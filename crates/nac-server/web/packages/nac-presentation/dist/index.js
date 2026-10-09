import { $ as e, $n as t, $r as n, $t as r, A as i, An as a, Ar as o, At as s, B as c, Bn as l, Br as u, Bt as d, C as f, Ci as p, Cn as m, Cr as h, Ct as g, D as _, Di as v, Dn as y, Dr as b, Dt as x, E as S, Ei as C, En as w, Et as T, F as E, Fn as D, Fr as O, Ft as k, G as ee, Gn as te, Gr as A, Gt as ne, H as re, Hn as j, Hr as ie, Ht as ae, I as oe, In as se, Ir as M, It as ce, J as le, Jn as ue, Jr as de, Jt as fe, K as pe, Kn as N, Kr as me, Kt as he, L as ge, Ln as P, Lr as F, Lt as _e, M as ve, Mi as I, Mn as ye, Mr as L, Mt as be, N as xe, Nn as Se, Nr as Ce, Nt as we, O as Te, Oi as Ee, On as De, Or as R, Ot as Oe, P as ke, Pn as Ae, Pr as je, Pt as Me, Q as Ne, Qn as Pe, Qr as Fe, Qt as Ie, R as Le, Rn as Re, Rr as z, Rt as ze, S as Be, Si as Ve, Sn as He, Sr as Ue, St as We, T as Ge, Ti as Ke, Tn as qe, Tr as Je, Tt as Ye, U as Xe, Un as Ze, Ur as Qe, Ut as $e, V as et, Vn as tt, Vr as nt, Vt as rt, W as it, Wn as at, Wr as ot, Wt as st, X as ct, Xn as lt, Xr as ut, Xt as dt, Y as ft, Yn as pt, Yr as mt, Yt as ht, Z as gt, Zn as _t, Zr as vt, Zt as yt, _ as bt, _i as xt, _n as St, _r as Ct, _t as wt, a as Tt, ai as Et, an as Dt, at as Ot, b as kt, bi as At, bn as jt, br as Mt, bt as Nt, c as Pt, ci as Ft, cn as It, cr as Lt, ct as Rt, d as zt, di as Bt, dn as Vt, dr as Ht, dt as Ut, ei as Wt, en as Gt, er as Kt, et as qt, f as Jt, fi as Yt, fn as Xt, fr as Zt, ft as Qt, g as $t, gi as en, gn as tn, gr as nn, gt as rn, h as an, hi as on, hn as sn, hr as cn, ht as ln, i as un, ii as dn, in as fn, ir as pn, it as mn, j as hn, ji as gn, jn as _n, jr as B, jt as vn, k as yn, ki as bn, kn as xn, kr as V, kt as Sn, l as Cn, li as wn, ln as Tn, lr as En, lt as Dn, m as On, mi as kn, mn as An, mr as jn, mt as Mn, n as Nn, ni as Pn, nn as Fn, nr as In, nt as Ln, o as Rn, oi as zn, on as Bn, or as Vn, ot as Hn, p as Un, pi as Wn, pn as Gn, pr as Kn, pt as qn, q as Jn, qn as Yn, qr as Xn, qt as Zn, r as Qn, ri as $n, rn as er, rr as tr, rt as nr, s as rr, si as ir, sn as ar, sr as or, st as sr, t as cr, ti as lr, tn as ur, tr as dr, tt as fr, u as pr, ui as mr, un as hr, ur as gr, ut as _r, v as vr, vi as yr, vn as br, vr as xr, vt as Sr, w as Cr, wi as wr, wn as Tr, wr as Er, wt as Dr, x as Or, xi as kr, xn as Ar, xr as jr, xt as Mr, y as Nr, yi as Pr, yn as Fr, yr as Ir, yt as Lr, z as Rr, zn as zr, zr as Br, zt as Vr } from "./chunks/PerfProfiler-Cme0gNrD.js";
import { Fragment as Hr, Suspense as Ur, createContext as Wr, lazy as Gr, memo as Kr, useCallback as H, useContext as qr, useEffect as U, useId as Jr, useLayoutEffect as Yr, useMemo as W, useRef as G, useState as K, useSyncExternalStore as Xr } from "react";
import { QueryClientProvider as Zr, QueryObserver as Qr, useIsFetching as $r, useQuery as ei, useQueryClient as ti } from "@tanstack/react-query";
import { Link as ni, Navigate as ri, Outlet as ii, Route as ai, Routes as oi, useLocation as si, useNavigate as ci, useParams as li } from "react-router-dom";
import { Fragment as q, jsx as J, jsxs as Y } from "react/jsx-runtime";
import { flushSync as ui } from "react-dom";
//#region src/app/features/ui-policy/UiPolicyProvider.tsx
var di = /* @__PURE__ */ new WeakMap(), fi = 0;
function pi(e) {
	let t = di.get(e);
	return t === void 0 && (t = ++fi, di.set(e, t)), t;
}
function mi({ children: e, client: t }) {
	let n = me(), r = t ?? n.client, i = ei({
		queryKey: [
			"ui-configuration",
			r.transport.endpoint,
			pi(r)
		],
		queryFn: async ({ signal: e }) => {
			let t = await r.getUiConfiguration(e);
			if (typeof t.orchestration_enabled != "boolean" || t.diagnostic !== null && typeof t.diagnostic != "string") throw Error("Invalid UI configuration response");
			return t;
		},
		retry: !1,
		staleTime: Infinity
	}), a = W(() => ({ orchestrationEnabled: i.data?.orchestration_enabled === !0 }), [i.data]);
	return i.isPending ? /* @__PURE__ */ J("div", {
		role: "status",
		className: "p-8",
		children: "Loading workspace configuration…"
	}) : i.isError ? /* @__PURE__ */ Y("div", {
		role: "alert",
		className: "p-8",
		children: [
			"Workspace configuration could not be loaded.",
			" ",
			/* @__PURE__ */ J("button", {
				onClick: () => void i.refetch(),
				children: "Try again"
			})
		]
	}) : /* @__PURE__ */ Y(Br.Provider, {
		value: a,
		children: [i.data.diagnostic ? /* @__PURE__ */ J("div", {
			role: "alert",
			className: "p-3",
			children: i.data.diagnostic
		}) : null, e]
	});
}
//#endregion
//#region src/app/atoms/avatar/index.tsx
var hi = /* @__PURE__ */ function(e) {
	return e.Micro = "w-4 h-4 text-[10px]", e.Small = "w-5 h-5 text-xs", e.Medium = "w-6 h-6 text-xs", e.Large = "w-8 h-8 text-sm", e.XLarge = "w-12 h-12 text-lg", e;
}({}), gi = ({ imageUrl: e, name: t, size: n = "w-6 h-6 text-xs", color: r = "var(--color-bg-accent-primary)", glyph: i = !1, className: a = "" }) => {
	let o = t?.trim() ?? "", s = i ? o : o[0]?.toUpperCase() ?? "?";
	return /* @__PURE__ */ J("div", {
		className: z("flex items-center justify-center shrink-0 rounded-full overflow-hidden", "font-semibold text-basic-primary-inverse shadow-convex", n, a),
		style: { background: e ? void 0 : r },
		children: e ? /* @__PURE__ */ J("img", {
			src: e,
			alt: o,
			className: "w-full h-full object-cover"
		}) : s
	});
};
gi.Size = hi;
//#endregion
//#region src/app/atoms/badge/index.tsx
var _i = /* @__PURE__ */ function(e) {
	return e.Neutral = "bg-elevation-sublevel-variant-B text-basic-secondary border-tertiary", e.Green = "bg-success-tertiary text-success-primary border-success-muted", e.Blue = "bg-info-tertiary text-info-primary border-info-muted", e.Red = "bg-error-tertiary text-error-primary border-error-muted", e.Yellow = "bg-danger-tertiary  text-danger-primary border-danger-muted", e.Violet = "bg-indigo-400 text-indigo-800 border-indigo-300", e.Gray = "bg-elevation-sublevel-variant-A text-basic-secondary border-muted", e;
}({}), vi = ({ text: e, color: t = "bg-elevation-sublevel-variant-B text-basic-secondary border-tertiary", className: n = "" }) => {
	let r = [
		"inline-block tag-label px-[8px] py-[3px] border rounded-full",
		t,
		n
	].filter(Boolean).join(" ");
	return /* @__PURE__ */ J("span", {
		className: r,
		children: e
	});
};
vi.Color = _i;
//#endregion
//#region src/app/atoms/box-surface/index.tsx
var yi = ({ title: e, headerContent: t, footer: n, className: r = "", bodyClassName: i = "", children: a }) => {
	let o = e != null || t != null;
	return /* @__PURE__ */ Y("div", {
		className: z("flex flex-col rounded-[8px] overflow-hidden bg-elevation-level-1 shadow-convex", r),
		children: [
			o ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-4 h-14 px-4 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ J("div", {
					className: "header-md text-basic-primary flex-1 min-w-0 truncate",
					children: e
				}), t]
			}) : null,
			/* @__PURE__ */ J("div", {
				className: z("flex-1 min-h-0 flex flex-col [&>*]:shrink-0", i),
				children: a
			}),
			n ? /* @__PURE__ */ J("div", {
				className: "flex items-center p-4 border-t border-muted shrink-0",
				children: n
			}) : null
		]
	});
}, bi = ({ variant: e = L.Ghost, content: t = o.Text, disabled: n, className: r = "", buttonClassName: i = "", children: a, loading: s = !1, type: c = "button", ...l }) => {
	let u = r.includes("flex-grow") || r.includes("flex-1");
	return /* @__PURE__ */ J("div", {
		className: z("bg-elevation-level-3 shadow-2xl rounded-full overflow-hidden h-10", u ? "flex w-full" : "inline-flex w-fit", r),
		children: /* @__PURE__ */ J(V, {
			size: B.Large,
			variant: e,
			content: t,
			type: c,
			disabled: n,
			loading: s,
			className: z("btn-sticky", u && "w-full", i),
			...l,
			children: a
		})
	});
};
bi.Variant = L, bi.Content = o;
//#endregion
//#region src/app/atoms/chat-loader/index.tsx
var xi = /* @__PURE__ */ function(e) {
	return e.Small = "w-1.5 h-1.5", e.Medium = "w-2 h-2", e.Large = "w-3 h-3", e;
}({}), Si = ({ size: e = "w-2 h-2", className: t = "" }) => /* @__PURE__ */ J("div", {
	role: "status",
	"aria-label": "Waiting for a response",
	className: z("flex items-end gap-1 fade", t),
	children: [
		0,
		1,
		2
	].map((t) => /* @__PURE__ */ J("span", { className: z("chat-loader-dot rounded-full bg-divider-secondary", e) }, t))
});
Si.Size = xi;
//#endregion
//#region src/app/atoms/chat-session-fork-mark/index.tsx
var Ci = ({ forkedFromTitle: e, running: t = !1, className: n = "" }) => {
	if (t) return /* @__PURE__ */ J(Ce, {
		size: je.Micro,
		variant: O.Neutral,
		className: "shrink-0"
	});
	let r = e?.trim();
	if (!r) return null;
	let i = `Fork of ${r}`;
	return /* @__PURE__ */ J(Zt, {
		title: i,
		position: Zt.Position.BottomCenter,
		sticky: !0,
		className: "shrink-0",
		children: /* @__PURE__ */ J("span", {
			className: "inline-flex shrink-0",
			"aria-label": i,
			children: /* @__PURE__ */ J(M, {
				iconName: F.Scheme,
				size: 16,
				className: z("shrink-0", n)
			})
		})
	});
}, wi = ({ title: e, active: t = !1, running: n = !1, icon: r = F.Plane, forkedFromTitle: i, badge: a, badgeLabel: o, unread: s = !1, isMobile: c = !1, actions: l, className: u = "", type: d = "button", "aria-label": f, ...p }) => {
	let m = t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered", h = n ? "text-shimmer-basic" : m;
	return /* @__PURE__ */ Y("div", {
		className: z("group flex items-center min-w-0 rounded-[4px]", c ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1", t ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered" : "hover:bg-btn-ghost-hovered", u),
		children: [/* @__PURE__ */ Y("button", {
			type: d,
			title: o ? `${e} · ${o}` : e,
			"aria-label": f ?? (o ? `${e}, ${o}` : e),
			"aria-current": t ? "page" : void 0,
			className: z("flex flex-1 items-center min-w-0 rounded-[3px] text-left", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary", c ? "gap-3" : "gap-1.5"),
			...p,
			children: [
				/* @__PURE__ */ J(M, {
					iconName: r,
					size: 20,
					"aria-hidden": !0,
					"data-session-behavior-icon": r,
					className: z("shrink-0", m)
				}),
				/* @__PURE__ */ J("span", {
					className: z("min-w-0 flex-1 truncate", c ? "text-medium" : "label-small", h),
					children: e
				}),
				/* @__PURE__ */ J(Ci, {
					forkedFromTitle: i,
					className: m
				}),
				a ? /* @__PURE__ */ J("span", {
					title: o,
					className: "tag-label max-w-[76px] shrink-0 truncate rounded bg-elevation-level-3 px-1 text-basic-tertiary",
					children: a
				}) : null,
				s ? /* @__PURE__ */ J("span", {
					className: "h-2 w-2 shrink-0 rounded-full bg-accent-primary",
					title: "Updated since last viewed",
					children: /* @__PURE__ */ J("span", {
						className: "sr-only",
						children: "Unread"
					})
				}) : null
			]
		}), l ? /* @__PURE__ */ J("div", {
			className: z("flex items-center gap-1 shrink-0", c ? null : "hidden group-hover:flex group-has-[:focus-visible]:flex"),
			children: l
		}) : null]
	});
}, Ti = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), Ei = {
	info: "border-info-primary text-info-primary",
	error: "border-error-primary text-error-primary",
	danger: "border-danger-primary text-danger-primary",
	success: "border-success-primary text-success-primary"
}, Di = {
	info: F.Info,
	error: F.Close,
	danger: F.Danger,
	success: F.CheckCircle
}, Oi = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, ki = ({ title: e, variant: t = "info", action: n, className: r = "", children: i, ...a }) => /* @__PURE__ */ J("div", {
	className: z("flex w-full items-start overflow-hidden border-l-2 px-4 py-2", Ei[t], r),
	...a,
	children: /* @__PURE__ */ Y("div", {
		className: "flex flex-1 min-w-0 flex-col items-start gap-2",
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex w-full items-start gap-1.5",
				children: [/* @__PURE__ */ J(M, {
					iconName: Di[t],
					size: 20,
					color: Oi[t],
					className: "shrink-0"
				}), /* @__PURE__ */ J("p", {
					className: "flex-1 min-w-0 header-sm break-words !my-0",
					children: e
				})]
			}),
			i ? /* @__PURE__ */ J("div", {
				className: "w-full text-small break-words",
				children: i
			}) : null,
			n ? /* @__PURE__ */ J(V, {
				size: B.Small,
				variant: L.Primary,
				content: o.Text,
				onClick: n.onClick,
				children: n.label
			}) : null
		]
	})
});
ki.Variant = Ti;
//#endregion
//#region src/app/atoms/chat-session-orphan-avatar/index.tsx
var Ai = (e) => Math.round(e * .7 / 4) * 4, ji = (e) => Math.round(e / 10), Mi = ({ size: e = 40, isRunning: t = !1, className: n = "", ...r }) => /* @__PURE__ */ J("div", {
	className: z("flex items-center justify-center shrink-0", "border border-muted bg-elevation-sublevel-variant-B", n),
	style: {
		width: e,
		height: e,
		borderRadius: ji(e)
	},
	"aria-hidden": "true",
	...r,
	children: /* @__PURE__ */ J(M, {
		iconName: F.Chat,
		size: Ai(e),
		className: z("text-basic-secondary", t && "pulse-dim")
	})
}), Ni = ({ rows: e = 3, className: t = "", rowClassName: n = "" }) => /* @__PURE__ */ J("div", {
	className: z("flex flex-col gap-2", t),
	children: Array.from({ length: e }).map((e, t) => /* @__PURE__ */ J("div", {
		className: z("relative h-4 rounded-[4px] overflow-hidden bg-elevation-level-2", n),
		children: /* @__PURE__ */ J("div", {
			className: "absolute inset-0 animate-shimmer bg-[length:200%_100%] bg-[position:-200%_0]",
			style: { backgroundImage: "linear-gradient(90deg, transparent 0%, var(--color-bg-btn-secondary-highlighted-hovered) 50%, transparent 100%)" }
		})
	}, t))
}), Pi = ({ title: e, active: t = !1, running: n = !1, forkedFromTitle: r, behaviorIcon: i, behaviorLabel: a, onDismiss: s, className: c = "", type: l = "button", "aria-label": u, ...d }) => {
	let f = n ? "text-shimmer-basic" : r ? "text-btn-secondary group-hover:text-btn-secondary-hovered" : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered", p = /* @__PURE__ */ Y("button", {
		type: l,
		title: e,
		"aria-label": u ?? (a ? `${e}, ${a}` : e),
		"aria-current": t ? "page" : void 0,
		className: "flex h-10 w-full min-w-0 flex-1 items-center justify-start gap-1 py-1 pl-2 pr-2 group-hover:pr-8 group-has-[:focus-visible]:pr-8",
		...d,
		children: [
			/* @__PURE__ */ J(Ci, {
				forkedFromTitle: r,
				running: n,
				className: n ? void 0 : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered"
			}),
			i ? /* @__PURE__ */ J(M, {
				iconName: i,
				size: 16,
				"aria-hidden": !0,
				"data-session-behavior-icon": i,
				className: z("shrink-0", f)
			}) : null,
			/* @__PURE__ */ J("span", {
				"data-session-tab-title": !0,
				className: z("label-micro w-full min-w-0 flex-1 truncate text-left", f),
				children: e
			})
		]
	});
	return /* @__PURE__ */ Y("div", {
		className: z("chat-session-tab group relative flex w-32 max-w-full shrink-0 items-center justify-start gap-1", t ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered" : "hover:bg-btn-ghost-hovered", c),
		children: [a ? /* @__PURE__ */ J(Zt, {
			title: a,
			position: Zt.Position.BottomLeft,
			sticky: !0,
			className: "min-w-0 flex-1",
			children: p
		}) : p, s ? /* @__PURE__ */ J(V, {
			variant: L.Tertiary,
			size: B.Small,
			content: o.Icon,
			"aria-label": `Close ${e}`,
			title: "Close tab",
			onClick: (e) => {
				e.stopPropagation(), s();
			},
			className: "absolute right-1 top-1/2 -translate-y-1/2 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto",
			children: /* @__PURE__ */ J(M, { iconName: F.Close })
		}) : null]
	});
}, Fi = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ Y("label", {
	className: z("flex items-center gap-2 w-fit", n ? "cursor-not-allowed opacity-60" : "", i),
	children: [
		/* @__PURE__ */ J("input", {
			type: "checkbox",
			checked: e,
			onChange: (e) => t(e.target.checked),
			disabled: n,
			className: "sr-only peer",
			...a
		}),
		/* @__PURE__ */ J("span", {
			"aria-hidden": "true",
			className: z("flex items-center justify-center shrink-0 w-4 h-4 rounded-[4px] border transition-colors duration-150", "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-primary", n ? "bg-btn-secondary-disabled border-muted" : e ? "bg-btn-secondary-accent border-accent-primary hover:bg-btn-secondary-accent-hovered" : "bg-btn-secondary border-secondary hover:bg-btn-secondary-hovered hover:border-tertiary"),
			children: e ? /* @__PURE__ */ J(M, {
				iconName: F.Check,
				size: 14,
				className: "fade",
				color: "var(--color-fill-accent-primary)"
			}) : null
		}),
		r ? /* @__PURE__ */ J("span", {
			className: "label-small text-basic-primary",
			children: r
		}) : null
	]
}), Ii = "en-US", Li = new Intl.DateTimeFormat(Ii, {
	month: "long",
	year: "numeric"
}), Ri = new Intl.DateTimeFormat(Ii, { weekday: "short" }), zi = (e) => new Date(e.getFullYear(), e.getMonth(), 1), Bi = (e, t) => new Date(e.getFullYear(), e.getMonth() + t, 1), Vi = (e, t) => new Date(e.getFullYear(), e.getMonth(), e.getDate() + t), Hi = (e) => new Date(e.getFullYear(), e.getMonth(), e.getDate()), Ui = (e, t) => e.getFullYear() === t.getFullYear() && e.getMonth() === t.getMonth() && e.getDate() === t.getDate(), Wi = (e) => Ui(e, /* @__PURE__ */ new Date()), Gi = (e, t, n) => {
	let r = Hi(e).getTime();
	return r >= Hi(t).getTime() && r <= Hi(n).getTime();
}, Ki = (e, t, n) => {
	let r = Hi(e).getTime();
	return !!(t && r < Hi(t).getTime() || n && r > Hi(n).getTime());
}, qi = (e) => Li.format(e), Ji = () => {
	let e = new Date(2021, 7, 1);
	return Array.from({ length: 7 }, (t, n) => Ri.format(Vi(e, n)));
}, Yi = (e) => `${e.getFullYear()}-${e.getMonth()}-${e.getDate()}`;
function Xi(e) {
	let t = zi(e), n = t.getDay(), r = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate(), i = [];
	for (let e = -n; e < 0; e += 1) i.push({
		date: Vi(t, e),
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
//#endregion
//#region src/app/atoms/date-picker/DayGrid.tsx
function Zi(e, t, n, r) {
	return e || t ? L.Primary : n ? L.GhostHighlightedAccent : r ? L.SecondaryHighlighted : L.Ghost;
}
var Qi = ({ days: e, selected: t, range: n, focused: r, min: i, max: a, disabled: o = !1, onSelect: s, onFocusDay: c, onNavigate: l }) => {
	let u = G(null);
	U(() => {
		let e = u.current;
		if (!r || !e) return;
		let t = requestAnimationFrame(() => {
			let t = e.querySelector(`button[data-day="${Yi(r)}"]`);
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
	return /* @__PURE__ */ J("div", {
		ref: u,
		className: "grid grid-cols-7 gap-y-1 p-2",
		role: "rowgroup",
		children: e.map(({ date: e, inMonth: l }) => {
			let u = t ? Ui(e, t) : !1, f = n?.from ? Ui(e, n.from) : !1, p = n?.to ? Ui(e, n.to) : !1, m = n?.from && n?.to ? Gi(e, n.from, n.to) : !1, h = o || !l || Ki(e, i, a), g = f && p ? null : f ? "rounded-r-none" : p ? "rounded-l-none" : m ? "rounded-none" : null;
			return /* @__PURE__ */ J("div", {
				role: "gridcell",
				"aria-selected": u,
				children: /* @__PURE__ */ J(V, {
					"data-day": Yi(e),
					variant: Zi(u, f || p, m, Wi(e)),
					size: B.Medium,
					disabled: h,
					tabIndex: r && Ui(e, r) ? 0 : -1,
					className: z("w-full", g, !l && "invisible"),
					onClick: () => s(e),
					onFocus: () => c(e),
					onKeyDown: (t) => d(t, e),
					children: e.getDate()
				})
			}, Yi(e));
		})
	});
}, $i = Ji(), ea = ({ selected: e, onSelect: t, range: n, onRangeChange: r, min: i, max: a, disabled: s = !1, defaultMonth: c, className: l = "" }) => {
	let u = n ? n.to ?? n.from : e, [d, f] = K(() => zi(c ?? u ?? /* @__PURE__ */ new Date())), [p, m] = K(u), h = W(() => Xi(d), [d]);
	return /* @__PURE__ */ Y("div", {
		role: "group",
		"aria-label": "Calendar",
		className: z("flex flex-col min-w-0 w-[280px]", l),
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex items-center justify-between gap-2 p-1 border-b border-muted",
				children: [
					/* @__PURE__ */ J(V, {
						variant: L.Ghost,
						size: B.Medium,
						content: o.Icon,
						"aria-label": "Previous month",
						onClick: () => f((e) => Bi(e, -1)),
						children: /* @__PURE__ */ J(M, { iconName: F.Left })
					}),
					/* @__PURE__ */ J("div", {
						className: "label-small text-basic-primary",
						"aria-live": "polite",
						children: qi(d)
					}),
					/* @__PURE__ */ J(V, {
						variant: L.Ghost,
						size: B.Medium,
						content: o.Icon,
						"aria-label": "Next month",
						onClick: () => f((e) => Bi(e, 1)),
						children: /* @__PURE__ */ J(M, { iconName: F.Right })
					})
				]
			}),
			/* @__PURE__ */ J("div", {
				className: "grid grid-cols-7 px-2 pt-2",
				role: "row",
				children: $i.map((e) => /* @__PURE__ */ J("div", {
					role: "columnheader",
					className: "label-micro text-basic-tertiary text-center py-1",
					children: e
				}, e))
			}),
			/* @__PURE__ */ J(Qi, {
				days: h,
				selected: n ? void 0 : e,
				range: n,
				focused: p,
				min: i,
				max: a,
				disabled: s,
				onSelect: (e) => {
					if (m(e), !n) {
						t?.(e);
						return;
					}
					let i = n.from;
					if (!i || n.to) {
						r?.({
							from: e,
							to: void 0
						});
						return;
					}
					r?.(e < i ? {
						from: e,
						to: i
					} : {
						from: i,
						to: e
					});
				},
				onFocusDay: m,
				onNavigate: (e, t) => {
					let n = Vi(e, t);
					m(n), (n.getFullYear() !== d.getFullYear() || n.getMonth() !== d.getMonth()) && f(zi(n));
				}
			})
		]
	});
}, ta = /* @__PURE__ */ function(e) {
	return e[e.Small = 16] = "Small", e[e.Medium = 20] = "Medium", e[e.Large = 24] = "Large", e;
}({}), na = ({ title: e, description: t, size: n = 16, position: r = R.TopCenter, className: i = "", muted: a = !1 }) => /* @__PURE__ */ J(Zt, {
	title: e,
	description: t,
	position: r,
	sticky: !0,
	showTooltipOnMobile: !0,
	className: i,
	children: /* @__PURE__ */ J(M, {
		iconName: F.Info,
		size: n,
		className: z("cursor-help shrink-0", a && "[&>path]:!fill-basic-muted"),
		color: a ? void 0 : "var(--color-fill-basic-tertiary)"
	})
});
na.Size = ta;
//#endregion
//#region src/app/atoms/label/index.tsx
var ra = /* @__PURE__ */ function(e) {
	return e.Micro = "label-micro", e.Small = "label-small", e.Medium = "label-medium", e;
}({}), ia = {
	"label-micro": 16,
	"label-small": 20,
	"label-medium": 24
}, aa = {
	"label-micro": ta.Small,
	"label-small": ta.Small,
	"label-medium": ta.Medium
}, oa = ({ children: e, htmlFor: t, size: n = "label-small", icon: r, validation: i = !1, tone: a = "secondary", hoverHint: o, className: s = "" }) => /* @__PURE__ */ Y("label", {
	htmlFor: t,
	className: z("flex items-center gap-1.5 min-w-0", n, i ? "text-error-primary" : a === "primary" ? "text-basic-primary" : a === "muted" ? "text-basic-muted" : "text-basic-secondary", s),
	children: [
		r ? /* @__PURE__ */ J(M, {
			iconName: r,
			size: ia[n],
			className: "shrink-0"
		}) : null,
		/* @__PURE__ */ J("span", {
			className: "truncate",
			children: e
		}),
		o ? /* @__PURE__ */ J(na, {
			title: o.title,
			description: o.description,
			muted: o.muted,
			size: aa[n]
		}) : null
	]
});
oa.Size = ra;
//#endregion
//#region src/app/atoms/input/InputWrapper.tsx
var sa = ({ label: e, required: t, validation: n, validationText: r, hintText: i, hoverHint: a, className: o, children: s }) => /* @__PURE__ */ Y("div", {
	className: z("flex text-left flex-col gap-1", o),
	children: [
		e ? /* @__PURE__ */ Y("div", {
			className: "flex gap-2 items-center",
			children: [/* @__PURE__ */ J(oa, {
				validation: n,
				hoverHint: a,
				tone: "primary",
				className: "flex-1",
				children: e
			}), t ? /* @__PURE__ */ J("div", {
				className: z("text-micro shrink-0", n ? "text-error-secondary" : "text-basic-tertiary"),
				children: "* Required"
			}) : null]
		}) : null,
		s,
		n && r ? /* @__PURE__ */ J("p", {
			className: "pt-1 text-error-primary text-micro",
			children: r
		}) : !n && i ? /* @__PURE__ */ J("p", {
			className: "pt-1 text-basic-muted text-micro",
			children: i
		}) : null
	]
}), ca = (e) => `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`, la = (e) => {
	let t = e?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (t) return new Date(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
}, ua = (e) => {
	let t = la(e);
	return t ? t.toLocaleDateString("en-US") : "";
}, da = ({ value: e, onChange: t, range: n, onRangeChange: r, size: i = B.Medium, disabled: a = !1, validation: s, validationText: c, placement: l = R.BottomRight, min: u, max: d, placeholder: f, label: p, required: m, hintText: h, hoverHint: g, className: _ = "" }) => {
	let [v, y] = K(!1), b = !!n, x = b ? n?.from || n?.to ? `${ua(n?.from) || "Start"} – ${ua(n?.to) || "End"}` : f ?? "Select range" : (ua(e) || f) ?? "Select date", S = b ? /* @__PURE__ */ J(ea, {
		range: {
			from: la(n?.from),
			to: la(n?.to)
		},
		onRangeChange: (e) => {
			r?.({
				from: e.from ? ca(e.from) : null,
				to: e.to ? ca(e.to) : null
			}), e.from && e.to && y(!1);
		},
		min: la(u),
		max: la(d),
		disabled: a
	}) : /* @__PURE__ */ J(ea, {
		selected: la(e),
		onSelect: (e) => {
			t?.(ca(e)), y(!1);
		},
		min: la(u),
		max: la(d),
		disabled: a
	});
	return /* @__PURE__ */ J(sa, {
		label: p,
		required: m,
		validation: s,
		validationText: c,
		hintText: h,
		hoverHint: g,
		className: _,
		children: /* @__PURE__ */ J(Kn, {
			open: v,
			onClose: () => y(!1),
			placement: l,
			size: jn.Fit,
			sticky: !0,
			className: "w-full",
			panelClassName: "p-0",
			content: S,
			children: /* @__PURE__ */ Y(V, {
				variant: v ? L.SecondaryHighlighted : L.Secondary,
				size: i,
				content: o.IconLeft,
				disabled: a,
				"aria-haspopup": "dialog",
				"aria-expanded": v,
				className: z("w-full justify-between", s && "input-validation"),
				onClick: () => y((e) => !e),
				children: [
					/* @__PURE__ */ J(M, { iconName: F.Calendar }),
					/* @__PURE__ */ J("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: x
					}),
					/* @__PURE__ */ J(M, {
						iconName: F.Down,
						className: z("transition-transform", v && "rotate-180")
					})
				]
			})
		})
	});
}, fa = ({ isOpen: e, children: t, className: n = "", onCloseMaxHeight: r, isScrollable: i = !1, scrollToBottom: a = !1, ...o }) => {
	let s = G(null), c = G(null), [l, u] = K(0), d = G(null);
	U(() => {
		if (s.current) if (e) {
			let e = s.current.scrollHeight;
			u(e);
		} else u(r ?? 0);
	}, [e, r]), U(() => {
		if (!e || !s.current) return;
		let t = () => {
			s.current && u(s.current.scrollHeight);
		}, n = new ResizeObserver(t);
		return n.observe(s.current), t(), () => {
			n.disconnect();
		};
	}, [e]), U(() => {
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
	return /* @__PURE__ */ J("div", {
		...o,
		ref: c,
		className: z(f, "transition-[height] duration-150 ease-out", n),
		style: {
			height: `${l}px`,
			...o.style
		},
		children: /* @__PURE__ */ J("div", {
			ref: s,
			children: t
		})
	});
}, pa = /* @__PURE__ */ function(e) {
	return e.Micro = "header-micro", e.Small = "header-small", e.Medium = "header-medium", e;
}({}), ma = ({ value: e, onCommit: t, size: n = "header-small", placeholder: r = "Untitled", disabled: i = !1, className: a = "" }) => {
	let [o, s] = K(!1), [c, l] = K(e), u = G(null), [d, f] = K(e);
	d !== e && (f(e), o || l(e)), U(() => {
		if (!o) return;
		let e = u.current;
		e?.focus(), e?.select();
	}, [o]);
	let p = () => {
		s(!1);
		let n = c.trim();
		n && n !== e ? t(n) : l(e);
	};
	return /* @__PURE__ */ J("div", {
		className: z("flex items-center min-w-0 h-8", n, a),
		children: o ? /* @__PURE__ */ J("input", {
			ref: u,
			value: c,
			placeholder: r,
			className: z("w-full min-w-0 bg-btn-secondary-hovered text-basic-primary font-normal", "rounded-t-[4px] border-b border-primary outline-none px-1", n),
			onChange: (e) => l(e.target.value),
			onBlur: p,
			onKeyDown: (t) => {
				t.key === "Enter" && (t.preventDefault(), p()), t.key === "Escape" && (t.preventDefault(), l(e), s(!1));
			}
		}) : /* @__PURE__ */ J("button", {
			type: "button",
			disabled: i,
			className: z("min-w-0 truncate text-left text-basic-primary px-1", i ? "cursor-default" : "cursor-text", n),
			onClick: () => !i && s(!0),
			children: e || r
		})
	});
};
ma.Size = pa;
//#endregion
//#region src/app/atoms/file-icon/icons/asciidoc.svg?raw
var ha = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M4 18V8l5.39 10Zm0 4v3.67A2.33 2.33 0 0 0 6.33 28h8.9l-3.496-6Zm12.444 0 3.177 5.444A11.88 11.88 0 0 0 26.448 22Zm11.419-4A15 15 0 0 0 28 16 12 12 0 0 0 16 4L6 3.995q-.08 0-.158.005L14 18Z\"/></svg>", ga = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff6e40\" d=\"M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2v-1H2V2h2V1Zm10 0v1h2v12h-2v1h2a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1ZM6 3c0 1 0 1-1 1v1h1v2h1V3Zm3 0a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm0 1h1v2H9ZM6 9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Zm4 0c0 1 0 1-1 1v1h1v2h1V9Zm-4 1h1v2H6Z\"/></svg>", _a = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M12.106 25.849c-1.262-1.156-1.63-3.586-1.105-5.346a5.18 5.18 0 0 0 3.484 1.66 9.68 9.68 0 0 0 5.882-.734c.215-.106.413-.247.648-.39a3.5 3.5 0 0 1 .16 1.555 4.26 4.26 0 0 1-1.798 3.021c-.404.3-.832.569-1.25.852a2.613 2.613 0 0 0-1.15 3.372l.048.161a3.4 3.4 0 0 1-1.5-1.285 3.6 3.6 0 0 1-.578-1.962 9 9 0 0 0-.05-1.037c-.114-.831-.504-1.204-1.238-1.225a1.45 1.45 0 0 0-1.507 1.18c-.012.056-.028.112-.046.178M4.901 20a17.75 17.75 0 0 1 7.4-2l2.913-8.38a.765.765 0 0 1 1.527 0L19.7 18a14.24 14.24 0 0 1 7.399 2S20.704 2.877 20.692 2.842C20.51 2.33 20.202 2 19.787 2h-7.619c-.415 0-.71.33-.904.842z\"/></svg>", va = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m6 10h-4v8a4 4 0 1 1-4-4 3.96 3.96 0 0 1 2 .555V8h6Z\"/></svg>", ya = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fbc02d\" d=\"M3 18S4.15 6.885 7 3l5 1-1 3H9v7h1c1.9-2.915 5.783-3.98 8.157-2.915 4.475 1.915 2.998 5.967.148 7.905C16.025 20.548 10.113 23.05 3 18\"/></svg>", ba = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", xa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g transform=\"translate(0 -822.52)\"><rect width=\"107.25\" height=\"156.59\" x=\"405.55\" y=\"967.22\" fill=\"#0097a7\" rx=\"12.306\" ry=\"12.31\" transform=\"matrix(-.98339 .18149 .60192 .79856 0 0)\"/><rect width=\"108.34\" height=\"123.15\" x=\"-1156.5\" y=\"1461.9\" fill=\"#3f51b5\" rx=\"10.69\" ry=\"12.31\" transform=\"matrix(-.98528 .17093 -.59175 .80612 0 0)\"/><path fill=\"#3f51b5\" d=\"M52.112 965.158c-1.343 3.515-26.292 23.248-25.744 27.277.548 4.03 29.812 16.023 32.04 19.027s10.545 41.668 13.603 42.5 18.828-31.274 21.548-32.932 32.808 2.503 34.15-1.01c1.343-3.515-18.174-35.352-18.721-39.381s9.732-40.12 7.502-43.125-30.06 9.427-33.118 8.594-26.793-27.3-29.514-25.643-.405 41.177-1.747 44.693z\"/></g></svg>", Sa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M2 2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h6v3l2-1.25L12 14v-3h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Zm0 1h4v1H2Zm6 0 2 1.25L12 3v2.5l2 1-2 1V10l-2-1.25L8 10V7.5l-2-1 2-1zM2 5h3v1H2Zm0 2h3v1H2Zm0 2h4v1H2Z\"/></svg>", Ca = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path fill=\"#64dd17\" d=\"M123.456 129.975a507 507 0 0 0-3.54 7.846c-4.406 9.981-9.284 22.127-11.066 29.908-.64 2.77-1.037 6.205-1.03 10.013 0 1.506.081 3.09.21 4.702a58.1 58.1 0 0 0 19.98 3.559 58.2 58.2 0 0 0 18.29-2.98c-1.352-1.237-2.642-2.554-3.816-4.038-7.796-9.942-12.146-24.512-19.028-49.01m-28.784-49.39C79.782 91.08 70.039 108.387 70.002 128c.037 19.32 9.487 36.403 24.002 46.94 3.56-14.83 12.485-28.41 25.868-55.63a219 219 0 0 0-2.714-7.083c-3.708-9.3-9.059-20.102-13.834-24.993-2.435-2.555-5.389-4.763-8.652-6.648\"/><path fill=\"#7cb342\" d=\"M178.532 194.535c-7.683-.963-14.023-2.124-19.57-4.081a69.4 69.4 0 0 1-30.958 7.249c-38.491 0-69.693-31.198-69.698-69.7 0-20.891 9.203-39.62 23.764-52.392-3.895-.94-7.956-1.49-12.104-1.482-20.45.193-42.037 11.51-51.025 42.075-.84 4.45-.64 7.813-.64 11.8 0 60.591 49.12 109.715 109.705 109.715 37.104 0 69.882-18.437 89.732-46.633-10.736 2.675-21.06 3.955-29.902 3.982-3.314 0-6.425-.177-9.305-.53\"/><path fill=\"#29b6f6\" d=\"M157.922 173.271c.678.336 2.213.884 4.35 1.49 14.375-10.553 23.717-27.552 23.754-46.764h-.005c-.055-32.03-25.974-57.945-58.011-58.009a58.2 58.2 0 0 0-18.213 2.961c11.779 13.426 17.443 32.613 22.922 53.6l.01.025c.01.017 1.752 5.828 4.743 13.538 2.97 7.7 7.203 17.231 11.818 24.178 3.03 4.655 6.363 8 8.632 8.981\"/><path fill=\"#1e88e5\" d=\"M128.009 18.29c-36.746 0-69.25 18.089-89.16 45.826 10.361-6.49 20.941-8.83 30.174-8.747 12.753.037 22.779 3.991 27.589 6.696a51 51 0 0 1 3.345 2.131 69.4 69.4 0 0 1 28.049-5.894c38.496.004 69.703 31.202 69.709 69.698h-.006c0 19.409-7.938 36.957-20.736 49.594 3.142.352 6.492.571 9.912.554 12.15.006 25.284-2.675 35.13-10.956 6.42-5.408 11.798-13.327 14.78-25.199.584-4.586.92-9.247.92-13.991 0-60.588-49.116-109.715-109.705-109.715\"/></svg>", wa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M11.94 2.984 2.928 21.017l9.875-8.47z\"/><path fill=\"#e53935\" d=\"m11.958 2.982.002.29 1.312 14.499-.002.006.023.26 7.363 2.978h.415l-.158-.31-.114-.228h-.001l-8.84-17.494z\"/><path fill=\"#7cb342\" d=\"m8.558 16.13-5.627 4.884h17.743v-.016z\"/></svg>", Ta = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff7043\" d=\"M2 2a1 1 0 0 0-1 1v10c0 .554.446 1 1 1h12c.554 0 1-.446 1-1V3a1 1 0 0 0-1-1zm0 3h12v8H2zm1 2 2 2-2 2 1 1 3-3-3-3zm5 3.5V12h5v-1.5z\"/></svg>", Ea = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#0288d1\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", Da = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#cfd8dc\" d=\"m179.363 121.67-57.623 57.507c-.23.23-.576.346-.806.23l-78.713-21.09c-.346-.115-.577-.345-.577-.576L20.44 79.144c-.115-.345 0-.576.23-.806L78.294 20.83c.23-.23.576-.346.807-.23l78.713 21.09c.345.114.576.345.576.575l21.09 78.597c.23.346.115.577-.115.807zm-77.215-62.58-77.33 20.63c-.115 0-.23.23-.115.345l56.586 56.47c.115.115.346.115.346-.115l20.744-77.215c.115 0-.115-.23-.23-.116z\"/></svg>", Oa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M30 14v-2h-2V8h-2v4h-2V8h-2v4h-2v2h2v2h-2v2h2v4h2v-4h2v4h2v-4h2v-2h-2v-2Zm-4 2h-2v-2h2Zm-12.437 6A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", ka = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7e57c2\" d=\"M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034\"/><path fill=\"#7e57c2\" d=\"M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z\"/></svg>", Aa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#4fc3f7\" d=\"M16.83 2a1.3 1.3 0 0 0-.916.377l-.013.01L7.323 7.34l8.556 8.55v.005l10.283 10.277 1.96-3.529-7.068-16.96-3.299-3.297A1.3 1.3 0 0 0 16.828 2Z\"/><path fill=\"#01579b\" d=\"m7.343 7.32-4.955 8.565-.01.013a1.297 1.297 0 0 0 .004 1.835l.005.005 4.106 4.107 16.064 6.314 3.632-2.015-.098-.098-.025.002L15.995 15.97h-.012z\"/><path fill=\"#01579b\" d=\"m7.321 7.324 8.753 8.755h.013L26.16 26.156l3.835-.73L30 14.089l-4.049-3.965a6.5 6.5 0 0 0-3.618-1.612l.002-.043L7.323 7.325Z\"/><path fill=\"#64b5f6\" d=\"m7.332 7.335 8.758 8.75v.013l10.079 10.071L25.436 30H14.09l-3.967-4.048a6.5 6.5 0 0 1-1.611-3.618l-.045.004Z\"/></svg>", ja = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M16 24c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-8c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-12C10.477 4 6 4.895 6 6v4c0 1.1 4.475 2 10 2s10-.9 10-2V6c0-1.105-4.477-2-10-2\"/></svg>", Ma = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M18 23H4c-1.1 0-2-.9-2-2V7h2v14h14zM14.5 7V5h-2v2h-2v2h2v2h2V9h2V7zm2 6h-6v2h6zM15 1H8c-1.1 0-1.99.9-1.99 2L6 17c0 1.1.89 2 1.99 2H19c1.1 0 2-.9 2-2V7zm4 16H8V3h6.17L19 7.83z\"/></svg>", Na = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#42a5f5\" d=\"M6 2a2 2 0 0 0-2 2v16c0 1.11.89 2 2 2h6v-2H6V4h7v5h5v3h2V8l-6-6m4 12a.26.26 0 0 0-.26.21l-.19 1.32c-.3.13-.59.29-.85.47l-1.24-.5c-.11 0-.24 0-.31.13l-1 1.73c-.06.11-.04.24.06.32l1.06.82a4.2 4.2 0 0 0 0 1l-1.06.82a.26.26 0 0 0-.06.32l1 1.73c.06.13.19.13.31.13l1.24-.5c.26.18.54.35.85.47l.19 1.32c.02.12.12.21.26.21h2c.11 0 .22-.09.24-.21l.19-1.32c.3-.13.57-.29.84-.47l1.23.5c.13 0 .26 0 .33-.13l1-1.73a.26.26 0 0 0-.06-.32l-1.07-.82c.02-.17.04-.33.04-.5s-.01-.33-.04-.5l1.06-.82a.26.26 0 0 0 .06-.32l-1-1.73c-.06-.13-.19-.13-.32-.13l-1.23.5c-.27-.18-.54-.35-.85-.47l-.19-1.32A.236.236 0 0 0 20 14m-1 3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5c-.84 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5\"/></svg>", Pa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M21.81 10.25c-.06-.04-.56-.43-1.64-.43-.28 0-.56.03-.84.08-.21-1.4-1.38-2.11-1.43-2.14l-.29-.17-.18.27c-.24.36-.43.77-.51 1.19-.2.8-.08 1.56.33 2.21-.49.28-1.29.35-1.46.35H2.62c-.34 0-.62.28-.62.63 0 1.15.18 2.3.58 3.38.45 1.19 1.13 2.07 2 2.61.98.6 2.59.94 4.42.94.79 0 1.61-.07 2.42-.22 1.12-.2 2.2-.59 3.19-1.16A8.3 8.3 0 0 0 16.78 16c1.05-1.17 1.67-2.5 2.12-3.65h.19c1.14 0 1.85-.46 2.24-.85.26-.24.45-.53.59-.87l.08-.24zm-17.96.99h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H3.85c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.43 0h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H6.28c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.47 0h1.75c.1 0 .17-.07.17-.16V9.5c0-.08-.06-.16-.17-.16H8.75c-.08 0-.15.07-.15.16v1.58c0 .09.06.16.15.16m2.44 0h1.77c.08 0 .15-.07.15-.16V9.5c0-.08-.06-.16-.15-.16h-1.77c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16M6.28 9h1.76c.08 0 .16-.09.16-.18V7.25c0-.09-.07-.16-.16-.16H6.28c-.09 0-.16.06-.16.16v1.57c.01.09.07.18.16.18m2.47 0h1.75c.1 0 .17-.09.17-.18V7.25c0-.09-.06-.16-.17-.16H8.75c-.08 0-.15.06-.15.16v1.57c0 .09.06.18.15.18m2.44 0h1.77c.08 0 .15-.09.15-.18V7.25c0-.09-.07-.16-.15-.16h-1.77c-.08 0-.15.06-.15.16v1.57c0 .09.07.18.15.18m0-2.28h1.77c.08 0 .15-.07.15-.16V5c0-.1-.07-.17-.15-.17h-1.77c-.08 0-.15.06-.15.17v1.56c0 .08.07.16.15.16m2.46 4.52h1.76c.09 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16h-1.76c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16\"/></svg>", Fa = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 16h8v2H8zm0-4h8v2H8zm6-10H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm4 18H6V4h7v5h5z\"/></svg>", Ia = "<svg xmlns=\"http://www.w3.org/2000/svg\" clip-rule=\"evenodd\" image-rendering=\"optimizeQuality\" shape-rendering=\"geometricPrecision\" text-rendering=\"geometricPrecision\" viewBox=\"0 0 3473 3473\"><path fill=\"#ede7f6\" d=\"M989.342 1977.409c41.146-26.835 75.137-93.922 54.564-141.33-56.353 24.151-53.67 79.61-54.564 141.33m636.877 153.851c44.724-14.311 87.66-64.402 63.509-116.283-34.886 24.151-57.248 57.247-63.51 116.284z\"/><g fill=\"#fafafa\"><path d=\"M374.827 2871.899c0 56.352 14.312 117.178 53.67 138.645 144.907 81.4 652.977 17.89 825.614-20.573 90.343-20.573 163.692-87.66 248.668-124.334 191.421-83.187 330.067-150.274 483.025-262.085 110.916-81.399 287.131-310.388 305.915-447.245l-151.169-33.991c-3.578 153.852-38.463 188.737-175.32 224.517-92.132 25.046-271.925 30.413-365.846 14.312-124.334-20.574-180.687-85.871-237.04-160.114-109.128-144.907 24.151-245.985-148.485-255.824-181.582 222.728-501.81 62.614-642.244 40.252-59.93 86.765-200.366 650.294-198.577 779.1 86.766-29.517 141.33 2.684 219.15 33.097 275.503 106.444 34.885 200.366-75.137 172.636-75.137-17.89-98.394-67.086-142.224-98.393m360.48-1285.383c111.81 21.468 211.1 67.982 305.915 115.39 154.747 76.926 182.476 66.192 196.788 173.53 1.789 19.68-1.789 30.413 54.564 48.303 94.816 29.518-54.564-23.257 199.471-22.362 151.169.894 497.337 61.72 609.148 132.384 46.513 29.519 37.568 67.087 194.999 62.615-1.79-185.16-50.986-461.557-123.44-631.51-88.554-205.733-205.733-237.04-444.561-313.966-139.54-44.725-549.217-93.922-676.235-15.207-118.967 74.243-141.33 162.798-252.246 318.439-32.202 45.619-43.83 80.504-64.403 132.384\"/><path d=\"M1720.14 1966.675c89.45 36.674-4.472 273.714-128.806 216.466-40.252-113.6 55.458-178.003 81.398-228.99-53.67-8.05-206.627-32.2-252.246-15.206-59.036 22.363-72.454 148.486-42.041 207.522 143.118 280.87 775.523 220.94 708.436 2.684-26.835-88.555-51.88-102.867-142.224-133.28-72.454-24.15-144.907-49.196-224.517-49.196m-1124.374-31.307c71.56 68.875 233.462 79.61 338.117 84.976 13.418-138.646 25.046-242.407 135.963-234.356 54.564 74.242 25.94 161.902-31.307 218.255 97.5-.894 153.852-74.242 139.54-180.687-82.293-59.036-331.856-177.109-457.084-194.104-34.885 37.569-120.756 243.301-125.229 305.916\"/></g><path d=\"M427.602 2820.913c59.036-5.367 212.889 39.357 225.412 89.449-95.71 11.628-217.361 2.683-225.412-89.45zm-52.775 50.986c43.83 31.307 67.087 80.504 142.224 98.393 110.022 27.73 350.64-66.192 75.137-172.636-77.82-30.413-132.384-62.614-219.15-33.096-1.789-128.807 138.646-692.336 198.577-779.101 140.435 22.362 460.662 182.476 642.244-40.252 172.636 9.84 39.357 110.917 148.485 255.824 56.353 74.243 112.706 139.54 237.04 160.114 93.921 16.1 273.714 10.734 365.846-14.312 136.857-35.78 171.742-70.665 175.32-224.517l151.17 33.99c-18.785 136.858-195 365.847-305.916 447.246-152.958 111.81-291.604 178.898-483.025 262.085-84.976 36.674-158.325 103.761-248.668 124.334-172.637 38.463-680.707 101.972-825.614 20.574-39.358-21.468-53.67-82.294-53.67-138.646M1626.22 2131.26c6.261-59.037 28.623-92.133 63.508-116.284 24.152 51.88-18.784 101.972-63.508 116.284m93.921-164.586c79.61 0 152.063 25.045 224.517 49.197 90.344 30.412 115.39 44.724 142.224 133.279 67.087 218.255-565.318 278.186-708.436-2.684-30.413-59.036-16.995-185.16 42.041-207.522 45.619-16.995 198.577 7.156 252.246 15.207-25.94 50.986-121.65 115.389-81.398 228.99 124.334 57.247 218.255-179.793 128.806-216.467m-730.798 10.734c.894-61.72-1.79-117.179 54.564-141.33 20.573 47.408-13.418 114.495-54.564 141.33m-393.576-42.041c4.473-62.615 90.344-268.347 125.229-305.916 125.228 16.995 374.791 135.068 457.084 194.104 14.312 106.445-42.04 179.793-139.54 180.687 57.247-56.353 85.87-144.013 31.307-218.255-110.917-8.05-122.545 95.71-135.963 234.356-104.655-5.367-266.558-16.1-338.117-84.976m-89.449-71.56c-33.096-91.238-33.096-233.462 107.339-245.09l-71.56 199.471c-18.783 42.936-18.783 33.096-35.779 45.62zm228.99-277.292c20.573-51.88 32.201-86.765 64.403-132.384 110.917-155.641 133.279-244.196 252.246-318.439 127.018-78.715 536.694-29.518 676.235 15.207 238.828 76.926 356.007 108.233 444.561 313.966 72.454 169.953 121.65 446.35 123.44 631.51-157.43 4.472-148.486-33.096-195-62.615-111.81-70.664-457.978-131.49-609.147-132.384-254.035-.895-104.655 51.88-199.471 22.362-56.353-17.89-52.775-28.624-54.564-48.302-14.312-107.34-42.041-96.605-196.788-173.531-94.816-47.408-194.104-93.922-305.915-115.39m1583.247-43.83c-16.995-56.352 14.312-52.775 68.876-91.238 31.307-22.362 56.353-45.619 94.816-67.086 144.013-80.504 412.36-93.922 526.854 1.789 46.514 38.463 122.545 113.6 110.917 211.994-24.151 195.893-158.325 303.232-268.347 392.68-111.811 91.239-297.865 185.16-490.18 122.546-16.101-39.358-3.578-288.92-22.363-381.053-16.995-82.293-8.05-91.238 39.358-140.435 139.54-144.907 441.878-250.457 613.62-126.123 72.454 53.67 51.88 74.243 89.449 115.39 46.513-50.092-40.252-218.256-360.48-207.522-217.36 7.156-311.282 177.109-402.52 169.058m-1302.377-508.964c4.472-124.335 118.967-381.948 233.461-471.397 138.646-107.338 283.554-208.416 496.442-87.66 52.775 29.519 50.092 44.725 55.459 118.073 4.472 70.665-1.79 96.605-19.679 153.852-141.33 456.19-259.402 194.105-712.014 302.338 16.995-148.485 145.802-280.87 217.361-349.746 122.545-118.967 211.1-195.893 395.365-170.847 50.986 84.976 56.352 138.646-5.367 237.934-82.293 132.385-102.867 124.334-90.344 214.678 64.403-16.101 84.082-78.715 113.6-141.33 179.793-375.686-81.398-421.305-241.512-352.429-107.339 45.62-298.76 256.719-361.374 383.736-12.523 25.046-25.94 57.248-37.568 84.977zm708.436 18.784c18.784-111.811 129.7-139.54 129.7-483.92 0-148.485-182.475-281.764-421.304-182.475-204.838 84.082-236.145 148.485-345.273 313.071-102.867 155.642-99.289 326.49-187.843 470.502-25.94 41.147-49.197 55.458-77.82 96.605-20.574 30.413-35.78 68.876-56.354 104.655-42.04 68.876-84.976 118.968-118.967 201.26-107.339 2.684-197.682 4.473-208.416 115.39-14.312 152.063 57.247 189.632 57.247 246.879-.894 61.72-251.351 684.285-181.581 1055.498 19.679 101.972 86.765 102.867 194.104 115.39 258.508 31.307 593.942 20.573 825.614-72.454l420.41-201.26c106.445-59.931 285.343-173.532 364.953-256.72 56.353-58.141 85.87-107.338 134.173-176.214 66.192-96.605 67.981-94.816 82.293-226.306 87.66 16.101 251.352 54.564 305.916 101.972-6.262 61.72-36.674 32.202-36.674 87.66 34.885.895 93.027-42.935 107.339-91.238-36.675-53.67-75.138-44.724-127.913-87.66 42.042-33.096 118.073-48.302 176.215-72.453 125.229-51.88 339.012-209.311 391.787-352.43 42.04-115.389 10.734-307.704-57.248-382.841-71.559-78.715-237.934-118.967-373.897-118.967-161.902 0-329.172 116.283-459.767 166.375-50.092-43.83-53.67-93.922-90.344-142.224-42.04-57.248-315.755-200.366-446.35-228.095\"/><path fill=\"#efebe9\" d=\"M2318.554 1542.686c91.238 8.05 185.16-161.902 402.52-169.058 320.228-10.734 406.993 157.43 360.48 207.521-37.569-41.146-16.995-61.72-89.45-115.389-171.741-124.334-474.079-18.784-613.62 126.123-47.407 49.197-56.352 58.142-39.357 140.435 18.785 92.133 6.262 341.695 22.362 381.053 192.316 62.614 378.37-31.307 490.181-122.545 110.022-89.45 244.196-196.788 268.347-392.681 11.628-98.394-64.403-173.531-110.917-211.994-114.494-95.71-382.841-82.293-526.854-1.79-38.463 21.468-63.51 44.725-94.816 67.087-54.564 38.464-85.871 34.886-68.876 91.238m-1302.377-508.964 43.83-77.821c11.628-27.73 25.045-59.93 37.568-84.977 62.614-127.017 254.035-338.117 361.374-383.736 160.114-68.876 421.305-23.257 241.512 352.43-29.518 62.614-49.197 125.228-113.6 141.329-12.523-90.344 8.05-82.293 90.344-214.678 61.72-99.288 56.353-152.958 5.367-237.934-184.265-25.046-272.82 51.88-395.365 170.847-71.56 68.876-200.366 201.26-217.361 349.746 452.612-108.233 570.685 153.852 712.014-302.338 17.89-57.247 24.151-83.187 19.679-153.852-5.367-73.348-2.684-88.554-55.459-118.073-212.888-120.756-357.796-19.678-496.442 87.66-114.494 89.45-228.989 347.062-233.461 471.397\"/><path fill=\"#eee\" d=\"M506.317 1863.808c16.996-12.523 16.996-2.683 35.78-45.619l71.559-199.47c-140.435 11.627-140.435 153.851-107.339 245.09z\"/><path fill=\"#efebe9\" d=\"M653.014 2910.362c-12.523-50.092-166.376-94.816-225.412-89.45 8.05 92.133 129.701 101.078 225.412 89.45\"/></svg>", La = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#9575cd\" d=\"M12.173 22.681c-3.86 0-6.99-3.64-6.99-8.13 0-3.678 2.773-8.172 4.916-10.91 1.014-1.296 2.93-2.322 2.93-2.322s-.982 5.239 1.683 7.319c2.366 1.847 4.106 4.25 4.106 6.363 0 4.232-2.784 7.68-6.645 7.68\"/></svg>", Ra = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 323 323\"><path fill=\"#ffb300\" d=\"m106.716 99.763 54.785 54.782 54.779-54.782z\"/><path fill=\"#64dd17\" d=\"M96.881 89.93H216.83l-55.18-55.184H41.7zm131.546 11.593 59.705 59.704L228.16 221.2l-59.705-59.704z\"/><path fill=\"#00b8d4\" d=\"m175.552 34.746 112.703 112.695V34.746z\"/><path fill=\"#455a64\" d=\"m34.746 281.3 119.8-119.8-119.8-119.8z\"/><path fill=\"#ffb300\" d=\"m288.255 175.01-53.148 53.149 53.148 53.14z\"/><path fill=\"#00b8d4\" d=\"M281.3 288.254 161.5 168.455l-119.8 119.8z\"/></svg>", za = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 30 30\"><path fill=\"#f44336\" d=\"M5.207 4.33q-.072.075-.143.153Q1.5 8.476 1.5 15.33c0 4.418 1.155 7.862 3.459 10.34h19.415c2.553-1.152 4.127-3.43 4.127-3.43l-3.147-2.52L23.9 21.1c-.867.773-.845.931-2.315 1.78-1.495.674-3.04.966-4.634.966-2.515 0-4.423-.909-5.723-2.059-1.286-1.15-1.985-4.511-2.096-6.68l17.458.067-.183-1.472s-.847-7.129-2.541-9.372zm8.76.846c1.565 0 3.22.535 3.961 1.471.74.937.931 1.667.973 3.524H9.11c.112-1.955.436-2.81 1.373-3.698.936-.887 2.03-1.297 3.484-1.297\"/></svg>", Ba = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#3f51b5\" d=\"M22.713 4H9.287a.5.5 0 0 0-.432.248l-6.708 11.5a.5.5 0 0 0 0 .504l6.708 11.5a.5.5 0 0 0 .432.248h13.426a.5.5 0 0 0 .432-.248l6.708-11.5a.5.5 0 0 0 0-.504l-6.708-11.5A.5.5 0 0 0 22.713 4m-6.937 20.888-7.5-3.75A.5.5 0 0 1 8 20.691v-9.382a.5.5 0 0 1 .276-.447l7.5-3.75a.5.5 0 0 1 .448 0l7.5 3.75a.5.5 0 0 1 .276.447v9.382a.5.5 0 0 1-.276.447l-7.5 3.75a.5.5 0 0 1-.448 0\"/><path fill=\"#7986cb\" d=\"M22 19.441v-6.882a.5.5 0 0 0-.276-.447l-5.5-2.75a.5.5 0 0 0-.448 0l-5.5 2.75a.5.5 0 0 0-.276.447v6.882a.5.5 0 0 0 .276.447l5.5 2.75a.5.5 0 0 0 .448 0l5.5-2.75a.5.5 0 0 0 .276-.447\"/></svg>", Va = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M28 4H4a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 22H4V10h24Z\"/></svg>", Ha = "<svg viewBox=\"0 0 16 16\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"m8.668 6h3.6641l-3.6641-3.668v3.668m-4.668-4.668h5.332l4 4v8c0 0.73828-0.59375 1.3359-1.332 1.3359h-8c-0.73828 0-1.332-0.59766-1.332-1.3359v-10.664c0-0.74219 0.59375-1.3359 1.332-1.3359m3.332 1.3359h-3.332v10.664h8v-6h-4.668z\" fill=\"#90a4ae\" /></svg>", Ua = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M24 28h4L18 4h-4L4 28h4l8-19.422\"/><path fill=\"#f44336\" d=\"M8 20h16v4H8z\"/></svg>", Wa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><path fill=\"#0288d1\" d=\"m236.249 36.066-213.94 213.94 213.94 213.94v-84.36l-129.7-129.7 129.7-129.7z\"/><path fill=\"#0288d1\" d=\"m236.249 156.017-93.622 93.62 93.622 93.622z\"/><path fill=\"#00b8d4\" d=\"m263.759 36.047 213.94 213.94-213.94 213.94v-84.36l129.7-129.7-129.7-129.7z\"/></svg>", Ga = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M13.172 2.828 11.78 4.22l1.91 1.91 2 2A2.986 2.986 0 0 1 20 10.81a3.25 3.25 0 0 1-.31 1.31l2.06 2a2.68 2.68 0 0 1 3.37.57 2.86 2.86 0 0 1 .88 2.117 3.02 3.02 0 0 1-.856 2.109A2.9 2.9 0 0 1 23 19.81a2.93 2.93 0 0 1-2.13-.87 2.694 2.694 0 0 1-.56-3.38l-2-2.06a3 3 0 0 1-.31.12V20a3 3 0 0 1 1.44 1.09 2.92 2.92 0 0 1 .56 1.72 2.88 2.88 0 0 1-.878 2.128 2.98 2.98 0 0 1-2.048.871 2.981 2.981 0 0 1-2.514-4.719A3 3 0 0 1 16 20v-6.38a2.96 2.96 0 0 1-1.44-1.09 2.9 2.9 0 0 1-.56-1.72 2.9 2.9 0 0 1 .31-1.31l-3.9-3.9-7.579 7.572a4 4 0 0 0-.001 5.658l10.342 10.342a4 4 0 0 0 5.656 0l10.344-10.344a4 4 0 0 0 0-5.656L18.828 2.828a4 4 0 0 0-5.656 0\"/></svg>", Ka = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#78909c\" d=\"M26 18h-6a2 2 0 0 0-2 2v2h-6a2 2 0 0 1-2-2v-6h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2v6a4 4 0 0 0 4 4h6v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2M6.5 12a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5ZM26 25.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5Z\"/></svg>", qa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"m29.532 13.083-.037-.105-3.811-10.322a1 1 0 0 0-.392-.49.985.985 0 0 0-1.39.316 1 1 0 0 0-.122.28L21.208 10H10.792L8.22 2.762a1.004 1.004 0 0 0-1.246-.721 1 1 0 0 0-.266.124 1 1 0 0 0-.392.491L2.507 12.98l-.04.103a7.52 7.52 0 0 0 2.348 8.491l.015.012.032.026 5.797 4.511 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257 5.838-4.537.016-.013a7.52 7.52 0 0 0 2.35-8.49Z\"/><path fill=\"#ef6c00\" d=\"m29.532 13.083-.037-.105a12.6 12.6 0 0 0-5.123 2.394l-8.367 6.57 5.327 4.181 5.839-4.537.016-.013a7.52 7.52 0 0 0 2.345-8.49\"/><path fill=\"#f9a825\" d=\"m10.659 26.123 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257L16 21.943Z\"/><path fill=\"#ef6c00\" d=\"M7.628 15.371a12.6 12.6 0 0 0-5.12-2.39l-.04.102a7.52 7.52 0 0 0 2.347 8.491l.015.012.032.026 5.797 4.511 5.331-4.18Z\"/></svg>", Ja = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#ec407a\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", Ya = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00acc1\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#00acc1\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", Xa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M16 10v2h6c-2 0-3-2-6-2\"/><path fill=\"#0097a7\" d=\"M26 4h-2a4 4 0 0 0-4 4h4a1 1 0 0 1 2 0v4H16v-2h-5.317A2.683 2.683 0 0 0 8 12.683v2.634A2.683 2.683 0 0 0 10.683 18H16v2h-5.98A4.02 4.02 0 0 1 6 16v-2c-2 0-4 4-4 8 0 5 1 6 2 6h4v-4h4v4h4v-4h4v4h4v-6a2 2 0 0 0 2-2v-2a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4m-4 12h-2a2 2 0 0 1-2-2h6a2 2 0 0 1-2 2\"/></svg>", Za = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M6 20h20v2H6z\"/><circle cx=\"7\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"27\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 10h20v2H6z\"/><circle cx=\"7\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"5\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 12h2v10H6zm18-2h2v12h-2z\"/><path fill=\"#ec407a\" d=\"m5.014 19.41 11.674 6.866L15.674 28 4 21.134z\"/><path fill=\"#ec407a\" d=\"M26.688 21.724 15.014 28.59 14 26.866 25.674 20zM5.124 10.382l11.415-7.29 1.077 1.686L6.2 12.068z\"/><path fill=\"#ec407a\" d=\"m25.798 12.067-11.415-7.29 1.077-1.685 11.415 7.29zM6.2 19.932l11.416 7.29-1.077 1.686-11.415-7.29z\"/><path fill=\"#ec407a\" d=\"m26.875 21.619-11.415 7.29-1.077-1.687 11.415-7.289zM5.877 22.6 16.04 3.686l1.762.946L7.638 23.546z\"/><path fill=\"#ec407a\" d=\"M24.361 23.545 14.197 4.633l1.761-.947 10.165 18.913z\"/></svg>", Qa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26c6da\" d=\"M19.322 2a6.5 6.5 0 0 1 4.352 1.419 4.55 4.55 0 0 1 1.685 3.662 5.82 5.82 0 0 1-1.886 4.275 6.04 6.04 0 0 1-4.34 1.846 4.15 4.15 0 0 1-2.385-.649 1.91 1.91 0 0 1-.936-1.603 1.6 1.6 0 0 1 .356-1.024 1.1 1.1 0 0 1 .861-.447q.469 0 .468.504a.79.79 0 0 0 .358.693 1.43 1.43 0 0 0 .826.245 3.1 3.1 0 0 0 2.39-1.573 5.66 5.66 0 0 0 1.154-3.39 2.64 2.64 0 0 0-.891-2.064 3.28 3.28 0 0 0-2.293-.812 6.18 6.18 0 0 0-4.086 1.736 12.9 12.9 0 0 0-3.215 4.557 13.4 13.4 0 0 0-1.233 5.36 5.86 5.86 0 0 0 1.091 3.723 3.53 3.53 0 0 0 2.905 1.372q3.058 0 5.848-4.002l2.935-.388q.546-.07.545.246a8 8 0 0 1-.423 1.24q-.421 1.097-1.152 3.668A12.7 12.7 0 0 0 26 17.72v1.66a14.2 14.2 0 0 1-4.055 2.57 10.38 10.38 0 0 1-2.764 5.931 6.7 6.7 0 0 1-4.806 2.11 3.3 3.3 0 0 1-2.012-.55 1.8 1.8 0 0 1-.718-1.514q0-2.685 5.634-5.212.532-1.766 1.152-3.507a8.6 8.6 0 0 1-2.853 2.323 7.4 7.4 0 0 1-3.48 1.01 5.46 5.46 0 0 1-4.366-2.093A8.1 8.1 0 0 1 6 15.122a11.6 11.6 0 0 1 1.966-6.426 14.7 14.7 0 0 1 5.162-4.862A12.44 12.44 0 0 1 19.322 2m-2.407 22.17q-4.055 1.875-4.054 3.695a.87.87 0 0 0 .999.97q1.964 0 3.055-4.665\"/></svg>", $a = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M18.5 11a5.49 5.49 0 0 0-4.5 2.344V4H8v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", eo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"M12.023 12a4 4 0 0 0-3.94 3.182 1 1 0 0 1-.972.818H5.229C4.446 16 4 15.552 4 15v-1H3a1 1 0 0 0-1 1v1c0 3.866 3.134 6 7 6 3.425 0 6.275-1.675 6.881-4.745.545-2.764-1.041-5.24-3.858-5.255\"/><path fill=\"#ff7043\" d=\"M29 14h-1v1c0 .552-.446 1-1.229 1H24.89a1 1 0 0 1-.973-.818A4 4 0 0 0 19.977 12c-2.817.016-4.403 2.491-3.858 5.255C16.725 20.325 19.575 22 23 22c3.866 0 7-2.134 7-6v-1a1 1 0 0 0-1-1\"/></svg>", to = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g stroke-width=\"2.422\"><path fill=\"#ef5350\" d=\"m23.928 240.5 59.94-89.852-59.94-89.855h44.955l59.94 89.855-59.94 89.852z\"/><path fill=\"#ffa726\" d=\"m83.869 240.5 59.94-89.852-59.94-89.855h44.955l119.88 179.71h-44.95l-37.46-56.156-37.468 56.156z\"/><path fill=\"#ffee58\" d=\"m228.72 188.08-19.98-29.953h69.93v29.956h-49.95zm-29.97-44.924-19.98-29.953h99.901v29.953z\"/></g></svg>", no = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#eceff1\" d=\"M18 1.2V14h-4v-4l-4 2v16.37l4 2.43V18h4v4l4-2V3.63z\"/><path fill=\"#eceff1\" d=\"M14 1.2 2 8.49v15.02l4 2.43v-15.2l8-4.86zm12 4.86v15.2l-8 4.86v4.68l12-7.29V8.49z\"/></svg>", ro = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M4 8v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2m4 14V10h4v12Zm11.999-6L18 18.001 21 21l-3 3.001L19.999 26l3.003-3 3 2.999L28 24l-3-2.999 3-3L26.001 16l-3 3z\"/></svg>", io = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 6V2h-2v4h-6V2h-2v4h-4v2h4v4h2V8h6v4h2V8h4V6zm-15.5 5A5.49 5.49 0 0 0 8 13.344V4H2v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", ao = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e65100\" d=\"m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z\"/></svg>", oo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#26a69a\" d=\"M8.5 6h4l-4-4zM3.875 1H9.5l4 4v8.6c0 .773-.616 1.4-1.375 1.4h-8.25c-.76 0-1.375-.627-1.375-1.4V2.4c0-.777.612-1.4 1.375-1.4M4 13.6h8V8l-2.625 2.8L8 9.4zm1.25-7.7c-.76 0-1.375.627-1.375 1.4s.616 1.4 1.375 1.4c.76 0 1.375-.627 1.375-1.4S6.009 5.9 5.25 5.9\"/></svg>", so = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M22 10h2v4h-2z\"/><path fill=\"#f44336\" d=\"M28 2H4a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2m-2 12a2 2 0 0 1-2 2h-2v4a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V8h18a2 2 0 0 1 2 2Z\"/></svg>", co = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", lo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#1e88e5\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", uo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ffca28\" d=\"M2 2v12h12V2zm6 6h1v4a1.003 1.003 0 0 1-1 1H7a1.003 1.003 0 0 1-1-1v-1h1v1h1zm3 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", fo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path fill=\"#f9a825\" d=\"M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z\"/></svg>", po = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 50 50\"><g transform=\"translate(.21 -247.01)\"><circle cx=\"13.497\" cy=\"281.63\" r=\"9.555\" fill=\"#c62828\"/><circle cx=\"36.081\" cy=\"281.63\" r=\"9.555\" fill=\"#7e57c2\"/><circle cx=\"24.722\" cy=\"262.39\" r=\"9.555\" fill=\"#388e3c\"/></g></svg>", mo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f57c00\" d=\"M6.2 18a22.7 22.7 0 0 0 9.8 2 22.7 22.7 0 0 0 9.8-2 10.002 10.002 0 0 1-19.6 0m19.6-4a22.7 22.7 0 0 0-9.8-2 22.7 22.7 0 0 0-9.8 2 10.002 10.002 0 0 1 19.6 0\"/><circle cx=\"27\" cy=\"5\" r=\"3\" fill=\"#757575\"/><circle cx=\"5\" cy=\"27\" r=\"3\" fill=\"#9e9e9e\"/><circle cx=\"5\" cy=\"5\" r=\"3\" fill=\"#616161\"/></svg>", ho = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M30 14H17.738a8 8 0 1 0 0 4H24v4h4v-4h2Zm-20 5a3 3 0 1 1 3-3 3.003 3.003 0 0 1-3 3\"/></svg>", go = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\"1.725\" x2=\"22.185\" y1=\"22.67\" y2=\"1.982\" gradientTransform=\"translate(1.306 1.129)scale(.89324)\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#7c4dff\"/><stop offset=\".5\" stop-color=\"#d500f9\"/><stop offset=\"1\" stop-color=\"#ef5350\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M2.975 2.976v18.048h18.05v-.03l-4.478-4.511-4.48-4.515 4.48-4.515 4.443-4.477z\"/></svg>", _o = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#448aff\" d=\"M12.074 1.424a.638.638 0 0 0-.686.691v.173c.015.2.044.402.087.588.058.358.085.73.07 1.102a.65.65 0 0 1-.201.33l-.014.258a7 7 0 0 0-1.117.17 7.9 7.9 0 0 0-4.012 2.292l-.213-.157a.56.56 0 0 1-.374-.042 6 6 0 0 1-.829-.747c-.129-.143-.26-.299-.403-.428l-.128-.1a.8.8 0 0 0-.431-.171c-.2 0-.372.07-.501.212-.2.301-.127.675.16.904l.013.014c.03.029.087.072.115.1q.258.172.515.3c.33.186.631.403.918.647a.63.63 0 0 1 .114.358l.2.17a7.82 7.82 0 0 0-1.232 5.546l-.271.07a.84.84 0 0 1-.275.274c-.358.086-.73.17-1.102.17-.186 0-.387 0-.588.057l-.156.03h-.014v.015c-.043 0-.086.014-.115.014a.62.62 0 0 0-.4.789.625.625 0 0 0 .772.386 1 1 0 0 0 .188-.045c.186-.057.37-.127.528-.213a7.4 7.4 0 0 1 1.103-.316c.114 0 .244.057.33.129l.285-.042a8.04 8.04 0 0 0 3.54 4.426l-.1.258a.8.8 0 0 1 .044.358c-.143.344-.33.687-.56.987-.114.172-.215.33-.344.501 0 .043.001.117-.056.16-.014.043-.044.072-.059.114a.615.615 0 0 0 .372.787.62.62 0 0 0 .79-.372c.028-.043.055-.143.083-.143.072-.2.131-.387.174-.574a5.4 5.4 0 0 1 .473-1.102.5.5 0 0 1 .271-.129l.143-.257c1.82.702 3.84.701 5.688.014l.115.23a.53.53 0 0 1 .3.198c.186.33.301.674.43 1.032.043.187.102.373.174.588.028 0 .055.086.084.129.014.043.03.071.044.114a.61.61 0 0 0 .845.216.614.614 0 0 0 .213-.845c-.014-.057-.056-.13-.056-.174-.115-.157-.23-.329-.344-.486-.215-.316-.371-.63-.543-.974a.48.48 0 0 1 .042-.372 1.2 1.2 0 0 1-.1-.244c1.661-1.002 2.951-2.577 3.539-4.454.086.014.17.028.271.042.086-.115.201-.115.33-.115.387.057.73.16 1.103.302q.235.128.514.213c.058.014.116.03.202.03v.015c0 .014.058.013.1.028.344.043.617-.202.689-.532a.617.617 0 0 0-.532-.7c-.057-.014-.127-.03-.17-.072h-.588a7 7 0 0 1-1.102-.202.6.6 0 0 1-.274-.257l-.272-.07a7.8 7.8 0 0 0-1.262-5.531l.23-.2a.44.44 0 0 1 .114-.343c.273-.244.589-.46.918-.647a3.6 3.6 0 0 0 .5-.3 1 1 0 0 0 .13-.1c.043-.028.086-.058.086-.087.258-.243.273-.63 0-.859-.214-.257-.601-.257-.845 0-.043 0-.1.059-.142.087a11 11 0 0 0-.403.428c-.244.272-.53.532-.831.747a.55.55 0 0 1-.372.042l-.23.171a7.98 7.98 0 0 0-5.098-2.462l-.014-.274a.5.5 0 0 1-.201-.314 5.6 5.6 0 0 1 .07-1.102 4 4 0 0 0 .087-.588v-.316a.62.62 0 0 0-.546-.548m-.842 4.773-.174 3.223h-.014a.56.56 0 0 1-.114.302.543.543 0 0 1-.745.13h-.014L7.536 7.973a6.23 6.23 0 0 1 3.035-1.662c.23-.043.446-.086.66-.115zm1.544 0a6.38 6.38 0 0 1 3.682 1.777L13.837 9.85h-.014a.66.66 0 0 1-.3.073.535.535 0 0 1-.56-.518zm-6.2 2.938 2.406 2.19v.015c.086.071.157.16.157.274a.523.523 0 0 1-.372.657v.014l-3.095.89a6.4 6.4 0 0 1 .904-4.04m10.842.042c.73 1.189 1.032 2.595.932 3.984l-3.109-.89-.014-.014a.5.5 0 0 1-.257-.17.53.53 0 0 1 .056-.761l-.014-.042zm-5.915 2.322h.988l.615.758-.215.96-.887.431-.887-.43-.23-.96zm-2.308 2.65h.115c.243 0 .46.17.545.414 0 .1.001.23-.056.302v.042l-1.22 2.966a6.33 6.33 0 0 1-2.563-3.195zm5.274 0h.344l3.193.515a6.34 6.34 0 0 1-2.563 3.223l-1.234-3.022c-.115-.258.002-.558.26-.716m-2.521 1.298a.55.55 0 0 1 .529.277h.014l1.561 2.823a5 5 0 0 1-.615.171 6.4 6.4 0 0 1-3.481-.17l1.561-2.824h.014c.043-.1.115-.144.216-.215a.5.5 0 0 1 .201-.062\"/></svg>", vo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0277bd\" d=\"M8 3a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2H3v2h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2v-2H8v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V5h2V3m6 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3z\"/></svg>", yo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M8 1a5.5 5.5 0 0 0-4 9.26V15l4-1.5 4 1.5v-4.74A5.49 5.49 0 0 0 8 1m0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4\"/></svg>", bo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffd54f\" d=\"M25 12h-3V8a6 6 0 0 0-12 0v4H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V13a1 1 0 0 0-1-1M14 8a2 2 0 0 1 4 0v4h-4Zm2 17a4 4 0 1 1 4-4 4 4 0 0 1-4 4\"/></svg>", xo = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#afb42b\" d=\"M19 5v9h-5v5H5V5zm0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10l6-6V5c0-1.1-.9-2-2-2m-7 11H7v-2h5zm5-4H7V8h10z\"/></svg>", So = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"M30 6a3.86 3.86 0 0 1-1.167 2.833 4.024 4.024 0 0 1-5.666 0A3.86 3.86 0 0 1 22 6a3.86 3.86 0 0 1 1.167-2.833 4.024 4.024 0 0 1 5.666 0A3.86 3.86 0 0 1 30 6m-9.208 5.208A10.6 10.6 0 0 0 13 8a10.6 10.6 0 0 0-7.792 3.208A10.6 10.6 0 0 0 2 19a10.6 10.6 0 0 0 3.208 7.792A10.6 10.6 0 0 0 13 30a10.6 10.6 0 0 0 7.792-3.208A10.6 10.6 0 0 0 24 19a10.6 10.6 0 0 0-3.208-7.792m-1.959 7.625a4.024 4.024 0 0 1-5.666 0 4.024 4.024 0 0 1 0-5.666 4.024 4.024 0 0 1 5.666 0 4.024 4.024 0 0 1 0 5.666\"/></svg>", Co = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"m29.5 24.02-1.6-.92a4.4 4.4 0 0 0 .09-.9A1.3 1.3 0 0 0 28 22a5.6 5.6 0 0 0-.1-1.1l1.6-.92a.493.493 0 0 0 .18-.68l-1.5-2.6a.45.45 0 0 0-.18-.18V6.01a2.006 2.006 0 0 0-2-2H4a2.006 2.006 0 0 0-2 2V22a2.006 2.006 0 0 0 2 2h10.53l-.03.02a.493.493 0 0 0-.18.68l1.5 2.6a.493.493 0 0 0 .68.18l1.6-.92a5.9 5.9 0 0 0 1.9 1.09v1.85a.495.495 0 0 0 .5.5h3a.495.495 0 0 0 .5-.5v-1.85a5.9 5.9 0 0 0 1.9-1.09l1.6.92a.493.493 0 0 0 .68-.18l1.5-2.6a.493.493 0 0 0-.18-.68M24 22.01a1.99 1.99 0 0 1-.88 1.65l-.18.11a2.04 2.04 0 0 1-1.88 0l-.18-.11a1.99 1.99 0 0 1-.88-1.65V22a2 2 0 0 1 .88-1.66l.18-.11a2.04 2.04 0 0 1 1.88 0l.18.11A2 2 0 0 1 24 22Zm2-4.63-.1.06a5.9 5.9 0 0 0-1.9-1.09V14.5a.495.495 0 0 0-.5-.5h-3a.495.495 0 0 0-.5.5v1.85a5.9 5.9 0 0 0-1.9 1.09l-1.6-.92a.493.493 0 0 0-.68.18l-1.5 2.6a.493.493 0 0 0 .18.68l1.6.92A5.6 5.6 0 0 0 16 22v.01L4 22V10.01h22Z\"/></svg>", wo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", To = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\".125\" x2=\"0\" y1=\"1\" y2=\"0\"><stop offset=\"0%\" stop-color=\"#ab47bc\"/><stop offset=\"37.5%\" stop-color=\"#ab47bc\"/><stop offset=\"37.501%\" stop-color=\"#d32f2f\"/><stop offset=\"54.25%\" stop-color=\"#d32f2f\"/><stop offset=\"54.251%\" stop-color=\"#ff7043\"/><stop offset=\"69.75%\" stop-color=\"#ff7043\"/><stop offset=\"69.751%\" stop-color=\"#ffa726\"/><stop offset=\"100%\" stop-color=\"#ffa726\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M22 2s-7.64-.37-13.66 7.88C3.72 16.21 2 22 2 22l1.94-1c1.44-2.5 2.19-3.53 3.6-5 2.53.74 5.17.65 7.46-2-2-.56-3.6-.43-5.96-.19C11.69 12 13.5 11.6 16 12l1-2c-1.8-.34-3-.37-4.78.04C14.19 8.65 15.56 7.87 18 8l1.11-1.73c-1.53-.06-2.4-.02-4.19.3 1.61-1.46 3.08-2.12 5.22-2.25 0 0 1.05-1.89 1.86-2.32\"/></svg>", Eo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", Do = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M16 0 2 8v16l14 8 14-8V8Zm8 23a1 1 0 0 1-1 1h-2.52a1 1 0 0 1-.78-.375L12 14v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2.52a1 1 0 0 1 .78.375L20 18V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1Z\"/></svg>", Oo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M6 24h20v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM30 6l-9 9-5-11-5 11-9-9 4 14h20z\"/></svg>", ko = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><g stroke-width=\".395\"><path fill=\"#1976d2\" d=\"M133.347 451.499c0-.295-2.752-5.283-6.116-11.084s-6.116-10.776-6.116-11.055 9.514-16.889 21.143-36.912c11.629-20.022 21.323-36.798 21.542-37.279.346-.76-1.608-4.363-14.896-27.466-8.412-14.625-15.294-26.785-15.294-27.023 0-.5 24.46-43.501 25.206-44.31.414-.45.592-.384 1.078.395.32.513 16.876 29.256 36.791 63.87 62.62 108.85 74.852 130.01 75.41 130.46.3.242.544.554.544.694s-11.836.21-26.302.154c-23.023-.09-26.313-.175-26.393-.694-.11-.714-27.662-48.825-28.86-50.392-.746-.978-.906-1.035-1.426-.51-.688.696-28.954 49.323-29.49 50.733l-.364.96h-13.23c-10.895 0-13.228-.095-13.228-.538zm167.58-125.61c-.134-.216 1.189-2.863 2.939-5.882 6.924-11.944 84.29-145.75 96.49-166.88 7.143-12.371 13.143-22.465 13.334-22.433.362.062 25.86 43.105 25.86 43.655 0 .174-6.761 11.952-15.025 26.173-8.46 14.557-14.932 26.104-14.81 26.421.185.483 4.563.564 30.213.564h29.996l.957 1.48c.527.814 3.296 5.547 6.155 10.518s5.45 9.29 5.757 9.597c.705.705.703.724-.16 1.572-.396.388-3.36 5.323-6.588 10.965-3.228 5.643-6.056 10.387-6.285 10.543s-19.695.171-43.256.034l-42.84-.249-.803 1.15c-.442.632-7.505 12.736-15.696 26.897l-14.892 25.747h-15.486c-8.518 0-20.015.116-25.551.259-6.55.168-10.15.121-10.308-.135zm-133.75-157.86c-56.373-.055-102.5-.182-102.5-.282s5.617-10.132 12.481-22.294L89.64 123.34h30.332c27.113 0 30.332-.065 30.332-.611 0-.336-6.659-12.228-14.797-26.427s-14.797-25.917-14.797-26.04 2.682-4.853 5.96-10.51 6.003-10.578 6.056-10.934c.086-.586 1.375-.648 13.572-.648 7.412 0 13.463.143 13.446.317-.018.174.22.707.53 1.184.31.476 9.763 16.937 21.007 36.578 11.244 19.64 20.71 36.022 21.036 36.4.554.647 2.549.691 31.428.691h30.837l12.896 22.145c7.093 12.18 12.8 22.301 12.682 22.492-.117.19-4.776.303-10.352.249-5.575-.054-56.26-.143-112.63-.198z\"/><path fill=\"#64b5f6\" d=\"M23.046 238.939c-6.098 10.563-6.69 11.711-6.224 12.078.282.224 3.18 5.044 6.44 10.712s6.016 10.355 6.123 10.417c.106.061 13.585.153 29.95.204 16.367.052 29.994.23 30.285.399.473.273-1.08 3.094-14.637 26.574l-15.166 26.269 12.907 21.865c7.1 12.026 12.982 21.906 13.068 21.956s23.257-39.831 51.492-88.624c11.352-19.617 21.214-36.64 30.37-52.442 23.308-40.452 30.68-53.468 30.73-54.132-1.096-.11-6.141-.187-13.006-.216-3.945-.01-7.82-.02-12.75-.002l-25.341.092-15.42 26.706c-14.256 24.693-15.445 26.663-16.278 26.86l-.023.037c-.012.003-1.622-.001-1.826 0-4.29.062-20.453.063-40.226-.01-22.632-.082-41.615-.125-42.183-.096-.567.03-1.147-.03-1.29-.132-.141-.102-3.29 5.066-6.996 11.485zm205.16-190.3c-.123.149 5.62 10.392 12.761 22.763 12.2 21.131 89.393 155.03 96.276 167 1.503 2.613 2.92 4.803 3.443 5.348.9-1.249 3.532-5.63 7.954-13.219a1343 1343 0 0 1 10.05-17.76l6.606-11.443c.691-1.403.753-1.818.652-2.117-.161-.48-6.903-12.332-14.982-26.337-8.078-14.005-14.824-25.849-14.99-26.32a.73.73 0 0 1-.01-.366l-.426-.913 21.636-36.976c3.69-6.307 6.425-11.042 9.471-16.29 9.158-15.948 12.036-21.189 11.895-21.55-.126-.324-2.7-4.83-5.72-10.017-3.021-5.185-5.845-10.148-6.275-11.026-.483-.987-.734-1.364-1.1-1.456-.054.014-.083.018-.144.035-.42.112-5.455.195-11.19.185s-11.22.024-12.187.073l-1.76.089-14.998 25.978c-12.824 22.212-15.084 25.964-15.595 25.883-.024-.004-.15-.189-.235-.301-.109.066-.2.09-.271.05-.256-.148-7.144-11.902-15.306-26.119L279.4 48.817c-.116-.186-.444-.744-.458-.752-.476-.275-50.502.287-50.737.57zm-18.646 283.09c-.047.109-.026.262.043.48.328 1.05 25.338 43.735 25.772 43.985.206.119 14.178.239 31.05.266 26.65.044 30.749.152 31.234.832.307.43 9.987 17.214 21.513 37.296s21.152 36.627 21.394 36.767 5.926.243 12.633.23c6.705-.013 12.4.099 12.657.246.131.076.381-.141.851-.795l6.008-10.406c5.234-9.065 6.62-11.684 6.294-11.888-.575-.36-15.597-26.643-23.859-41.482-3.09-5.45-5.37-9.516-5.44-9.774-.196-.712-.066-.822 1.155-.98 1.956-.252 57.397-.057 58.071.205.237.092.79-.569 2.593-3.497 1.866-3.067 5.03-8.524 11.001-18.866 7.22-12.505 13.043-22.784 12.941-22.843s-.77-.051-1.489.016l-.046.001c-4.451.204-33.918.203-149.74.025-38.96-.06-69.786-.09-71.912-.072-1.12.01-2.095.076-2.66.172a.3.3 0 0 0-.062.083z\"/></g></svg>", Ao = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#8bc34a\" d=\"M16 20.003v2h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2v-2h4v-2h-4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v2Z\"/><path fill=\"#8bc34a\" d=\"m16 3.003-12 7v14l4 2h6v-13.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v11.5H8l-2-1.034V11.15l10-5.833 10 5.833v11.703l-10 5.833-1.745-1.022L13 29.253l3 1.75 12-7v-14Z\"/></svg>", jo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"M4 4v24h24V4Zm20 20h-4V12h-4v12H8V8h16Z\"/></svg>", Mo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", No = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#ffab40\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", Po = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"m12.019 15.021.003-.008c-.005-.021-.006-.026-.003.008\"/><path fill=\"#ff9800\" d=\"M4.51 3.273a2.523 2.523 0 0 0-2.524 2.523V11.3c.361-.13.88-.898 1.043-1.085.285-.327.337-.743.478-1.006C3.83 8.612 3.886 8.2 4.62 8.2c.342 0 .478.08.71.39.16.216.438.615.568.882.15.307.396.724.503.808q.122.095.233.137c.119.044.218-.037.297-.1.102-.082.145-.247.24-.467.135-.317.283-.697.367-.83.146-.23.195-.501.352-.633.232-.195.535-.208.618-.225.466-.092.677.225.907.43.15.133.355.403.5.765.114.283.26.544.32.707.059.158.203.41.289.713.077.275.286.486.365.616 0 0 .121.34.858.65.16.067.482.176.674.246.32.116.63.101 1.025.054.281 0 .434-.408.562-.734.075-.193.148-.745.197-.902.048-.153-.064-.27.031-.405.112-.156.178-.164.242-.368.138-.436.936-.458 1.384-.458.374 0 .327.363.96.239.364-.072.714.046 1.1.149.324.086.63.184.812.398.119.139.412.834.113.863.029.035.05.099.104.134-.067.262-.357.075-.518.041-.217-.045-.37.007-.583.101-.363.162-.894.143-1.21.407-.27.223-.269.721-.394 1 0 0-.348.895-1.106 1.443-.194.14-.574.477-1.4.605a5.3 5.3 0 0 1-1.1.043c-.186-.009-.362-.018-.549-.02-.11-.002-.48-.013-.461.022l-.041.103.024.138c.015.083.019.149.022.225.006.157-.013.32-.005.478.017.328.138.627.154.958.017.368.199.758.375 1.059.067.114.169.128.213.269.052.161.003.333.028.505.1.668.292 1.366.592 1.97l.008.014c.371-.062.743-.196 1.226-.267.885-.132 2.115-.064 2.906-.138 2-.188 3.085.82 4.882.407V5.796a2.523 2.523 0 0 0-2.523-2.523zm-.907 11.144q-.022 0-.046.003c-.159.025-.313.08-.412.24-.08.13-.108.355-.164.505-.064.175-.176.338-.274.505-.18.305-.504.581-.644.879-.028.06-.053.13-.076.2v3.402c.163.028.333.062.524.113 1.407.375 1.75.407 3.13.25l.13-.018c.105-.22.187-.968.255-1.2.054-.178.127-.32.155-.5.026-.173-.003-.337-.017-.493-.04-.393.285-.533.44-.87.14-.304.22-.651.336-.963.11-.298.284-.721.579-.872-.036-.041-.617-.06-.772-.076a5 5 0 0 1-.5-.07c-.314-.064-.656-.126-.965-.2a10 10 0 0 1-.947-.328c-.298-.138-.503-.497-.732-.507m5.737.83c-.74.149-.97.876-1.32 1.451-.192.319-.396.59-.548.928-.14.312-.128.657-.368.924a2.55 2.55 0 0 0-.528.922c-.023.067-.088.776-.158.943l1.101-.078c1.026.07.73.464 2.332.378l2.529-.078a7 7 0 0 0-.228-.588c-.07-.147-.16-.434-.218-.56a3.5 3.5 0 0 0-.309-.526c-.184-.215-.227-.23-.28-.503-.095-.473-.344-1.33-.637-1.923-.151-.306-.403-.562-.634-.784-.2-.195-.655-.522-.734-.505z\"/></svg>", Fo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ef5350\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z\"/></svg>", Io = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ba68c8\" d=\"M11.057 2.981c.537.735.028 1.653.141 2.472a3.42 3.42 0 0 1-1.03 2.415c-1.414 1.625-3.165 3.038-4.097 5.03a5.28 5.28 0 0 0 1.412 5.847c.706.735 1.54 1.342 2.472 1.738.17.805-1.088.184-1.455 0A6.7 6.7 0 0 1 4.361 16.4a5.44 5.44 0 0 1 .904-5.368c1.272-1.61 3.136-2.543 4.662-3.857.565-.55 1.003-1.3.932-2.119.156-.678-.254-1.469.212-2.09zm-.07 18.929c-.17.198-.467.325-.495.24-.042-.085.212-.127.381-.325.17-.183.127-.522.24-.522.1 0 .043.395-.14.607zm2.16 0c.17.198.453.31.495.24.028-.085-.212-.141-.395-.339-.156-.184-.113-.523-.24-.523-.085 0-.029.41.14.608zm-1.03.48c-.1 0-.071-.296-.071-.65 0-.367-.028-.663.07-.663.085 0 .057.296.057.663 0 .354.014.65-.057.65m-.495-20.765c.34.24.254 2.077.254 3.136 0 1.653.184 3.376-.805 4.916-.96 1.497-2.048 3.108-1.95 4.972.1 1.837.99 3.504 2.148 5.043.664.876-.353.509-.876.085a7.2 7.2 0 0 1-2.755-5.664c.142-1.907 1.597-3.348 2.628-4.803.805-1.13 1.186-1.879 1.215-3.645.028-1.412-.142-3.531.042-3.983.014-.043.07-.1.099-.057m.537 2.232c-.085 0-.043.396.028.72.424 2.26-.198 4.52-.749 6.682a12.77 12.77 0 0 0 .283 7.826c.607 1.568 1.71.791 2.161 1.568.34.593 1.272.198 1.978-.141 2.232-1.102 4.012-3.108 4.11-5.566.029-.494 0-.989-.07-1.497-.283-1.837-1.78-3.065-3.15-4.083-1.215-.89-2.74-1.483-3.659-2.613-.523-.65-.297-1.638-.381-2.458-.043-.452-.255-.042-.382-.268-.084-.127-.14-.17-.17-.17zm.72 3.616c.057 0 .17.071.325.226a20 20 0 0 0 2.161 1.921c1.272.961 2.43 2.091 2.967 3.504.339.875.339 1.836.226 2.74-.184 1.384-1.187 2.444-2.119 3.404-.339.354-1.06.791-1.074.678-.084-.367.763-1.172 1.159-1.695A5.93 5.93 0 0 0 16 10.962c-1.102-1.214-2.317-1.907-2.995-3.08-.14-.253-.183-.409-.113-.409z\"/></svg>", Lo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M12 18.08c-6.63 0-12-2.72-12-6.08s5.37-6.08 12-6.08S24 8.64 24 12s-5.37 6.08-12 6.08m-5.19-7.95c.54 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.58 1.09q-.42.33-1.29.33h-.87l.53-2.76zm-3.5 5.55h1.44l.34-1.75h1.23c.54 0 .98-.06 1.33-.17.35-.12.67-.31.96-.58.24-.22.43-.46.58-.73.15-.26.26-.56.31-.88.16-.78.05-1.39-.33-1.82-.39-.44-.99-.65-1.82-.65H4.59zm7.25-8.33-1.28 6.58h1.42l.74-3.77h1.14c.36 0 .6.06.71.18s.13.34.07.66l-.57 2.93h1.45l.59-3.07c.13-.62.03-1.07-.27-1.36-.3-.27-.85-.4-1.65-.4h-1.27L12 7.35zM18 10.13c.55 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.57 1.09-.29.22-.72.33-1.3.33h-.85l.5-2.76zm-3.5 5.55h1.44l.34-1.75h1.22c.55 0 1-.06 1.35-.17.35-.12.65-.31.95-.58.24-.22.44-.46.58-.73.15-.26.26-.56.32-.88.15-.78.04-1.39-.34-1.82-.36-.44-.99-.65-1.82-.65h-2.75z\"/></svg>", Ro = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e0e0e0\" d=\"M2 22h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zM12 12h8v8h-8z\"/><path fill=\"#ffb300\" d=\"M2 2h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zm0 10h8v8h-8z\"/></svg>", zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#e64a19\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM8 11v2h1v6H8v1h4v-1h-1v-2h2a3 3 0 0 0 3-3 3 3 0 0 0-3-3zm5 2a1 1 0 0 1 1 1 1 1 0 0 1-1 1h-2v-2z\"/></svg>", Bo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#03a9f4\" d=\"M29.07 6H7.677A1.535 1.535 0 0 0 6.24 7.113l-4.2 17.774A.852.852 0 0 0 2.93 26h21.393a1.535 1.535 0 0 0 1.436-1.113L29.96 7.112A.852.852 0 0 0 29.07 6M8.626 23.797a1.4 1.4 0 0 1-1.814-.31l-.007-.009a1.075 1.075 0 0 1 .315-1.599l9.6-6.061-6.102-5.852-.01-.01a1.068 1.068 0 0 1 .084-1.625l.037-.03a1.38 1.38 0 0 1 1.8.07l7.233 6.957a1.1 1.1 0 0 1 .236.739 1.08 1.08 0 0 1-.412.79c-.074.04-.146.119-10.951 6.935ZM24 22.94A1.135 1.135 0 0 1 22.803 24h-5.634a1.061 1.061 0 1 1 .001-2.112h5.633A1.134 1.134 0 0 1 24 22.938Z\"/></svg>", Vo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#f44336\" d=\"M2 8h4v1H2zm0 6h4v1H2zm9-10h3v1h-3zM2 2h3v1H2z\"/><path fill=\"#f9a825\" d=\"M9 2h3v1H9zm1 4h4v1h-4zm-5 6h1v1H5zm-3-2h6v1H2z\"/><path fill=\"#26a69a\" d=\"M2 12h3v1H2zm7-4h5v1H9zM2 4h4v1H2zm3-2h4v1H5z\"/><path fill=\"#ba68c8\" d=\"M2 6h3v1H2zm7-2h2v1H9zm-1 6h4v1H8z\"/></svg>", Ho = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"m27.777 22.617-.459-.946L18.43 3.26a2.25 2.25 0 0 0-1.914-1.256A2 2 0 0 0 16.379 2a2.23 2.23 0 0 0-1.891 1.042L4.348 19.056a2.2 2.2 0 0 0 .025 2.417l4.957 7.488A2.34 2.34 0 0 0 11.29 30a2.4 2.4 0 0 0 .655-.092l14.387-4.149a2.32 2.32 0 0 0 1.458-1.234 2.21 2.21 0 0 0-.013-1.908m-3.538.604-11.268 3.25 4.075-19.033 7.568 15.671-.376.098Z\"/></svg>", Uo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"M16 27 2 19v-5l14 8z\"/><path fill=\"#ffeb3b\" d=\"m30 14-14 8v5l14-8z\"/><path fill=\"#ff5722\" d=\"M16 6 2 14v5l14-8z\"/><path fill=\"#00e676\" d=\"m30 19-14-8V6l14 8z\"/><path fill=\"#03a9f4\" d=\"M16 27 2 19v-5l14 8z\"/></svg>", Wo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\"><g transform=\"translate(-.25 -1.71)\"><path fill=\"#ffe0b2\" d=\"M107.4 50.9c-.2-4.4.4-8.3-1.6-11.6-4.8-8.2-16.8-13-40.8-13v.7h-.5.5v-.7c-24 0-36.6 4.8-41.4 13.1-1.9 3.4-1.7 7.2-2 11.6-.2 3.5-1.8 7.2-1.1 11.2.8 5.2 1.1 10.4 1.9 15.2.6 3.9 6 7.2 6.5 10.9 1.4 10.2 12 14.9 36 14.9v.8h-.6.7v-.8c24 0 34.2-4.7 35.5-14.9.5-3.8 5.5-7 6.1-10.9.8-4.8 1.1-10 1.9-15.2.7-4-.9-7.8-1.1-11.3\"/><path fill=\"#ffe0b2\" d=\"M64.6 54.5c4.3.1 7.3 2.8 10.1 5.3 3.3 2.9 8.9 4.9 11.2 7.4s5.3 5 6.4 8.9 1.4 8.9 1.4 10.2.7 1 2.7 0c4.7-2.3 9.9-8.5 9.9-8.5-.6 3.9-5.7 7.4-6.2 11.1C98.9 99.1 89 104 64.5 104h-.1.6\"/><path fill=\"#ffe0b2\" d=\"M80.4 46.7c.9 3.1 4.1 13.6-2.1 10.1 0 0 2.6 1.5 4.2 7.2 1.7 5.7 5.8 6.4 5.8 6.4s6.7 1.3 11.7-3c4.2-3.6 4.9-10 3.1-14.9-1.8-4.8-5-6.3-9.7-7.3-4.7-1.1-14.1-2-13 1.5\"/><circle cx=\"92.3\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"90\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#ffe0b2\" d=\"M78.9 57.7s7.9 5.4 12.2 10.7 4.2 6.3 4.2 6.3l-3.1 1.4s-4.4-8.3-9.8-11.4c-5.5-3.1-6.1-5.7-6.1-5.7zm-14-3.2c-4.3.1-7.5 2.8-10.4 5.3-3.3 2.9-9.1 4.9-11.4 7.4s-5.4 5-6.5 8.9-1.5 8.9-1.5 10.2.2 1.4-2.7 0c-4.7-2.2-9.9-8.5-9.9-8.5.6 3.9 5.7 7.4 6.2 11.1C30.1 99.1 40 104 64.5 104h.5\"/><path fill=\"#4e342e\" d=\"M88.1 71.4C83.3 65.5 75.6 60 64.9 60h-.1c-10.7 0-18.4 5.5-23.2 11.4-5 6.1-4.6 8.5-4.6 14.3 0 21 7.4 15 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.7 12.3-17.3.1-5.8.4-8.4-4.6-14.5\"/><path fill=\"#3e2723\" d=\"M64.4 65.2s-.7 9.7-2.1 11.6l2.6-.6z\"/><path fill=\"#3e2723\" d=\"M65.1 65.2s.7 9.7 2.1 11.6l-2.6-.6z\"/><path fill=\"#4e342e\" d=\"M56.7 62.9c-1-2.3 2.6-6 8.3-6.1 5.7 0 9.3 3.7 8.3 6.1S68.7 66 65 66.1c-3.6-.1-7.3-.8-8.3-3.2\"/><path d=\"M65 65.2c0-.4 3.4-.5 5.2-1.7 0 0-3.7 1.2-4.5.7-.8-.4-1-1.6-1-1.6s-.3 1.2-.9 1.6c-.7.4-4.9-.7-4.9-.7s5.6 1.4 5.6 1.7-.1 1.3-.1 2c0 2.5 0 8.7.4 9.2.6.9.4-6.7.4-9.2-.1-.8-.1-1.6-.2-2\"/><path fill=\"#795548\" d=\"M65.2 78.6c1.7 0 4.7 1.2 7.4 3.1-2.6-2.9-5.7-4.9-7.4-4.9-1.8 0-5.6 2.2-8.3 5.4 2.8-2.2 6.4-3.6 8.3-3.6\"/><g fill=\"#3e2723\"><path d=\"M64.5 96.3c-3.8 0-7.5-1.2-10.9-2.1-.7-.2-1.4.3-2.1.1-6.3-2-11.4-5.4-14.5-9.7v1c0 21 7.4 15.1 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.6 12.3-17.4 0-.8 0-1.6.1-2.3-2.9 4.7-8.2 8.4-14.8 10.6-.6.2-2-.3-2.6-.2-3.6 1.2-6.8 2.5-10.9 2.5\"/><path d=\"M55 85s-2.5 7.5-.8 10.8l-2.3-1s1.7-7.6 3.1-9.8m19.8 0s2.5 7.5.8 10.8l2.3-1s-1.8-7.6-3.1-9.8\"/></g><path fill=\"#ffe0b2\" d=\"M48.6 46.7c-.9 3.1-4.1 13.6 2.1 10.1 0 0-2.6 1.5-4.2 7.2s-5.8 6.4-5.8 6.4-6.7 1.3-11.7-3c-4.2-3.6-4.9-10-3.1-14.9s5-6.3 9.7-7.3c4.7-1.1 14-2 13 1.5\"/><path d=\"M64.9 76.8c2.7 0 11.1 5.8 11.2 12.9v-.4c0-7.4-6.8-13.3-11.2-13.3s-11.2 6-11.2 13.3v.4c.1-7.1 8.5-12.9 11.2-12.9\"/><g fill=\"#3e2723\"><ellipse cx=\"66.7\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(-14.465 66.71 61.469)\"/><ellipse cx=\"62.4\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(17.235 62.372 61.463)\"/></g><circle cx=\"37.2\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"39.5\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#795548\" d=\"M67.5 58.2c0-.1-2.3 1-2.9 1.1-.6-.1-2.9-1.2-2.9-1.1z\"/><path fill=\"#ffe0b2\" d=\"M50 57.7s-7.9 5.4-12.2 10.7-4.2 6.3-4.2 6.3l3.1 1.4s4.4-8.3 9.8-11.4 6.1-5.7 6.1-5.7z\"/><path fill=\"#ffe0b2\" d=\"M32.7 41.7S30 49.1 24 52.2c0 0 9.4-1.1 8.7-10.5m63.1 0s2.7 7.4 8.7 10.5c0 0-9.4-1.1-8.7-10.5M78.7 55.5s-5.9-6.2-13.8-6.4h.2c-8 .2-13.8 6.4-13.8 6.4 6.9-4.8 12.8-4.7 13.8-4.7-.1 0 6.7-.1 13.6 4.7m-6.9-13s-3-4.2-7-4.3h.2c-3 .1-6.9 4.3-6.9 4.3 3.4-3.3 6.9-3.2 6.9-3.2s3.3-.1 6.8 3.2M37.2 73.2s-4.7 2.3-8.1.9H29c-3-1.7-4.5-6.8-4.5-6.8s3 9 12.7 5.9m54.8 0s4.7 2.3 8.1.9c4-1.7 4.6-6.8 4.6-6.8s-3 9-12.7 5.9\"/><path fill=\"#ffe0b2\" d=\"M42.6 41.2c2.6-.5 6.9-.6 10.3.5 4.3 1.5.8 7 1.7 7.3s2.1-3.8 10.1-3.4c8.1.4 9 4 10.1 3.4s-1.1-10 11-7.8c0 0-12.7-3.4-12.1 5.8 0 0-7.3-5.6-17.5-.6.1 0 2.7-8.6-13.6-5.2m44.3 0c.2 0 .3.1.4.1s-.1-.1-.4-.1M39.1 28.9S28.3 42.5 26.7 47.7c-1.6 5.3-2.8 27-4.2 30.1l-5-21.4 9.2-22.3zm50.8 0s10.8 13.6 12.4 18.8c1.6 5.3 2.8 27 4.2 30.1l5-21.4-9.2-22.3z\"/><path fill=\"#4e342e\" d=\"M89.4 28.9s11.6 9.7 15 20.9 2 24.8 4.6 26.5c3.7 2.4 7.9-11.9 9.3-13.4 2.2-2.4 9.5-8.5 10-9.6s-14.8-17.8-21.5-21.1c-8.1-3.8-18.1-4.1-17.4-3.3\"/><path fill=\"#3e2723\" d=\"M99.3 34.9s13.7 17.5 13.5 39.3l5.5-11.2c-.1 0-4.9-14.3-19-28.1\"/><path fill=\"#4e342e\" d=\"M39.1 28.9s-11.6 9.7-15 20.9-2 24.8-4.6 26.5c-3.7 2.4-7.9-11.9-9.3-13.4C8 60.5.7 54.4.2 53.3S15 35.5 21.7 32.2c8.1-3.8 18.1-4.1 17.4-3.3\"/><path fill=\"#3e2723\" d=\"M29.2 34.9S15.5 52.4 15.7 74.2L10.3 63s4.8-14.3 18.9-28.1\"/><path fill=\"#ffe0b2\" d=\"M21.8 74.6s1 5.4 2.6 7.1.5-1.3.5-1.3-1.7-.9-1.4-7.8-1.7 2-1.7 2m85.3 0s-1 5.4-2.6 7.1-.5-1.3-.5-1.3 1.7-.9 1.4-7.8 1.7 2 1.7 2\"/><g fill=\"#3e2723\"><circle cx=\"54.5\" cy=\"70.5\" r=\".8\"/><circle cx=\"49.9\" cy=\"75.3\" r=\".8\"/><circle cx=\"48.4\" cy=\"70.5\" r=\".8\"/></g><g fill=\"#3e2723\"><circle cx=\"74\" cy=\"70.5\" r=\".8\"/><circle cx=\"78.6\" cy=\"75.3\" r=\".8\"/><circle cx=\"80.1\" cy=\"70.5\" r=\".8\"/></g></g></svg>", Go = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M9.86 2A2.86 2.86 0 0 0 7 4.86v1.68h4.29c.39 0 .71.57.71.96H4.86A2.86 2.86 0 0 0 2 10.36v3.781a2.86 2.86 0 0 0 2.86 2.86h1.18v-2.68a2.85 2.85 0 0 1 2.85-2.86h5.25c1.58 0 2.86-1.271 2.86-2.851V4.86A2.86 2.86 0 0 0 14.14 2zm-.72 1.61c.4 0 .72.12.72.71s-.32.891-.72.891c-.39 0-.71-.3-.71-.89s.32-.711.71-.711\"/><path fill=\"#fdd835\" d=\"M17.959 7v2.68a2.85 2.85 0 0 1-2.85 2.859H9.86A2.85 2.85 0 0 0 7 15.389v3.75a2.86 2.86 0 0 0 2.86 2.86h4.28A2.86 2.86 0 0 0 17 19.14v-1.68h-4.291c-.39 0-.709-.57-.709-.96h7.14A2.86 2.86 0 0 0 22 13.64V9.86A2.86 2.86 0 0 0 19.14 7zM8.32 11.513l-.004.004.038-.004zm6.54 7.276c.39 0 .71.3.71.89a.71.71 0 0 1-.71.71c-.4 0-.72-.12-.72-.71s.32-.89.72-.89\"/></svg>", Ko = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1976d2\" d=\"M11.956 4.05c-5.694 0-10.354 3.106-10.354 6.947 0 3.396 3.686 6.212 8.531 6.813v2.205h3.53V17.82c.88-.093 1.699-.259 2.475-.497l1.43 2.692h3.996l-2.402-4.048c1.936-1.263 3.147-3.034 3.147-4.97 0-3.841-4.659-6.947-10.354-6.947m1.584 2.712c4.349 0 7.558 1.45 7.558 4.753 0 1.77-.952 3.013-2.505 3.779a1 1 0 0 1-.228-.156c-.373-.165-.994-.352-.994-.352s3.085-.227 3.085-3.302-3.23-3.127-3.23-3.127h-7.092v7.413c-2.64-.766-4.462-2.392-4.462-4.255 0-2.63 3.52-4.753 7.868-4.753m.156 4.12h2.143s.983-.05.983.974c0 1.004-.983 1.004-.983 1.004h-2.143v-1.977m-.031 4.566h.952c.186 0 .28.052.445.207.135.103.28.3.404.476-.57.073-1.17.104-1.801.104z\"/></svg>", qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bcd4\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#00bcd4\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#00bcd4\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#00bcd4\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", Jo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#0288d1\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#0288d1\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#0288d1\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", Yo = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 1C4.136 1 1 4.136 1 8s3.136 7 7 7 7-3.136 7-7-3.136-7-7-7m1 11H7V7.5h2zm0-6H7V4h2z\"/></svg>", Xo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#f44336\" d=\"M18.041 3.177c2.24.382 2.879 1.919 2.843 3.527V6.67l-1.013 13.266-13.132.897h.008c-1.093-.044-3.518-.151-3.634-3.545l1.217-2.222 2.462 5.74 2.097-6.77-.045.009.018-.018 6.85 2.186L13.945 9.3l6.53-.409-5.144-4.212 2.71-1.51v.009M3.113 17.252v.017zM6.916 6.874c2.63-2.622 6.033-4.168 7.34-2.844 1.297 1.306-.072 4.523-2.702 7.135-2.666 2.613-6.015 4.248-7.322 2.933-1.306-1.324.036-4.612 2.675-7.224z\"/></svg>", Zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"m30 12-4-2V6h-4l-2-4-4 2-4-2-2 4H6v4l-4 2 2 4-2 4 4 2v4h4l2 4 4-2 4 2 2-4h4v-4l4-2-2-4ZM6 16a9.9 9.9 0 0 1 .842-4H10v8H6.842A9.9 9.9 0 0 1 6 16m10 10a9.98 9.98 0 0 1-7.978-4H16v-2h-2v-2h4c.819.819.297 2.308 1.179 3.37a1.89 1.89 0 0 0 1.46.63h3.34A9.98 9.98 0 0 1 16 26m-2-12v-2h4a1 1 0 0 1 0 2Zm11.158 6H24a2.006 2.006 0 0 1-2-2 2 2 0 0 0-2-2 3 3 0 0 0 3-3q0-.08-.004-.161A3.115 3.115 0 0 0 19.83 10H8.022a9.986 9.986 0 0 1 17.136 10\"/></svg>", Qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M27.837 5.673a4.33 4.33 0 0 0-2.293-2.701c-2.362-1.261-6.11-1.298-9.548-.092a26.3 26.3 0 0 0-8.76 4.966c-2.752 2.542-3.438 4.925-3.189 6.194.523 2.668 3.274 4.539 5.485 6.042.418.284.822.559 1.175.816-1.429.76-4.261 2.444-5.088 4.248a3.88 3.88 0 0 0-.118 3.332A2.37 2.37 0 0 0 6.869 29.8a5.6 5.6 0 0 0 1.49.2 6.35 6.35 0 0 0 5.19-2.856 6.74 6.74 0 0 0 .864-5.382 7.3 7.3 0 0 1 2.044-.03 3.92 3.92 0 0 1 2.816 1.311 1.82 1.82 0 0 1 .423 1.262 1.55 1.55 0 0 1-.772 1.05c-.234.14-.586.355-.504.803.036.194.198.633.894.512a2.93 2.93 0 0 0 2.145-2.651 4 4 0 0 0-1.197-2.904 5.94 5.94 0 0 0-4.396-1.626 10.6 10.6 0 0 0-2.672.304 20 20 0 0 0-2.203-1.846c-1.712-1.3-3.33-2.529-3.235-4.26.125-2.263 2.468-4.532 6.964-6.744 4.016-1.976 7.254-2.037 8.944-1.438a2 2 0 0 1 1.204.883 2.77 2.77 0 0 1-.36 2.47 9.71 9.71 0 0 1-7.425 4.304 3.86 3.86 0 0 1-3.238-.757c-.278-.302-.593-.645-1.074-.383q-.565.31-.225 1.189a3.9 3.9 0 0 0 2.407 1.92 11.7 11.7 0 0 0 7.128-.671c3.527-1.35 6.681-5.202 5.756-8.787M11.895 24.475a4 4 0 0 1-.192.468 4.5 4.5 0 0 1-.753 1.081 2.83 2.83 0 0 1-2.533 1.107c-.056-.032-.078-.146-.085-.193a3.28 3.28 0 0 1 1.076-2.284 11.3 11.3 0 0 1 2.644-1.933 3.85 3.85 0 0 1-.157 1.754\"/></svg>", $o = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#0277bd\" d=\"M105.46 209.517c-7.875 0-13.452-7.521-13.452-15.37v-.327c0-7.848 5.578-13.735 13.452-13.735h164.05c1.476-4.905 2.625-11.446 3.281-17.986h-137.81c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h137.31c-.82-6.54-1.969-13.081-3.773-17.986h-104.01c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h91.87c-21.327-37.607-60.864-61.315-106.14-61.315-67.918 0-123.04 54.448-123.04 122.3 0 67.856 55.122 123.28 123.04 123.28 46.59 0 87.112-25.507 107.95-63.114h-152.73z\"/></svg>", es = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"m6.457 9.894 12.523 5.163-.456 1.211L6 11.105Zm7.02-3.091L26 11.966l-.457 1.21L13.02 8.015ZM6.465 18.885l12.524 5.163-.457 1.21L6.01 20.097Zm7.007-3.086 12.524 5.163-.456 1.21-12.524-5.162Z\"/><path fill=\"#f44336\" d=\"M6 24.07V30l19.997-3.106V20.96zM6 5.11v5.99l20-3.11V2zm0 9.96v5.03l20-3.11v-5.03z\"/></svg>", ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.6.6 0 0 0-.18-.03c-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1q.09.03.18.03c.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64zm-1.98-1.71c.04.31.05.52.05.73s-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2\"/></svg>", ns = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"#0288d1\"><path d=\"m5.747 14.046 6.254 8.61 6.252-8.61-6.254 3.807z\"/><path d=\"M11.999 1.343 5.747 11.83l6.252 3.807 6.253-3.807z\"/></g></svg>", rs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff4081\" d=\"m24.95 28.948-18-.9a1 1 0 0 1-.95-1V6.906a1 1 0 0 1 .9-.995l18-1.905A1 1 0 0 1 26 5v22.949a1 1 0 0 1-1.05.998Z\"/><path fill=\"#fafafa\" d=\"m20 8.52.19-4.242 3.649-.275.16 4.37a.28.28 0 0 1-.276.283.3.3 0 0 1-.188-.063L22.123 7.52l-1.668 1.23a.29.29 0 0 1-.398-.055A.27.27 0 0 1 20 8.52m-2.128 6.647c0 .487 3.448.25 3.912-.094 0-3.324-1.87-5.073-5.298-5.073-3.421 0-5.345 1.774-5.345 4.436 0 4.642 6.561 4.735 6.561 7.266a1.022 1.022 0 0 1-1.164 1.13c-1.047 0-1.459-.512-1.413-2.242 0-.375-3.984-.494-4.101 0-.308 4.198 2.426 5.41 5.56 5.41C19.619 26 22 24.45 22 21.658c0-4.973-6.653-4.842-6.653-7.31a1.08 1.08 0 0 1 1.243-1.13c.478 0 1.354.08 1.282 1.949\"/></svg>", is = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#c0ca33\" d=\"M127.22 155.91c14.639-17.51 16.362-35.594 5.023-69.178-7.176-21.241-19.089-37.603-10.334-50.807 9.33-14.065 29.135-.43 12.63 18.371l3.301 2.296c19.806 2.297 29.566-24.83 14.783-32.58-39.038-20.38-73.197 18.802-58.127 64.155 6.459 19.232 15.501 39.613 8.181 55.831-6.315 13.922-18.515 22.103-26.695 22.39-17.079.862-5.74-38.32 13.922-48.08 1.722-.86 4.162-2.009 1.866-4.88-24.255-2.726-38.464 8.468-46.645 24.113-23.825 45.497 45.21 62.289 82.096 18.37z\"/></svg>", as = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#ff5722\" d=\"M175.94 24.328c-13.037.252-26.009 3.872-37.471 11.174L79.912 72.818a67.13 67.13 0 0 0-30.355 44.906 70.8 70.8 0 0 0 6.959 45.445 67.2 67.2 0 0 0-10.035 25.102 71.54 71.54 0 0 0 12.236 54.156c23.351 33.41 69.468 43.311 102.81 22.07l58.559-37.158a67.36 67.36 0 0 0 30.355-44.906 70.77 70.77 0 0 0-6.982-45.422 67.65 67.65 0 0 0 10.059-25.102 71.63 71.63 0 0 0-12.236-54.156v-.18c-15.324-21.925-40.453-33.727-65.342-33.246zm5.137 28.68a46.5 46.5 0 0 1 36.09 19.969 42.98 42.98 0 0 1 7.365 32.557 45 45 0 0 1-1.393 5.455l-1.123 3.37-2.986-2.247a75.9 75.9 0 0 0-22.902-11.45l-2.244-.651.201-2.246a13.16 13.16 0 0 0-2.379-8.711 13.99 13.99 0 0 0-14.953-5.412 12.8 12.8 0 0 0-3.594 1.572l-58.578 37.25a12.24 12.24 0 0 0-5.502 8.15 13.1 13.1 0 0 0 2.246 9.834 14.03 14.03 0 0 0 14.93 5.569 13.5 13.5 0 0 0 3.594-1.573l22.453-14.234a41.8 41.8 0 0 1 11.898-5.232 46.48 46.48 0 0 1 49.914 18.502 43.02 43.02 0 0 1 7.363 32.557 40.42 40.42 0 0 1-18.254 27.078l-58.58 37.316a43 43 0 0 1-11.898 5.23A46.545 46.545 0 0 1 82.81 227.14a42.98 42.98 0 0 1-7.341-32.557 38 38 0 0 1 1.39-5.41l1.102-3.37 3.008 2.246a75.9 75.9 0 0 0 22.836 11.361l2.244.65-.201 2.247a13.25 13.25 0 0 0 2.447 8.644 14.03 14.03 0 0 0 15.043 5.569 13.1 13.1 0 0 0 3.592-1.573l58.467-37.316a12.17 12.17 0 0 0 5.502-8.173 12.96 12.96 0 0 0-2.246-9.811 14.03 14.03 0 0 0-15.043-5.568 12.8 12.8 0 0 0-3.592 1.57l-22.453 14.258a42.9 42.9 0 0 1-11.877 5.209 46.52 46.52 0 0 1-49.846-18.5 43.02 43.02 0 0 1-7.297-32.557A40.42 40.42 0 0 1 96.798 96.98l58.646-37.316a42.8 42.8 0 0 1 11.811-5.21 46.5 46.5 0 0 1 13.822-1.444z\"/></svg>", os = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffb300\" d=\"M29.168 14.03a2.7 2.7 0 0 0-1.968-.83 2.51 2.51 0 0 0-1.929.8h-4.443l3.078-3.078a2.835 2.835 0 0 0 2.857-2.842 2.6 2.6 0 0 0-.831-1.969 2.82 2.82 0 0 0-2.014-.788 2.67 2.67 0 0 0-1.968.788 2.36 2.36 0 0 0-.812 1.922L18 11.17V6.726a2.51 2.51 0 0 0 .8-1.929 2.7 2.7 0 0 0-.832-1.968 2.745 2.745 0 0 0-3.936 0 2.7 2.7 0 0 0-.832 1.968 2.51 2.51 0 0 0 .8 1.93v4.443l-3.138-3.138a2.36 2.36 0 0 0-.812-1.922 2.66 2.66 0 0 0-1.968-.788 2.83 2.83 0 0 0-2.014.788 2.6 2.6 0 0 0-.831 1.969 2.74 2.74 0 0 0 .831 2.013 2.8 2.8 0 0 0 2.026.829l3.078 3.078H6.729a2.51 2.51 0 0 0-1.929-.8 2.7 2.7 0 0 0-1.968.831 2.745 2.745 0 0 0 0 3.937 2.7 2.7 0 0 0 1.968.832 2.51 2.51 0 0 0 1.929-.8h4.443l-3.078 3.077a2.835 2.835 0 0 0-2.857 2.842 2.6 2.6 0 0 0 .831 1.969 2.82 2.82 0 0 0 2.014.788 2.67 2.67 0 0 0 1.968-.788 2.36 2.36 0 0 0 .812-1.922L14 20.827v4.444a2.51 2.51 0 0 0-.8 1.929 2.784 2.784 0 0 0 4.768 1.968A2.7 2.7 0 0 0 18.8 27.2a2.51 2.51 0 0 0-.8-1.929v-4.444l3.138 3.138a2.36 2.36 0 0 0 .812 1.922 2.66 2.66 0 0 0 1.968.788 2.83 2.83 0 0 0 2.014-.788 2.6 2.6 0 0 0 .831-1.969 2.74 2.74 0 0 0-.831-2.013 2.8 2.8 0 0 0-2.026-.829L20.828 18h4.443a2.51 2.51 0 0 0 1.93.8 2.784 2.784 0 0 0 1.967-4.769Z\"/></svg>", ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff6e40\" d=\"M17.087 19.721c-2.36 1.36-5.59 1.5-8.86.1a13.8 13.8 0 0 1-6.23-5.32c.67.55 1.46 1 2.3 1.4 3.37 1.57 6.73 1.46 9.1 0-3.37-2.59-6.24-5.96-8.37-8.71-.45-.45-.78-1.01-1.12-1.51 8.28 6.05 7.92 7.59 2.41-1.01 4.89 4.94 9.43 7.74 9.43 7.74.16.09.25.16.36.22.1-.25.19-.51.26-.78.79-2.85-.11-6.12-2.08-8.81 4.55 2.75 7.25 7.91 6.12 12.24-.03.11-.06.22-.05.39 2.24 2.83 1.64 5.78 1.35 5.22-1.21-2.39-3.48-1.65-4.62-1.17\"/></svg>", cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zm4 7.5h-4v2h1l-2 1.67L10 13h1v-2H7v2h1l3 2.5L8 18H7v2h4v-2h-1l2-1.67L14 18h-1v2h4v-2h-1l-3-2.5 3-2.5h1z\"/></svg>", ls = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#5c6bc0\" d=\"m2 10 8 4V6L2 2zm10 5 8 4v-8l-8-4zm0 11 8 4v-8l-8-4zm10-14v8l8-4V8z\"/></svg>", us = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#ffca28\"/><path fill=\"#ffca28\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#0288d1\"/><path fill=\"#0288d1\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", fs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><path fill=\"#2196f3\" d=\"M80 192 64 320h32c16-80 16-96 63.242-96H176c8.837 0 16 7.163 16 16v352c0 8.837 0 16-32 16h-32v32h192v-32h-32c-32 0-32-7.163-32-16V240c0-8.837 7.163-16 16-16h16c48 0 48 16 64 96h32l-16-128zm560 0v32c16 0 45.713 0 52.57 16L776 434.666 708.57 592c-6.857 16-52.57 16-68.57 16v32h128v-32s-34.285 0-27.428-16L792 472l51.428 120c3.103 7.24-1.52 16-11.428 16v32h128v-32c-16 0-45.713 0-52.57-16L824 397.334 891.43 240c6.857-16 52.57-16 68.57-16v-32H832v32s34.285 0 27.428 16L808 360l-51.428-120c-3.103-7.24 1.52-16 11.428-16v-32zM320 384v32h32c32 0 32 7.163 32 16v352c0 8.837 0 16-32 16h-32v32h304l16-128h-32c-16 80-16 96-64 96h-64c-32 0-32-7.163-32-16V624h80c8.837 0 16 0 16 32v16h32V544h-32v16c0 32-7.163 32-16 32h-80V432c0-8.837 0-16 32-16h64c48 0 48 16 64 96h32l-16-128z\"/></svg>", ps = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7cb342\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m-1.667 22.143L6.92 16.73l3.293-3.293 4.12 4.107 7.455-7.44 3.294 3.293Z\"/></svg>", ms = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#cfd8dc\" d=\"M4 6V4h8v2H9v7H7V6z\"/><path fill=\"#ef5350\" d=\"M4 1v1H2v12h2v1H1V1zm8 0v1h2v12h-2v1h3V1z\"/></svg>", hs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#757575\" d=\"M15 2H6a2.006 2.006 0 0 0-2 2v22a2.006 2.006 0 0 0 2 2h6v-4H6v-2h6v-2H6v-2h6v-2H6v-2h6v-2h2V4l8 8h2v-1Z\" data-mit-no-recolor=\"true\"/><path fill=\"#0288d1\" d=\"M12 12v18h18V12Zm8 6h-2v8h-2v-8h-2v-2h6Zm8 0h-4v2h2a2.006 2.006 0 0 1 2 2v2a2.006 2.006 0 0 1-2 2h-4v-2h4v-2h-2a2.006 2.006 0 0 1-2-2v-2a2.006 2.006 0 0 1 2-2h4Z\"/></svg>", gs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#fbc02d\" d=\"M12 10h10v2H12z\"/><path fill=\"#fbc02d\" d=\"M16 4h2v8h-2zm4 18h10v2H20zm4 2h2v4h-2zm0-20h2v14h-2zM2 18h10v2H2z\"/><path fill=\"#fbc02d\" d=\"M6 18h2v10H6zM6 4h2v10H6zm10 12h2v12h-2z\"/></svg>", _s = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><g fill=\"#0288d1\"><path d=\"M2 2v12h12V2zm1 1h10v10H3z\"/><path d=\"M5 7v1h1v4h1V8h1V7zm5 0a1.003 1.003 0 0 0-1 1v1a1.003 1.003 0 0 0 1 1h1v1H9v1h2a1.003 1.003 0 0 0 1-1v-1a1.003 1.003 0 0 0-1-1h-1V8h2V7z\"/></g></svg>", vs = "<svg xmlns=\"http://www.w3.org/2000/svg\" xml:space=\"preserve\" viewBox=\"0 0 16 16\"><path fill=\"#0288d1\" d=\"M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", ys = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff9800\" d=\"m24 6 2 6h-4l-2-6h-3l2 6h-4l-2-6h-3l2 6H8L6 6H5a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3V6Z\"/></svg>", bs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M22.19 4H16v4h2.19L12 14.19V8h2V4H2v4h2v20h4v-.01l.01.01L28 8V4z\"/></svg>", xs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ab47bc\" d=\"m22 11.8-5.7 4.584L22 20.8zM7.24 23.68 4 21.64v-10.8l3.6-1.2 5.16 3.996L23.2 4 28 7v18.6L22 28l-9.192-8.808zm.36-5.28 2.232-2.064L7.6 14.2Z\"/></svg>", Ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#a0f\" d=\"M29.313 12h-6.664a1.427 1.427 0 0 1-1.1-2.24l4.398-6.676A.703.703 0 0 0 25.397 2H8.428a.62.62 0 0 0-.55.289l-5.77 8.627A.703.703 0 0 0 2.658 12h8.175a1.427 1.427 0 0 1 1.099 2.24l-4.48 6.676A.702.702 0 0 0 8 22l6.695.002A1.34 1.34 0 0 1 16 23.375v5.934a.652.652 0 0 0 1.168.433l12.694-16.586a.725.725 0 0 0-.55-1.156\"/></svg>", Cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#41b883\" d=\"M1.791 3.851 12 21.471 22.209 3.936V3.85H18.24l-6.18 10.616L5.906 3.851z\"/><path fill=\"#35495e\" d=\"m5.907 3.851 6.152 10.617L18.24 3.851h-3.723L12.084 8.03 9.66 3.85z\"/></svg>", ws = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M22 18h4v4h-4z\"/><path fill=\"#7c4dff\" d=\"M20 2a4 4 0 0 1-8 0H2v28h28V2Zm-2 24h-2v2h-4v-2h-2v2H6v-2H4V16h2v10h4V16h2v10h4V16h2Zm10 2h-2v-4h-4v4h-2V18h2v-2h4v2h2Z\"/></svg>", Ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fafafa\" fill-opacity=\".785\" d=\"m19.376 15.988-7.708 4.45-7.709-4.45v-8.9l7.709-4.451 7.708 4.45z\"/><path fill=\"#90caf9\" d=\"M12.286 1.98c-.21 0-.41.059-.57.179l-7.9 4.44c-.32.17-.53.5-.53.88v9c0 .38.21.711.53.881l7.9 4.44c.16.12.36.18.57.18s.41-.06.57-.18l7.9-4.44c.32-.17.53-.5.53-.88v-9c0-.38-.21-.712-.53-.882l-7.9-4.44a.95.95 0 0 0-.57-.179zm0 2.15 7 3.94v2.103h-.016v5.177h.016v.54l-7 3.939-7-3.94V8.07zm0 2.08-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/><path fill=\"#0277bd\" d=\"m12.286 6.21-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/></svg>", Es = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#01579b\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM7 13l1.5 7h2l1.5-3 1.5 3h2l1.5-7h1v-2h-4v2h1l-.9 4.2L13 15h-2l-1.1 2.2L9 13h1v-2H6v2z\"/></svg>", Ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m.12 13.5 3.74 3.74 1.42-1.41-2.33-2.33 2.33-2.33-1.42-1.41zm11.16 0-3.74-3.74-1.42 1.41 2.33 2.33-2.33 2.33 1.42 1.41z\"/></svg>", Os = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff5252\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2m12 16v-2H9v2zm-4-4v-2H6v2z\"/></svg>", ks = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M27.575 23.967a9.9 9.9 0 0 0-3.751 1.726 22.6 22.6 0 0 1-5.537 2.504 1.55 1.55 0 0 1-.931.52 59 59 0 0 1-6.11.548c-1.102.008-1.777-.282-1.965-.735a1.49 1.49 0 0 1 .82-1.965 3.6 3.6 0 0 1-.486-.359c-.163-.162-.334-.487-.385-.367-.213.52-.324 1.794-.897 2.366-.786.795-2.273.53-3.153.069-.965-.513.069-1.718.069-1.718a.69.69 0 0 1-.94-.324 4.6 4.6 0 0 1-.632-2.794 5.2 5.2 0 0 1 1.674-2.76 8.84 8.84 0 0 1 .624-4.17 9.9 9.9 0 0 1 3-3.469S7.136 11.015 7.82 9.177c.444-1.196.623-1.187.769-1.239a3.44 3.44 0 0 0 1.375-.811 4.99 4.99 0 0 1 4.178-1.607s1.094-3.357 2.12-2.7a17.4 17.4 0 0 1 1.452 2.735s1.213-.71 1.35-.445a10.74 10.74 0 0 1 .495 5.81 13.3 13.3 0 0 1-2.46 5.127c-.129.214 1.47.889 2.477 3.683.932 2.554.103 4.699.248 4.938.026.043.034.06.034.06s1.068.085 3.213-1.24a8.05 8.05 0 0 1 4.05-1.52 1.026 1.026 0 0 1 .453 2Z\"/></svg>", As = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f9a825\" d=\"M2 8h6v4H2zm8 0h12v4H10zm0 12h12v4H10zm14 0h2v4h-2zM8 20l-3 4H2V12h4v8zm14-8h-6l-6 8h6z\"/><path fill=\"#f9a825\" d=\"M16 20h-6l-6 8m12-16h6l6-8m2 4v16h-4V12h-2l3-4z\"/></svg>", js = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#afb42b\" d=\"M14 17h-2v-2h-2v-2h2v2h2m0-6h-2v2h2v2h-2v-2h-2V9h2V7h-2V5h2v2h2m5-4H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2\"/></svg>", Ms = "file", Ns = {
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
}, Ps = {
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
}, Fs = new Map(Object.entries(/* @__PURE__ */ Object.assign({
	"./icons/asciidoc.svg": ha,
	"./icons/assembly.svg": ga,
	"./icons/astro.svg": _a,
	"./icons/audio.svg": va,
	"./icons/bicep.svg": ya,
	"./icons/c.svg": ba,
	"./icons/cabal.svg": xa,
	"./icons/certificate.svg": Sa,
	"./icons/clojure.svg": Ca,
	"./icons/cmake.svg": wa,
	"./icons/console.svg": Ta,
	"./icons/cpp.svg": Ea,
	"./icons/crystal.svg": Da,
	"./icons/csharp.svg": Oa,
	"./icons/css.svg": ka,
	"./icons/dart.svg": Aa,
	"./icons/database.svg": ja,
	"./icons/diff.svg": Ma,
	"./icons/dll.svg": Na,
	"./icons/docker.svg": Pa,
	"./icons/document.svg": Fa,
	"./icons/editorconfig.svg": Ia,
	"./icons/elixir.svg": La,
	"./icons/elm.svg": Ra,
	"./icons/erlang.svg": za,
	"./icons/eslint.svg": Ba,
	"./icons/exe.svg": Va,
	"./icons/file.svg": Ha,
	"./icons/font.svg": Ua,
	"./icons/fsharp.svg": Wa,
	"./icons/git.svg": Ga,
	"./icons/github-actions-workflow.svg": Ka,
	"./icons/gitlab.svg": qa,
	"./icons/go-mod.svg": Ja,
	"./icons/go.svg": Ya,
	"./icons/gradle.svg": Xa,
	"./icons/graphql.svg": Za,
	"./icons/groovy.svg": Qa,
	"./icons/h.svg": $a,
	"./icons/handlebars.svg": eo,
	"./icons/haskell.svg": to,
	"./icons/hcl.svg": no,
	"./icons/hex.svg": ro,
	"./icons/hpp.svg": io,
	"./icons/html.svg": ao,
	"./icons/image.svg": oo,
	"./icons/jar.svg": so,
	"./icons/java.svg": co,
	"./icons/javaclass.svg": lo,
	"./icons/javascript.svg": uo,
	"./icons/json.svg": fo,
	"./icons/julia.svg": po,
	"./icons/jupyter.svg": mo,
	"./icons/key.svg": ho,
	"./icons/kotlin.svg": go,
	"./icons/kubernetes.svg": _o,
	"./icons/less.svg": vo,
	"./icons/license.svg": yo,
	"./icons/lock.svg": bo,
	"./icons/log.svg": xo,
	"./icons/lua.svg": So,
	"./icons/makefile.svg": Co,
	"./icons/markdown.svg": wo,
	"./icons/maven.svg": To,
	"./icons/mdx.svg": Eo,
	"./icons/nginx.svg": Do,
	"./icons/nim.svg": Oo,
	"./icons/nix.svg": ko,
	"./icons/nodejs.svg": Ao,
	"./icons/npm.svg": jo,
	"./icons/objective-c.svg": Mo,
	"./icons/objective-cpp.svg": No,
	"./icons/ocaml.svg": Po,
	"./icons/pdf.svg": Fo,
	"./icons/perl.svg": Io,
	"./icons/php.svg": Lo,
	"./icons/pnpm.svg": Ro,
	"./icons/powerpoint.svg": zo,
	"./icons/powershell.svg": Bo,
	"./icons/prettier.svg": Vo,
	"./icons/prisma.svg": Ho,
	"./icons/proto.svg": Uo,
	"./icons/pug.svg": Wo,
	"./icons/python.svg": Go,
	"./icons/r.svg": Ko,
	"./icons/react.svg": qo,
	"./icons/react_ts.svg": Jo,
	"./icons/readme.svg": Yo,
	"./icons/ruby.svg": Xo,
	"./icons/rust.svg": Zo,
	"./icons/sass.svg": Qo,
	"./icons/sbt.svg": $o,
	"./icons/scala.svg": es,
	"./icons/settings.svg": ts,
	"./icons/solidity.svg": ns,
	"./icons/storybook.svg": rs,
	"./icons/stylus.svg": is,
	"./icons/svelte.svg": as,
	"./icons/svg.svg": os,
	"./icons/swift.svg": ss,
	"./icons/table.svg": cs,
	"./icons/terraform.svg": ls,
	"./icons/test-js.svg": us,
	"./icons/test-ts.svg": ds,
	"./icons/tex.svg": fs,
	"./icons/todo.svg": ps,
	"./icons/toml.svg": ms,
	"./icons/tsconfig.svg": hs,
	"./icons/tune.svg": gs,
	"./icons/typescript-def.svg": _s,
	"./icons/typescript.svg": vs,
	"./icons/video.svg": ys,
	"./icons/vim.svg": bs,
	"./icons/visualstudio.svg": xs,
	"./icons/vite.svg": Ss,
	"./icons/vue.svg": Cs,
	"./icons/webassembly.svg": ws,
	"./icons/webpack.svg": Ts,
	"./icons/word.svg": Es,
	"./icons/xml.svg": Ds,
	"./icons/yaml.svg": Os,
	"./icons/yarn.svg": ks,
	"./icons/zig.svg": As,
	"./icons/zip.svg": js
})).map(([e, t]) => [e.slice(8, -4), t]));
function Is(e) {
	let t = e.slice(e.lastIndexOf("/") + 1).toLowerCase(), n = Ns[t];
	if (n) return n;
	let r = t.split(".");
	for (let e = 1; e < r.length; e++) {
		let t = Ps[r.slice(e).join(".")];
		if (t) return t;
	}
	return Ms;
}
var Ls = /* @__PURE__ */ new Map(), Rs = (e) => {
	let t = Ls.get(e);
	if (t) return t;
	let n = Fs.get(e) ?? Fs.get("file") ?? "", r = `data:image/svg+xml,${encodeURIComponent(n)}`;
	return Ls.set(e, r), r;
};
function zs({ path: e, size: t = 16, className: n }) {
	return /* @__PURE__ */ J("img", {
		src: Rs(Is(e)),
		alt: "",
		"aria-hidden": !0,
		width: t,
		height: t,
		className: z("shrink-0", n)
	});
}
//#endregion
//#region src/app/atoms/fork-session-item/index.tsx
function Bs(e) {
	return e.replace(/-/g, "").slice(0, 12);
}
var Vs = ({ sessionId: e, title: t, deleted: n = !1, onOpen: r, onDismiss: i }) => {
	let a = n ? "No fork found" : t?.trim() || "Fork", o = `ID: ${Bs(e)}`;
	return n ? /* @__PURE__ */ J("div", {
		className: z("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] max-w-[540px]", "border-l-2 border-tertiary bg-elevation-sublevel-variant-A text-basic-tertiary"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ J(M, {
						iconName: F.Scheme,
						size: 20,
						className: "shrink-0"
					}),
					/* @__PURE__ */ J("span", {
						className: "header-micro",
						children: a
					}),
					i ? /* @__PURE__ */ J("button", {
						type: "button",
						title: "Dismiss",
						"aria-label": "Dismiss deleted fork",
						onClick: i,
						className: "shrink-0 inline-flex",
						children: /* @__PURE__ */ J(M, {
							iconName: F.Close,
							size: 20
						})
					}) : /* @__PURE__ */ J(M, {
						iconName: F.Close,
						size: 20,
						className: "shrink-0"
					})
				]
			}), /* @__PURE__ */ J("span", {
				className: "code-micro opacity-75 whitespace-nowrap",
				children: o
			})]
		})
	}) : /* @__PURE__ */ J("button", {
		type: "button",
		onClick: r,
		className: z("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] text-left max-w-[540px]", "border-l-2 border-accent-primary bg-btn-ghost-accent-highlighted text-btn-accent", "hover:bg-btn-ghost-accent-highlighted-hovered", "active:bg-btn-ghost-accent-highlighted-pressed"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ J(M, {
						iconName: F.Scheme,
						size: 20,
						className: "shrink-0"
					}),
					/* @__PURE__ */ J("span", {
						className: "header-micro",
						children: a
					}),
					/* @__PURE__ */ J(M, {
						iconName: F.Right,
						size: 20,
						className: "shrink-0"
					})
				]
			}), /* @__PURE__ */ J("span", {
				className: "code code-micro opacity-75 whitespace-nowrap",
				children: o
			})]
		})
	});
}, Hs = ({ icon: e, title: t, description: n, onClick: r, className: i = "" }) => /* @__PURE__ */ Y("button", {
	type: "button",
	onClick: r,
	className: z("group relative flex h-[100px] w-full flex-col items-start overflow-hidden", "rounded-[4px] bg-elevation-level-1 text-left shadow-convex", "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--blue-500)]", i),
	children: [
		/* @__PURE__ */ J("span", {
			"aria-hidden": !0,
			className: "absolute inset-0 bg-btn-ghost transition-colors duration-200 ease-out group-hover:bg-btn-ghost-hovered group-active:bg-btn-ghost-pressed"
		}),
		/* @__PURE__ */ Y("span", {
			className: "relative flex w-full items-center gap-[10px] px-4 pb-2 pt-4",
			children: [/* @__PURE__ */ J(M, {
				iconName: e,
				size: 20,
				className: "shrink-0 [&>path]:fill-basic-tertiary"
			}), /* @__PURE__ */ J("span", {
				className: "flex-1 min-w-0 truncate label-small text-basic-primary",
				children: t
			})]
		}),
		/* @__PURE__ */ J("span", {
			className: "relative flex w-full flex-col justify-end px-4 pb-4 pt-2",
			children: /* @__PURE__ */ J("span", {
				className: "text-micro text-basic-muted line-clamp-2",
				children: n
			})
		})
	]
}), X = /* @__PURE__ */ function(e) {
	return e.Small = "input-small", e.Medium = "input-medium", e.Large = "input-large", e;
}({}), Us = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Ws = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Gs = {
	"input-small": B.Small,
	"input-medium": B.Medium,
	"input-large": B.Large
}, Ks = {
	"input-small": 16,
	"input-medium": 20,
	"input-large": 24
}, qs = {
	"input-small": "pl-1",
	"input-medium": "pl-2",
	"input-large": "pl-3"
}, Js = {
	"input-small": "pr-1",
	"input-medium": "pr-2",
	"input-large": "pr-3"
}, Ys = {
	"input-small": "pl-6",
	"input-medium": "pl-9",
	"input-large": "pl-12"
}, Xs = {
	"input-small": "pr-7",
	"input-medium": "pr-11",
	"input-large": "pr-14"
}, Zs = {
	"input-small": "top-1 left-1",
	"input-medium": "top-2 left-2",
	"input-large": "top-3 left-3"
}, Qs = {
	"input-small": "top-1 right-1",
	"input-medium": "top-2 right-2",
	"input-large": "top-3 right-3"
}, Z = ({ inputSize: e = "input-large", leading: t = "none", leadingOnClick: n, leadingSlot: r, trailing: i = "none", trailingOnClick: a, leadingIconName: s = F.Add, trailingIconName: c = F.Search, inputClassName: l = "", label: u = "", required: d = !1, rounded: f = !1, placeholder: p = "", isDisabled: m = !1, validation: h = !1, validationText: g = "", hintText: _, className: v = "", ref: y, ...b }) => {
	let x = z("w-full input font-normal", e, l, f ? "rounded-full" : "rounded-[4px]", t === "none" && !r ? qs[e] : Ys[e], i === "none" ? Js[e] : Xs[e], m && "input-disabled", h && "input-validation"), S = m ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)";
	return /* @__PURE__ */ J(sa, {
		label: u,
		required: d,
		validation: h,
		validationText: g,
		hintText: _,
		className: v,
		children: /* @__PURE__ */ Y("div", {
			className: "input-wrapper relative w-full h-fit",
			children: [
				r ? /* @__PURE__ */ J("div", {
					className: z("absolute flex items-center justify-center", Zs[e]),
					style: {
						width: Ks[e],
						height: Ks[e]
					},
					children: r
				}) : null,
				!r && t === "icon" ? /* @__PURE__ */ J(M, {
					iconName: s,
					size: Ks[e],
					className: z("absolute", Zs[e]),
					color: S
				}) : null,
				!r && t === "button" ? /* @__PURE__ */ J(V, {
					size: Gs[e],
					variant: L.Ghost,
					content: o.Icon,
					onClick: n,
					className: z("input-btn-leading", !f && "rounded-lg"),
					children: /* @__PURE__ */ J(M, { iconName: s })
				}) : null,
				/* @__PURE__ */ J("input", {
					ref: y,
					className: x,
					placeholder: p,
					disabled: m,
					...b
				}),
				i === "icon" ? /* @__PURE__ */ J(M, {
					iconName: c,
					size: Ks[e],
					className: z("absolute", Qs[e]),
					color: S
				}) : null,
				i === "button" ? /* @__PURE__ */ J(V, {
					size: Gs[e],
					variant: L.Ghost,
					content: o.Icon,
					onClick: a,
					className: z("input-btn-trailing", !f && "rounded-lg"),
					children: /* @__PURE__ */ J(M, { iconName: c })
				}) : null
			]
		})
	});
};
Z.Size = X, Z.Leading = Us, Z.Trailing = Ws;
//#endregion
//#region src/app/atoms/input/StickyInput.tsx
var $s = /* @__PURE__ */ function(e) {
	return e.Default = "default", e.Search = "search", e;
}({}), ec = ({ variant: e = "default", leading: t = Us.None, leadingOnClick: n, trailing: r = Ws.None, trailingOnClick: i, leadingIconName: a = F.Add, trailingIconName: s = F.Search, inputClassName: c = "", className: l = "", rounded: u = !0, isDisabled: d = !1, validation: f = !1, onClear: p, value: m, ref: h, ...g }) => {
	let _ = e === "search", v = m != null && String(m).length > 0, y = _ ? Us.Icon : t, b = _ ? F.Search : a, x = _ ? v ? Ws.Button : Ws.None : r, S = _ ? F.Close : s, C = _ ? p : i, w = l.includes("flex-grow") || l.includes("flex-1"), T = u ? "rounded-full" : "rounded-[4px]", E = d ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)", D = {
		[Us.None]: "pl-3",
		[Us.Icon]: "pl-10",
		[Us.Button]: "pl-12"
	}[y], O = {
		[Ws.None]: "pr-3",
		[Ws.Icon]: "pr-10",
		[Ws.Button]: "pr-12"
	}[x];
	return /* @__PURE__ */ J("div", {
		className: z("bg-elevation-level-3 shadow-2xl overflow-hidden h-10", w ? "flex w-full" : "inline-flex w-fit", T, l),
		children: /* @__PURE__ */ Y("div", {
			className: "input-wrapper relative w-full h-full",
			children: [
				y === Us.Icon ? /* @__PURE__ */ J(M, {
					iconName: b,
					size: 24,
					className: "absolute top-2 left-2",
					color: E
				}) : null,
				y === Us.Button ? /* @__PURE__ */ J(V, {
					size: B.Large,
					variant: L.Ghost,
					content: o.Icon,
					onClick: n,
					className: "btn-sticky input-btn-leading",
					children: /* @__PURE__ */ J(M, { iconName: b })
				}) : null,
				/* @__PURE__ */ J("input", {
					ref: h,
					className: z("w-full input input-sticky font-normal", T, D, O, d && "input-disabled", f && "input-validation", c),
					disabled: d,
					value: m,
					...g
				}),
				x === Ws.Icon ? /* @__PURE__ */ J(M, {
					iconName: S,
					size: 24,
					className: "absolute top-2 right-2",
					color: E
				}) : null,
				x === Ws.Button ? /* @__PURE__ */ J(V, {
					size: B.Large,
					variant: L.Ghost,
					content: o.Icon,
					onClick: C,
					"aria-label": _ ? "Clear search" : void 0,
					className: "btn-sticky input-btn-trailing",
					children: /* @__PURE__ */ J(M, { iconName: S })
				}) : null
			]
		})
	});
};
ec.Variant = $s, ec.Leading = Us, ec.Trailing = Ws;
//#endregion
//#region src/app/atoms/input/TextArea.tsx
var tc = /* @__PURE__ */ function(e) {
	return e.Small = "p-2 text-micro", e.Medium = "p-3 text-small", e.Large = "p-4 text-medium", e;
}({}), nc = ({ textAreaSize: e = "p-3 text-small", label: t = "", required: n = !1, isDisabled: r = !1, validation: i = !1, validationText: a = "", hintText: o, className: s = "", textAreaClassName: c = "", ref: l, ...u }) => /* @__PURE__ */ J(sa, {
	label: t,
	required: n,
	validation: i,
	validationText: a,
	hintText: o,
	className: s,
	children: /* @__PURE__ */ J("textarea", {
		ref: l,
		className: z("w-full input font-normal rounded-[4px]", e, r && "input-disabled", i && "input-validation", c),
		disabled: r,
		...u
	})
});
nc.Size = tc;
//#endregion
//#region src/app/atoms/loader/CircularLoader.tsx
var rc = /* @__PURE__ */ function(e) {
	return e.Brand = "stroke-[var(--color-fill-accent-primary)]", e.Neutral = "stroke-[var(--color-fill-basic-primary)]", e.Destructive = "stroke-[var(--color-fill-error-primary)]", e;
}({}), ic = ({ size: e = je.Medium, variant: t = "stroke-[var(--color-fill-basic-primary)]", strokeWidth: n = 2, className: r = "", ...i }) => {
	let a = Jr().replace(/:/g, ""), o = `circular-loader-mask-${a}`, s = `circular-loader-gradient-${a}`, c = 12 - n / 2;
	return /* @__PURE__ */ J("div", {
		className: z("inline-flex w-fit h-fit animate-spin", r),
		...i,
		children: /* @__PURE__ */ Y("svg", {
			width: e - 2,
			height: e - 2,
			viewBox: "0 0 24 24",
			fill: "none",
			xmlns: "http://www.w3.org/2000/svg",
			children: [/* @__PURE__ */ Y("defs", { children: [/* @__PURE__ */ Y("linearGradient", {
				id: s,
				x1: "0",
				y1: "0",
				x2: "0",
				y2: "1",
				children: [/* @__PURE__ */ J("stop", {
					offset: "0",
					stopColor: "white",
					stopOpacity: "1"
				}), /* @__PURE__ */ J("stop", {
					offset: "1",
					stopColor: "white",
					stopOpacity: "0"
				})]
			}), /* @__PURE__ */ Y("mask", {
				id: o,
				maskUnits: "userSpaceOnUse",
				children: [/* @__PURE__ */ J("rect", {
					x: "0",
					y: "0",
					width: "12",
					height: "24",
					fill: "white"
				}), /* @__PURE__ */ J("rect", {
					x: "12",
					y: "0",
					width: "12",
					height: "24",
					fill: `url(#${s})`
				})]
			})] }), /* @__PURE__ */ J("circle", {
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
ic.Size = je, ic.Variant = rc;
//#endregion
//#region src/app/atoms/loader/ProgressLoader.tsx
var ac = ({ active: e = !1, className: t = "" }) => /* @__PURE__ */ J("div", {
	className: z("h-px w-full overflow-hidden transition-opacity duration-150", e ? "opacity-100" : "opacity-0", t),
	children: /* @__PURE__ */ J("div", { className: "h-full w-full rounded-full bg-accent-inverse animate-progress" })
}), oc = "M121.021 9.70276e-06C121.635 0.00562721 122.201 0.336563 122.507 0.870577L135.925 24.2549C136.063 24.7077 136.011 25.2039 135.77 25.6245C123.798 46.5422 95.5972 95.432 95.5972 95.432C95.2748 95.7673 94.8263 95.9633 94.35 95.9633C94.35 95.9633 41.4186 95.9998 14.9471 96C14.327 96 13.7541 95.6678 13.4452 95.1289L0.251482 72.1142C-0.109585 71.4843 -0.0743152 70.5531 0.308855 69.8878C0.308855 69.8878 26.8205 24.1272 39.9734 1.1421C40.3239 0.529539 40.9631 0.0326747 41.6869 0.0326651C41.6869 0.0331171 121.021 9.70276e-06 121.021 9.70276e-06ZM17.9867 92.5287H38.3062L28.0888 74.8628L17.9867 92.5287ZM71.4405 92.4921H91.3571L81.3833 75.1488L71.4405 92.4921ZM44.4776 92.3253H64.8395L54.7068 74.6392L44.4776 92.3253ZM94.3943 90.7219L104.699 72.9047H84.1208L94.3943 90.7219ZM31.4008 73.0222L41.4435 90.5842L51.4972 73.0222H31.4008ZM84.704 69.3835H104.622L94.6593 51.9934L84.704 69.3835ZM31.5361 69.3112H51.9053L41.7633 51.595L31.5361 69.3112ZM107.678 67.7382L117.965 49.7693H97.3917L107.678 67.7382ZM98.0384 46.2393H117.945L107.94 28.9421L98.0384 46.2393ZM120.957 44.5242L131.277 26.4965H110.637L120.957 44.5242ZM68.3422 44.1304L78.6021 26.3231H58.0823L68.3422 44.1304ZM110.648 23.0128H131.258L120.976 5.23426L110.648 23.0128ZM58.1921 22.8519H78.4107L68.3014 5.46138L58.1921 22.8519ZM55.0653 21.3342L65.4303 3.50386H44.7004L55.0653 21.3342ZM81.5178 21.3003L91.8827 3.46996H71.1528L81.5178 21.3003Z", sc = "M153.045 9.30753e-05C153.475 0 153.734 0.165348 153.935 0.513892C156.659 5.22122 159.463 9.99634 162.212 14.7289L170.478 0.496114C170.663 0.188622 170.997 1.01676e-06 171.357 0C189.161 0.00012553 206.964 0.0226173 224.768 0.0226173C225.263 0.0226173 225.641 0.126836 225.863 0.498976L234.863 16.1296C235.046 16.4462 235.045 16.8479 234.863 17.1649L208.298 63.4387C208.131 63.7127 207.797 64 207.444 64C207.444 64 171.362 63.9773 153.308 63.9774C152.95 63.9774 152.567 63.7127 152.417 63.4632L144.303 49.3669L136.244 63.3367C136.08 63.5817 135.817 63.9484 135.411 63.9484C135.411 63.9484 96.8361 63.9773 81.4848 63.9773C81.4838 63.9773 81.4828 63.9773 81.4819 63.9773C81.479 63.9773 81.4762 63.9774 81.4734 63.9774C81.1058 63.9774 80.7662 63.7813 80.5831 63.4632L72.7738 49.8976L64.8804 63.4892C64.6968 63.8053 64.3583 64 63.9921 64C63.9921 64 27.959 63.9802 9.97191 63.9803C9.6043 63.9803 9.26474 63.7841 9.08163 63.4661L0.136438 47.9273C-0.0460772 47.6102 -0.0454374 47.2201 0.138117 46.9037C0.13793 46.9037 26.9095 0.698576 26.9095 0.698576C27.1378 0.308359 27.4681 0.0248531 27.9419 0.0248511C45.8728 0.0248511 81.7347 0 81.7347 0C82.1599 1.62705e-08 82.6177 0.296445 82.8391 0.692247L90.6841 14.2006L98.6433 0.496114C98.8288 0.188622 99.1624 1.01676e-06 99.5229 0C117.363 0.000125786 135.204 2.31608e-05 153.045 9.30753e-05ZM48.0609 61.9748H61.9268L54.9897 49.9265L48.0609 61.9748ZM191.465 61.9508H205.669L198.567 49.6279L191.465 61.9508ZM11.7777 61.9311H26.0793L18.9273 49.4798L11.7777 61.9311ZM83.2587 61.9282H97.5671L90.4129 49.5006L83.2587 61.9282ZM101.147 61.9282H115.448L108.296 49.4771L101.147 61.9282ZM29.906 61.7949H43.9006L36.9004 49.6222L29.906 61.7949ZM119.275 61.7921H133.27L126.269 49.6193L119.275 61.7921ZM63.9921 60.9321L71.1556 48.5974H56.8286L63.9921 60.9321ZM99.3581 60.8662L106.512 48.4386H92.2039L99.3581 60.8662ZM135.263 60.8448L142.361 48.5974H128.218L135.263 60.8448ZM27.8172 60.7005L34.7728 48.6002H20.7913L27.8172 60.7005ZM207.524 60.6894L214.566 48.4386H200.481L207.524 60.6894ZM20.8834 46.3924H35.0459L27.9937 34.1242L20.8834 46.3924ZM182.087 46.3895H196.249L189.197 34.1219L182.087 46.3895ZM164.037 46.3895H178.359L171.198 34.0343L164.037 46.3895ZM57.0693 46.2307H70.9708L64.0186 34.1364L57.0693 46.2307ZM128.29 46.2307H142.191L135.239 34.1364L128.29 46.2307ZM200.484 46.1626H214.258L207.38 34.1969L200.484 46.1626ZM180.223 45.5056L187.395 33.0359H173.05L180.223 45.5056ZM198.194 45.3711L205.285 33.0359H191.041L198.194 45.3711ZM216.337 45.3669L223.425 33.0359H209.23L216.337 45.3669ZM144.355 45.1453L151.299 33.0359H137.389L144.355 45.1453ZM72.8971 44.7322L79.6799 33.0359H66.1684L72.8971 44.7322ZM65.8535 30.9867H79.973L72.9494 18.7682L65.8535 30.9867ZM101.228 30.9867H115.536L108.378 18.7232L101.228 30.9867ZM137.09 30.9867H151.194L144.196 18.813L137.09 30.9867ZM173.063 30.9867H187.369L180.212 18.7239L173.063 30.9867ZM191.078 30.9867H205.279L198.165 18.6904L191.078 30.9867ZM209.219 30.9867H223.294L216.257 18.7753L209.219 30.9867ZM45.8569 29.9615L52.9107 17.7693H38.8302L45.8569 29.9615ZM207.059 29.9591L214.112 17.7693H200.034L207.059 29.9591ZM153.161 29.9309L160.23 17.6333H146.019L153.161 29.9309ZM117.363 29.9065L124.388 17.7693H110.287L117.363 29.9065ZM189.197 29.9058L196.222 17.7693H182.121L189.197 29.9058ZM225.16 29.8901L232.198 17.6787H218.122L225.16 29.8901ZM81.7234 29.5569L88.6482 17.6333H74.7987L81.7234 29.5569ZM38.6257 15.587H52.7652L45.7468 3.38717L38.6257 15.587ZM74.7873 15.5841H89.1142L81.9508 3.24932L74.7873 15.5841ZM146.008 15.5841H160.335L153.171 3.24932L146.008 15.5841ZM217.88 15.4026H232.084L224.982 3.0797L217.88 15.4026ZM164.21 15.3754L174.931 9.22166L171.357 3.06792L164.21 15.3754ZM92.4047 15.3247L103.071 9.17803L99.5229 3.06792L92.4047 15.3247ZM215.969 14.4006L223.101 2.07176H208.836L215.969 14.4006ZM54.7173 14.3916L61.9217 2.04914H47.5129L54.7173 14.3916ZM144.055 14.3915L151.259 2.04905H136.85L144.055 14.3915ZM36.917 14.3898L43.9936 2.07399H29.7281L36.917 14.3898ZM176.746 8.2023L187.531 2.04914H173.155L176.746 8.2023ZM104.85 8.15332L115.695 2.0491H101.305L104.85 8.15332Z", cc = ({ height: e = 20, markOnly: t = !1, className: n = "" }) => t ? /* @__PURE__ */ J("svg", {
	height: e,
	viewBox: "0 0 136 96",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	className: n,
	role: "img",
	"aria-label": "NAC",
	children: /* @__PURE__ */ J("path", {
		fill: "currentColor",
		d: oc
	})
}) : /* @__PURE__ */ J("svg", {
	height: e,
	viewBox: "0 0 235 64",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	className: n,
	role: "img",
	"aria-label": "NAC",
	children: /* @__PURE__ */ J("path", {
		fill: "currentColor",
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: sc
	})
}), lc = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), uc = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), dc = {
	info: "bg-info-primary text-info-primary border-info-primary",
	error: "bg-error-primary text-error-primary border-error-primary",
	danger: "bg-danger-primary text-danger-primary border-danger-primary",
	success: "bg-success-primary text-success-primary border-success-primary"
}, fc = {
	info: F.Info,
	error: F.Danger,
	danger: F.Danger,
	success: F.CheckCircle
}, pc = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, mc = {
	small: "p-2 gap-2",
	medium: "p-3 gap-2",
	large: "p-4 gap-3"
}, hc = {
	small: "label-micro",
	medium: "label-small",
	large: "label-medium"
}, gc = {
	small: "text-micro",
	medium: "text-small",
	large: "text-medium"
}, _c = {
	small: 16,
	medium: 20,
	large: 24
}, vc = ({ title: e, variant: t = "info", size: n = "small", className: r = "", children: i, ...a }) => /* @__PURE__ */ Y("div", {
	className: z("flex rounded-[4px] border", dc[t], mc[n], r),
	...a,
	children: [/* @__PURE__ */ J(M, {
		iconName: fc[t],
		size: _c[n],
		color: pc[t],
		className: "shrink-0"
	}), /* @__PURE__ */ Y("div", {
		className: "flex-1 min-w-0 flex flex-col gap-1",
		children: [e ? /* @__PURE__ */ J("div", {
			className: hc[n],
			children: e
		}) : null, i ? /* @__PURE__ */ J("div", {
			className: z("opacity-80", gc[n]),
			children: i
		}) : null]
	})]
});
vc.Variant = lc, vc.Size = uc;
//#endregion
//#region src/app/atoms/model-pill/index.tsx
var yc = /* @__PURE__ */ function(e) {
	return e[e.Small = 24] = "Small", e[e.Medium = 32] = "Medium", e;
}({}), bc = {
	32: 16,
	24: 18
}, xc = {
	32: je.Large,
	24: je.Small
}, Sc = ({ size: e = 32, active: t = !1, className: n = "", ...r }) => /* @__PURE__ */ Y("div", {
	className: z("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full", "border", t ? "border-transparent" : "border-secondary", n),
	style: {
		width: e,
		height: e
	},
	...r,
	children: [
		t ? null : /* @__PURE__ */ J("div", {
			"aria-hidden": !0,
			className: "absolute inset-0 rounded-full bg-gradient-to-b from-[var(--color-fill-basic-muted)] to-transparent [html.light_&]:bg-gradient-to-t"
		}),
		/* @__PURE__ */ J(M, {
			iconName: F.Brain,
			size: bc[e],
			color: "var(--color-fill-basic-primary)",
			className: "relative"
		}),
		t ? /* @__PURE__ */ J(ic, {
			size: xc[e],
			className: "absolute inset-0 m-auto"
		}) : null
	]
});
Sc.Size = yc;
//#endregion
//#region src/app/atoms/number-input/index.tsx
var Cc = {
	[X.Small]: B.Small,
	[X.Medium]: B.Medium,
	[X.Large]: B.Large
}, wc = (e, t, n) => Math.min(Math.max(e, t), n), Tc = ({ value: e, onChange: t, min: n = 0, max: r = 2 ** 53 - 1, step: i = 1, size: a = X.Medium, disabled: s = !1, className: c = "", "aria-label": l }) => {
	let [u, d] = K(String(e)), [f, p] = K(e);
	f !== e && (p(e), d(String(e)));
	let m = () => {
		let i = Number(u);
		if (u.trim() === "" || Number.isNaN(i)) {
			d(String(e));
			return;
		}
		let a = wc(i, n, r);
		d(String(a)), a !== e && t(a);
	}, h = (i) => {
		let a = wc(e + i, n, r);
		a !== e && t(a);
	};
	return /* @__PURE__ */ Y("div", {
		className: z("flex items-center gap-2 w-fit", c),
		children: [
			/* @__PURE__ */ J(V, {
				variant: L.Secondary,
				size: Cc[a],
				content: o.Icon,
				disabled: s || e <= n,
				"aria-label": "Decrease",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => h(-i),
				children: /* @__PURE__ */ J(M, { iconName: F.Remove })
			}),
			/* @__PURE__ */ J("input", {
				type: "text",
				inputMode: "numeric",
				role: "spinbutton",
				"aria-label": l,
				"aria-valuenow": e,
				"aria-valuemin": n,
				"aria-valuemax": r,
				className: z("input rounded-[4px] text-center w-16 px-1 font-normal", a, s && "input-disabled"),
				value: u,
				disabled: s,
				onChange: (e) => d(e.target.value),
				onBlur: m,
				onKeyDown: (e) => {
					e.key === "Enter" && (e.preventDefault(), m()), e.key === "ArrowUp" && (e.preventDefault(), h(i)), e.key === "ArrowDown" && (e.preventDefault(), h(-i));
				}
			}),
			/* @__PURE__ */ J(V, {
				variant: L.Secondary,
				size: Cc[a],
				content: o.Icon,
				disabled: s || e >= r,
				"aria-label": "Increase",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => h(i),
				children: /* @__PURE__ */ J(M, { iconName: F.Add })
			})
		]
	});
}, Ec = ({ page: e, pageSize: t, totalItems: n, onPageChange: r, itemLabel: i = "items", className: a = "" }) => {
	let s = Ue(), c = Math.max(1, Math.ceil(n / t)), l = n === 0 ? 0 : (e - 1) * t + 1, u = Math.min(e * t, n);
	return /* @__PURE__ */ Y("div", {
		className: z("flex items-center w-full gap-4 px-4 py-3", s ? "justify-center" : "justify-between", a),
		children: [s ? null : /* @__PURE__ */ Y("div", {
			className: "label-small text-basic-secondary",
			children: [
				l,
				"–",
				u,
				" of ",
				n,
				" ",
				i
			]
		}), /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-3",
			children: [
				/* @__PURE__ */ J(V, {
					variant: L.Tertiary,
					size: B.Small,
					content: o.Icon,
					disabled: e <= 1,
					"aria-label": "Previous page",
					onClick: () => r(e - 1),
					children: /* @__PURE__ */ J(M, { iconName: F.Left })
				}),
				/* @__PURE__ */ Y("div", {
					className: "label-small text-basic-secondary",
					children: [
						"Page ",
						e,
						" of ",
						c
					]
				}),
				/* @__PURE__ */ J(V, {
					variant: L.Tertiary,
					size: B.Small,
					content: o.Icon,
					disabled: e >= c,
					"aria-label": "Next page",
					onClick: () => r(e + 1),
					children: /* @__PURE__ */ J(M, { iconName: F.Right })
				})
			]
		})]
	});
}, Dc = 6, Oc = 36;
function kc(e) {
	let t = String(e ?? ""), n = 2166136261;
	for (let e = 0; e < t.length; e += 1) n ^= t.charCodeAt(e), n = Math.imul(n, 16777619) >>> 0;
	return n >>> 0;
}
function Ac(e) {
	let t = e >>> 0 || 2654435769;
	return () => (t = (t ^ t << 13) >>> 0, t = (t ^ t >>> 17) >>> 0, t = (t ^ t << 5) >>> 0, t);
}
function jc(e) {
	return `hsl(${kc(e) % 360} 75% 50%)`;
}
function Mc(e) {
	let t = e % Dc, n = (e - t) / Dc, r = [];
	return n > 0 && r.push(e - Dc), n < 5 && r.push(e + Dc), t > 0 && r.push(e - 1), t < 5 && r.push(e + 1), r;
}
function Nc(e) {
	let t = Array.from({ length: Oc }, () => !1), n = [];
	for (let e = 0; e < Oc; e += 1) {
		let t = e % Dc, r = (e - t) / Dc;
		(r === 0 || t === 0 || r === 5 || t === 5) && n.push(e);
	}
	let r = 4 + e() % 5, i = 0;
	for (; i < r && n.length > 0;) {
		let r = e() % 2 == 0 ? n.length - 1 : e() % n.length, a = n.splice(r, 1)[0];
		if (!t[a]) {
			t[a] = !0, i += 1;
			for (let e of Mc(a)) !t[e] && !n.includes(e) && n.push(e);
		}
	}
	return t;
}
function Pc(e) {
	let t = Ac(kc(e)), n = Nc(t), r = [];
	for (let e = 0; e < Oc; e += 1) r.push(n[e] ? 0 : t() % 7 < 4 ? 1 : 2);
	return r;
}
var Fc = 40, Ic = 1.5;
function Lc(e) {
	let t = Math.max(1, Ic * e / Fc);
	return t * Dc / (e - t);
}
var Rc = ({ id: e, size: t = 40, isRunning: n = !1, className: r = "", ...i }) => {
	let a = jc(e), o = Pc(e), s = Lc(t), c = s / 2;
	return /* @__PURE__ */ J("svg", {
		className: z("block shrink-0", n && "pulse-dim", r),
		width: t,
		height: t,
		viewBox: `${-c} ${-c} ${Dc + s} ${Dc + s}`,
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		"aria-hidden": "true",
		...i,
		children: o.map((e, t) => e === 0 ? null : /* @__PURE__ */ J("rect", {
			x: t % Dc,
			y: Math.floor(t / Dc),
			width: "1",
			height: "1",
			fill: e === 2 ? a : "none",
			stroke: a,
			strokeWidth: s
		}, t))
	});
}, zc = /* @__PURE__ */ function(e) {
	return e.Project = "project", e.Orphan = "orphan", e;
}({}), Bc = ({ entityId: e, name: t, variant: n = "project", active: r = !1, running: i = !1, trailing: a, isMobile: o = !1, actions: s, className: c = "", type: l = "button", ...u }) => /* @__PURE__ */ Y("div", {
	className: z("group flex items-center min-w-0 rounded-[4px] hover:bg-btn-ghost-hovered", o ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1", r && "bg-btn-ghost-highlighted", c),
	children: [
		/* @__PURE__ */ Y("button", {
			type: l,
			className: z("flex flex-1 items-center min-w-0 text-left", o ? "gap-3" : "gap-1.5"),
			...u,
			children: [n === "orphan" ? /* @__PURE__ */ J(Mi, {
				size: 24,
				isRunning: i
			}) : /* @__PURE__ */ J(Rc, {
				id: e,
				size: 24,
				isRunning: i,
				className: "rounded-[2px]"
			}), /* @__PURE__ */ J("span", {
				className: z("flex-1 truncate", o ? "text-medium" : "label-small", i ? "text-shimmer-basic" : "text-basic-primary"),
				children: t
			})]
		}),
		a ? /* @__PURE__ */ J("span", {
			className: z("shrink-0 label-micro text-basic-muted", s && !o && "group-hover:hidden group-has-[:focus-visible]:hidden"),
			children: a
		}) : null,
		s ? /* @__PURE__ */ J("div", {
			className: z("items-center shrink-0", o ? "flex gap-3" : "hidden gap-1.5 group-hover:flex group-has-[:focus-visible]:flex"),
			children: s
		}) : null
	]
});
Bc.Variant = zc;
//#endregion
//#region src/app/atoms/radio/index.tsx
var Vc = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ Y("label", {
	className: z("flex items-start gap-2 w-fit", n ? "cursor-not-allowed opacity-60" : "", i),
	children: [
		/* @__PURE__ */ J("input", {
			type: "radio",
			checked: e,
			onChange: (e) => t(e.target.checked),
			disabled: n,
			className: "sr-only peer",
			...a
		}),
		/* @__PURE__ */ J("span", {
			"aria-hidden": "true",
			className: z("flex items-center justify-center shrink-0 mt-[1px] w-4 h-4 rounded-full border transition-colors duration-150", "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-primary", n ? "bg-btn-secondary-disabled border-muted" : "bg-btn-secondary border-secondary hover:bg-btn-secondary-hovered hover:border-tertiary"),
			children: e ? /* @__PURE__ */ J("span", {
				className: "fade w-2 h-2 rounded-full",
				style: { background: n ? "var(--color-fill-btn-accent-muted)" : "var(--color-fill-accent-primary)" }
			}) : null
		}),
		r ? /* @__PURE__ */ J("span", {
			className: "label-small text-basic-primary",
			children: r
		}) : null
	]
}), Hc = 8, Uc = (e, t, n) => Math.min(Math.max(e, t), n), Wc = ({ min: e, max: t, value: n, onChange: r, step: i = 1, disabled: a = !1, label: o, className: s = "" }) => {
	let c = G(null), l = H((a) => {
		let o = Uc(Math.round(a / i) * i, e, t), s = Number(o.toFixed(4));
		s !== n && r(s);
	}, [
		i,
		e,
		t,
		n,
		r
	]), u = H((n) => {
		let r = c.current;
		if (!r) return;
		let i = r.getBoundingClientRect();
		if (i.width === 0) return;
		let a = Uc((n - i.left) / i.width, 0, 1);
		l(e + a * (t - e));
	}, [
		l,
		e,
		t
	]), d = (e) => {
		a || (e.currentTarget.setPointerCapture(e.pointerId), u(e.clientX));
	}, f = (e) => {
		a || e.currentTarget.hasPointerCapture(e.pointerId) && u(e.clientX);
	}, p = (r) => {
		if (a) return;
		let o = r.key === "ArrowLeft" || r.key === "ArrowDown" ? -i : r.key === "ArrowRight" || r.key === "ArrowUp" ? i : 0;
		if (o) {
			r.preventDefault(), l(n + o);
			return;
		}
		r.key === "Home" && (r.preventDefault(), l(e)), r.key === "End" && (r.preventDefault(), l(t));
	}, m = t === e ? 0 : (n - e) / (t - e) * 100, h = Hc * (1 - 2 * m / 100);
	return /* @__PURE__ */ Y("div", {
		ref: c,
		role: "slider",
		tabIndex: a ? -1 : 0,
		"aria-label": o ?? "Range",
		"aria-valuemin": e,
		"aria-valuemax": t,
		"aria-valuenow": n,
		"aria-disabled": a,
		className: z("group relative h-1 w-full rounded-full outline-none touch-none select-none", a ? "bg-input-progress-bar-disabled cursor-not-allowed" : "bg-input-progress-bar cursor-auto", s),
		onPointerDown: d,
		onPointerMove: f,
		onKeyDown: p,
		children: [/* @__PURE__ */ J("div", {
			className: z("absolute inset-y-0 left-0 rounded-full", a ? "bg-input-progress-disabled" : "bg-input-progress"),
			style: { width: `${m}%` }
		}), /* @__PURE__ */ J("div", {
			className: z("absolute top-1/2 w-4 h-4 rounded-full shadow-md -translate-y-1/2 -translate-x-1/2", a ? "bg-input-knob-disabled" : "bg-input-knob group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-accent-primary"),
			style: { left: `calc(${m}% + ${h}px)` }
		})]
	});
}, Gc = /* @__PURE__ */ function(e) {
	return e.Large = "btn-large", e.Medium = "btn-medium", e.Small = "btn-small", e;
}({}), Kc = /* @__PURE__ */ function(e) {
	return e.Regular = "btn-ghost", e.Accent = "btn-ghost-accent", e.Destructive = "btn-ghost-destructive", e;
}({}), qc = ({ size: e = "btn-medium", variant: t = "btn-ghost", active: n = !1, disabled: r, className: i = "", children: a, hoverHint: o, trailing: s, ...c }) => {
	let l = [
		"btn btn-icon tab-btn",
		"w-full",
		"justify-start",
		e,
		n && t === "btn-ghost" ? "btn-ghost-highlighted" : n && t === "btn-ghost-accent" ? "btn-ghost-highlighted-accent" : t,
		r ? "btn-disabled" : "",
		i,
		"rounded-[4px]"
	].filter(Boolean).join(" ");
	return /* @__PURE__ */ Y("button", {
		onClick: () => {},
		className: l,
		disabled: r,
		...c,
		children: [
			a,
			s,
			o ? /* @__PURE__ */ J("span", {
				className: "inline-flex shrink-0",
				onClick: (e) => e.stopPropagation(),
				onMouseDown: (e) => e.stopPropagation(),
				onKeyDown: (e) => e.stopPropagation(),
				children: /* @__PURE__ */ J(na, {
					title: o.title,
					description: o.description,
					muted: o.muted,
					position: R.CenterRight
				})
			}) : null
		]
	});
};
qc.Size = Gc, qc.Variant = Kc;
//#endregion
//#region src/app/atoms/select/index.tsx
var Jc = {
	[B.Small]: Gc.Small,
	[B.Medium]: Gc.Medium,
	[B.Large]: Gc.Large
}, Yc = ({ items: e = [], value: t, onValueChange: n, size: r = B.Medium, itemSize: i, variant: a = L.Secondary, placement: s = R.BottomRight, placeholder: c = "Select...", disabled: l = !1, sticky: u = !1, className: d = "", trailingIcon: f = F.Down, triggerClassName: p = "", panelClassName: m = "", onOpenChange: h }) => {
	let [g, _] = K(!1), v = e.find((e) => e.id === t), y = i ?? Jc[r], b = (e) => {
		_(e), h?.(e);
	}, x = (e) => {
		n?.(e), b(!1);
	};
	return /* @__PURE__ */ J(Kn, {
		open: g,
		onClose: () => b(!1),
		placement: s,
		size: u ? jn.Fit : "min-w-full",
		sticky: u,
		className: d,
		panelClassName: m,
		content: /* @__PURE__ */ J("div", {
			className: "flex flex-col gap-1 px-2 md:px-0",
			children: e.map((e) => /* @__PURE__ */ Y(qc, {
				size: y,
				variant: Kc.Regular,
				active: e.id === t,
				hoverHint: e.hoverHint,
				onClick: () => x(e.id),
				children: [e.icon ? /* @__PURE__ */ J(M, { iconName: e.icon }) : null, /* @__PURE__ */ J("span", {
					className: "text-left flex-grow",
					children: e.label
				})]
			}, e.id))
		}),
		children: /* @__PURE__ */ Y(V, {
			variant: a,
			size: r,
			disabled: l,
			content: o.IconRight,
			className: `${p} overflow-hidden max-w-full`,
			onClick: () => !l && b(!g),
			"aria-expanded": g,
			children: [
				v?.icon ? /* @__PURE__ */ J(M, { iconName: v.icon }) : null,
				/* @__PURE__ */ J("span", {
					className: "text-left flex-grow truncate md:max-w-full",
					children: v?.label ?? c
				}),
				/* @__PURE__ */ J(M, {
					iconName: f,
					className: z(f === F.Down && "transition-transform duration-150 ease-out", f === F.Down && (g ? "rotate-180" : "rotate-0"))
				})
			]
		})
	});
}, Xc = "M95 64.7797H79.5544V78.0484H95V96H0V31.2203H61.7894V0H95V64.7797ZM33.2129 93.6586H46.3415V80.3898H33.2129V93.6586ZM48.6585 93.6586H61.7894V80.3898H48.6585V93.6586ZM79.5544 93.6586H92.6829V80.3898H79.5544V93.6586ZM2.31707 78.0484H15.4479V64.7797H2.31707V78.0484ZM17.765 78.0484H30.8936V49.1718H17.765V78.0484ZM33.2106 78.0484H46.3415V64.7797H33.2106V78.0484ZM2.31707 62.4383H15.4479V49.1718H2.31707V62.4383ZM48.6585 62.4383H61.7894V49.1718H48.6585V62.4383ZM64.1064 62.4383H77.235V49.1718H64.1064V62.4383ZM79.5544 62.4383H92.6829V49.1718H79.5544V62.4383ZM17.765 46.8304H30.8936V33.5617H17.765V46.8304ZM33.2129 46.8282H46.3415V33.5617H33.2129V46.8282ZM79.5544 46.8282H92.6829V33.5617H79.5544V46.8282ZM64.1064 31.2203H77.235V17.9516H64.1064V31.2203ZM64.1064 15.6101H77.235V2.34141H64.1064V15.6101ZM79.5544 15.6101H92.6829V2.34141H79.5544V15.6101Z", Zc = "M48.6585 17.9516H0V0H48.6585V17.9516ZM2.31707 15.6101H15.4479V2.34141H2.31707V15.6101ZM17.765 15.6101H30.8936V2.34141H17.765V15.6101Z", Qc = ({ className: e = "" }) => /* @__PURE__ */ Y("svg", {
	width: 95,
	height: 96,
	viewBox: "0 0 95 96",
	xmlns: "http://www.w3.org/2000/svg",
	className: z("fill-basic-muted", e),
	"aria-hidden": !0,
	children: [/* @__PURE__ */ J("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: Xc
	}), /* @__PURE__ */ J("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: Zc
	})]
}), $c = /* @__PURE__ */ function(e) {
	return e.Muted = "muted", e.Tertiary = "tertiary", e.Secondary = "secondary", e.Primary = "primary", e;
}({}), el = /* @__PURE__ */ function(e) {
	return e.Horizontal = "horizontal", e.Vertical = "vertical", e;
}({}), Q = ({ variant: e = "muted", label: t, orientation: n = "horizontal", width: r, height: i, className: a = "", ...o }) => {
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
		return i && (e.height = i), r && (e.width = r), /* @__PURE__ */ J("div", {
			className: `h-full w-px ${l} ${a}`,
			style: e,
			...f
		});
	}
	if (t) {
		let e = { ...d };
		return r && (e.width = r), i && (e.height = i), /* @__PURE__ */ Y("div", {
			className: `flex items-center gap-2 w-full ${a}`,
			style: e,
			...f,
			children: [/* @__PURE__ */ J("span", {
				className: `label-micro ${u} whitespace-nowrap`,
				children: t
			}), /* @__PURE__ */ J("div", { className: `flex-1 h-[1px] min-h-[1px] max-h-[1px] ${l}` })]
		});
	}
	let p = { ...d };
	return r && (p.width = r), i && (p.height = i), /* @__PURE__ */ J("div", {
		className: `h-[1px] min-h-[1px] max-h-[1px] w-full ${l} ${a}`,
		style: p,
		...f
	});
};
Q.Variant = $c, Q.Orientation = el;
//#endregion
//#region src/app/atoms/switch/index.tsx
var tl = /* @__PURE__ */ function(e) {
	return e.Medium = "medium", e.Large = "large", e;
}({}), nl = {
	medium: "w-9 h-5",
	large: "w-11 h-6"
}, rl = {
	medium: "w-4 h-4",
	large: "w-5 h-5"
}, il = {
	medium: "translate-x-4",
	large: "translate-x-5"
}, al = ({ checked: e = !1, disabled: t = !1, onChange: n, size: r = "medium", className: i = "", ...a }) => /* @__PURE__ */ J("button", {
	type: "button",
	role: "switch",
	"aria-checked": e,
	disabled: t,
	onClick: () => !t && n?.(!e),
	className: z("relative shrink-0 rounded-full transition-colors duration-150", nl[r], t ? "bg-input-switcher-disabled cursor-not-allowed" : e ? "bg-input-switcher-active cursor-auto" : "bg-input-switcher cursor-auto", i),
	...a,
	children: /* @__PURE__ */ J("span", { className: z("absolute top-0.5 left-0.5 rounded-full transition-transform duration-150", rl[r], t ? "bg-input-knob-disabled" : "bg-input-knob", e ? il[r] : "translate-x-0") })
}), ol = ({ tags: e, selected: t, onChange: n, disabled: r = !1, className: i = "" }) => {
	let a = (e) => {
		n(t.includes(e) ? t.filter((t) => t !== e) : [...t, e]);
	};
	return /* @__PURE__ */ J("div", {
		className: z("flex flex-wrap gap-2", i),
		children: e.map((e) => {
			let n = t.includes(e);
			return /* @__PURE__ */ J(V, {
				size: B.Small,
				variant: n ? L.SecondaryAccent : L.Secondary,
				disabled: r,
				"aria-pressed": n,
				onClick: () => a(e),
				children: e
			}, e);
		})
	});
};
//#endregion
//#region src/app/components/projects/ChatSessionActions.tsx
function sl({ title: e, pinned: t = !1, onPin: n, onRename: r, onDelete: i }) {
	return /* @__PURE__ */ Y(q, { children: [
		n ? /* @__PURE__ */ J(V, {
			variant: L.Ghost,
			size: B.Small,
			content: o.Icon,
			title: t ? "Unpin chat" : "Pin chat",
			"aria-label": `${t ? "Unpin" : "Pin"} ${e}`,
			onClick: n,
			children: /* @__PURE__ */ J(M, { iconName: t ? F.Unpin : F.Pin })
		}) : null,
		r ? /* @__PURE__ */ J(V, {
			variant: L.Ghost,
			size: B.Small,
			content: o.Icon,
			title: "Rename chat",
			"aria-label": `Rename ${e}`,
			onClick: r,
			children: /* @__PURE__ */ J(M, { iconName: F.Edit })
		}) : null,
		i ? /* @__PURE__ */ J(V, {
			variant: L.GhostDestructive,
			size: B.Small,
			content: o.Icon,
			title: "Delete chat",
			"aria-label": `Delete ${e}`,
			onClick: i,
			children: /* @__PURE__ */ J(M, { iconName: F.Trash })
		}) : null
	] });
}
//#endregion
//#region src/app/components/projects/GroupLabel.tsx
function cl({ children: e, className: t }) {
	return /* @__PURE__ */ Y("div", {
		className: z("flex items-baseline gap-2", t),
		children: [/* @__PURE__ */ J("span", {
			className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
			children: e
		}), /* @__PURE__ */ J(Q, { className: "shrink" })]
	});
}
//#endregion
//#region node_modules/effect/dist/esm/Layer.js
var ll = N;
//#endregion
//#region src/app/hooks/useSessionTitle.ts
function ul() {
	let { data: e = [] } = Ut(), t = xt(e);
	return (e) => kr(e, t);
}
//#endregion
//#region src/app/lib/projects.ts
function dl(e) {
	return e.filter((e) => e.lineage == null);
}
function fl(e, t) {
	let n = t;
	for (let t of dl(e)) yr(t.summary.updated_at) > yr(n) && (n = t.summary.updated_at);
	return n;
}
function pl(e, t) {
	return yr(t.summary.updated_at) - yr(e.summary.updated_at);
}
function ml(e, t) {
	return dl(e).filter((e) => e.summary.project_id === t).sort(pl)[0] ?? null;
}
function hl(e, t) {
	return dl(e).filter((e) => e.summary.project_id === t).sort((e, t) => yr(t.summary.created_at) - yr(e.summary.created_at))[0] ?? null;
}
function gl(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let e of dl(t)) {
		let t = e.summary.project_id;
		if (!t) continue;
		let r = n.get(t);
		r ? r.push(e) : n.set(t, [e]);
	}
	return e.map((e) => {
		let t = (n.get(e.project_id) ?? []).sort(pl);
		return {
			project: e,
			sessions: t,
			running: t.filter((e) => en(e.active_run)).length,
			totalCostMicros: t.reduce((e, t) => e + (t.summary.total_cost_micros ?? 0), 0),
			updatedAt: fl(t, e.updated_at)
		};
	});
}
function _l(e) {
	return e.filter((e) => e.lineage == null && !e.summary.project_id).sort((e, t) => x(e.summary, t.summary));
}
function vl(e) {
	return e.kind === "project" ? e.entry.project.project_id : e.session.summary.session_id;
}
function yl(e, t) {
	return [...gl(e, t).map((e) => ({
		kind: "project",
		entry: e
	})), ..._l(t).map((e) => ({
		kind: "orphan",
		session: e
	}))];
}
function bl(e, t) {
	return t ? e.find((e) => e.project_id === t) ?? null : null;
}
function xl(e, t) {
	return e.cwd === t.cwd && (e.ssh_host ?? null) === (t.ssh_host ?? null) && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function Sl(e) {
	return {
		cwd: e.cwd,
		ssh_host: e.ssh_host ?? null,
		ssh_port: e.ssh_port ?? null,
		ssh_identity_file: e.ssh_identity_file ?? null
	};
}
function Cl(e, t) {
	return t ? e.find((e) => xl(e, t)) ?? null : null;
}
var wl = [
	"Pinned",
	"Today",
	"Yesterday",
	"This week",
	"This month",
	"Older"
];
function Tl(e) {
	let t = new Date(e);
	return t.setHours(0, 0, 0, 0), t;
}
function El(e, t) {
	let n = new Date(e);
	return n.setDate(n.getDate() - t), n.getTime();
}
function Dl(e, t) {
	let n = yr(e);
	if (!Number.isFinite(n)) return "Older";
	let r = Tl(t);
	return n >= r.getTime() ? "Today" : n >= El(r, 1) ? "Yesterday" : n >= El(r, 7) ? "This week" : n >= El(r, 30) ? "This month" : "Older";
}
function Ol(e, t, n) {
	let r = /* @__PURE__ */ new Map();
	for (let i of e) {
		let { updatedAt: e, pinned: a } = t(i), o = a ? "Pinned" : Dl(e, n), s = r.get(o);
		s ? s.push(i) : r.set(o, [i]);
	}
	return wl.flatMap((e) => {
		let t = r.get(e);
		return t && t.length > 0 ? [{
			label: e,
			items: t
		}] : [];
	});
}
//#endregion
//#region src/app/lib/sessionBehavior.ts
var kl = [
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
function Al(e) {
	return kl.find((t) => t.id === e) ?? kl[0];
}
function jl(e) {
	switch (e) {
		case "direct": return F.Plane;
		case "direct-with-orchestrator": return F.PlaneAdd;
		default: return F.Orchestrator;
	}
}
var Ml = {
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
}, Nl = {
	widePanels: ["delegated", "files"],
	mobilePanels: [
		"delegated",
		"files",
		"history"
	],
	defaultPanel: "files",
	readOnly: !1
}, Pl = {
	widePanels: ["files"],
	mobilePanels: ["files", "history"],
	defaultPanel: "files",
	readOnly: !0
}, Fl = {
	...Ml,
	readOnly: !0
};
function Il(e, t) {
	return t === "traditional-child" ? Pl : t === "managed-orchestrator" ? Fl : Al(e).id === "orchestrator" ? Ml : Nl;
}
//#endregion
//#region src/app/components/projects/ChatSessionList.tsx
var Ll = 6e4;
function Rl({ sessions: e, activeSessionId: t = null, onOpen: n, onRename: r, onDelete: i, onPin: a, isMobile: o = !1, emptyLabel: s = "No chats" }) {
	let c = u(), l = Pn(Ll), d = ul(), f = W(() => Ol(e, (e) => ({
		updatedAt: e.summary.updated_at,
		pinned: !!e.summary.pinned
	}), l), [e, l]);
	return e.length === 0 ? /* @__PURE__ */ J("div", {
		className: "label-small text-basic-muted px-2 py-1",
		children: s
	}) : /* @__PURE__ */ J("div", {
		className: "flex flex-col gap-8",
		children: f.map((e) => /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ J(cl, {
				className: "px-2",
				children: e.label
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let s = d(e.summary), l = Al(e.summary.behavior);
					return /* @__PURE__ */ J(wi, {
						title: s,
						icon: jl(e.summary.behavior),
						badge: c.orchestrationEnabled ? l.navigationLabel : void 0,
						badgeLabel: c.orchestrationEnabled ? l.label : void 0,
						active: e.summary.session_id === t,
						running: en(e.active_run),
						forkedFromTitle: e.summary.forked_from?.title,
						isMobile: o,
						onClick: () => n(e),
						actions: a || r || i ? /* @__PURE__ */ J(sl, {
							title: s,
							pinned: e.summary.pinned,
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
//#endregion
//#region src/app/components/projects/ProjectsList.tsx
var zl = 6e4;
function Bl({ items: e, activeId: t = null, onOpenProject: n, onOpenSession: r, isMobile: i = !1, renderActions: a, emptyLabel: o = "No projects" }) {
	let s = Pn(zl), c = ul(), l = W(() => Ol(e, (e) => e.kind === "project" ? {
		updatedAt: e.entry.updatedAt,
		pinned: e.entry.project.pinned
	} : {
		updatedAt: e.session.summary.updated_at,
		pinned: !1
	}, s), [e, s]);
	return e.length === 0 ? /* @__PURE__ */ J("div", {
		className: "label-small text-basic-muted px-2 py-1",
		children: o
	}) : /* @__PURE__ */ J("div", {
		className: "flex flex-col gap-8",
		children: l.map((e) => /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ J(cl, {
				className: i ? "px-3" : "px-2",
				children: e.label
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let o = vl(e), s = a?.(e);
					return e.kind === "project" ? /* @__PURE__ */ J(Bc, {
						entityId: o,
						name: e.entry.project.name,
						active: o === t,
						running: e.entry.running > 0,
						trailing: String(e.entry.sessions.length),
						isMobile: i,
						actions: s,
						onClick: () => n(o)
					}, o) : /* @__PURE__ */ J(Bc, {
						entityId: o,
						name: c(e.session.summary),
						variant: zc.Orphan,
						active: o === t,
						running: en(e.session.active_run),
						isMobile: i,
						actions: s,
						onClick: () => r(o)
					}, o);
				})
			})]
		}, e.label))
	});
}
//#endregion
//#region src/app/lib/json.ts
function Vl(e) {
	return Object(e) === e && !Array.isArray(e);
}
//#endregion
//#region src/app/lib/providerError.ts
function $(e) {
	return e instanceof Error || e == null || gn(e) ? e : Object(e) === e ? { status: e.status } : String(e);
}
var Hl = "/api/wallet", Ul = "/admin/workspace/workspace-settings", Wl = "platform.arcee.ai";
function Gl(e) {
	return e instanceof Error ? e.message : String(e);
}
function Kl(e, t) {
	let n = e.match(/https:\/\/[^\s"'),]+/), r = Wl;
	if (n) try {
		let { hostname: e } = new URL(n[0]);
		e.endsWith(".arcee.ai") && /^api\d*\./.test(e) && (r = e.replace(/^api(\d*)\./, "platform$1."));
	} catch {}
	return `https://${r}${t}`;
}
function ql(e, t) {
	let n = /* @__PURE__ */ new Set();
	for (let t of [
		/HTTP (\d{3})/g,
		/\((\d{3}) [A-Z]/g,
		/"code":\s*(\d{3})/g,
		/status[ _]code["']?[:=]\s*(\d{3})/gi
	]) for (let r of e.matchAll(t)) n.add(Number(r[1]));
	return t !== null && n.add(t), n;
}
function Jl(e) {
	let t = e.indexOf("{");
	if (t === -1) return e;
	let n = e.slice(t), r = Yl(n) ?? Xl(n);
	if (r === null) return e;
	let i = e.slice(0, t).trim().replace(/:$/, "");
	return i ? `${i} — ${r}` : r;
}
function Yl(e) {
	try {
		return Zl(JSON.parse(e));
	} catch {
		return null;
	}
}
function Xl(e) {
	let t = e.match(/"(?:message|detail|error_description)"\s*:\s*"((?:[^"\\]|\\.)*)/);
	if (!t) return null;
	try {
		return JSON.parse(`"${t[1]}"`);
	} catch {
		return t[1];
	}
}
function Zl(e) {
	if (gn(e)) return e;
	if (!Vl(e)) return null;
	for (let t of [
		"message",
		"detail",
		"error",
		"error_description"
	]) {
		let n = Zl(e[t]);
		if (n !== null) return n;
	}
	return null;
}
var Ql = {
	title: "There was a problem with authentication",
	description: "Please sign back in to continue using the API.",
	fix: {
		kind: "login",
		label: "Sign in again"
	}
};
function $l(e, t) {
	let n = Gl(e), r = ru(e) ? e.status : null, i = n.toLowerCase(), a = (...e) => e.some((e) => i.includes(e)), o = ql(n, r), s = n.match(/invalid model configuration:\s*(.+)/is);
	if (s) return {
		title: "Configuration needs repair",
		description: tu(s[1]),
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
			url: Kl(n, Ul)
		}
	};
	if (a("insufficient_credits", "insufficient credits", "insufficient_quota", "top up your wallet") || o.has(402)) return {
		title: "Not enough credits for this request",
		description: "The provider reserved more than the remaining balance allows. The wallet can still show a balance. Top up, or retry.",
		fix: {
			kind: "link",
			label: "Open wallet",
			url: Kl(n, Hl)
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
	return c || a("arcee authorization was revoked", "arcee token refresh failed", "rejected this login", "authentication_error") || o.has(401) ? c || t === "arcee-api" ? {
		title: "There was a problem with authentication",
		description: "The API key was rejected. Add a valid Arcee API key to continue.",
		fix: {
			kind: "settings",
			label: "Open settings"
		}
	} : Ql : a("permission_error") || o.has(403) ? {
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
	} : { title: tu(Jl(n)) };
}
function eu(e, t) {
	let { title: n, description: r } = $l(e, t);
	return r ? `${n}. ${r}` : n;
}
function tu(e) {
	let t = e.trim();
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function nu(e) {
	return e != null && !(e instanceof Error) && !gn(e);
}
function ru(e) {
	return nu(e) ? Number.isFinite(e.status) : !1;
}
//#endregion
//#region src/app/components/modals/AssignToProjectModal.tsx
function iu({ open: e, onClose: t, summary: n }) {
	let r = un(), i = Ue(), a = ul(), { data: s } = et(), c = ge(), l = Le(), [u, d] = K(""), [f, p] = K(null), m = W(() => Cl(s?.projects ?? [], n), [s, n]), h = c.isPending || l.isPending;
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: t,
		title: "Assign to Project",
		size: or.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(V, {
			variant: L.Tertiary,
			content: o.Text,
			onClick: t,
			disabled: h,
			children: "Cancel"
		}), /* @__PURE__ */ J(V, {
			variant: L.Primary,
			content: o.Text,
			onClick: async () => {
				if (!(!n || h)) {
					p(null);
					try {
						let e = m ?? await l.mutateAsync({
							name: u.trim() || null,
							...Sl(n)
						});
						await c.mutateAsync({
							projectId: e.project_id,
							sessionId: n.session_id
						}), r.success(`Assigned to ${e.name}`), t();
					} catch (e) {
						p(eu($(e)));
					}
				}
			},
			loading: h,
			children: m ? "Assign" : "Create and assign"
		})] }),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-4",
			children: [
				/* @__PURE__ */ Y("p", {
					className: "text-small",
					children: [/* @__PURE__ */ J("span", {
						className: "text-basic-primary font-bold",
						children: a(n)
					}), " belongs to no project yet."]
				}),
				m ? /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-3 rounded-[8px] border border-muted p-3",
					children: [/* @__PURE__ */ J(Rc, {
						id: m.project_id,
						size: 32,
						className: "rounded-[4px]"
					}), /* @__PURE__ */ Y("div", {
						className: "flex flex-col min-w-0",
						children: [/* @__PURE__ */ J("span", {
							className: "label-medium text-basic-primary truncate",
							children: m.name
						}), /* @__PURE__ */ J("span", {
							className: "text-micro text-basic-muted truncate",
							children: m.cwd
						})]
					})]
				}) : /* @__PURE__ */ J(q, { children: /* @__PURE__ */ J(Z, {
					label: "Project name",
					inputSize: i ? X.Large : X.Medium,
					placeholder: "Taken from the git remote",
					value: u,
					onChange: (e) => {
						p(null), d(e.target.value);
					}
				}) }),
				f ? /* @__PURE__ */ J("p", {
					className: "text-error-primary text-micro",
					children: f
				}) : null
			]
		})
	});
}
//#endregion
//#region src/app/components/modals/ConfigRow.tsx
var au = "w-full md:w-[280px]";
function ou({ label: e, hint: t, required: n = !1, invalid: r = !1 }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-1 w-full",
		children: [/* @__PURE__ */ Y("div", {
			className: z("label-small", r ? "text-error-primary" : "text-basic-primary"),
			children: [e, n ? "*" : ""]
		}), t ? /* @__PURE__ */ J(na, {
			title: t,
			position: R.TopCenter
		}) : null]
	});
}
function su({ label: e, hint: t, required: n = !1, invalid: r = !1, secondary: i = !1, muted: a = !1, verticalOnMobile: o = !1, labelClassName: s = "", control: c }) {
	return /* @__PURE__ */ Y("div", {
		className: z("flex w-full min-h-9 md:flex-row items-center md:justify-between md:min-h-5", o ? "flex-col items-stretch justify-center gap-1" : "flex-row items-center justify-between"),
		children: [/* @__PURE__ */ Y("div", {
			className: z("flex items-center gap-1 min-w-0 md:flex-1 md:max-w-[220px]", o ? "max-w-none" : "flex-1 max-w-[220px]", s),
			children: [/* @__PURE__ */ Y("div", {
				className: z(o ? "md:truncate" : "truncate", i ? "text-small" : "label-small", r ? "text-error-primary" : a ? "text-basic-muted" : i ? "text-basic-secondary" : "text-basic-primary"),
				children: [e, n ? "*" : ""]
			}), t ? /* @__PURE__ */ J(na, {
				title: t,
				position: R.TopCenter
			}) : null]
		}), /* @__PURE__ */ J("div", {
			className: z("shrink-0", o && "w-full md:w-auto"),
			children: c
		})]
	});
}
//#endregion
//#region src/app/lib/catalog.ts
function cu(e) {
	return e.connection?.base_url ?? e.managed_base_url ?? e.default_base_url ?? "";
}
var lu = "deepseek/deepseek-v4-flash-latest", uu = ["arcee-auth", "arcee-api"];
function du(e) {
	let t = uu.flatMap((t) => {
		let n = mu(e, t);
		if (!n) return [];
		let r = cu(n);
		return r ? [{
			provider: n,
			baseUrl: r
		}] : [];
	}), n = t.find((e) => e.provider.auth_status === "ready") ?? t[0];
	return n ? {
		backend: n.provider.id,
		model: lu,
		baseUrl: n.baseUrl
	} : null;
}
var fu = {
	provider: null,
	model: null,
	contextWindow: null,
	supportedEfforts: [],
	estimated: !1
};
function pu(e) {
	let t = e.lastIndexOf("-");
	if (t <= 0) return null;
	let n = e.slice(t + 1);
	return n.length === 8 && /^\d{8}$/.test(n) ? e.slice(0, t) : null;
}
function mu(e, t) {
	return e?.providers?.find((e) => e.id === t) ?? null;
}
function hu(e, t) {
	let n = e.models.find((e) => e.id === t);
	if (n) return n;
	let r = pu(t);
	return r ? e.models.find((e) => e.id === r) ?? null : null;
}
function gu(e, t, n) {
	let r = (n ?? "").trim(), i = mu(e, (t ?? "").trim());
	if (!i || !r) return fu;
	let a = hu(i, r);
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
function _u(e, t) {
	let n = t.trim();
	if (!n) return null;
	let r = (e?.providers ?? []).filter((e) => e.models.some((e) => e.id === n));
	if (r.length === 0) return null;
	let i = r.find((e) => e.id === "openai-responses"), a = r.find((e) => e.managed_base_url === null);
	return (i ?? a ?? r[0]).id;
}
//#endregion
//#region src/app/components/modals/catalogModelOverlay.ts
var vu = {
	input: 0,
	output: 0,
	cache_read: 0,
	cache_write: 0
};
function yu(e, t) {
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
			cost: vu,
			reasoning: !1,
			supported_efforts: e.default_limits.supported_efforts,
			source: "fallback"
		};
	});
}
//#endregion
//#region src/app/components/modals/CatalogModelPicker.tsx
function bu(e, t, n) {
	let r = t.trim().toLowerCase(), i = [...e?.providers ?? []].sort((e, t) => {
		let n = e.auth_status === "ready" ? 0 : 1, r = t.auth_status === "ready" ? 0 : 1;
		return n === r ? Wt(e.id) - Wt(t.id) : n - r;
	}), a = [];
	for (let e of i) for (let t of yu(e, n.get(e.id))) r && !`${t.id} ${t.display_name ?? ""} ${e.id}`.toLowerCase().includes(r) || a.push({
		provider: e,
		model: t
	});
	return a;
}
function xu(e) {
	return Number.isFinite(e) && e > 0 ? `$${Number(e.toFixed(2))}` : null;
}
function Su(e) {
	let t = xu(e.input), n = xu(e.output);
	return t && n ? `${t}/${n} per 1M` : "pricing unknown";
}
function Cu(e) {
	return [e.context_window > 0 ? `${kn(e.context_window)} ctx` : "", Su(e.cost)].filter(Boolean).join(" · ");
}
var wu = (e) => e.display_name || e.id;
function Tu({ provider: e }) {
	return e.auth_status === "ready" ? /* @__PURE__ */ J(vi, {
		text: "available",
		color: _i.Green,
		className: "shrink-0 whitespace-nowrap"
	}) : /* @__PURE__ */ J(vi, {
		text: e.managed_base_url ? "login required" : "no credential detected",
		color: _i.Yellow,
		className: "shrink-0 whitespace-nowrap"
	});
}
function Eu({ catalog: e, loading: t, failed: r, disabled: i = !1, compact: a = !1, liveByBackend: s, value: c, onSelect: l }) {
	let u = Ue(), [d, f] = K(!1), [p, m] = K(""), [h, g] = K(null), [_, v] = K(null), y = G(null), b = u ? Gc.Large : Gc.Medium, x = W(() => bu(e, p, s), [
		e,
		p,
		s
	]), S = h === null ? null : Math.min(h, Math.max(x.length - 1, 0)), C = _ !== null && _ < x.length ? _ : S, w = (e) => {
		m(e), g(null), v(null);
	};
	U(() => {
		!d || S === null || y.current?.querySelector(`[data-row="${S}"]`)?.scrollIntoView({ block: "nearest" });
	}, [d, S]);
	let T = x.find((e) => e.provider.id === c?.backend && e.model.id === c?.model), E = () => {
		f(!1), g(null), v(null);
	}, D = (e) => {
		l({
			backend: e.provider.id,
			model: e.model.id,
			baseUrl: cu(e.provider)
		}), f(!1), w("");
	}, O = (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (e.preventDefault(), !x.length) return;
			let t = e.key === "ArrowDown" ? 1 : -1;
			g(((C ?? (t === 1 ? -1 : 0)) + t + x.length) % x.length), v(null);
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			let t = x[C ?? 0];
			t && D(t);
		}
	}, k = c ? T ? wu(T.model) : c.model : t ? "Loading models…" : r ? "Model catalog unavailable" : "Select a model";
	return /* @__PURE__ */ J(Kn, {
		open: d,
		onClose: E,
		placement: a ? R.TopRight : R.BottomLeft,
		size: "w-[520px]",
		sticky: !0,
		className: z(a ? "min-w-0" : "shrink-0", u && "w-full"),
		panelClassName: "p-2 overflow-hidden",
		sheetClassName: "h-[70dvh] max-h-[70dvh] min-h-[70dvh] overflow-hidden [&>*]:min-h-0 [&>*]:h-full [&>*]:flex [&>*]:flex-col",
		content: /* @__PURE__ */ Y("div", {
			className: z("flex flex-col min-h-0", u ? "h-full" : "h-[340px]"),
			children: [/* @__PURE__ */ J("div", {
				className: "shrink-0 p-4 pt-0 md:p-0 md:pb-2",
				children: /* @__PURE__ */ J(Z, {
					inputSize: u ? X.Large : X.Medium,
					leading: Us.Icon,
					leadingIconName: F.Search,
					placeholder: "Search models…",
					autoFocus: !0,
					autoComplete: "off",
					spellCheck: !1,
					value: p,
					onChange: (e) => w(e.target.value),
					onKeyDown: O
				})
			}), /* @__PURE__ */ J("div", {
				ref: y,
				className: "flex flex-col flex-1 gap-1 min-h-0 overflow-auto [&>*]:shrink-0",
				children: x.length === 0 ? /* @__PURE__ */ J("p", {
					className: "px-4 md:px-2 py-3 text-micro text-basic-muted",
					children: t ? "Reading the catalog…" : r ? "The model catalog could not be read." : `No model matches "${p.trim()}".`
				}) : x.map((e, t) => {
					let r = t === 0 || x[t - 1].provider.id !== e.provider.id, i = e.provider.id === c?.backend && e.model.id === c?.model;
					return /* @__PURE__ */ Y("div", {
						className: "px-2 md:px-0",
						children: [r ? /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2 px-2 pt-6 pb-2",
							children: [
								/* @__PURE__ */ J("span", {
									className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
									children: n(e.provider.id)
								}),
								/* @__PURE__ */ J(Q, { className: "shrink" }),
								/* @__PURE__ */ J(Tu, { provider: e.provider })
							]
						}) : null, /* @__PURE__ */ Y(qc, {
							size: b,
							variant: Kc.Regular,
							active: i,
							"data-row": t,
							onMouseEnter: () => v(t),
							onMouseLeave: () => v((e) => e === t ? null : e),
							onClick: () => D(e),
							children: [
								/* @__PURE__ */ J("span", {
									className: "flex-1 min-w-0 text-left truncate",
									children: wu(e.model)
								}),
								u ? null : /* @__PURE__ */ J("span", {
									className: "code-small text-basic-muted truncate md:max-w-[180px]",
									children: e.model.id
								}),
								/* @__PURE__ */ J("span", {
									className: "text-micro text-basic-muted shrink-0",
									children: Cu(e.model)
								})
							]
						})]
					}, `${e.provider.id}/${e.model.id}`);
				})
			})]
		}),
		children: /* @__PURE__ */ Y(V, {
			variant: a ? L.Ghost : L.Secondary,
			size: a ? B.Small : u ? B.Large : B.Medium,
			content: a ? o.IconLeft : o.IconRight,
			disabled: !e || i,
			onClick: () => d ? E() : f(!0),
			"aria-expanded": d,
			"aria-label": a ? "Model" : void 0,
			className: a ? "min-w-0 max-w-full !gap-1.5 !pr-3" : "w-full md:w-[280px]",
			children: [
				a ? /* @__PURE__ */ J(M, { iconName: F.Brain }) : null,
				/* @__PURE__ */ J("span", {
					className: z("min-w-0 text-left truncate", a ? "label-micro max-w-[96px]" : "flex-1"),
					children: k
				}),
				c && n(c.backend) !== k ? /* @__PURE__ */ J("span", {
					className: z("truncate", a ? "label-micro max-w-[72px] text-basic-tertiary" : "text-micro text-basic-muted max-w-[110px]"),
					children: n(c.backend)
				}) : null,
				a ? null : /* @__PURE__ */ J(M, {
					iconName: F.Down,
					className: z("transition-transform duration-150 ease-out", d ? "rotate-180" : "rotate-0")
				})
			]
		})
	});
}
//#endregion
//#region src/app/components/modals/KeyStatus.tsx
function Du({ status: e }) {
	return e === "validating" ? /* @__PURE__ */ J(Ce, { size: je.Micro }) : e === "ready" ? /* @__PURE__ */ J(M, {
		iconName: F.CheckCircle,
		size: 16,
		className: "text-success-primary"
	}) : /* @__PURE__ */ J(M, {
		iconName: e === "error" ? F.Danger : F.Key,
		size: 16,
		className: z(e === "error" ? "text-error-primary" : "text-basic-muted")
	});
}
//#endregion
//#region src/app/features/setup/lifetime.ts
function Ou() {
	let e = zr(lt()), t = new AbortController(), n = !0;
	return zr(Yn(e, j(() => {
		n = !1, t.abort();
	}))), {
		signal: t.signal,
		current: () => n,
		close: () => zr(ue(e, Kt))
	};
}
function ku(e = !0) {
	let t = G(null);
	return U(() => {
		let n = Ou();
		return t.current = n, e || n.close(), n.close;
	}, [e]), t;
}
//#endregion
//#region src/app/features/managed/controller/deviceLoginOperation.ts
var Au = (e) => ["provider-device-login-attempt", e];
async function ju(e, t) {
	let { api: n } = mt(e), r = Au(t), i = e.getQueryData(r);
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
		let i = await y(w({ command: () => n.startManagedLogin(t) }));
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
		], l = new Qr(e, {
			queryKey: c,
			queryFn: async ({ signal: r }) => {
				let a = await n.pollManagedLogin(t, i.login_id, r);
				return a.state === "complete" && o() && await ur(e), a;
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
				message: Qn($(e.error))
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
			message: Qn($(e))
		}), {
			attempt: a,
			fresh: !1
		};
	}
}
async function Mu(e, t) {
	let { api: n } = mt(e), r = Au(t), i = e.getQueryData(r);
	if (!i || !["starting", "waiting"].includes(i.state.status)) return;
	let a = i.attempt;
	a.cancelled = !0, a.dispose?.(), e.setQueryData(r, {
		attempt: a,
		state: { status: "idle" },
		completed: !1
	}), a.prompt && await n.cancelManagedLogin(t, a.prompt.login_id).catch(() => {});
}
//#endregion
//#region src/app/features/managed/controller/useDeviceLogin.ts
function Nu(e, t) {
	let n = ti(), r = ku(), [i, a] = K(t ?? null), [o, s] = K(null), c = t ?? i, l = G(c);
	Yr(() => {
		l.current = c;
	}, [c]);
	let u = Au(c), d = ei({
		queryKey: u,
		queryFn: () => n.getQueryData(u) ?? null,
		enabled: !1,
		gcTime: Infinity
	}).data, f = G(e), p = G(null);
	U(() => {
		f.current = e;
	}, [e]);
	let m = H(async (e) => {
		let t = r.current;
		if (!t?.current()) return;
		l.current = e, a(e);
		let i = await ju(n, e);
		!t.current() || l.current !== e || n.getQueryData(Au(e))?.attempt !== i.attempt || (s({
			attempt: i.attempt,
			current: t.current
		}), i.fresh && i.attempt.prompt && !i.attempt.cancelled && window.open(i.attempt.prompt.verification_uri, "_blank", "noopener,noreferrer"));
	}, [n, r]), h = H(async () => {
		c && await Mu(n, c);
	}, [n, c]);
	return U(() => {
		!d?.completed || d.attempt !== o?.attempt || !o.current() || p.current === d.attempt || (p.current = d.attempt, f.current?.());
	}, [d, o]), {
		state: d?.state ?? { status: "idle" },
		start: m,
		cancel: h
	};
}
//#endregion
//#region src/app/features/managed/controller/useManagedSignIn.ts
function Pu(e) {
	let t = Fe(e), { data: n } = On(!!t);
	return {
		provider: t,
		signedIn: !!(t && n?.providers.find((e) => e.provider === t)?.signed_in)
	};
}
//#endregion
//#region src/app/features/managed/presentation/ManagedAuthCallout.tsx
var Fu = {
	arcee: F.Arcee,
	codex: F.ChatGpt
};
function Iu({ backend: e, className: t = "" }) {
	let { provider: n, signedIn: r } = Pu(e), { state: i, start: a, cancel: s } = Nu(void 0, n), c = yt(), l = bt(e, !!n && r);
	if (!n) return null;
	let u = vt(n), d = i.status === "failed", f = r && l.isError, p = d || f, m = i.status === "waiting", h = r && !p, g = m ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2",
		children: [
			/* @__PURE__ */ J(Ce, { size: je.Micro }),
			i.prompt.user_code ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
				className: "text-micro text-basic-muted",
				children: "Code"
			}), /* @__PURE__ */ J("span", {
				className: "label-small text-basic-primary tabular-nums",
				children: i.prompt.user_code
			})] }) : /* @__PURE__ */ J("span", {
				className: "text-micro text-basic-muted",
				children: "Waiting for the browser"
			}),
			/* @__PURE__ */ J(V, {
				variant: L.Ghost,
				size: B.Medium,
				content: o.Text,
				onClick: () => void s(),
				children: "Cancel"
			})
		]
	}) : h ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
			children: [/* @__PURE__ */ J(M, {
				iconName: F.CheckCircle,
				className: "text-success-primary"
			}), /* @__PURE__ */ J("span", {
				className: "label-small text-success-primary",
				children: "Signed in"
			})]
		}), /* @__PURE__ */ J(V, {
			variant: L.Ghost,
			size: B.Medium,
			content: o.Text,
			loading: c.isPending,
			onClick: () => void c.mutateAsync(n).catch(() => {}),
			children: "Sign out"
		})]
	}) : /* @__PURE__ */ Y(V, {
		variant: L.Primary,
		size: B.Medium,
		content: o.IconRight,
		loading: i.status === "starting",
		onClick: () => void a(n),
		children: [/* @__PURE__ */ Y("span", { children: ["Sign in with ", u] }), /* @__PURE__ */ J(M, { iconName: F.External })]
	}), _ = m ? `Approve the request in the ${u} tab NAC opened.` : h ? "NAC holds this login and every session on this provider uses it." : `This provider authenticates with ${u} in your browser instead of with an API key.`;
	return /* @__PURE__ */ Y("div", {
		className: z("flex flex-col gap-3 rounded-[8px] border bg-elevation-level-2 p-3 md:flex-row md:items-center md:justify-between md:gap-4", p ? "border-error-primary" : "border-muted", t),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-start gap-2 min-w-0",
			children: [/* @__PURE__ */ J(M, {
				iconName: Fu[n],
				className: z("shrink-0", p ? "text-error-primary" : "text-basic-secondary")
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-0.5 min-w-0",
				children: [/* @__PURE__ */ Y("span", {
					className: z("label-small", p ? "text-error-primary" : "text-basic-primary"),
					children: [u, " sign-in"]
				}), /* @__PURE__ */ J("span", {
					className: "text-micro text-basic-muted",
					children: _
				})]
			})]
		}), /* @__PURE__ */ Y("div", {
			className: "flex flex-col items-stretch md:items-end gap-1 shrink-0",
			children: [g, p ? /* @__PURE__ */ J("p", {
				className: "label-micro !text-[10px] !leading-[12px] text-error-primary max-w-[280px] md:text-right pt-1 opacity-70",
				children: eu(d ? i.message : l.error, e)
			}) : null]
		})]
	});
}
//#endregion
//#region src/app/lib/modelConfig.ts
function Lu(e, t, n, r = null) {
	return {
		...e,
		api_key_env: e.backend === t && (!e.api_key_env || e.api_key_env === r) ? n : e.api_key_env
	};
}
function Ru(e, t) {
	return {
		...e,
		api_key_env: t !== null && e.api_key_env === t ? null : e.api_key_env
	};
}
function zu(e, t) {
	return e === t ? !0 : !e || !t ? !1 : e.model === t.model && (e.backend ?? null) === (t.backend ?? null) && (e.base_url ?? null) === (t.base_url ?? null) && (e.api_key_env ?? null) === (t.api_key_env ?? null) && (e.reasoning_effort ?? null) === (t.reasoning_effort ?? null);
}
var Bu = {
	"arcee-auth": "https://api.arcee.ai/api/v1",
	"chatgpt-codex-responses": "https://chatgpt.com/backend-api"
}, Vu = "__clear__";
function Hu(e) {
	return Bu[(e ?? "").trim()] ?? null;
}
function Uu(e) {
	return e === "arcee-auth" || e === "chatgpt-codex-responses";
}
function Wu(e) {
	return (e ?? "").trim() || null;
}
function Gu(e) {
	return (e ?? "").split(",").map((e) => e.trim()).filter(Boolean);
}
function Ku(e, t) {
	if (e !== "inherit") {
		if (e === "none") return null;
		if (e !== "variable") throw Error("Choose how credentials are selected");
		if (!t) throw Error("API key environment variable is required when Environment variable is selected");
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) throw Error("API key environment variable must match [A-Za-z_][A-Za-z0-9_]* exactly (no whitespace)");
		return t;
	}
}
function qu(e, t) {
	if (!e) return;
	let n = Uu(e);
	if (n && t !== "none") throw Error(`${e} uses ${e === "arcee-auth" ? "stored Arcee login" : "stored Codex OAuth"} and does not accept an API key environment variable`);
	if (!n && t !== "variable") throw Error(`${e} requires an API key environment variable; explicitly select Environment variable`);
}
function Ju(e, t) {
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
	for (let [e, t] of Object.entries(i)) if (!gn(t)) throw Error(`Extra Headers value for "${e}" must be a string`);
	return i;
}
function Yu(e, t) {
	let n = e.trim();
	if (!n) throw Error(`${t} is required and cannot be cleared`);
	return n;
}
function Xu(e, t) {
	let n = Object.keys(e).sort(), r = Object.keys(t).sort();
	return n.length === r.length && n.every((n, i) => n === r[i] && e[n] === t[n]);
}
function Zu(e, t, n = !1) {
	let r = Yu(e.backend, "Backend"), i = Hu(r), a, o;
	if (i) a = Wu(e.base_url) ?? i, o = null;
	else {
		a = Yu(e.base_url, "Base URL");
		let t = Ku(e.credential_mode, e.api_key_env);
		if (t === void 0) throw Error("Select an API key environment variable or explicitly choose none");
		o = t, n && e.credential_mode === "none" || qu(r, e.credential_mode);
	}
	let s = {
		model: Yu(e.model, "Model"),
		base_url: a,
		allow_insecure_http: e.allow_insecure_http,
		backend: r,
		reasoning_effort: e.reasoning_effort === "__clear__" ? null : e.reasoning_effort || null,
		api_key_env: o
	}, c = {};
	s.model !== t.model && (c.model = s.model), s.base_url !== t.base_url && (c.base_url = s.base_url), s.allow_insecure_http !== t.allow_insecure_http && (c.allow_insecure_http = s.allow_insecure_http), s.backend !== t.backend && (c.backend = s.backend), s.reasoning_effort !== t.reasoning_effort && (c.reasoning_effort = s.reasoning_effort), s.api_key_env !== t.api_key_env && (c.api_key_env = s.api_key_env);
	let l = Ju(e.extra_headers, {});
	(t.extra_headers_invalid || !Xu(l, t.extra_headers)) && (c.extra_headers = l);
	let u = e.orchestrator_compaction_threshold.trim();
	if (u !== "" && !/^\d+$/.test(u)) throw Error("Context Limit must be a non-negative integer");
	let d = u === "" ? null : Number(u);
	return d !== t.orchestrator_compaction_threshold && (c.orchestrator_compaction_threshold = d), c;
}
[...ut.map((e) => ({
	id: e,
	label: n(e)
}))];
var Qu = ut.map((e) => ({
	id: e,
	label: n(e)
})), $u = [
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
], ed = [
	{
		id: "",
		label: "Inherit config"
	},
	{
		id: Vu,
		label: "Clear configured effort"
	},
	...$u
], td = /* @__PURE__ */ new Set(["", Vu]);
function nd(e, t, n = ed) {
	if (e.length === 0) return n;
	let r = new Set(e);
	return n.filter((e) => td.has(String(e.id)) || r.has(String(e.id)) || e.id === t);
}
//#endregion
//#region src/app/hooks/useExitTransition.ts
var rd = 300;
function id(e, t = rd) {
	let [n, r] = K(e);
	return e && !n && r(!0), U(() => {
		if (e) return;
		let n = setTimeout(() => r(!1), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
//#endregion
//#region src/app/components/modals/PathPickerModal.tsx
function ad({ open: e, ssh: t, ...n }) {
	return id(e) ? /* @__PURE__ */ J(od, {
		open: e,
		ssh: t ?? null,
		...n
	}) : null;
}
function od({ open: e, kind: t, initialPath: n, ssh: r, title: i, showHidden: a = !1, clearLabel: s, onClear: c, onClose: l, onSelect: u }) {
	let d = t !== "directory", f = Ue(), [p, m] = K(n.trim()), [h, g] = K(n.trim()), [_, v] = K(null), [y, b] = K(a), x = Fn(p || null, t, y, !r), S = Fr(r ?? null, p || null, y, !!r), { data: C, error: w, isFetching: T } = r ? S : x, E = (e) => {
		m(e), g(e), v(null);
	}, D = d ? _ : C?.path ?? p;
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: l,
		title: i ?? (t === "toml" ? "Select Config File" : t === "file" ? "Select File" : r ? `Select Working Folder on ${r.ssh_host}` : "Select Working Folder"),
		size: or.Wide,
		flush: !0,
		className: "h-[560px]",
		footer: /* @__PURE__ */ Y(q, { children: [
			c ? f ? /* @__PURE__ */ J(bi, {
				variant: L.Secondary,
				content: o.Text,
				onClick: c,
				children: s ?? "Clear"
			}) : /* @__PURE__ */ J(V, {
				variant: L.Ghost,
				size: B.Large,
				content: o.Text,
				className: "mr-auto",
				onClick: c,
				children: s ?? "Clear"
			}) : null,
			f ? /* @__PURE__ */ J(bi, {
				variant: L.Secondary,
				content: o.Text,
				onClick: l,
				children: "Cancel"
			}) : /* @__PURE__ */ J(V, {
				variant: L.Secondary,
				size: B.Large,
				content: o.Text,
				onClick: l,
				children: "Cancel"
			}),
			f ? /* @__PURE__ */ J(bi, {
				variant: L.Primary,
				content: o.Text,
				disabled: !D,
				onClick: () => {
					D && u(D);
				},
				children: "Select"
			}) : /* @__PURE__ */ J(V, {
				variant: L.Primary,
				size: B.Large,
				content: o.Text,
				disabled: !D,
				onClick: () => {
					D && u(D);
				},
				children: "Select"
			})
		] }),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-3 h-full min-h-0",
			children: [
				/* @__PURE__ */ Y("div", {
					className: "flex items-center gap-2 shrink-0",
					children: [
						/* @__PURE__ */ J(V, {
							variant: L.Secondary,
							size: B.Medium,
							content: o.Icon,
							disabled: !C?.parent,
							onClick: () => C?.parent && E(C.parent),
							"aria-label": "Parent directory",
							children: /* @__PURE__ */ J(M, { iconName: F.Top })
						}),
						/* @__PURE__ */ J(V, {
							variant: L.Secondary,
							size: B.Medium,
							content: o.Icon,
							disabled: !C?.home,
							onClick: () => C?.home && E(C.home),
							"aria-label": "Home directory",
							children: /* @__PURE__ */ J(M, { iconName: F.Home })
						}),
						/* @__PURE__ */ J(Z, {
							inputSize: X.Medium,
							className: "flex-1 min-w-0",
							placeholder: r ? "~/path/on/the/host" : "/path/to/directory",
							value: h,
							onChange: (e) => g(e.target.value),
							onKeyDown: (e) => {
								e.key === "Enter" && E(h.trim());
							}
						}),
						/* @__PURE__ */ J(V, {
							variant: y ? L.SecondaryHighlighted : L.Secondary,
							size: B.Medium,
							content: o.Icon,
							onClick: () => b((e) => !e),
							"aria-pressed": y,
							title: y ? "Hide dot-prefixed entries" : "Show hidden entries",
							"aria-label": y ? "Hide dot-prefixed entries" : "Show hidden entries",
							children: /* @__PURE__ */ J(M, { iconName: y ? F.Eye : F.EyeStrikethrough })
						})
					]
				}),
				w ? /* @__PURE__ */ J("p", {
					className: "label-micro text-error-primary shrink-0",
					children: Qn(w)
				}) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex-1 min-h-0 overflow-auto rounded-[4px] bg-input shadow-concave p-1 flex flex-col [&>*]:shrink-0",
					children: [
						T && !C ? /* @__PURE__ */ J("div", {
							className: "flex items-center justify-center py-6",
							children: /* @__PURE__ */ J(Ce, { size: je.Small })
						}) : null,
						C?.entries.length === 0 ? /* @__PURE__ */ Y("p", {
							className: "text-micro text-basic-muted px-2 py-3",
							children: [t === "toml" ? "No directories or .toml files here." : t === "file" ? "Nothing here." : "No subdirectories here.", y ? "" : " Hidden entries are not listed."]
						}) : null,
						C?.entries.map((e) => /* @__PURE__ */ Y("button", {
							type: "button",
							className: z("flex items-center gap-3 md:gap-2 w-full px-2 md:px-2 py-3 md:py-1.5 rounded-[4px] text-left", "hover:bg-elevation-sublevel-variant-A", _ === e.path && "bg-elevation-sublevel-variant-A"),
							onClick: () => e.is_directory ? E(e.path) : v(e.path),
							onDoubleClick: () => {
								e.is_directory || u(e.path);
							},
							children: [/* @__PURE__ */ J(M, {
								iconName: e.is_directory ? F.Folder : F.File,
								size: f ? 20 : 16,
								className: "shrink-0 text-basic-muted"
							}), /* @__PURE__ */ J("span", {
								className: z("text-basic-primary truncate", f ? "text-small" : "text-small "),
								children: e.name
							})]
						}, e.path)),
						C?.truncated ? /* @__PURE__ */ J("p", {
							className: "text-micro text-basic-muted px-2 py-2",
							children: "Only the first entries are listed; type a path to go deeper."
						}) : null
					]
				}),
				/* @__PURE__ */ J("p", {
					className: "text-micro text-basic-muted shrink-0 truncate",
					children: D ? `Selected: ${D}` : "Nothing selected yet."
				})
			]
		})
	});
}
//#endregion
//#region src/app/components/modals/SmallSelect.tsx
function sd({ items: e, value: t, onValueChange: n, placeholder: r, disabled: i = !1, size: a = B.Medium, trailingIcon: o, triggerClassName: s, placement: c = R.CenterLeft, onOpenChange: l }) {
	let u = Ue();
	return /* @__PURE__ */ J(Yc, {
		items: e,
		value: t,
		onValueChange: n,
		placeholder: r,
		disabled: i,
		size: a,
		trailingIcon: o,
		triggerClassName: s,
		itemSize: u ? Gc.Large : Gc.Medium,
		variant: L.Ghost,
		placement: c,
		onOpenChange: l,
		sticky: !0,
		panelClassName: "max-h-[200px] overflow-auto min-w-[220px] max-w-[calc(100vw-16px)]"
	});
}
//#endregion
//#region src/app/lib/apiKey.ts
var cd = "*".repeat(32);
function ld(e) {
	return e.map((e) => ({
		id: e.id,
		label: e.display_name ?? e.id
	}));
}
//#endregion
//#region src/app/components/modals/ResolvedRows.tsx
function ud({ resolving: e, resolved: t, backend: n, onBackend: r, baseUrl: i, onBaseUrl: a, model: o, onModel: s, failed: c }) {
	if (e) return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 py-1",
		children: [/* @__PURE__ */ J(Ce, { size: je.Micro }), /* @__PURE__ */ J("span", {
			className: "text-micro text-basic-muted",
			children: "Checking the key and reading the model list…"
		})]
	});
	if (!t || !n) return c ? null : /* @__PURE__ */ J("p", {
		className: "text-micro text-basic-muted py-1",
		children: "Pick a configuration to see its provider and models."
	});
	let l = lr(n), u = t.models.length > 0, d = !!t.models_error, f = u ? ld(t.models) : o ? [{
		id: o,
		label: o
	}] : [];
	return /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ J(su, {
			label: "Model Provider",
			required: !0,
			hint: "Service that provides the models for this session.",
			control: /* @__PURE__ */ J(sd, {
				items: Qu,
				value: n,
				onValueChange: (e) => r(e)
			})
		}),
		l ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(su, {
			label: "API Key",
			required: !0,
			hint: "Held by NAC for this configuration; save a new setup to use a different key.",
			control: /* @__PURE__ */ J(Z, {
				inputSize: X.Medium,
				className: au,
				value: cd,
				isDisabled: !0,
				readOnly: !0,
				leadingSlot: /* @__PURE__ */ J(Du, { status: "ready" })
			})
		})] }) : null,
		/* @__PURE__ */ J(Q, {}),
		u || d ? /* @__PURE__ */ J(su, {
			label: "Default Model",
			invalid: d,
			hint: "The NAC session will start with this default and may switch to another.",
			control: /* @__PURE__ */ J(sd, {
				items: d ? [] : f,
				value: d ? "" : o,
				onValueChange: s,
				disabled: d,
				placeholder: "–"
			})
		}) : /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(su, {
				label: "Model",
				required: !0,
				hint: "Model identifier the endpoint expects.",
				control: /* @__PURE__ */ J(Z, {
					inputSize: X.Medium,
					className: au,
					placeholder: "gpt-5.5",
					value: o,
					onChange: (e) => s(e.target.value)
				})
			}),
			/* @__PURE__ */ J(Q, {}),
			/* @__PURE__ */ J(su, {
				label: "Base URL",
				required: !0,
				hint: "Endpoint the session sends its requests to.",
				control: /* @__PURE__ */ J(Z, {
					inputSize: X.Medium,
					className: au,
					placeholder: "https://api.openai.com/v1",
					value: i,
					onChange: (e) => a(e.target.value)
				})
			})
		] })
	] });
}
//#endregion
//#region src/app/components/modals/SourceMenu.tsx
function dd({ label: e, configurations: t, activeId: n, source: r, onSelect: i, onDelete: a }) {
	let s = Ue(), [c, l] = K(!1), u = s ? Gc.Large : Gc.Medium, d = s ? B.Large : B.Medium, f = (e) => {
		i(e), l(!1);
	}, p = /* @__PURE__ */ Y("div", {
		className: z("flex flex-col min-h-0", s ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col shrink-0 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ Y(qc, {
					size: u,
					variant: Kc.Regular,
					active: r === "catalog",
					onClick: () => f({ kind: "catalog" }),
					children: [/* @__PURE__ */ J(M, { iconName: F.Search }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Browse Models"
					})]
				}),
				/* @__PURE__ */ Y(qc, {
					size: u,
					variant: Kc.Regular,
					active: r === "new",
					onClick: () => f({ kind: "new" }),
					children: [/* @__PURE__ */ J(M, { iconName: F.Add }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Create New"
					})]
				}),
				/* @__PURE__ */ Y(qc, {
					size: u,
					variant: Kc.Regular,
					active: r === "file",
					onClick: () => f({ kind: "file" }),
					children: [/* @__PURE__ */ J(M, { iconName: F.File }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "From a .toml file"
					})]
				})
			]
		}), t.length > 0 ? /* @__PURE__ */ Y("div", {
			className: "flex flex-col flex-1 min-h-0 min-w-0",
			children: [/* @__PURE__ */ J("div", { className: "h-px w-full bg-divider-muted my-1 shrink-0" }), /* @__PURE__ */ J("div", {
				className: "flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
				children: t.map((e) => /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-1",
					children: [/* @__PURE__ */ Y(qc, {
						size: u,
						variant: Kc.Regular,
						active: n === e.id,
						className: "flex-1 min-w-0",
						onClick: () => f({
							kind: "saved",
							configId: e.id
						}),
						children: [/* @__PURE__ */ J(M, { iconName: F.Gear }), /* @__PURE__ */ J("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						})]
					}), /* @__PURE__ */ J(V, {
						variant: L.TertiaryDestructive,
						size: d,
						content: o.Icon,
						"aria-label": `Remove ${e.name}`,
						onClick: () => a(e.id, e.name),
						children: /* @__PURE__ */ J(M, { iconName: F.Trash })
					})]
				}, e.id))
			})]
		}) : null]
	});
	return /* @__PURE__ */ J(Kn, {
		open: c,
		onClose: () => l(!1),
		placement: R.BottomLeft,
		size: "w-auto",
		className: "shrink-0",
		panelClassName: "max-h-72 overflow-hidden",
		sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
		content: p,
		children: /* @__PURE__ */ Y(V, {
			variant: L.Secondary,
			size: B.Medium,
			content: o.IconRight,
			onClick: () => l((e) => !e),
			"aria-expanded": c,
			children: [/* @__PURE__ */ J("span", {
				className: "text-left flex-grow truncate max-w-[96px] md:max-w-[220px]",
				children: e
			}), /* @__PURE__ */ J(M, {
				iconName: F.Down,
				className: z("transition-transform duration-150 ease-out", c ? "rotate-180" : "rotate-0")
			})]
		})
	});
}
//#endregion
//#region src/app/hooks/useDebouncedValue.ts
function fd(e, t) {
	let [n, r] = K(e);
	return U(() => {
		let n = setTimeout(() => r(e), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
//#endregion
//#region src/app/features/managed/controller/useManagedModelProfile.ts
function pd() {
	let e = $t(), t = e.data ?? null, n = W(() => xe(t), [t]), r = H((e) => E(t, e), [t]);
	return {
		defaultPick: n,
		configured: n !== null,
		matches: r,
		credentialReady: !!t?.model_ready,
		initializing: e.isPending
	};
}
//#endregion
//#region src/app/features/managed/presentation/ManagedModelCredentialStatus.tsx
function md({ ready: e }) {
	return /* @__PURE__ */ J(su, {
		label: "Credential",
		verticalOnMobile: !0,
		hint: "This managed host supplies the credential securely; it is not stored in this configuration or exposed to commands.",
		control: /* @__PURE__ */ Y("div", {
			className: z("flex items-center gap-1.5 rounded-[4px] py-2 pl-2 pr-4", e ? "bg-success-secondary" : "bg-error-tertiary"),
			children: [/* @__PURE__ */ J(M, {
				iconName: e ? F.CheckCircle : F.Repair,
				className: e ? "text-success-primary" : "text-error-primary"
			}), /* @__PURE__ */ J("span", {
				className: z("label-small", e ? "text-success-primary" : "text-error-primary"),
				children: e ? "Detected" : "Host needs attention"
			})]
		})
	});
}
//#endregion
//#region src/app/components/modals/ConfigurationsPanel.tsx
var hd = "custom", gd = [...ut.map((e) => ({
	id: e,
	label: n(e)
})), {
	id: hd,
	label: "Custom"
}], _d = 400;
function vd(e, t) {
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => e[n] === t[n]);
}
function yd({ invalid: e, errorText: t, onChange: n, initial: r, children: i }) {
	let a = un(), s = pd(), { data: c, isPending: l } = An(), u = Gn(), d = Or(u.data), f = ar(), p = W(() => c?.configurations ?? [], [c]), [m, h] = K(null), [g, _] = K(null), v = r?.backend ?? "arcee-api", [y, b] = K(ut.includes(v) ? v : hd), [x, S] = K(v), [C, w] = K(null), [T, E] = K(""), [D, O] = K(r?.model ?? ""), [k, ee] = K(r?.base_url ?? ""), [te, A] = K(r?.allow_insecure_http ?? !1), [ne, re] = K(r?.model ?? ""), [j, ie] = K(""), [ae, oe] = K(!1), [se, ce] = K(null), [le, ue] = K(null), [de, fe] = K(null), pe = s.defaultPick, N = pe ? d.get(pe.backend) : void 0, me = s.configured && s.credentialReady && u.isPending, he = N === null, ge = m === null && g === null && (l || s.initializing || me || he), P = W(() => pe ? N === void 0 ? pe : N === null ? null : N.some((e) => e.id === pe.model) ? pe : null : null, [pe, N]), _e = r ? p.find((e) => (!r.config_id || e.config_id === r.config_id) && r.orchestrator_compaction_threshold !== void 0 && r.light_model !== void 0 && e.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && zu(e.light_model ?? null, r.light_model) && e.backend === r.backend && e.model === r.model && e.base_url === r.base_url && e.allow_insecure_http === (r.allow_insecure_http ?? !1) && e.api_key_env === r.api_key_env && (e.reasoning_effort ?? null) === r.reasoning_effort && vd(e.extra_headers, r.extra_headers)) : null, ve = p.at(-1), I = m ?? (r ? _e ? {
		kind: "saved",
		configId: _e.config_id
	} : { kind: "new" } : ve ? {
		kind: "saved",
		configId: ve.config_id
	} : { kind: "catalog" }), ye = W(() => I.kind === "catalog" && !ge ? s.configured ? P : du(u.data) : null, [
		I.kind,
		u.data,
		s.configured,
		P,
		ge
	]), be = g ?? ye, xe = I.kind === "catalog" && be ? be.backend : y === hd ? x : y, Se = lr(xe), Ce = y !== hd && Se, we = W(() => {
		let e = I.kind === "catalog" ? be?.backend ?? "catalog" : y === hd ? "custom" : y, t = new Set(p.map((e) => e.name));
		for (let n = 1;; n += 1) {
			let r = `${e}-config-${n}`;
			if (!t.has(r)) return r;
		}
	}, [
		I.kind,
		be,
		y,
		p
	]), Te = C ?? we, Ee = fd(T.trim(), 600), De = fd(j.trim(), _d), R = I.kind === "saved" ? I.configId : null, Oe = I.kind === "file" ? De : "", ke = Ue(), { signedIn: Ae } = Pu(xe), je = u.data?.providers.find((e) => e.id === xe) ?? null, Me = I.kind === "catalog" && s.matches(be), Ne = Me ? s.credentialReady : Se ? je?.auth_status === "ready" : Ae, Pe = I.kind === "catalog" && !!be && Se && !Me && !Ne, Fe = I.kind === "new" && Ce || Pe, Ie = sn(xe, Ee, null, Fe), Le = bt(xe, I.kind === "new" && y !== hd && !Se && Ae), Re = tn(R, Oe), ze = Fe && Ee ? Ie.isFetching ? { status: "validating" } : Ie.error ? {
		status: "error",
		message: eu(Ie.error, xe)
	} : Ie.data ? {
		status: "ready",
		models: Ie.data.models,
		baseUrl: Ie.data.base_url
	} : { status: "validating" } : { status: "idle" }, Be = ze.status === "ready", Ve = Ie.data?.base_url ?? "", He = !!(R ?? Oe), We = He && Re.isFetching, Ge = He && !Re.error ? Re.data ?? null : null, Ke = He && Re.error ? eu(Re.error, xe) : "", qe = se ?? Ge?.backend ?? null, Je = le ?? Ge?.base_url ?? "", Ye = I.kind === "new" ? (Se ? Ie.data?.models : Le.data?.models) ?? [] : Ge?.models ?? [], Xe = I.kind === "new" ? "" : Ge?.model ?? "", Ze = I.kind === "new" ? Ye.some((e) => e.id === ne) ? ne : Ye[0]?.id ?? de ?? ne : ne || de || Xe || Ye[0]?.id || "", Qe = (e) => {
		h(e), E(""), re(""), ce(null), ue(null), fe(null), e?.kind !== "file" && ie(""), e?.kind !== "catalog" && _(null), e?.kind !== "new" && e?.kind !== "catalog" && w(null);
	}, $e = R ? p.find((e) => e.config_id === R) ?? null : null, et = !!(r && m === null && I.kind === "new" && xe === r.backend && k.trim() === r.base_url && te === (r.allow_insecure_http ?? !1) && !T.trim()), tt = W(() => {
		if (ge) return null;
		if (r && et) {
			let e = y === hd ? D.trim() : Ze;
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
		if (I.kind === "catalog") {
			if (!be || !be.baseUrl || Me && !Ne) return null;
			if (Ne) return {
				kind: "resolved",
				backend: be.backend,
				model: be.model,
				base_url: be.baseUrl,
				allow_insecure_http: !1,
				api_key_env: Se ? je?.connection?.api_key_env ?? null : null,
				reasoning_effort: null,
				extra_headers: null,
				light_model: void 0
			};
			if (!Se) return null;
			let e = Te.trim();
			return !e || !Be ? null : {
				kind: "save",
				request: {
					name: e,
					backend: be.backend,
					model: be.model,
					base_url: Ve || be.baseUrl,
					allow_insecure_http: !1,
					api_key: T.trim()
				}
			};
		}
		if (I.kind === "new") {
			let e = Te.trim();
			if (!e) return null;
			let t = T.trim();
			if (Se && !t) return null;
			if (y === hd) {
				let n = k.trim(), r = D.trim();
				return !n || !r ? null : {
					kind: "save",
					request: {
						name: e,
						backend: xe,
						model: r,
						base_url: n,
						allow_insecure_http: te,
						api_key: Se ? t : null
					}
				};
			}
			return Se ? !Be || !Ze || !Ve ? null : {
				kind: "save",
				request: {
					name: e,
					backend: xe,
					model: Ze,
					base_url: Ve,
					allow_insecure_http: !1,
					api_key: t
				}
			} : !Ae || !Ze ? null : {
				kind: "save",
				request: {
					name: e,
					backend: xe,
					model: Ze
				}
			};
		}
		if (!Ge || !qe) return null;
		let e = Ze || Ge.model || "", t = Je.trim();
		return !e || !t ? null : {
			kind: "resolved",
			backend: qe,
			model: e,
			base_url: t,
			allow_insecure_http: Ge.allow_insecure_http,
			api_key_env: Ge.api_key_env,
			reasoning_effort: Ge.reasoning_effort,
			extra_headers: $e?.extra_headers ?? null,
			orchestrator_compaction_threshold: r && m === null ? r.orchestrator_compaction_threshold : $e ? $e.orchestrator_compaction_threshold ?? null : void 0,
			light_model: r && m === null ? r.light_model : $e ? $e.light_model ?? null : void 0,
			config_id: r && m === null ? r.config_id ?? $e?.config_id ?? null : $e?.config_id ?? null
		};
	}, [
		I.kind,
		ge,
		r,
		et,
		be,
		Ne,
		Me,
		je,
		Te,
		T,
		Se,
		y,
		xe,
		k,
		te,
		D,
		Ae,
		Be,
		Ve,
		Ze,
		Ge,
		qe,
		Je,
		$e,
		m
	]);
	U(() => {
		n(tt);
	}, [tt, n]);
	let nt = async (e, t) => {
		try {
			await f.mutateAsync(e), R === e && Qe(null), a.success(`Configuration ${t} removed`);
		} catch (e) {
			a.error(`Failed to remove the configuration: ${eu($(e))}`);
		}
	}, rt = et ? !0 : I.kind === "catalog" ? !!be && (Ne || Be) : I.kind === "new" ? y === hd ? !!(k.trim() && D.trim()) : Se ? Be : Ae : !!Ge, it = ze.status === "error", at = Le.isError ? eu(Le.error, xe) : Ge?.models_error ?? "", ot = e || it || !!Ke || !!at, st = Le.isError || !!(Ge && !lr(Ge.backend) && Ge.models_error), ct = t ?? (it ? ze.message : Ke || (st ? "" : at)), lt = Ke || Ge?.models_error && lr(Ge.backend) ? Re.refetch : null, dt = I.kind === "catalog" ? be && !Se ? xe : null : I.kind === "new" ? y !== hd && !Se ? xe : null : qe && !lr(qe) ? qe : null, ft = I.kind === "catalog" ? "Browse Models" : I.kind === "new" ? "Create New" : I.kind === "file" ? "From a .toml file" : $e?.name ?? "Configuration";
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1",
		children: [
			/* @__PURE__ */ Y("div", {
				className: z("flex flex-col rounded-[8px] bg-elevation-level-2 border border-muted overflow-visible", ot && "border border-error-primary"),
				children: [
					/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-4 px-3 py-2 bg-elevation-level-3 rounded-t-[8px] border-b border-muted",
						children: [/* @__PURE__ */ J("div", {
							className: z("flex-1 min-w-0 truncate", ke ? "label-medium" : "label-small", ot ? "text-error-primary" : "text-basic-primary"),
							children: "Configurations"
						}), /* @__PURE__ */ J(dd, {
							label: ft,
							configurations: p.map((e) => ({
								id: e.config_id,
								name: e.name
							})),
							activeId: R,
							source: I.kind,
							onSelect: Qe,
							onDelete: (e, t) => void nt(e, t)
						})]
					}),
					/* @__PURE__ */ J(Q, {}),
					/* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-4 md:gap-2 p-3",
						children: [
							I.kind === "catalog" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(su, {
								label: "Model",
								required: !0,
								verticalOnMobile: !0,
								hint: "Every model this build knows about; picking one names its provider.",
								control: /* @__PURE__ */ J(Eu, {
									catalog: u.data,
									loading: u.isLoading,
									failed: u.isError,
									disabled: ge,
									liveByBackend: d,
									value: be,
									onSelect: (e) => {
										h({ kind: "catalog" }), _(e), E(""), w(null);
									}
								})
							}), be ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(su, {
									label: "Base URL",
									hint: "Endpoint the catalog names for this provider.",
									verticalOnMobile: !0,
									control: /* @__PURE__ */ J(Z, {
										inputSize: ke ? X.Large : X.Medium,
										className: au,
										value: be.baseUrl,
										isDisabled: !0,
										readOnly: !0
									})
								}),
								Se ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), Me ? /* @__PURE__ */ J(md, { ready: Ne }) : Ne ? /* @__PURE__ */ J(su, {
									label: "Credential",
									verticalOnMobile: !0,
									hint: "This provider's conventional environment variable is set on the server; the session reuses it.",
									control: /* @__PURE__ */ Y("div", {
										className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
										children: [/* @__PURE__ */ J(M, {
											iconName: F.CheckCircle,
											className: "text-success-primary"
										}), /* @__PURE__ */ J("span", {
											className: "label-small text-success-primary",
											children: "Detected"
										})]
									})
								}) : /* @__PURE__ */ Y(q, { children: [
									/* @__PURE__ */ J(su, {
										label: "Name",
										required: !0,
										verticalOnMobile: !0,
										hint: "How this setup is listed the next time a session is created.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: ke ? X.Large : X.Medium,
											className: au,
											value: Te,
											onChange: (e) => w(e.target.value)
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "API Key",
										required: !0,
										verticalOnMobile: !0,
										invalid: it,
										hint: je?.auth_hint ? `Stored in NAC once the setup is saved, or set ${je.auth_hint} on the server instead.` : "Stored in NAC under a generated name once the setup is saved.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: ke ? X.Large : X.Medium,
											className: au,
											type: "password",
											autoComplete: "off",
											placeholder: "Paste the provider key",
											leadingSlot: /* @__PURE__ */ J(Du, { status: ze.status }),
											validation: it,
											value: T,
											onChange: (e) => E(e.target.value)
										})
									})
								] })] }) : null
							] }) : null] }) : null,
							I.kind === "file" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(su, {
								label: "Config File",
								required: !0,
								hint: "A config.toml on this machine; its [model] section is read.",
								invalid: !!Ke,
								verticalOnMobile: !0,
								control: /* @__PURE__ */ J(Z, {
									inputSize: ke ? X.Large : X.Medium,
									className: au,
									placeholder: "Select Config File",
									trailing: Ws.Button,
									trailingIconName: F.Folder,
									trailingOnClick: () => oe(!0),
									value: j,
									onChange: (e) => ie(e.target.value)
								})
							}), j.trim() ? /* @__PURE__ */ J(Q, {}) : null] }) : null,
							I.kind === "new" ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(su, {
									label: "Model Provider",
									required: !0,
									hint: "Service that provides the models for this session.",
									control: /* @__PURE__ */ J(sd, {
										items: gd,
										value: y,
										onValueChange: (e) => {
											b(e), E(""), re("");
										}
									})
								}),
								/* @__PURE__ */ J(Q, {}),
								y === hd ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(su, {
									label: "Protocol",
									required: !0,
									hint: "Wire format the endpoint speaks; a URL alone cannot say.",
									control: /* @__PURE__ */ J(sd, {
										items: Qu,
										value: x,
										onValueChange: (e) => S(e)
									})
								}), /* @__PURE__ */ J(Q, {})] }) : null,
								/* @__PURE__ */ J(su, {
									label: "Name",
									required: !0,
									hint: "How this setup is listed the next time a session is created.",
									control: /* @__PURE__ */ J(Z, {
										inputSize: X.Medium,
										className: au,
										value: Te,
										onChange: (e) => w(e.target.value)
									})
								}),
								Se ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(su, {
									label: "API Key",
									required: !0,
									invalid: it,
									hint: "Stored in NAC under a generated name once the setup is saved.",
									control: /* @__PURE__ */ J(Z, {
										inputSize: X.Medium,
										className: au,
										type: "password",
										autoComplete: "off",
										placeholder: "Paste the provider key",
										leadingSlot: /* @__PURE__ */ J(Du, { status: ze.status }),
										validation: it,
										value: T,
										onChange: (e) => E(e.target.value)
									})
								})] }) : null,
								y === hd ? /* @__PURE__ */ Y(q, { children: [
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "Model",
										required: !0,
										hint: "Model identifier the endpoint expects.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: au,
											placeholder: "gpt-5.5",
											value: D,
											onChange: (e) => O(e.target.value)
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "Base URL",
										required: !0,
										hint: "Endpoint the session sends its requests to.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: au,
											placeholder: "https://api.openai.com/v1",
											value: k,
											onChange: (e) => ee(e.target.value)
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "Allow insecure HTTP",
										control: /* @__PURE__ */ Y("div", {
											className: `${au} flex flex-col items-start gap-1`,
											children: [/* @__PURE__ */ J(al, {
												"aria-label": "Allow insecure HTTP",
												checked: te,
												onChange: A
											}), /* @__PURE__ */ J("p", {
												className: "body-small text-basic-secondary",
												children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
											})]
										})
									})
								] }) : Se ? ze.status === "ready" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(su, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									control: /* @__PURE__ */ J(sd, {
										items: ld(ze.models),
										value: Ze,
										onValueChange: re,
										placeholder: "No models offered"
									})
								})] }) : null : Ae ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(su, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									invalid: !!at,
									control: /* @__PURE__ */ J(sd, {
										items: at ? [] : ld(Ye),
										value: at ? "" : Ze,
										onValueChange: re,
										disabled: !!at,
										placeholder: Le.isFetching ? "Reading the model list…" : at ? "–" : "No models offered"
									})
								})] }) : null
							] }) : null,
							I.kind === "saved" || I.kind === "file" ? /* @__PURE__ */ J(ud, {
								resolving: We,
								resolved: Ge,
								backend: qe,
								onBackend: ce,
								baseUrl: Je,
								onBaseUrl: ue,
								model: Ze,
								onModel: (e) => Ge?.models.length ? re(e) : fe(e),
								failed: !!Ke
							}) : null,
							i && rt ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), i] }) : null
						]
					})
				]
			}),
			dt ? /* @__PURE__ */ J(Iu, {
				backend: dt,
				className: "mt-1"
			}) : null,
			ct ? /* @__PURE__ */ Y("div", {
				className: "flex items-start gap-2",
				children: [/* @__PURE__ */ J("p", {
					className: "label-micro text-error-primary flex-1 min-w-0",
					children: ct
				}), lt ? /* @__PURE__ */ J(V, {
					variant: L.Ghost,
					size: B.Medium,
					content: o.Text,
					onClick: () => void lt(),
					children: "Try again"
				}) : null]
			}) : null,
			/* @__PURE__ */ J("p", {
				className: "text-micro text-basic-muted",
				children: "* Required fields"
			}),
			/* @__PURE__ */ J(ad, {
				open: ae,
				kind: "toml",
				initialPath: j.trim(),
				onClose: () => oe(!1),
				onSelect: (e) => {
					ie(e), oe(!1);
				}
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/LightModelSection.tsx
var bd = [{
	id: "",
	label: "Model default"
}, ...$u];
function xd(e, t) {
	if (!e?.model) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let n = e.backend ?? _u(t, e.model);
	if (!n) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let r = t?.providers?.find((e) => e.id === n), i = e.base_url ?? (r ? cu(r) : "");
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
function Sd(e) {
	return e.pick ? {
		model: e.pick.model,
		backend: e.pick.backend,
		base_url: e.pick.baseUrl || null,
		api_key_env: e.apiKeyEnv,
		reasoning_effort: e.effort || null
	} : null;
}
function Cd({ initial: e, onChange: t, behavior: n = "orchestrator" }) {
	let r = Gn(), i = Or(r.data), [a, s] = K(e ? "dual" : "single"), [c, l] = K(() => xd(e, r.data)), u = W(() => {
		if (c.pick) return c;
		let t = xd(e, r.data);
		return t.pick ? t : c;
	}, [
		c,
		e,
		r.data
	]), d = W(() => a === "single" ? {
		mode: a,
		light: null
	} : {
		mode: a,
		light: Sd(u)
	}, [a, u]);
	U(() => {
		t(d);
	}, [d, t]);
	let f = nd(gu(r.data, u.pick?.backend, u.pick?.model).supportedEfforts, u.effort, bd), p = n === "direct" ? {
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
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center justify-between",
			children: [/* @__PURE__ */ J(ou, {
				label: p.label,
				hint: p.hint
			}), /* @__PURE__ */ J("div", {
				className: "flex items-center gap-2",
				children: ["single", "dual"].map((e) => /* @__PURE__ */ J(V, {
					variant: a === e ? L.Primary : L.Secondary,
					size: B.Medium,
					content: o.Text,
					onClick: () => s(e),
					"aria-pressed": a === e,
					children: e === "single" ? "Single" : "Dual"
				}, e))
			})]
		}), a === "dual" ? /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
			children: [/* @__PURE__ */ J(su, {
				label: "Light model",
				required: !0,
				verticalOnMobile: !0,
				hint: p.modelHint,
				control: /* @__PURE__ */ J(Eu, {
					catalog: r.data,
					loading: r.isLoading,
					failed: r.isError,
					liveByBackend: i,
					value: u.pick,
					onSelect: (e) => l({
						...u,
						pick: e,
						effort: "",
						apiKeyEnv: e.backend === u.pick?.backend ? u.apiKeyEnv : r.data?.providers.find((t) => t.id === e.backend)?.connection?.api_key_env ?? null
					})
				})
			}), /* @__PURE__ */ J(su, {
				label: "Light effort",
				secondary: !0,
				hint: "Reasoning effort the light model runs with.",
				control: /* @__PURE__ */ J(Yc, {
					items: f,
					value: u.effort,
					onValueChange: (e) => l({
						...u,
						effort: e
					}),
					disabled: !u.pick,
					size: B.Medium,
					variant: L.Ghost,
					placement: R.BottomLeft,
					panelClassName: "max-h-64 overflow-auto"
				})
			})]
		}) : null]
	});
}
//#endregion
//#region src/app/components/modals/SshConnectionBox.tsx
var wd = "__new__", Td = ".ssh/config";
function Ed(e) {
	let t = e.trim();
	return t ? t.replace(/\/[^/]*$/, "") || "/" : "~/.ssh";
}
function Dd(e) {
	let t = e.trim();
	if (!t) return null;
	let n = Number(t);
	return !Number.isInteger(n) || n < 1 || n > 65535 ? "Port must be an integer between 1 and 65535." : null;
}
function Od(e) {
	return e.trim() || null;
}
function kd(e, t, n) {
	let r = Od(e);
	if (!r) return { error: "An SSH host is required." };
	let i = Dd(t);
	return i ? { error: i } : {
		ssh_host: r,
		ssh_port: Od(t) ? Number(t.trim()) : null,
		ssh_identity_file: Od(n)
	};
}
function Ad(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function jd(e, t) {
	return e.ssh_host === t.ssh_host && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function Md({ mode: e, connection: t, onConnectionChange: n, seedTarget: r = null, name: i, onNameChange: a, host: o, onHostChange: s, port: c, onPortChange: l, identityFile: u, onIdentityFileChange: d, onTest: f, testing: p = !1, locked: m = !1, className: h }) {
	let { markSshDisconnected: g, markSshConnected: _ } = me().stores.sshConnectionStore, v = un(), { data: y } = jt(), b = W(() => y?.configurations ?? [], [y]), x = Dt(), S = Ar(), C = e === "manage", w = W(() => C || !r?.ssh_host.trim() ? null : b.find((e) => jd(r, e))?.config_id ?? null, [
		C,
		r,
		b
	]), [T, E] = K(null), D = T ?? w ?? wd, [O, k] = K(!1), [ee, te] = K(() => Ad(b)), [A, ne] = K(r?.ssh_host ?? ""), [re, j] = K(r?.ssh_port ? String(r.ssh_port) : ""), [ie, ae] = K(r?.ssh_identity_file ?? ""), [oe, se] = K(null), [ce, le] = K(!1), ue = Ue(), de = !!t, fe = S.isPending || x.isPending || p, pe = m || de || fe, N = D === wd ? null : b.find((e) => e.config_id === D) ?? null, he = C ? i ?? "" : ee, ge = C ? o ?? "" : de ? t?.ssh_host ?? "" : A, P = C ? c ?? "" : de ? t?.ssh_port ? String(t.ssh_port) : "" : re, _e = C ? u ?? "" : de ? t?.ssh_identity_file ?? "" : ie, ve = (e) => {
		C ? a?.(e) : te(e);
	}, I = (e) => {
		C ? s?.(e) : ne(e);
	}, ye = (e) => {
		C ? l?.(e) : j(e);
	}, be = (e) => {
		C ? d?.(e) : ae(e);
	}, xe = D === wd ? "Create New" : N?.name ?? "SSH config", Se = (e) => {
		if (E(e), k(!1), se(null), e === wd) {
			te(Ad(b)), ne(r?.ssh_host ?? ""), j(r?.ssh_port ? String(r.ssh_port) : ""), ae(r?.ssh_identity_file ?? "");
			return;
		}
		let t = b.find((t) => t.config_id === e);
		t && (te(t.name), ne(t.ssh_host), j(t.ssh_port ? String(t.ssh_port) : ""), ae(t.ssh_identity_file ?? ""));
	}, we = async () => {
		se(null);
		let e = kd(ge, P, _e);
		if ("error" in e) {
			se(e.error);
			return;
		}
		if (D === wd && !Od(he)) {
			se("An SSH config name is required.");
			return;
		}
		try {
			let t = await S.mutateAsync(e);
			if (_(e), D === wd) {
				let t = await x.mutateAsync({
					name: he.trim(),
					ssh_host: e.ssh_host,
					ssh_port: e.ssh_port ?? null,
					ssh_identity_file: e.ssh_identity_file ?? null
				});
				E(t.config_id);
			}
			n(e, t.path);
		} catch (t) {
			g(e);
			let n = Qn($(t));
			se(n), v.error(`SSH connect failed: ${n}`);
		}
	}, Te = () => {
		t && g(t), n(null), se(null);
	}, Ee = async () => {
		if (f) {
			se(null);
			try {
				await f();
			} catch (e) {
				let t = Qn($(e));
				se(t);
			}
		}
	}, De = C || !de && D === wd, Oe = !C;
	return /* @__PURE__ */ Y("div", {
		className: z("relative flex flex-col rounded-[8px] overflow-hidden shadow-convex", de ? "bg-info-primary" : "bg-elevation-sublevel-variant-A", h),
		children: [
			Oe ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-4 h-12 pl-3 pr-1.5 py-1 border-b border-muted bg-elevation-sublevel-variant-A",
				children: [
					/* @__PURE__ */ J("p", {
						className: "label-small text-basic-primary flex-1 min-w-0",
						children: "SSH config"
					}),
					de ? /* @__PURE__ */ J(vi, {
						text: "Connected",
						color: _i.Blue,
						className: "!py-0.5 !px-1"
					}) : null,
					/* @__PURE__ */ J(Kn, {
						open: O && !pe,
						onClose: () => k(!1),
						placement: R.BottomLeft,
						size: "w-auto",
						className: "shrink-0",
						panelClassName: "max-h-72 overflow-hidden",
						sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
						content: /* @__PURE__ */ Y("div", {
							className: z("flex flex-col min-h-0", ue ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
							children: [/* @__PURE__ */ J("div", {
								className: "flex flex-col shrink-0 [&>*]:shrink-0",
								children: /* @__PURE__ */ Y(qc, {
									size: ue ? Gc.Large : Gc.Medium,
									variant: D === wd ? Kc.Accent : Kc.Regular,
									active: D === wd,
									onClick: () => Se(wd),
									children: [/* @__PURE__ */ J(M, { iconName: F.Add }), /* @__PURE__ */ J("span", {
										className: "text-left flex-grow",
										children: "Create New"
									})]
								})
							}), b.length > 0 ? /* @__PURE__ */ Y("div", {
								className: "flex flex-col flex-1 min-h-0 min-w-0",
								children: [/* @__PURE__ */ J("div", { className: "h-px w-full bg-divider-muted my-1 shrink-0" }), /* @__PURE__ */ J("div", {
									className: "flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
									children: b.map((e) => /* @__PURE__ */ Y(qc, {
										size: ue ? Gc.Large : Gc.Medium,
										variant: D === e.config_id ? Kc.Accent : Kc.Regular,
										active: D === e.config_id,
										onClick: () => Se(e.config_id),
										children: [/* @__PURE__ */ J(M, { iconName: F.Globe }), /* @__PURE__ */ J("span", {
											className: "text-left flex-grow truncate",
											children: e.name
										})]
									}, e.config_id))
								})]
							}) : null]
						}),
						children: /* @__PURE__ */ Y(V, {
							size: B.Medium,
							variant: L.Secondary,
							disabled: pe,
							onClick: () => k((e) => !e),
							"aria-expanded": O,
							children: [/* @__PURE__ */ J("span", {
								className: "truncate max-w-[140px]",
								children: xe
							}), /* @__PURE__ */ J(M, {
								iconName: F.Down,
								className: z("shrink-0 transition-transform duration-150 ease-out", O ? "rotate-180" : "rotate-0")
							})]
						})
					})
				]
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-4 p-3",
				children: [
					De ? /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 w-full",
						children: [/* @__PURE__ */ J(ou, {
							label: "SSH config name",
							required: !0
						}), /* @__PURE__ */ J(Z, {
							inputSize: ue ? X.Large : X.Medium,
							value: he,
							isDisabled: pe,
							onChange: (e) => ve(e.target.value),
							placeholder: "SSH-config-1"
						})]
					}) : null,
					/* @__PURE__ */ Y("div", {
						className: "flex flex-col md:flex-row gap-4 items-start w-full",
						children: [/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 w-full md:flex-1 min-w-0",
							children: [/* @__PURE__ */ J(ou, {
								label: "SSH Host",
								required: !0,
								hint: "user@host, a host alias from ~/.ssh/config, or an IP."
							}), /* @__PURE__ */ J(Z, {
								inputSize: ue ? X.Large : X.Medium,
								value: ge,
								isDisabled: pe,
								onChange: (e) => I(e.target.value),
								placeholder: "example@192.0.2.10 or build-box"
							})]
						}), /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 w-full md:w-[98px] shrink-0",
							children: [/* @__PURE__ */ J(ou, {
								label: "Port",
								hint: "Blank uses OpenSSH's default (usually 22)."
							}), /* @__PURE__ */ J(Z, {
								inputSize: ue ? X.Large : X.Medium,
								value: P,
								isDisabled: pe,
								onChange: (e) => ye(e.target.value),
								placeholder: "22"
							})]
						})]
					}),
					/* @__PURE__ */ Y("div", {
						className: "flex gap-4 items-end w-full",
						children: [/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 flex-1 min-w-0",
							children: [/* @__PURE__ */ J(ou, {
								label: "Private Key",
								hint: "A key file on this machine. The default leaves the choice to your ~/.ssh/config and ssh agent."
							}), /* @__PURE__ */ Y(V, {
								size: B.Medium,
								variant: L.Secondary,
								className: "w-full",
								disabled: pe,
								onClick: () => le(!0),
								children: [/* @__PURE__ */ J("span", {
									className: "flex-1 min-w-0 truncate text-left",
									children: _e.trim() || Td
								}), /* @__PURE__ */ J(M, {
									iconName: F.FolderOpen,
									size: 20
								})]
							})]
						}), /* @__PURE__ */ J("div", {
							className: "md:w-[128px] shrink-0 relative",
							children: C ? /* @__PURE__ */ Y(V, {
								size: B.Medium,
								variant: L.Secondary,
								className: "w-full",
								disabled: fe,
								onClick: () => void Ee(),
								children: [p ? /* @__PURE__ */ J(Ce, { size: je.Small }) : /* @__PURE__ */ J(M, {
									iconName: F.Bolt,
									size: 20
								}), "Test"]
							}) : de ? /* @__PURE__ */ J(V, {
								size: B.Medium,
								variant: L.Ghost,
								className: "w-full",
								onClick: Te,
								children: "Disconnect"
							}) : /* @__PURE__ */ Y(V, {
								size: B.Medium,
								variant: L.Primary,
								className: "w-full",
								disabled: fe,
								onClick: () => void we(),
								children: [fe ? /* @__PURE__ */ J(Ce, { size: je.Small }) : null, "Connect"]
							})
						})]
					}),
					oe ? /* @__PURE__ */ J("p", {
						className: "text-micro text-error-primary",
						children: oe
					}) : null
				]
			}),
			/* @__PURE__ */ J(ad, {
				open: ce,
				kind: "file",
				title: "Select Private Key",
				showHidden: !0,
				initialPath: Ed(_e),
				clearLabel: `Use ${Td}`,
				onClear: () => {
					be(""), le(!1);
				},
				onClose: () => le(!1),
				onSelect: (e) => {
					be(e), le(!1);
				}
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/SessionBehaviorPicker.tsx
function Nd({ value: e, onChange: t, disabled: n = !1 }) {
	return /* @__PURE__ */ Y("fieldset", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ J("legend", {
				className: "label-small text-basic-primary",
				children: "How should this chat work?"
			}),
			/* @__PURE__ */ J("div", {
				className: "grid grid-cols-1 gap-2 md:grid-cols-3",
				role: "radiogroup",
				children: kl.map((r, i) => {
					let a = r.id === e;
					return /* @__PURE__ */ Y("button", {
						type: "button",
						role: "radio",
						"aria-checked": a,
						tabIndex: a ? 0 : -1,
						disabled: n,
						className: z("flex min-h-[196px] cursor-pointer flex-col gap-2 rounded-[6px] border p-3 text-left transition-colors", a ? "border-accent-primary bg-accent-secondary" : "border-border-primary bg-elevation-level-1 hover:bg-elevation-level-2", n && "cursor-not-allowed opacity-60"),
						onClick: () => t(r.id),
						onKeyDown: (e) => {
							let n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0, r = e.key === "Home" ? 0 : e.key === "End" ? kl.length - 1 : n ? (i + n + kl.length) % kl.length : null;
							r != null && (e.preventDefault(), t(kl[r].id), (e.currentTarget.parentElement?.querySelectorAll("[role=\"radio\"]"))?.[r]?.focus());
						},
						children: [
							/* @__PURE__ */ Y("span", {
								className: "flex items-center justify-between gap-2",
								children: [/* @__PURE__ */ J("span", {
									className: "text-small font-medium text-basic-primary",
									children: r.label
								}), r.id === "orchestrator" ? /* @__PURE__ */ J("span", {
									className: "tag-label shrink-0 text-basic-tertiary",
									children: "Default"
								}) : null]
							}),
							/* @__PURE__ */ J("span", {
								className: "text-xs text-basic-secondary",
								children: r.topLevel
							}),
							/* @__PURE__ */ J("span", {
								className: "text-xs text-basic-secondary",
								children: r.editing
							}),
							/* @__PURE__ */ J("span", {
								className: "text-xs text-basic-secondary",
								children: r.delegation
							}),
							/* @__PURE__ */ J("span", {
								className: "mt-auto text-xs text-basic-muted",
								children: r.inspection
							})
						]
					}, r.id);
				})
			}),
			/* @__PURE__ */ J("p", {
				className: "text-micro text-basic-muted",
				children: "Behavior is fixed for the lifetime of this chat. Start a new chat to choose a different behavior."
			})
		]
	});
}
//#endregion
//#region src/app/features/setup/modelSelection.ts
function Pd(e) {
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
function Fd(e, t) {
	if (e === t) return !0;
	if (e == null || t == null) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Object.hasOwn(t, n) && e[n] === t[n]);
}
function Id(e, t) {
	return e === void 0 || t === void 0 ? e === t : zu(e ?? null, t ?? null);
}
function Ld(e, t) {
	if (e === t) return !0;
	if (!e || !t) return !1;
	if (e.kind === "resolved" && t.kind === "resolved") return e.backend === t.backend && e.model === t.model && e.base_url === t.base_url && e.allow_insecure_http === t.allow_insecure_http && e.api_key_env === t.api_key_env && e.reasoning_effort === t.reasoning_effort && Fd(e.extra_headers, t.extra_headers) && e.orchestrator_compaction_threshold === t.orchestrator_compaction_threshold && Id(e.light_model, t.light_model);
	if (e.kind !== "save" || t.kind !== "save") return !1;
	let n = e.request, r = t.request;
	return n.name === r.name && n.backend === r.backend && n.model === r.model && n.base_url === r.base_url && n.allow_insecure_http === r.allow_insecure_http && n.api_key === r.api_key && n.reasoning_effort === r.reasoning_effort && n.initial_prompt === r.initial_prompt && Fd(n.extra_headers, r.extra_headers) && n.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && Id(n.light_model, r.light_model);
}
//#endregion
//#region src/app/components/modals/PrimaryModelSection.tsx
var Rd = [{
	id: "",
	label: "Model default"
}, ...$u];
function zd({ initial: e, inheritSavedDefault: t = !1, existingSession: r = !1, onChange: i }) {
	let a = Gn(), o = pd(), s = Or(a.data), [c, l] = K(null), u = An(t && !e), d = t && !e ? u.data?.configurations.at(-1) : void 0, f = W(() => e ?? (d ? {
		...Pd(d),
		extra_headers: d.extra_headers
	} : void 0), [e, d]), p = tn(d && !c ? d.config_id : null, ""), m = t && !e && !c && (u.isPending || d && !p.data), h = W(() => f ? {
		pick: {
			backend: f.backend,
			model: f.model,
			baseUrl: f.base_url
		},
		effort: f.reasoning_effort ?? ""
	} : null, [f]), g = o.defaultPick ? s.get(o.defaultPick.backend) : void 0, _ = o.configured && o.credentialReady && (a.isPending || g === null), v = g === void 0 || o.defaultPick && g?.some((e) => e.id === o.defaultPick?.model) ? o.defaultPick : null, y = W(() => du(a.data), [a.data]), b = W(() => c ?? h ?? (o.configured ? v ? {
		pick: v,
		effort: ""
	} : null : y ? {
		pick: y,
		effort: ""
	} : null), [
		c,
		h,
		y,
		v,
		o.configured
	]), x = a.data?.providers.find((e) => e.id === b?.pick.backend), S = !!(f && b && b.pick.backend === f.backend), C = !!(x?.auth_status === "ready" || b && o.matches(b.pick) && o.credentialReady), w = b ? o.matches(b.pick) : !1, T = w && b ? s.get(b.pick.backend) : void 0, E = W(() => {
		if (m || !b || !b.pick.baseUrl) return null;
		let e = !!(r && f && S && b.pick.model === f.model);
		if (!e && (o.initializing || _)) return null;
		if (!e && w) {
			let e = T;
			if (!o.credentialReady || e === null || e && !e.some((e) => e.id === b.pick.model)) return null;
		}
		return !e && !lr(b.pick.backend) && !C ? null : S && f ? {
			kind: "resolved",
			backend: b.pick.backend,
			model: b.pick.model,
			base_url: f.base_url,
			allow_insecure_http: f.allow_insecure_http ?? !1,
			api_key_env: f.api_key_env,
			reasoning_effort: b.effort || null,
			extra_headers: f.extra_headers,
			light_model: f.light_model,
			orchestrator_compaction_threshold: f.orchestrator_compaction_threshold,
			config_id: f.config_id
		} : C ? {
			kind: "resolved",
			backend: b.pick.backend,
			model: b.pick.model,
			base_url: b.pick.baseUrl,
			allow_insecure_http: !1,
			api_key_env: x?.connection?.api_key_env ?? null,
			reasoning_effort: b.effort || null,
			extra_headers: null,
			light_model: void 0
		} : null;
	}, [
		b,
		f,
		r,
		S,
		x,
		C,
		o.initializing,
		o.credentialReady,
		w,
		_,
		T,
		m
	]);
	U(() => i(E), [i, E]);
	let D = nd(gu(a.data, b?.pick.backend, b?.pick.model).supportedEfforts, b?.effort ?? "", Rd);
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
		children: [
			/* @__PURE__ */ J(ou, {
				label: "Primary model",
				hint: "Search one catalog across every connected provider. Provider accounts and advanced presets are managed separately below."
			}),
			/* @__PURE__ */ J(su, {
				label: "Model",
				required: !0,
				verticalOnMobile: !0,
				control: /* @__PURE__ */ J(Eu, {
					catalog: a.data,
					loading: a.isLoading,
					failed: a.isError,
					liveByBackend: s,
					value: b?.pick ?? null,
					onSelect: (e) => {
						let t = gu(a.data, e.backend, e.model).supportedEfforts, n = b?.effort ?? "";
						l({
							pick: e,
							effort: n && !t.includes(n) ? "" : n
						});
					}
				})
			}),
			/* @__PURE__ */ J(su, {
				label: "Reasoning",
				hint: "Stored with this chat and switchable independently of provider setup.",
				control: /* @__PURE__ */ J(sd, {
					items: D,
					value: b?.effort ?? "",
					placeholder: "Model default",
					disabled: !b,
					onValueChange: (e) => {
						b && l({
							...b,
							effort: e
						});
					}
				})
			}),
			d && p.isError ? /* @__PURE__ */ J("p", {
				role: "alert",
				className: "text-micro text-error-primary",
				children: "The saved project setup could not be resolved. Review it in Advanced or choose another model."
			}) : null,
			b && !S && !C ? /* @__PURE__ */ Y("p", {
				className: "text-micro text-error-primary",
				role: "alert",
				children: [
					"Connect ",
					n(b.pick.backend),
					" in Provider connections or Advanced before selecting this model."
				]
			}) : null
		]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ProviderConnections.tsx
function Bd() {
	return /* @__PURE__ */ Y("section", {
		"aria-label": "Provider connections",
		className: "flex flex-col gap-3",
		children: [
			/* @__PURE__ */ J("p", {
				className: "text-micro text-basic-muted",
				children: "Connect another account without changing this chat or signing out of your current provider. API keys and custom endpoints are available in Advanced provider setup."
			}),
			/* @__PURE__ */ J(Iu, { backend: "arcee-auth" }),
			/* @__PURE__ */ J(Iu, { backend: "chatgpt-codex-responses" })
		]
	});
}
//#endregion
//#region src/app/features/setup/ModelSetupSection.tsx
function Vd({ initial: e, onChange: t, invalid: n, errorText: r, children: i, simple: a = !0, inheritSavedDefault: o = !1, existingSession: s = !1 }) {
	let [c, l] = K(!a), [u, d] = K(!1), [f, p] = K(!1), m = G(null), [h, g] = K(e), _ = H((e) => {
		m.current = e, p(e?.kind === "save"), t(e, "preset");
	}, [t]), v = H((e) => {
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
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-3",
		children: [
			c ? /* @__PURE__ */ J(yd, {
				initial: h,
				invalid: n,
				onChange: _,
				children: i
			}) : /* @__PURE__ */ J(zd, {
				inheritSavedDefault: o,
				existingSession: s,
				initial: h,
				onChange: v
			}),
			/* @__PURE__ */ J(V, {
				variant: L.Secondary,
				"aria-expanded": u,
				onClick: () => d((e) => !e),
				children: "Provider connections"
			}),
			u ? /* @__PURE__ */ J(Bd, {}) : null,
			/* @__PURE__ */ J(V, {
				variant: L.Secondary,
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
			!c && i ? /* @__PURE__ */ Y("details", {
				className: "text-micro",
				children: [/* @__PURE__ */ J("summary", {
					className: "cursor-pointer py-2",
					children: "Advanced execution settings"
				}), i]
			}) : null,
			r ? /* @__PURE__ */ J("p", {
				role: "alert",
				className: "text-micro text-error-primary",
				children: r
			}) : null
		]
	});
}
//#endregion
//#region src/app/features/setup/workflow.ts
var Hd = class extends te("SetupFailure") {};
function Ud(e) {
	return e instanceof Hd && (e.kind === "unknown" || e.kind === "conflict" || e.completed.length > 0);
}
function Wd(e, t) {
	return tt(() => {
		let n = [];
		return t((t, r, i = !0) => Se(function* () {
			if (!e.current()) return yield* ye(new Hd({
				phase: t,
				kind: "cancelled",
				cause: null,
				completed: [...n]
			}));
			let a = yield* at({
				try: r,
				catch: (r) => {
					let i = e.classify(r, t);
					return new Hd({
						phase: t,
						kind: t === "read" && i === "unknown" ? "rejected" : i,
						cause: r,
						completed: [...n]
					});
				}
			}).pipe(Ze(() => i ? D(() => e.reconcile(t)) : De));
			return i && (n.push(t), yield* D(() => e.reconcile(t))), a;
		}));
	});
}
function Gd(e) {
	return Wd(e, (t) => Se(function* () {
		let n = yield* t("preset", e.model, e.persistsModel ?? !0), r = yield* t("project", () => e.project(n));
		return {
			model: n,
			project: r,
			chat: yield* t("chat", () => e.chat(n, r))
		};
	}));
}
function Kd(e) {
	return Wd(e, (t) => Se(function* () {
		if (e.existing) {
			let n = yield* t("read", e.existing, !1);
			if (n !== null) return n;
		}
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("chat", () => e.chat(n));
	}));
}
function qd(e) {
	return Wd(e, (t) => Se(function* () {
		yield* t("read", e.check, !1);
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("configuration", () => e.configuration(n), e.configurationSaved ?? !0), e.title && (yield* t("title", e.title)), e.projectDefault && (yield* t("default", () => e.projectDefault(n))), n;
	}));
}
async function Jd(e) {
	let n = await Re(e);
	if (t(n)) return n.value;
	let r = _t(n.cause);
	throw In(r) ? r.value : Pe(n.cause);
}
//#endregion
//#region src/app/features/setup/useSetupAction.ts
function Yd(e = !0) {
	let t = ku(e), n = G(!1), r = G(!1), [i, a] = K(!1), [o, s] = K(!1);
	return {
		busy: i,
		needsReview: o,
		run: async (e) => {
			let i = t.current;
			if (!(!i?.current() || n.current || r.current)) {
				n.current = !0, a(!0);
				try {
					let t = await Jd(e(i));
					return i.current() ? t : void 0;
				} catch (e) {
					if (!i.current()) return;
					throw Ud(e) && (r.current = !0, s(!0)), e;
				} finally {
					n.current = !1, i.current() && a(!1);
				}
			}
		}
	};
}
//#endregion
//#region src/app/features/setup/browserAdapters.ts
var Xd = class extends Error {}, Zd = class extends Error {
	constructor() {
		super("This chat's settings changed. Reopen settings to review the current values before saving.");
	}
};
function Qd(e, t) {
	return e instanceof Xd ? "rejected" : e instanceof Zd ? "conflict" : e instanceof I ? t === "project" && e.status === 409 ? "rejected" : e.status === 409 ? "conflict" : e.status >= 500 ? "unknown" : "rejected" : "unknown";
}
function $d(e) {
	if (!(e instanceof Hd)) return eu($(e));
	if (e.kind === "cancelled") return "This setup view was closed.";
	let t = e.completed.includes("configuration") ? "Chat settings were saved. " : e.completed.includes("project") ? "The project was saved. " : e.completed.includes("preset") ? "The preset was saved. " : "";
	return e.kind === "unknown" ? `${t}The ${e.phase} save outcome is unknown. Refresh and review the saved values before trying again.` : e.kind === "conflict" ? `${t}The ${e.phase} changed or is busy. Refresh and review before saving again. ${eu($(e.cause))}` : `${t}${eu($(e.cause))}${e.completed.length ? " Reopen setup to review the saved values before continuing." : ""}`;
}
function ef(e, t) {
	return async (n) => {
		let r = n === "preset" ? [
			tr.modelConfigs,
			tr.modelCatalog,
			tr.credentials
		] : n === "project" || n === "default" ? [tr.projects] : t ? [
			tr.sessionConfig(t),
			tr.sessionSnapshot(t),
			tr.sessionsAll
		] : [tr.sessionsAll];
		await Promise.all(r.map((t) => e.invalidateQueries({ queryKey: t })));
	};
}
//#endregion
//#region src/app/features/setup/projectLaunch.ts
function tf(e) {
	let { selected: t, policy: n, light: r, sandbox: i } = e, a = {
		project_id: e.projectId,
		behavior: nt(n, e.behavior),
		first_chat: !0,
		first_chat_same_behavior: !n.orchestrationEnabled,
		backend: t.backend,
		model: t.model,
		base_url: t.base_url,
		allow_insecure_http: t.allow_insecure_http,
		api_key_env: t.api_key_env,
		reasoning_effort: e.reasoning === "__clear__" ? null : e.reasoning || t.reasoning_effort || null,
		light_model: n.orchestrationEnabled ? r.mode === "dual" && r.light ? Lu(r.light, t.backend, t.api_key_env) : null : e.savedLight ?? null
	}, o = e.headers ?? t.extra_headers ?? void 0;
	return o !== void 0 && (a.extra_headers = o), e.presetCompaction && t.orchestrator_compaction_threshold !== void 0 ? a.orchestrator_compaction_threshold = t.orchestrator_compaction_threshold : Wu(e.compaction) !== null && (a.orchestrator_compaction_threshold = Number(e.compaction)), e.execution !== "ssh" && (a.sandbox = {
		enabled: e.execution === "sandbox",
		no_mount_cwd: i.noMount,
		image: Wu(i.image),
		gpus: Gu(i.gpu),
		workdir: Wu(i.workdir),
		shm_size: Wu(i.shm),
		mounts: Gu(i.mounts),
		mounts_ro: [],
		activity_key: e.activityKey
	}), a;
}
//#endregion
//#region src/app/components/modals/CreateProjectModal.tsx
var nf = [
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
], rf = ed.map((e) => e.id === "" ? {
	...e,
	label: "From configuration"
} : e), af = { paddingInline: "8px" }, of = {
	noMount: !1,
	image: "",
	gpu: "",
	workdir: "",
	shm: "",
	mounts: ""
};
function sf({ open: e, onClose: t }) {
	let { data: n } = Gt();
	return id(e) ? /* @__PURE__ */ J(cf, {
		open: e,
		defaultCwd: n?.root_cwd ?? "",
		onClose: t
	}, e ? "open" : "closing") : null;
}
function cf({ open: e, defaultCwd: t, onClose: n }) {
	let { loadLastLight: i, storeLastLight: a } = me().stores.lastLight, s = ci(), c = un(), l = Yd(e), d = ti(), f = Le(), p = qt(), m = fn(), [h, g] = K("local"), _ = u(), [v, y] = K(_.orchestrationEnabled ? "orchestrator" : "direct"), [b, x] = K(t), [S, C] = K(""), [w, T] = K(""), [E, D] = K(""), [O, k] = K(""), [ee, te] = K(of), [A, ne] = K(!1), [re, j] = K(!1), [ie, ae] = K(!1), [oe, se] = K(null), [ce, le] = K({
		mode: "single",
		light: null
	}), [ue, de] = K(null), [fe, pe] = K(""), [N, he] = K(null), ge = G(""), P = G(!0), _e = G(!1), ve = Gn(), I = oe?.kind === "save" ? oe.request : oe ?? null, ye = nd(gu(ve.data, I?.backend, I?.model).supportedEfforts, w, rf), be = Ue(), xe = h === "ssh", Se = r(h === "sandbox").data, Ce = xe ? N : null, we = !xe || Ce !== null, Te = l.busy, [Ee, De] = K(null), Oe = p.isPending && h === "sandbox", ke = Ie(Oe, Ee).data, Ae = ke?.since_epoch_ms, [je, Me] = K(0);
	U(() => {
		if (!Oe) return;
		let e = setInterval(() => {
			Me(Ae ? Math.max(0, Math.floor((Date.now() - Ae) / 1e3)) : 0);
		}, 1e3);
		return () => clearInterval(e);
	}, [Oe, Ae]);
	let Ne = (e) => (t) => {
		de(null), e(t);
	}, Pe = (e) => {
		de(null), te((t) => ({
			...t,
			...e
		}));
	}, Fe = G(null), Re = H((e, t) => {
		if (se(e), !e || Ld(Fe.current, e)) return;
		let n = Fe.current;
		if (Fe.current = e, t === "primary" && n?.kind === "resolved") {
			de((e) => e?.field === "config" ? null : e);
			return;
		}
		if (e?.kind === "resolved" && e.orchestrator_compaction_threshold !== void 0) {
			let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
			_e.current = !0, P.current = !1, ge.current = n, D(n);
		} else {
			let e = _e.current;
			_e.current = !1, e && (P.current = !0, ge.current = "", D(""));
		}
		de((e) => e?.field === "config" ? null : e);
	}, []), ze = H((e) => {
		le(e), de((e) => e?.field === "config" ? null : e);
	}, []), Be = W(() => i(), [i]), Ve = oe?.kind === "resolved" && oe.light_model !== void 0 ? oe.light_model : Be, He = JSON.stringify(Ve), We = W(() => {
		let e = gu(ve.data, I?.backend, I?.model).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		ve.data,
		I?.backend,
		I?.model
	]);
	U(() => {
		!_e.current && We !== "auto" && (ge.current === "" || P.current) && (P.current = !0, ge.current = We, D(We));
	}, [We, oe]);
	let Ge = (e) => {
		de(null), _e.current = !1, P.current = !1, ge.current = e, D(e);
	}, Ke = (e) => {
		e !== h && (de(null), g(e), he(null), x(e === "ssh" ? "" : t));
	}, qe = (e, t) => {
		de(null), he(e), e ? t && x(t) : x("");
	}, Je = async () => {
		if (l.needsReview || Te) return;
		if (xe && !Ce) {
			de({
				field: "ssh",
				message: "Connect to the SSH host before creating a project."
			});
			return;
		}
		if (!Wu(b)) {
			de({
				field: "cwd",
				message: "A working folder is required."
			});
			return;
		}
		if (!oe) {
			de({
				field: "config",
				message: "Complete the provider configuration before creating a project."
			});
			return;
		}
		if (_.orchestrationEnabled && ce.mode === "dual" && !ce.light) {
			de({
				field: "config",
				message: "Pick the light model before creating a project."
			});
			return;
		}
		let e;
		try {
			e = Ju(O, void 0);
		} catch (e) {
			de({
				field: "config",
				message: Qn($(e))
			});
			return;
		}
		let t = null;
		try {
			let r = await l.run((n) => Gd({
				current: n.current,
				classify: Qd,
				reconcile: ef(d),
				persistsModel: oe.kind === "save",
				model: async () => {
					if (oe.kind === "save") {
						let e = ce.mode === "dual" && ce.light ? {
							...oe.request,
							light_model: ce.light
						} : oe.request, t = Pd(await m.mutateAsync(e));
						return n.current() && se(t), t;
					}
					return oe;
				},
				project: async (e) => {
					let n = await f.mutateAsync({
						name: Wu(S),
						cwd: b,
						ssh_host: Ce?.ssh_host ?? null,
						ssh_port: Ce?.ssh_port ?? null,
						ssh_identity_file: Ce?.ssh_identity_file ?? null,
						default_model_config_id: e.config_id ?? null
					});
					return t = n.project_id, n;
				},
				chat: async (t, r) => {
					let i = h === "sandbox" ? crypto.randomUUID() : null;
					n.current() && De(i);
					let a = tf({
						selected: t,
						projectId: r.project_id,
						policy: _,
						behavior: v,
						reasoning: w,
						headers: e,
						compaction: E,
						presetCompaction: _e.current,
						savedLight: Ve,
						light: ce,
						execution: Ce ? "ssh" : h,
						sandbox: ee,
						activityKey: i
					});
					return {
						snapshot: await p.mutateAsync(a),
						launchLight: a.light_model ?? null,
						apiKeyEnv: t.api_key_env
					};
				}
			}));
			if (!r) return;
			let { snapshot: i, launchLight: o, apiKeyEnv: u } = r.chat;
			a(o && Ru(o, u)), c.success("Project created"), s(i.metadata.session_id ? pr.session(i.metadata.session_id) : pr.project(r.project.project_id)), n();
		} catch (e) {
			if (t && e instanceof Hd && e.kind !== "unknown") c.error(`Project created, but the first chat failed: ${$d(e)}`), s(pr.project(t)), n();
			else {
				let t = $d(e);
				Ud(e) && pe(t), de({
					field: e instanceof Hd && e.phase === "project" && e.kind === "rejected" ? "cwd" : "config",
					message: t
				});
			}
		}
	}, Ye = (e) => ue?.field === e;
	return /* @__PURE__ */ Y(Vn, {
		open: e,
		onClose: n,
		title: "New Project",
		size: or.Wide,
		flush: !0,
		className: "h-[680px]",
		footer: be ? /* @__PURE__ */ J(bi, {
			variant: L.Primary,
			content: o.Text,
			onClick: Je,
			loading: Te,
			disabled: Te || l.needsReview || !!ue || !oe || !we,
			children: "Create Project"
		}) : /* @__PURE__ */ J(V, {
			variant: L.Primary,
			size: B.Large,
			content: o.Text,
			onClick: Je,
			loading: Te,
			disabled: Te || l.needsReview || !!ue || !oe || !we,
			children: "Create Project"
		}),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-8 md:gap-6 [&>*]:shrink-0",
			children: [
				_.orchestrationEnabled ? /* @__PURE__ */ J(Nd, {
					value: v,
					onChange: y,
					disabled: Te
				}) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: [
						/* @__PURE__ */ J(ou, {
							label: "Environment",
							hint: "Where NAC runs commands and accesses files."
						}),
						/* @__PURE__ */ J("div", {
							className: "flex items-start gap-3",
							children: nf.map((e) => /* @__PURE__ */ J(V, {
								variant: h === e.id ? L.Primary : L.Secondary,
								size: B.Medium,
								content: o.Text,
								onClick: () => Ke(e.id),
								"aria-pressed": h === e.id,
								className: `${be ? "!rounded-full" : ""}`,
								children: e.label
							}, e.id))
						}),
						/* @__PURE__ */ J("p", {
							className: "pt-1 text-micro text-basic-muted",
							children: nf.find((e) => e.id === h)?.description
						}),
						h === "sandbox" && Se && Se.status !== "ready" ? /* @__PURE__ */ Y("div", {
							className: "pt-1",
							children: [/* @__PURE__ */ J("p", {
								className: "text-error-primary text-micro",
								children: Se.status === "missing" ? "Sandbox mode runs sessions in a podman container, and podman is not installed on this machine." : `Sandbox mode needs podman, which is not responding${Se.detail ? `: ${Se.detail}` : "."}`
							}), Se.guidance ? /* @__PURE__ */ J("pre", {
								className: "pt-1 whitespace-pre-wrap font-mono text-micro text-basic-muted",
								children: Se.guidance
							}) : null]
						}) : null
					]
				}),
				xe ? /* @__PURE__ */ J(Md, {
					mode: "launch",
					connection: N,
					onConnectionChange: qe
				}) : null,
				we ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col md:flex-row items-start gap-6 md:gap-4",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 flex-1 min-w-0 w-full",
						children: [
							/* @__PURE__ */ J(ou, {
								label: "Working Folder",
								hint: xe ? "The project folder NAC works within on the SSH host." : "The project folder NAC works within.",
								required: !0,
								invalid: Ye("cwd")
							}),
							/* @__PURE__ */ Y(V, {
								variant: L.Secondary,
								size: be ? B.Large : B.Medium,
								content: o.IconRight,
								className: z("w-full", Ye("cwd") && "input-validation"),
								style: af,
								onClick: () => ae(!0),
								children: [/* @__PURE__ */ J("span", {
									className: z("flex-1 min-w-0 truncate text-left font-normal", b ? "text-basic-primary" : "text-basic-muted"),
									children: b || "/path/to/project"
								}), /* @__PURE__ */ J(M, {
									iconName: F.Folder,
									className: "shrink-0"
								})]
							}),
							Ye("cwd") ? /* @__PURE__ */ J("p", {
								className: "pt-1 text-error-primary text-micro",
								children: ue?.message
							}) : null
						]
					}), /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 flex-1 min-w-0 w-full",
						children: [/* @__PURE__ */ J(ou, { label: "Project name" }), /* @__PURE__ */ J(Z, {
							inputSize: be ? X.Large : X.Medium,
							placeholder: "Taken from the git remote",
							value: S,
							onChange: (e) => Ne(C)(e.target.value),
							className: `${be ? "w-full" : ""}`
						})]
					})]
				}) : null,
				we ? /* @__PURE__ */ J(Vd, {
					simple: !_.orchestrationEnabled,
					inheritSavedDefault: !0,
					invalid: Ye("config"),
					errorText: fe || (Ye("config") ? ue?.message : void 0),
					onChange: Re,
					children: /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-2",
						children: [
							_.orchestrationEnabled ? /* @__PURE__ */ J(Cd, {
								initial: Ve,
								behavior: v,
								onChange: ze
							}, He) : null,
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ J(su, {
								label: "Reasoning Effort",
								hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
								control: ((e, t, n, r = !1) => /* @__PURE__ */ J(Yc, {
									items: e,
									value: t,
									onValueChange: n,
									disabled: r,
									size: B.Medium,
									variant: L.Ghost,
									placement: R.BottomLeft,
									sticky: !0,
									panelClassName: "max-h-64 overflow-auto min-w-[220px]"
								}))(ye, w, Ne(T))
							}),
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ J(su, {
								label: "Context Limit",
								hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
								control: /* @__PURE__ */ Y("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ J(Z, {
										inputSize: be ? X.Large : X.Medium,
										className: "w-full md:w-[120px]",
										inputClassName: "md:text-right",
										placeholder: We,
										inputMode: "numeric",
										value: E,
										onChange: (e) => Ge(e.target.value)
									}), /* @__PURE__ */ J("span", {
										className: "shrink-0 text-micro text-basic-muted",
										children: "tokens"
									})]
								})
							}),
							h === "sandbox" ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(su, {
									label: "Sandbox options",
									hint: "The container the session runs in: image, GPUs, workdir, shared memory and mounts.",
									control: /* @__PURE__ */ J(al, {
										checked: re,
										onChange: j,
										"aria-label": "Sandbox options"
									})
								}),
								re ? /* @__PURE__ */ Y(q, { children: [
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "Container image",
										hint: "Image the sandbox runs; empty uses the configured default.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "python:3.13-bookworm",
											value: ee.image,
											onChange: (e) => Pe({ image: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "GPUs",
										hint: "Comma-separated GPU list, e.g. all.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "all",
											value: ee.gpu,
											onChange: (e) => Pe({ gpu: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "Container workdir",
										hint: "Working directory inside the container.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "/workspace",
											value: ee.workdir,
											onChange: (e) => Pe({ workdir: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "Shared memory size",
										hint: "Container /dev/shm size, e.g. 1g.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "0",
											value: ee.shm,
											onChange: (e) => Pe({ shm: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "Mounts (HOST:GUEST)",
										hint: "Comma-separated bind mounts.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "/data:/data",
											value: ee.mounts,
											onChange: (e) => Pe({ mounts: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(su, {
										label: "Don't mount the working folder",
										secondary: !0,
										control: /* @__PURE__ */ J(al, {
											checked: ee.noMount,
											onChange: (e) => Pe({ noMount: e }),
											"aria-label": "Don't mount the working folder",
											size: be ? tl.Large : tl.Medium
										})
									})
								] }) : null
							] }) : null,
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ J(su, {
								label: "Custom HTTP headers",
								hint: "Turn this on only if you need to send additional request metadata.",
								control: /* @__PURE__ */ J(al, {
									checked: A,
									onChange: ne,
									"aria-label": "Custom HTTP headers"
								})
							}),
							A ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(nc, {
								label: "Extra headers (JSON object)",
								hintText: "Blank keeps the configuration's headers. Enter {} to send none; header values must be strings.",
								placeholder: "{\"X-Title\": \"NAC\"}",
								value: O,
								onChange: (e) => Ne(k)(e.target.value),
								textAreaClassName: "h-[108px] resize-none"
							})] }) : null
						]
					})
				}) : null,
				Oe ? /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-2",
					role: "status",
					"aria-live": "polite",
					children: [/* @__PURE__ */ J("span", {
						className: "text-micro text-basic-primary",
						children: ke?.phase ?? "Creating the sandbox…"
					}), /* @__PURE__ */ Y("span", {
						className: "text-micro text-basic-muted",
						children: [je, "s"]
					})]
				}) : null
			]
		}), /* @__PURE__ */ J(ad, {
			open: ie,
			kind: "directory",
			initialPath: b.trim(),
			ssh: Ce,
			onClose: () => ae(!1),
			onSelect: (e) => {
				Ne(x)(e), ae(!1);
			}
		})]
	});
}
//#endregion
//#region src/app/components/modals/NewChatModal.tsx
function lf(e) {
	if (!e) return {};
	try {
		let t = JSON.parse(e);
		return Object(t) !== t || Array.isArray(t) ? {} : t;
	} catch {
		return {};
	}
}
function uf(e) {
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
function df(e, t) {
	return {
		initial: {
			backend: e.backend ?? t,
			model: e.model,
			base_url: e.base_url,
			allow_insecure_http: e.allow_insecure_http,
			api_key_env: e.api_key_env ?? null,
			reasoning_effort: e.reasoning_effort ?? null,
			extra_headers: lf(e.extra_headers_json),
			orchestrator_compaction_threshold: e.orchestrator_compaction_threshold,
			light_model: e.light_model ?? null
		},
		light: e.light_model ?? null
	};
}
function ff({ projectId: e, firstChat: t = !1, onClose: n }) {
	return !id(e !== null) || e === null ? null : /* @__PURE__ */ J(pf, {
		projectId: e,
		firstChat: t,
		onClose: n
	}, e);
}
function pf({ projectId: e, firstChat: t, onClose: n }) {
	let { api: r } = me(), i = ci(), a = Yd(), o = ti(), s = qt(), c = fn(), l = et(), d = Ut(), f = An(), p = u(), [m, h] = K(p.orchestrationEnabled ? "orchestrator" : "direct"), [g, _] = K(null), [v, y] = K({
		mode: "single",
		light: null
	}), [b, x] = K(""), S = l.data?.projects.find((t) => t.project_id === e) ?? null, C = hl(d.data ?? [], e), w = S?.default_model_config_id ? f.data?.configurations.find((e) => e.config_id === S.default_model_config_id) ?? null : null, T = Rt(S?.default_model_config_id ? null : C?.summary.session_id ?? null), E = W(() => w ? uf(w) : T.data && C ? df(T.data, C.summary.backend) : null, [
		w,
		T.data,
		C
	]), D = l.isPending || d.isPending || f.isPending || !!C && !S?.default_model_config_id && T.isPending, O = l.error || d.error || T.error || S?.default_model_config_id && (f.error || !f.isPending && !w ? /* @__PURE__ */ Error("The project default is unavailable. Review the project settings before creating a chat.") : null), k = a.busy, ee = H((e) => {
		_(e), x((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), te = H((e) => {
		y(e), x((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), A = g?.kind === "resolved" && g.light_model !== void 0 ? g.light_model : E?.light, ne = JSON.stringify(A), re = async () => {
		if (!(k || a.needsReview || D || O)) {
			if (!g) {
				x("Choose the primary model before creating this chat.");
				return;
			}
			if (p.orchestrationEnabled && v.mode === "dual" && !v.light) {
				x("Pick the light model before creating this chat.");
				return;
			}
			try {
				let l = await a.run((n) => Kd({
					current: n.current,
					classify: Qd,
					reconcile: ef(o),
					existing: t ? async () => {
						let [t, i] = await Promise.all([r.listProjects(n.signal), r.listSessions({ projectId: e }, n.signal)]);
						if (!t.projects.some((t) => t.project_id === e)) return pr.list();
						let a = ml(ot(p, i), e);
						return a ? pr.session(a.summary.session_id) : null;
					} : void 0,
					persistsModel: g.kind === "save",
					model: async () => {
						let e;
						if (g.kind === "save") {
							let t = await c.mutateAsync({
								...g.request,
								light_model: p.orchestrationEnabled ? v.mode === "dual" ? v.light : null : A ?? null
							});
							n.current() && _({
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
						} else e = g;
						return e;
					},
					chat: async (n) => {
						let r = p.orchestrationEnabled ? v.mode === "dual" && v.light ? Lu(v.light, n.backend, n.api_key_env) : null : A ?? null, i = {
							project_id: e,
							behavior: nt(p, m),
							first_chat: t && ie(p, d.data ?? [], e),
							first_chat_same_behavior: !p.orchestrationEnabled,
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
						return a.metadata.session_id ? pr.session(a.metadata.session_id) : pr.project(e);
					}
				}));
				l && (n(), i(l, { replace: t }));
			} catch (e) {
				x($d(e));
			}
		}
	};
	return /* @__PURE__ */ Y(Vn, {
		open: !0,
		onClose: n,
		size: or.Wide,
		flush: !0,
		className: "h-[700px]",
		title: "New Chat",
		subheader: p.orchestrationEnabled ? "Choose this chat's behavior and models. These settings apply to this chat without changing the project default." : "Choose this chat's model. These settings apply to this chat without changing the project default.",
		footer: /* @__PURE__ */ J(V, {
			variant: L.Primary,
			loading: k,
			disabled: k || a.needsReview || D || !!O || !g,
			onClick: () => void re(),
			children: "Create chat"
		}),
		children: [p.orchestrationEnabled ? /* @__PURE__ */ J(Nd, {
			value: m,
			onChange: h,
			disabled: k
		}) : null, O ? /* @__PURE__ */ J("p", {
			role: "alert",
			className: "text-micro text-error-primary",
			children: "The inherited settings could not be loaded. Reopen New Chat to refresh and review them."
		}) : D ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 py-6 text-micro text-basic-muted",
			role: "status",
			children: [/* @__PURE__ */ J(Ce, { size: je.Micro }), "Loading the project's model settings…"]
		}) : /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-3",
			children: [
				/* @__PURE__ */ Y("p", {
					className: "text-micro text-basic-muted",
					children: [
						w ? "Inherited from the project default" : E ? "Inherited from the latest chat" : "No saved project model default",
						E ? `: ${E.initial.model} · ${E.initial.backend} · reasoning ${E.initial.reasoning_effort ?? "model default"}.` : ".",
						" ",
						"Changes below override this chat only."
					]
				}),
				/* @__PURE__ */ J(Vd, {
					initial: E?.initial,
					onChange: ee,
					invalid: !!b,
					errorText: b || void 0
				}),
				p.orchestrationEnabled ? /* @__PURE__ */ J(Cd, {
					initial: A,
					behavior: m,
					onChange: te
				}, ne) : null
			]
		})]
	});
}
//#endregion
//#region src/app/components/modals/DeleteProjectModal.tsx
var mf = (e) => e === 1 ? "chat" : "chats";
function hf({ open: e, onClose: t, project: n }) {
	let r = un(), i = ci(), a = si(), s = Rr(), c = Ue(), l = async (e) => {
		if (!(!n || s.isPending)) try {
			let o = await s.mutateAsync({
				projectId: n.project_id,
				sessions: e
			}), c = o?.deleted_session_ids ?? [], l = zt(a.pathname);
			(a.pathname.startsWith(`/project/${encodeURIComponent(n.project_id)}`) || l && c.includes(l)) && i(pr.list(), { replace: !0 });
			let u = o?.released_session_ids?.length ?? 0, d = c.length;
			r.success(d > 0 ? `Project and ${d} ${mf(d)} removed` : u > 0 ? `Project removed; ${u} ${mf(u)} kept` : "Project removed"), t();
		} catch (e) {
			r.error(`Failed to delete: ${Qn($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: t,
		title: "Remove Project?",
		size: or.Medium,
		footer: /* @__PURE__ */ Y(q, { children: [
			!c && /* @__PURE__ */ J(V, {
				variant: L.Tertiary,
				content: o.Text,
				onClick: t,
				disabled: s.isPending,
				children: "Cancel"
			}),
			/* @__PURE__ */ J(V, {
				variant: L.Secondary,
				content: o.Text,
				onClick: () => void l("keep"),
				disabled: s.isPending,
				children: "Keep Sessions"
			}),
			/* @__PURE__ */ J(V, {
				variant: L.SecondaryDestructive,
				content: o.Text,
				onClick: () => void l("delete"),
				loading: s.isPending,
				children: "Remove Project and Sessions"
			})
		] }),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ Y("p", { children: [
				"Remove ",
				/* @__PURE__ */ Y("span", {
					className: "text-basic-primary",
					children: [
						"\"",
						n?.name,
						"\""
					]
				}),
				" from NAC?"
			] }), /* @__PURE__ */ Y("p", { children: [
				"Files at ",
				/* @__PURE__ */ J("code", {
					className: "break-all text-basic-primary",
					children: n?.cwd
				}),
				" will be preserved. Select Keep Sessions to leave its chats unassigned, or remove the Project and its chats together."
			] })]
		})
	});
}
//#endregion
//#region src/app/components/modals/RenameProjectModal.tsx
function gf({ open: e, onClose: t, project: n }) {
	return !id(e) || !n ? null : /* @__PURE__ */ J(_f, {
		open: e,
		project: n,
		onClose: t
	}, n.project_id);
}
function _f({ open: e, project: t, onClose: n }) {
	let r = un(), i = Xe(), [a, s] = K(t.name), [c, l] = K(t.description ?? ""), u = async () => {
		if (i.isPending) return;
		let e = a.trim();
		if (!e) {
			r.error("A project needs a name");
			return;
		}
		try {
			await i.mutateAsync({
				projectId: t.project_id,
				payload: {
					name: e,
					description: c.trim() || null
				}
			}), r.success("Project saved"), n();
		} catch (e) {
			let t = e instanceof I && e.status === 409;
			r.error(t ? "Version conflict — the project changed in the meantime" : `Error: ${Qn($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: n,
		title: "Rename project",
		size: or.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(V, {
			variant: L.Tertiary,
			content: o.Text,
			onClick: n,
			disabled: i.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(V, {
			variant: L.Primary,
			content: o.Text,
			onClick: u,
			loading: i.isPending,
			children: "Save"
		})] }),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ J(Z, {
				label: "Name",
				placeholder: "Project name",
				value: a,
				onChange: (e) => s(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && u();
				}
			}), /* @__PURE__ */ J(Z, {
				label: "Description",
				placeholder: "Optional",
				value: c,
				onChange: (e) => l(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && u();
				}
			})]
		})
	});
}
//#endregion
//#region src/app/hooks/useKeyboardShortcuts.ts
var vf = /* @__PURE__ */ new Set([
	"INPUT",
	"TEXTAREA",
	"SELECT"
]);
function yf(e) {
	return e instanceof HTMLElement ? vf.has(e.tagName) || e.isContentEditable : !1;
}
function bf(e) {
	let { getStackLength: t } = b(), n = Je(), r = G(e);
	U(() => {
		r.current = e;
	}), U(() => {
		let e = (e) => {
			if (!(e.repeat || !n(e.target))) {
				for (let n of r.current) if (n.enabled !== !1 && Mt(e, n.keys)) {
					if (t() > 0 || !Ir(n.keys) && yf(e.target)) return;
					e.preventDefault(), n.onTrigger();
					return;
				}
			}
		};
		return window.addEventListener("keydown", e), () => window.removeEventListener("keydown", e);
	}, [t, n]);
}
//#endregion
//#region src/app/providers/ProjectActionsProvider.tsx
var xf = Wr(null);
function Sf({ children: e }) {
	let { pruneSessionNavigation: t } = me().stores.sessionNavigationStore, { pruneChatTabs: n } = me().stores.chatTabsStore, r = un(), { pathname: i } = si(), a = ci(), o = Ut(), s = u(), c = o.isSuccess, l = W(() => ot(s, o.data ?? []), [o.data, s]), { data: d } = et(), f = re(), p = ge(), [m, h] = K(null), [g, _] = K(null), [v, y] = K(null), [b, x] = K(null), [S, C] = K(!1), w = f.toggle, T = p.mutateAsync, E = H(async (e, t) => {
		try {
			await T({
				projectId: e.project_id,
				sessionId: t.session_id
			}), r.success(`Assigned to ${e.name}`);
		} catch (e) {
			r.error(`Failed to assign the chat: ${eu($(e))}`);
		}
	}, [T, r]), D = H(async (e, t = !1) => {
		C(t), x(e);
	}, []), O = W(() => ({
		create: () => h("create"),
		assign: (e) => {
			let t = Cl(d?.projects ?? [], e);
			if (t) {
				E(t, e);
				return;
			}
			y(e), h("assign");
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
				r.error(`Failed to update pin: ${Qn($(e))}`);
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
	U(() => {
		let e = o.data;
		!c || !e || !d || (n(e.map((e) => e.summary.session_id), d.projects.map((e) => e.project_id)), t(dl(e).map((e) => e.summary.session_id)));
	}, [
		c,
		o.data,
		d,
		n,
		t
	]);
	let k = zt(i), ee = Cn(i) ?? o.data?.find((e) => e.summary.session_id === k)?.summary.project_id ?? null;
	bf([{
		keys: Ct,
		enabled: ee != null,
		onTrigger: () => {
			ee && D(ee);
		}
	}, {
		keys: xr,
		enabled: ee == null,
		onTrigger: () => h("create")
	}]);
	let te = () => h(null);
	return /* @__PURE__ */ Y(xf.Provider, {
		value: O,
		children: [
			e,
			/* @__PURE__ */ J(sf, {
				open: m === "create",
				onClose: te
			}),
			/* @__PURE__ */ J(ff, {
				projectId: b,
				firstChat: S,
				onClose: () => {
					let e = b;
					x(null), C(!1), e && Cn(i) === e && !dl(l).some((t) => t.summary.project_id === e) && a(pr.list(), { replace: !0 });
				}
			}),
			/* @__PURE__ */ J(iu, {
				open: m === "assign",
				onClose: te,
				summary: v
			}),
			/* @__PURE__ */ J(gf, {
				open: m === "rename",
				onClose: te,
				project: g
			}),
			/* @__PURE__ */ J(hf, {
				open: m === "delete",
				onClose: te,
				project: g
			})
		]
	});
}
function Cf() {
	let e = qr(xf);
	if (!e) throw Error("useProjectActions must be used within ProjectActionsProvider");
	return e;
}
//#endregion
//#region src/app/components/modals/DeleteModal.tsx
function wf(e, t) {
	let n = e.project_id?.trim();
	if (!n) return pr.list();
	let r = t.filter((t) => t.summary.project_id === n && t.summary.session_id !== e.session_id);
	r.sort((e, t) => yr(t.summary.updated_at) - yr(e.summary.updated_at));
	let i = r[0];
	return i ? pr.session(i.summary.session_id) : pr.project(n);
}
function Tf({ open: e, onClose: t, summary: n }) {
	let r = un(), i = ul(), a = ci(), s = si(), c = fr(), { data: l = [] } = Ut();
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: t,
		title: "Delete session",
		size: or.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(V, {
			variant: L.Tertiary,
			content: o.Text,
			onClick: t,
			disabled: c.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(V, {
			variant: L.SecondaryDestructive,
			content: o.Text,
			onClick: async () => {
				if (!n || c.isPending) return;
				let e = n.session_id, i = s.pathname, o = zt(i) === e ? wf(n, l) : null;
				try {
					o && ui(() => {
						a(o, { replace: !0 });
					}), await c.mutateAsync(e), r.success("Session deleted"), t();
				} catch (e) {
					o && a(i, { replace: !0 }), r.error(`Failed to delete: ${Qn($(e))}`);
				}
			},
			loading: c.isPending,
			children: "Delete session"
		})] }),
		children: /* @__PURE__ */ Y("p", { children: [
			"Are you sure you want to delete the session",
			" ",
			/* @__PURE__ */ Y("span", {
				className: "text-basic-primary",
				children: [
					"\"",
					i(n),
					"\""
				]
			}),
			" ",
			/* @__PURE__ */ Y("span", {
				className: "font-mono text-basic-muted",
				children: [
					"(",
					Ve(n?.session_id),
					")"
				]
			}),
			"? This action cannot be undone."
		] })
	});
}
//#endregion
//#region src/app/components/modals/RenameModal.tsx
function Ef({ open: e, onClose: t, summary: n }) {
	return !id(e) || !n ? null : /* @__PURE__ */ J(Df, {
		open: e,
		summary: n,
		onClose: t
	}, n.session_id);
}
function Df({ open: e, summary: t, onClose: n }) {
	let r = un(), i = ul(), a = Lr(), [s, c] = K(t.title ?? ""), [l, u] = K(!!t.pinned), d = !!t.project_id, f = async () => {
		if (!a.isPending) try {
			await a.mutateAsync({
				id: t.session_id,
				title: s.trim(),
				pinned: d ? l : !1,
				expectedVersion: t.presentation_version ?? 0
			}), r.success("Session presentation saved"), n();
		} catch (e) {
			let t = e instanceof I && e.status === 409;
			r.error(t ? "Version conflict — the session changed in the meantime" : `Error: ${Qn($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: n,
		title: "Rename session",
		size: or.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(V, {
			variant: L.Tertiary,
			content: o.Text,
			onClick: n,
			disabled: a.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(V, {
			variant: L.Primary,
			content: o.Text,
			onClick: f,
			loading: a.isPending,
			children: "Save"
		})] }),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ J(Z, {
				label: "Title",
				placeholder: i(t) || "Session name",
				hintText: "Leave empty to restore the automatic title (last prompt).",
				value: s,
				onChange: (e) => c(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && f();
				}
			}), d ? /* @__PURE__ */ Y("label", {
				className: "flex items-center gap-2 label-small text-basic-secondary select-none",
				children: [/* @__PURE__ */ J("input", {
					type: "checkbox",
					checked: l,
					onChange: (e) => u(e.target.checked),
					className: "accent-[var(--color-fill-accent-primary)]"
				}), "Pin to top of the list"]
			}) : null]
		})
	});
}
//#endregion
//#region src/app/components/SshBadge.tsx
function Of({ state: e, onReconnect: t, className: n }) {
	let r = e !== "connected";
	return /* @__PURE__ */ Y("div", {
		className: z("flex items-center h-4 shrink-0", r ? "gap-1" : null, n),
		children: [
			r ? /* @__PURE__ */ J(M, {
				iconName: F.Danger,
				size: 16,
				className: "text-error-primary"
			}) : null,
			/* @__PURE__ */ J("span", {
				className: z("tag-label uppercase", r ? "text-error-primary" : "text-info-primary"),
				children: "SSH"
			}),
			e === "reconnect" && t ? /* @__PURE__ */ J(Zt, {
				title: "Reconnect SSH",
				position: R.TopCenter,
				children: /* @__PURE__ */ J(V, {
					size: B.Small,
					variant: L.Ghost,
					content: o.Icon,
					"aria-label": "Reconnect SSH",
					onClick: (e) => {
						e.stopPropagation(), t();
					},
					children: /* @__PURE__ */ J(M, {
						iconName: F.Refresh,
						size: 16
					})
				})
			}) : null
		]
	});
}
//#endregion
//#region src/app/components/modals/SettingsModal.tsx
function kf(e) {
	return Object.keys(e).length === 0 ? "" : JSON.stringify(e, null, 2);
}
function Af(e) {
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
function jf(e) {
	let t = Af(e.extra_headers_json);
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
function Mf({ open: e, onClose: t, footer: n, titleExtra: r, children: i }) {
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: t,
		title: r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-4",
			children: [/* @__PURE__ */ J("span", {
				className: "flex-1 min-w-0",
				children: "Session settings"
			}), r]
		}) : "Session settings",
		size: or.Wide,
		flush: !0,
		className: "h-[700px]",
		footer: n,
		children: i
	});
}
function Nf({ open: e, id: t, onClose: n }) {
	let r = id(e), { data: i, isLoading: a } = _r(r ? t : null), { data: o, isLoading: s } = Rt(r ? t : null);
	if (!r || !t) return null;
	let c = o ? jf(o) : null;
	return !c || !i || s ? /* @__PURE__ */ J(Mf, {
		open: e,
		onClose: n,
		children: /* @__PURE__ */ J("p", {
			className: "text-basic-muted text-micro",
			children: s || a ? "Loading session configuration…" : "Session configuration unavailable."
		})
	}) : /* @__PURE__ */ J(Pf, {
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
function Pf({ open: e, id: t, initial: n, initialLight: r, initialVersion: i, summary: a, diagnostics: s, onClose: c }) {
	let { useSshConnectionStatus: l, sshTargetFromSummary: d } = me().stores.sshConnectionStore, { api: f } = me(), p = Ue(), m = un(), h = ti(), g = Yd(e), _ = ul(), v = Sr(), y = Xe(), [b, x] = K(!1), S = $t(), C = S.data ?? null, w = fn(), T = u(), [D] = K(a), [O] = K(i), k = Lr(), ee = D.title ?? "", [te, A] = K(ee), [ne, re] = K(n.model), [j, ie] = K(n.backend), [ae, oe] = K(n.reasoning_effort ?? ""), [, se] = K(n.base_url), [ce, le] = K(kf(n.extra_headers)), [ue, de] = K(n.orchestrator_compaction_threshold == null ? "" : String(n.orchestrator_compaction_threshold)), fe = G(n.orchestrator_compaction_threshold == null ? "" : String(n.orchestrator_compaction_threshold)), pe = G(!1), N = G(!1), [he, ge] = K(""), [P, _e] = K(null), [ve, I] = K({
		mode: r ? "dual" : "single",
		light: r
	}), [ye, be] = K(r), [xe, Se] = K(!1), [Ce, we] = K(!1), Te = s.some((e) => e.startsWith("malformed stored light model")), Ee = G(null), De = H((e, t) => {
		if (_e(e), !e || Ld(Ee.current, e)) return;
		let n = Ee.current;
		Ee.current = e;
		let r = e.kind === "resolved" ? e : e.request;
		if (ie(r.backend), re(r.model), se(r.base_url ?? Hu(r.backend) ?? ""), e.kind === "resolved") {
			oe(e.reasoning_effort ?? "");
			let r = t === "primary" && n?.kind === "resolved";
			if (r && n.backend === e.backend && n.base_url === e.base_url && n.api_key_env === e.api_key_env && n.allow_insecure_http === e.allow_insecure_http || le(kf(e.extra_headers ?? {})), r) return;
			if (e.orchestrator_compaction_threshold !== void 0) {
				let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
				N.current = !0, pe.current = !1, fe.current = n, de(n);
			} else {
				let e = N.current;
				N.current = !1, e && (pe.current = !0, fe.current = "", de(""));
			}
			e.light_model !== void 0 && (be(e.light_model), I({
				mode: e.light_model ? "dual" : "single",
				light: e.light_model
			}));
		}
	}, []), R = Gn(), Oe = nd(gu(R.data, j, ne).supportedEfforts, ae), ke = W(() => {
		let e = gu(R.data, j, ne).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		R.data,
		j,
		ne
	]);
	U(() => {
		!N.current && ke !== "auto" && pe.current && (pe.current = !0, fe.current = ke, de(ke));
	}, [ke, P]);
	let Ae = !P || g.needsReview || g.busy, je = g.busy || S.isPending || v.isPending || k.isPending || w.isPending, Me = d(D), Ne = l(Me), [Pe, Fe] = K(void 0), Ie = Pe === void 0 ? Ne === "connected" ? Me : null : Pe, Le = (e) => {
		Fe(e);
	}, Re = () => k.mutateAsync({
		id: t,
		title: te.trim(),
		pinned: !!D.pinned,
		expectedVersion: D.presentation_version ?? 0
	}), z = (e) => {
		let t;
		try {
			let r = !!(C?.model_ready && E(C, {
				backend: e.backend,
				model: e.model,
				baseUrl: e.base_url
			}));
			t = Zu({
				model: e.model,
				backend: e.backend,
				base_url: e.base_url,
				allow_insecure_http: e.allow_insecure_http,
				reasoning_effort: ae,
				credential_mode: e.api_key_env ? "variable" : "none",
				api_key_env: e.api_key_env ?? "",
				extra_headers: ce,
				orchestrator_compaction_threshold: ue
			}, n, r);
		} catch (e) {
			throw new Xd(e instanceof Error ? e.message : String(e));
		}
		if (T.orchestrationEnabled) if (ve.mode === "dual") {
			if (!ve.light) throw new Xd("Pick the light model before saving.");
			let i = Lu(ve.light, e.backend, e.api_key_env, n.api_key_env);
			(Te || !zu(i, r)) && (t.light_model = i);
		} else (r || Te) && (t.light_model = null);
		else Ce ? t.light_model = null : zu(ve.light, r) || (t.light_model = ve.light);
		return t;
	}, ze = async () => {
		if (je || g.needsReview || !P) return;
		if (b && P.kind === "resolved" && !P.config_id) {
			ge("Choose a saved preset in Advanced before updating the project default.");
			return;
		}
		if (T.orchestrationEnabled && ve.mode === "dual" && !ve.light) {
			ge("Pick the light model before saving.");
			return;
		}
		let e = !1;
		try {
			let t = P.kind === "save" ? P.request : P, n = z({
				...t,
				base_url: t.base_url ?? Hu(t.backend) ?? "",
				allow_insecure_http: t.allow_insecure_http ?? !1,
				api_key_env: P.kind === "resolved" ? P.api_key_env : P.request.api_key ? "PENDING_SAVED_CREDENTIAL" : null
			});
			e = P.kind === "save" || Object.keys(n).length > 0;
		} catch (e) {
			ge($d(e));
			return;
		}
		try {
			if (!await g.run((n) => qd({
				current: n.current,
				classify: Qd,
				reconcile: ef(h, t),
				check: async () => {
					let e = await f.getConfig(t, n.signal);
					if (O !== void 0 && e.config_version !== O) throw new Zd();
				},
				persistsModel: P.kind === "save",
				model: async () => {
					if (P.kind === "save") {
						let e = Pd(await w.mutateAsync({
							...P.request,
							light_model: ve.mode === "dual" ? ve.light : null
						}));
						return n.current() && _e(e), e;
					}
					return P;
				},
				configurationSaved: e,
				configuration: async (e) => {
					let n = z(e);
					Object.keys(n).length > 0 && await v.mutateAsync({
						id: t,
						patch: n
					});
				},
				title: te.trim() === ee.trim() ? void 0 : Re,
				projectDefault: b && D.project_id ? (e) => {
					if (!e.config_id) throw new Xd("Choose a saved preset before updating the project default.");
					return y.mutateAsync({
						projectId: D.project_id,
						payload: { default_model_config_id: e.config_id }
					});
				} : void 0
			}))) return;
			m.success("Session settings saved"), c();
		} catch (e) {
			ge($d(e));
		}
	}, Be = /* @__PURE__ */ Y(q, { children: [p ? /* @__PURE__ */ J(bi, {
		variant: L.Tertiary,
		content: o.Text,
		onClick: c,
		disabled: je,
		children: "Cancel"
	}) : /* @__PURE__ */ J(V, {
		variant: L.Tertiary,
		size: B.Large,
		content: o.Text,
		onClick: c,
		disabled: je,
		children: "Cancel"
	}), p ? /* @__PURE__ */ J(bi, {
		variant: L.Primary,
		"aria-label": "Save",
		content: o.Text,
		onClick: ze,
		disabled: Ae,
		loading: je,
		children: "Save"
	}) : /* @__PURE__ */ J(V, {
		variant: L.Primary,
		"aria-label": "Save",
		size: B.Large,
		content: o.Text,
		onClick: ze,
		disabled: Ae,
		loading: je,
		children: "Save"
	})] });
	return /* @__PURE__ */ J(Mf, {
		open: e,
		onClose: c,
		footer: Be,
		titleExtra: Me ? /* @__PURE__ */ J(Of, { state: Ne === "connected" ? "connected" : "disconnected" }) : null,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-6 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ J("p", {
					className: "text-micro text-basic-muted",
					children: "Changes apply to this inactive primary chat. Project defaults and existing children keep their settings."
				}),
				s.length > 0 ? /* @__PURE__ */ Y("div", {
					className: "rounded-[4px] border border-error-muted bg-error-tertiary p-3 text-micro text-error-primary",
					children: [/* @__PURE__ */ J("div", {
						className: "label-small mb-1",
						children: "Repair required"
					}), s.map((e) => /* @__PURE__ */ Y("div", { children: ["• ", e] }, e))]
				}) : null,
				Me ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Md, {
					mode: "settings",
					connection: Ie,
					seedTarget: Me,
					onConnectionChange: Le
				}), /* @__PURE__ */ J(Q, {})] }) : null,
				/* @__PURE__ */ J(Z, {
					label: "Session title",
					"aria-label": "Session title",
					inputSize: p ? X.Large : X.Medium,
					placeholder: _(D) || "Session name",
					hintText: "Leave empty to restore the automatic title (the last prompt).",
					value: te,
					onChange: (e) => A(e.target.value)
				}),
				/* @__PURE__ */ J(Vd, {
					existingSession: !0,
					simple: !T.orchestrationEnabled,
					invalid: !!he,
					errorText: he || void 0,
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
					onChange: De,
					children: /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-2",
						children: [
							T.orchestrationEnabled ? /* @__PURE__ */ J(Cd, {
								initial: ve.light,
								behavior: D.behavior ?? "orchestrator",
								onChange: I
							}, JSON.stringify(ye)) : null,
							D.project_id ? /* @__PURE__ */ Y("label", {
								className: "flex items-start gap-2 text-micro",
								children: [
									/* @__PURE__ */ J("input", {
										type: "checkbox",
										checked: b,
										onChange: (e) => x(e.target.checked)
									}),
									" ",
									/* @__PURE__ */ Y("span", { children: ["Use selected preset as the project default", /* @__PURE__ */ J("span", {
										className: "block text-basic-muted",
										children: "Future chats inherit that saved preset, including its Advanced values. Existing chats and children keep their settings."
									})] })
								]
							}) : null,
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ Y("button", {
								type: "button",
								className: "btn-ghost flex w-full items-center gap-1.5 rounded-[4px] p-2 text-btn-secondary",
								"aria-expanded": xe,
								onClick: () => Se((e) => !e),
								children: [
									/* @__PURE__ */ J(M, {
										iconName: F.Gear,
										size: 20
									}),
									/* @__PURE__ */ J("span", {
										className: "label-small flex-1 text-left",
										children: "Advanced Configurations"
									}),
									/* @__PURE__ */ J(M, {
										iconName: xe ? F.Down : F.Right,
										size: 20
									})
								]
							}),
							xe ? /* @__PURE__ */ Y(q, { children: [
								Te && !T.orchestrationEnabled ? /* @__PURE__ */ Y("label", {
									className: "text-micro",
									children: [
										/* @__PURE__ */ J("input", {
											type: "checkbox",
											checked: Ce,
											onChange: (e) => we(e.target.checked)
										}),
										" ",
										"Clear malformed legacy light settings"
									]
								}) : null,
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(su, {
									label: "Reasoning Effort",
									hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
									control: /* @__PURE__ */ J(sd, {
										items: Oe,
										value: ae,
										onValueChange: oe
									})
								}),
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(su, {
									label: "Context Limit",
									hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
									control: /* @__PURE__ */ Y("div", {
										className: "flex items-center gap-2",
										children: [/* @__PURE__ */ J(Z, {
											inputSize: p ? X.Large : X.Medium,
											className: au,
											inputClassName: "md:text-right",
											"aria-label": "Context limit",
											placeholder: ke,
											inputMode: "numeric",
											value: ue,
											onChange: (e) => {
												N.current = !1, pe.current = !1, fe.current = e.target.value, de(e.target.value);
											}
										}), /* @__PURE__ */ J("span", {
											className: "shrink-0 text-micro text-basic-muted",
											children: "tokens"
										})]
									})
								}),
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(nc, {
									label: "Extra headers (JSON object)",
									textAreaSize: p ? tc.Large : tc.Medium,
									hintText: "Blank sends none; header values must be strings.",
									placeholder: "{ \"X-Title\": \"NAC\" }",
									value: ce,
									onChange: (e) => le(e.target.value),
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
//#endregion
//#region src/app/providers/SessionActionsProvider.tsx
var Ff = Wr(null);
function If({ children: e }) {
	let { pushLocalEvent: t, captureRuntimeActivation: n } = me().stores.runtimeStore, r = un(), i = wt(), a = Ne(), [o, s] = K(null), [c, l] = K(null), [u, d] = K(null), f = H((e) => (t) => {
		l(t), s(e);
	}, []), p = i.toggle, m = W(() => ({
		rename: f("rename"),
		remove: f("delete"),
		settings: (e) => {
			d(e), s("settings");
		},
		togglePin: async (e) => {
			try {
				await p(e);
			} catch (e) {
				r.error(`Failed to update pin: ${Qn($(e))}`);
			}
		},
		stopRun: async (e) => {
			let i = n(e);
			try {
				await a.mutateAsync(e), i() && t("run", "■ run cancellation requested"), r.success("Run cancellation requested");
			} catch (e) {
				r.error(`Failed to stop run: ${Qn($(e))}`);
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
	return /* @__PURE__ */ Y(Ff.Provider, {
		value: m,
		children: [
			e,
			/* @__PURE__ */ J(Ef, {
				open: o === "rename",
				onClose: h,
				summary: c
			}),
			/* @__PURE__ */ J(Tf, {
				open: o === "delete",
				onClose: h,
				summary: c
			}),
			/* @__PURE__ */ J(Nf, {
				open: o === "settings",
				id: u,
				onClose: h
			})
		]
	});
}
function Lf() {
	let e = qr(Ff);
	if (!e) throw Error("useSessionActions must be used within SessionActionsProvider");
	return e;
}
//#endregion
//#region src/app/components/modals/MobileProjectSessionModal.tsx
function Rf(e, t, n) {
	return e.kind === "project" ? `${e.entry.project.name} ${e.entry.project.cwd}`.toLowerCase().includes(t) : `${n(e.session.summary)} ${e.session.summary.cwd}`.toLowerCase().includes(t);
}
function zf({ open: e, onClose: t, projectId: n, sessions: r, activeSessionId: i, summary: a }) {
	let s = ci(), c = Cf(), l = Lf(), u = ul(), { data: d } = et(), { data: f = [] } = Nt(), p = a != null && !n, m = bl(d?.projects ?? [], n), [h, g] = K(n || a ? "chats" : "projects"), [_, v] = K(""), y = G(e);
	U(() => {
		e && !y.current && (g(n || a ? "chats" : "projects"), v("")), y.current = e;
	}, [
		e,
		n,
		a
	]);
	let b = a ? u(a) : m?.name ?? "Projects", x = a ? m?.name ?? "Not assigned" : null, S = n ? r : _l(f), C = W(() => {
		let e = _.trim().toLowerCase();
		return e ? S.filter((t) => u(t.summary).toLowerCase().includes(e)) : S;
	}, [
		S,
		_,
		u
	]), w = W(() => yl(d?.projects ?? [], f), [d, f]), T = W(() => {
		let e = _.trim().toLowerCase();
		return e ? w.filter((t) => Rf(t, e, u)) : w;
	}, [
		w,
		_,
		u
	]), E = (e) => {
		g(e), v("");
	}, D = (e) => {
		t(), e();
	};
	return /* @__PURE__ */ Y(Vn, {
		open: e,
		onClose: t,
		title: /* @__PURE__ */ Y("div", {
			className: "flex flex-col min-w-0 justify-center",
			children: [/* @__PURE__ */ J("span", {
				className: "truncate",
				children: b
			}), x ? /* @__PURE__ */ J("span", {
				className: z("text-micro font-normal truncate", p ? "text-danger-primary" : "text-basic-muted"),
				children: x
			}) : null]
		}),
		bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
		children: [
			h === "assign" ? null : /* @__PURE__ */ Y("div", {
				className: "absolute inset-x-0 top-0 z-10 flex items-start gap-3 px-2 py-4",
				children: [
					/* @__PURE__ */ J(ec, {
						className: "flex-1 min-w-0",
						variant: $s.Search,
						placeholder: h === "chats" ? "Search Sessions..." : "Search projects...",
						value: _,
						onChange: (e) => v(e.target.value),
						onClear: () => v(""),
						"aria-label": h === "chats" ? "Search Sessions" : "Search projects"
					}),
					h === "chats" && n ? /* @__PURE__ */ J(bi, {
						variant: L.Secondary,
						content: o.Icon,
						"aria-label": "New Session",
						onClick: () => D(() => void c.newChat(n)),
						children: /* @__PURE__ */ J(M, { iconName: F.Add })
					}) : null,
					h === "projects" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(bi, {
						variant: L.Secondary,
						content: o.Icon,
						"aria-label": "New project",
						onClick: () => D(c.create),
						children: /* @__PURE__ */ J(M, { iconName: F.Add })
					}), /* @__PURE__ */ J(bi, {
						variant: L.Secondary,
						content: o.Icon,
						"aria-label": "All projects",
						onClick: () => D(() => s(pr.list())),
						children: /* @__PURE__ */ J(M, { iconName: F.Grid })
					})] }) : null
				]
			}),
			/* @__PURE__ */ J("div", {
				className: z("flex-1 min-h-0 overflow-auto [&>*]:shrink-0", h === "assign" ? "px-4 py-4" : "px-2 pt-[72px] pb-[96px]"),
				children: h === "assign" && a ? /* @__PURE__ */ J(Hf, {
					summary: a,
					onAssigned: t
				}) : h === "chats" ? /* @__PURE__ */ J(Rl, {
					sessions: C,
					activeSessionId: i,
					isMobile: !0,
					emptyLabel: _.trim() ? "No matching chats" : "No chats yet",
					onOpen: (e) => D(() => s(pr.session(e.summary.session_id))),
					onPin: (e) => void l.togglePin(e.summary),
					onRename: (e) => D(() => l.rename(e.summary)),
					onDelete: (e) => D(() => l.remove(e.summary))
				}) : /* @__PURE__ */ J(Bl, {
					items: T,
					activeId: n ?? i,
					isMobile: !0,
					emptyLabel: _.trim() ? "No matching projects" : "No projects yet",
					onOpenProject: (e) => D(() => s(pr.project(e))),
					onOpenSession: (e) => D(() => s(pr.session(e))),
					renderActions: (e) => {
						if (e.kind === "project") {
							let { project: t } = e.entry;
							return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Vf, {
								label: `Rename ${t.name}`,
								icon: F.Edit,
								onClick: () => D(() => c.rename(t))
							}), /* @__PURE__ */ J(Vf, {
								label: `Delete ${t.name}`,
								icon: F.Trash,
								variant: L.GhostDestructive,
								onClick: () => D(() => c.remove(t))
							})] });
						}
						let { summary: t } = e.session, n = u(t);
						return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Vf, {
							label: `Rename ${n}`,
							icon: F.Edit,
							onClick: () => D(() => l.rename(t))
						}), /* @__PURE__ */ J(Vf, {
							label: `Delete ${n}`,
							icon: F.Trash,
							variant: L.GhostDestructive,
							onClick: () => D(() => l.remove(t))
						})] });
					}
				})
			}),
			/* @__PURE__ */ J("div", {
				className: "absolute inset-x-0 bottom-0 z-10 px-2 py-4 pointer-events-none",
				children: /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-1 w-full p-[2px] rounded-[18px] bg-elevation-level-3 shadow-2xl overflow-hidden pointer-events-auto",
					role: "tablist",
					children: [
						p ? /* @__PURE__ */ J(Bf, {
							active: h === "assign",
							icon: F.FolderOpen,
							label: "Assign",
							onClick: () => E("assign")
						}) : null,
						/* @__PURE__ */ J(Bf, {
							active: h === "chats",
							icon: F.Chat,
							label: "Sessions",
							onClick: () => E("chats")
						}),
						/* @__PURE__ */ J(Bf, {
							active: h === "projects",
							icon: F.Folder,
							label: "Projects",
							onClick: () => E("projects")
						})
					]
				})
			})
		]
	});
}
function Bf({ active: e, icon: t, label: n, onClick: r }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		role: "tab",
		"aria-selected": e,
		className: z("flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]", e ? "btn-primary" : "btn-ghost"),
		onClick: r,
		children: [/* @__PURE__ */ J(M, {
			iconName: t,
			size: 28
		}), /* @__PURE__ */ J("span", {
			className: z("label-micro font-bold truncate max-w-full", e ? null : "text-basic-primary"),
			children: n
		})]
	});
}
function Vf({ label: e, icon: t, onClick: n, variant: r = L.Ghost }) {
	return /* @__PURE__ */ J(V, {
		variant: r,
		size: B.Small,
		content: o.Icon,
		title: e,
		"aria-label": e,
		onClick: n,
		children: /* @__PURE__ */ J(M, { iconName: t })
	});
}
function Hf({ summary: e, onAssigned: t }) {
	let n = un(), { data: r } = et(), i = ge(), a = Le(), [s, c] = K(""), [l, u] = K(null), d = W(() => Cl(r?.projects ?? [], e), [r, e]), f = i.isPending || a.isPending, p = async () => {
		if (!f) {
			u(null);
			try {
				let r = d ?? await a.mutateAsync({
					name: s.trim() || null,
					...Sl(e)
				});
				await i.mutateAsync({
					projectId: r.project_id,
					sessionId: e.session_id
				}), n.success(`Assigned to ${r.name}`), t();
			} catch (e) {
				u(eu($(e)));
			}
		}
	};
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ J("p", {
				className: "text-medium text-basic-secondary",
				children: "This Session will be assigned to the project (according to its working directory):"
			}),
			d ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-4 min-w-0",
				children: [/* @__PURE__ */ J(Rc, {
					id: d.project_id,
					size: 40,
					className: "rounded-[4px] shrink-0"
				}), /* @__PURE__ */ Y("div", {
					className: "flex flex-col min-w-0",
					children: [/* @__PURE__ */ J("span", {
						className: "header-md truncate",
						children: d.name
					}), /* @__PURE__ */ J("span", {
						className: "code-micro text-basic-tertiary truncate",
						children: d.cwd
					})]
				})]
			}) : /* @__PURE__ */ J(Z, {
				label: "Project name",
				inputSize: X.Large,
				placeholder: "Taken from the git remote",
				value: s,
				onChange: (e) => {
					u(null), c(e.target.value);
				}
			}),
			l ? /* @__PURE__ */ J("p", {
				className: "text-error-primary text-micro",
				children: l
			}) : null,
			/* @__PURE__ */ J(V, {
				variant: L.Primary,
				size: B.Large,
				content: o.Text,
				className: "w-full",
				onClick: () => void p(),
				loading: f,
				children: d ? "Assign" : "Create and assign"
			})
		]
	});
}
//#endregion
//#region src/app/components/projects/ProjectPopover.tsx
function Uf({ tooltip: e, label: t, icon: n, onClick: r, variant: i = L.Ghost }) {
	return /* @__PURE__ */ J(V, {
		variant: i,
		size: B.Small,
		content: o.Icon,
		title: e,
		"aria-label": t,
		onClick: r,
		children: /* @__PURE__ */ J(M, { iconName: n })
	});
}
function Wf(e, t, n) {
	return (e.kind === "project" ? `${e.entry.project.name} ${e.entry.project.cwd}` : `${n(e.session.summary)} ${e.session.summary.cwd}`).toLowerCase().includes(t);
}
function Gf({ activeId: e, onClose: t }) {
	let n = ci(), r = Cf(), i = Lf(), a = ul(), o = Ue(), [s, c] = K(""), { data: l } = et(), { data: u = [] } = Nt(), d = W(() => yl(l?.projects ?? [], u), [l, u]), f = W(() => {
		let e = s.trim().toLowerCase();
		return e ? d.filter((t) => Wf(t, e, a)) : d;
	}, [
		d,
		s,
		a
	]);
	return /* @__PURE__ */ Y("div", {
		className: z("flex flex-col", o ? "h-[calc(70dvh)]" : "max-h-[520px]"),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 shrink-0",
			children: [/* @__PURE__ */ J(Z, {
				inputSize: o ? X.Large : X.Medium,
				leading: Us.Icon,
				leadingIconName: F.Search,
				placeholder: "Search Projects",
				"aria-label": "Search projects",
				value: s,
				onChange: (e) => c(e.target.value)
			}), /* @__PURE__ */ J(Q, {})]
		}), /* @__PURE__ */ J("div", {
			className: "flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
			children: /* @__PURE__ */ J(Bl, {
				items: f,
				activeId: e,
				isMobile: o,
				emptyLabel: s.trim() ? "No matching projects" : "No projects yet",
				onOpenProject: (e) => {
					t(), n(pr.project(e));
				},
				onOpenSession: (e) => {
					t(), n(pr.session(e));
				},
				renderActions: (e) => {
					if (e.kind === "project") {
						let { project: n } = e.entry;
						return /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ J(Uf, {
								tooltip: n.pinned ? "Unpin project" : "Pin project",
								label: `${n.pinned ? "Unpin" : "Pin"} ${n.name}`,
								icon: n.pinned ? F.Unpin : F.Pin,
								onClick: () => void r.togglePin(n)
							}),
							/* @__PURE__ */ J(Uf, {
								tooltip: "Rename project",
								label: `Rename ${n.name}`,
								icon: F.Edit,
								onClick: () => {
									t(), r.rename(n);
								}
							}),
							/* @__PURE__ */ J(Uf, {
								tooltip: "Remove project",
								label: `Remove ${n.name}`,
								icon: F.Trash,
								variant: L.GhostDestructive,
								onClick: () => {
									t(), r.remove(n);
								}
							})
						] });
					}
					let { summary: n } = e.session, o = a(n);
					return /* @__PURE__ */ Y(q, { children: [
						/* @__PURE__ */ J(Uf, {
							tooltip: "Rename chat",
							label: `Rename ${o}`,
							icon: F.Edit,
							onClick: () => {
								t(), i.rename(n);
							}
						}),
						/* @__PURE__ */ J(Uf, {
							tooltip: "Delete chat",
							label: `Delete ${o}`,
							icon: F.Trash,
							variant: L.GhostDestructive,
							onClick: () => {
								t(), i.remove(n);
							}
						}),
						/* @__PURE__ */ J(Uf, {
							tooltip: "Assign to a project",
							label: `Assign ${o} to a project`,
							icon: F.Folders,
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
//#endregion
//#region src/app/components/Breadcrumbs.tsx
function Kf() {
	let { pathname: e } = si(), t = zt(e), n = Cn(e), r = ci(), i = Cf(), a = Ue(), s = ul(), { data: c } = et(), { data: l = [] } = Nt(), [u, d] = K(!1), f = t ? l.find((e) => e.summary.session_id === t) : void 0, p = n ?? f?.summary.project_id ?? null, m = bl(c?.projects ?? [], p), h = p ? dl(l).filter((e) => e.summary.project_id === p).sort((e, t) => yr(t.summary.updated_at) - yr(e.summary.updated_at)) : [], g = !!(p || t), _ = m?.name ?? s(f?.summary) ?? t ?? "", v = f ? s(f.summary) : null, y = m?.project_id ?? t ?? "", b = p ? h.some((e) => en(e.active_run)) : en(f?.active_run), x = !a || !g;
	return /* @__PURE__ */ Y("nav", {
		className: z("flex items-center min-w-0 gap-1", a && g && "flex-1"),
		"aria-label": "Breadcrumb",
		children: [x ? a ? /* @__PURE__ */ J("button", {
			type: "button",
			className: "label-medium text-btn-secondary rounded-[8px] truncate",
			onClick: () => r(pr.list()),
			"aria-current": g ? void 0 : "page",
			children: "All Projects"
		}) : /* @__PURE__ */ J(V, {
			variant: L.Ghost,
			size: B.Medium,
			content: o.Text,
			onClick: () => r(pr.list()),
			"aria-current": g ? void 0 : "page",
			children: "All Projects"
		}) : null, g ? /* @__PURE__ */ Y(q, { children: [
			x ? /* @__PURE__ */ J(M, {
				iconName: F.Right,
				className: "text-basic-muted shrink-0"
			}) : null,
			a ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("button", {
				type: "button",
				className: "flex flex-1 min-w-0 items-center gap-2 rounded-[8px] text-btn-secondary",
				onClick: () => d(!0),
				"aria-expanded": u,
				"aria-label": "Switch chat or project",
				children: [/* @__PURE__ */ Y("span", {
					className: "flex flex-col flex-1 min-w-0 text-left",
					children: [/* @__PURE__ */ J("span", {
						className: z("label-medium truncate !leading-[20px]", b ? "text-shimmer-basic" : "text-basic-primary"),
						children: v ?? _
					}), v ? /* @__PURE__ */ J("span", {
						className: z("text-micro truncate", m ? "text-basic-muted" : "text-danger-primary"),
						children: m?.name ?? "Not assigned"
					}) : null]
				}), /* @__PURE__ */ J(M, {
					iconName: F.Right,
					size: 24,
					className: "shrink-0"
				})]
			}), /* @__PURE__ */ J(zf, {
				open: u,
				onClose: () => d(!1),
				projectId: p,
				sessions: h,
				activeSessionId: t,
				summary: f?.summary ?? null
			})] }) : /* @__PURE__ */ J(Kn, {
				open: u,
				onClose: () => d(!1),
				placement: R.BottomRight,
				size: jn.Medium,
				className: "min-w-0",
				content: /* @__PURE__ */ J(Gf, {
					activeId: p ?? t,
					onClose: () => d(!1)
				}),
				children: /* @__PURE__ */ Y(V, {
					variant: L.Ghost,
					size: B.Medium,
					content: o.Text,
					className: "!px-2 max-w-[320px]",
					onClick: () => d((e) => !e),
					"aria-expanded": u,
					"aria-label": "Switch project",
					children: [
						m ? /* @__PURE__ */ J(Rc, {
							id: y,
							size: 24,
							isRunning: b,
							className: "rounded-[2px]"
						}) : /* @__PURE__ */ J(Mi, {
							size: 24,
							isRunning: b
						}),
						/* @__PURE__ */ J("span", {
							className: z("truncate max-w-[120px]", b && "text-shimmer-basic"),
							children: _
						}),
						/* @__PURE__ */ J(M, {
							iconName: F.Down,
							className: z("transition-transform", u ? "rotate-180" : void 0)
						})
					]
				})
			}),
			a ? null : /* @__PURE__ */ J(Zt, {
				title: "New project",
				keyboardShortcuts: m ? void 0 : xr,
				position: Zt.Position.BottomCenter,
				children: /* @__PURE__ */ J(V, {
					variant: L.Ghost,
					size: B.Small,
					content: o.Icon,
					"aria-label": "New project",
					onClick: i.create,
					children: /* @__PURE__ */ J(M, { iconName: F.AddCircle })
				})
			})
		] }) : null]
	});
}
//#endregion
//#region src/app/components/HeaderMenu.tsx
var qf = "https://github.com/arcee-ai/nac", Jf = "https://github.com/arcee-ai/nac#readme";
function Yf({ onConfigurations: e, onSshConfigs: t, onManagedHost: n }) {
	let [r, i] = K(!1), a = Ue(), { data: s } = Gt(), c = s?.store_path ?? "store path pending", l = a ? Gc.Large : Gc.Medium, u = (e) => () => {
		i(!1), e();
	}, d = (e) => u(() => window.open(e, "_blank", "noopener"));
	return /* @__PURE__ */ J(Kn, {
		open: r,
		onClose: () => i(!1),
		placement: R.BottomLeft,
		size: "w-[280px]",
		panelClassName: "p-1",
		sheetClassName: "px-2",
		content: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2",
			children: [
				/* @__PURE__ */ Y("div", {
					className: z("flex items-center", a ? "h-16 gap-2 pl-4 pr-2" : "h-9 gap-1 pl-2"),
					children: [
						/* @__PURE__ */ J("span", {
							className: z("text-basic-primary shrink-0", a ? "label-medium" : "label-small"),
							children: "Store:"
						}),
						/* @__PURE__ */ J("span", {
							className: z("code text-info-primary flex-1 min-w-0 truncate", a ? "code-medium" : "code-small"),
							title: c,
							children: c
						}),
						/* @__PURE__ */ J(Ht, {
							value: c,
							size: B.Medium,
							variant: L.Ghost,
							title: "Copy the store path"
						})
					]
				}),
				/* @__PURE__ */ J(Q, {}),
				/* @__PURE__ */ Y(qc, {
					size: l,
					onClick: u(e),
					children: [/* @__PURE__ */ J(M, { iconName: F.Gear }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Configurations"
					})]
				}),
				/* @__PURE__ */ Y(qc, {
					size: l,
					onClick: u(t),
					children: [/* @__PURE__ */ J(M, { iconName: F.Globe }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "SSH configs"
					})]
				}),
				n ? /* @__PURE__ */ Y(qc, {
					size: l,
					onClick: u(n),
					children: [/* @__PURE__ */ J(M, { iconName: F.Server }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Managed host"
					})]
				}) : null,
				/* @__PURE__ */ J(Q, {}),
				/* @__PURE__ */ Y(qc, {
					size: l,
					onClick: d(Jf),
					children: [
						/* @__PURE__ */ J(M, { iconName: F.Book }),
						/* @__PURE__ */ J("span", {
							className: "text-left flex-grow",
							children: "See docs"
						}),
						/* @__PURE__ */ J(M, { iconName: F.External })
					]
				}),
				/* @__PURE__ */ Y(qc, {
					size: l,
					onClick: d(qf),
					children: [
						/* @__PURE__ */ J(M, { iconName: F.Github }),
						/* @__PURE__ */ J("span", {
							className: "text-left flex-grow",
							children: "See Github"
						}),
						/* @__PURE__ */ J(M, { iconName: F.External })
					]
				})
			]
		}),
		children: /* @__PURE__ */ J(V, {
			variant: L.Ghost,
			size: B.Medium,
			content: o.Icon,
			className: z(a && "btn-round"),
			onClick: () => i((e) => !e),
			"aria-expanded": r,
			"aria-label": r ? "Close the menu" : "Open the menu",
			children: /* @__PURE__ */ J(M, { iconName: r ? F.Close : F.Hamburger })
		})
	});
}
//#endregion
//#region src/app/components/McpServersButton.tsx
function Xf({ onOpen: e }) {
	let t = Ue(), { data: n } = Xt(), r = n?.servers.filter((e) => e.enabled).length ?? 0, i = r ? `MCP servers, ${r} active` : "MCP servers";
	return /* @__PURE__ */ Y("div", {
		className: "relative shrink-0",
		children: [t ? /* @__PURE__ */ J(bi, {
			variant: L.Ghost,
			content: o.Icon,
			"aria-label": i,
			onClick: e,
			children: /* @__PURE__ */ J(M, { iconName: F.Toolbox })
		}) : /* @__PURE__ */ Y(V, {
			variant: L.Secondary,
			size: B.Medium,
			content: o.IconLeft,
			"aria-label": i,
			onClick: e,
			children: [/* @__PURE__ */ J(M, { iconName: F.Toolbox }), "MCP"]
		}), r ? /* @__PURE__ */ J("span", {
			"aria-hidden": !0,
			className: "label-micro pointer-events-none absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 bg-btn-primary text-btn-primary",
			children: r
		}) : null]
	});
}
//#endregion
//#region src/app/components/SessionHeaderActions.tsx
function Zf() {
	let { toggleSidePanelExpanded: e } = me().stores.sessionLayoutStore, { pathname: t } = si(), n = zt(t);
	return !Ue() || !n ? null : /* @__PURE__ */ J(V, {
		variant: L.Ghost,
		size: B.Medium,
		content: o.Icon,
		className: "btn-round",
		"aria-label": "Open panel",
		onClick: e,
		children: /* @__PURE__ */ J(M, { iconName: F.OpenMobileModal })
	});
}
//#endregion
//#region src/app/components/modals/ConfigListNav.tsx
function Qf({ draftLabel: e, draftSelected: t, onSelectDraft: n, entries: r, selectedId: i, onSelect: a, isLoading: s = !1 }) {
	let c = Ue(), [l, u] = K(!1), d = t ? e : r.find((e) => e.id === i)?.name ?? e, f = () => {
		n(), u(!1);
	}, p = (e) => {
		a(e), u(!1);
	}, m = /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ Y(qc, {
			size: c ? Gc.Large : Gc.Medium,
			variant: Kc.Regular,
			active: t,
			onClick: f,
			children: [/* @__PURE__ */ J(M, { iconName: F.Add }), /* @__PURE__ */ J("span", {
				className: "text-left flex-grow truncate",
				children: e
			})]
		}),
		r.length ? /* @__PURE__ */ J(Q, {}) : null,
		r.map((e) => /* @__PURE__ */ J(qc, {
			size: c ? Gc.Large : Gc.Medium,
			active: i === e.id,
			onClick: () => p(e.id),
			children: /* @__PURE__ */ J("span", {
				className: "text-left flex-grow truncate",
				children: e.name
			})
		}, e.id)),
		s ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 px-2 py-1",
			children: [/* @__PURE__ */ J(Ce, { size: je.Micro }), /* @__PURE__ */ J("span", {
				className: "text-micro text-basic-muted",
				children: "Loading…"
			})]
		}) : null
	] });
	return c ? /* @__PURE__ */ J("div", {
		className: "shrink-0 border-b border-muted px-2 py-2",
		children: /* @__PURE__ */ J(Kn, {
			open: l,
			onClose: () => u(!1),
			placement: R.BottomLeft,
			size: "min-w-full",
			className: "w-full",
			panelClassName: "max-h-[50dvh] overflow-auto",
			content: /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1 px-2",
				children: m
			}),
			children: /* @__PURE__ */ Y(V, {
				variant: L.Ghost,
				size: B.Large,
				content: o.Icon,
				className: "w-full",
				"aria-expanded": l,
				"aria-label": "Choose configuration",
				onClick: () => u((e) => !e),
				children: [
					t ? /* @__PURE__ */ J(M, {
						iconName: F.Add,
						className: "shrink-0"
					}) : null,
					/* @__PURE__ */ J("span", {
						className: "text-left flex-grow truncate",
						children: d
					}),
					/* @__PURE__ */ J(M, {
						iconName: F.Down,
						className: z("shrink-0 transition-transform duration-150 ease-out", l ? "rotate-180" : "rotate-0")
					})
				]
			})
		})
	}) : /* @__PURE__ */ J("div", {
		className: "flex flex-col shrink-0 gap-2 w-[240px] overflow-y-auto border-r border-muted px-2 py-4 [&>*]:shrink-0",
		children: m
	});
}
//#endregion
//#region src/app/components/modals/ConfigurationsModal.tsx
var $f = ut.map((e) => ({
	id: e,
	label: n(e)
})), ep = ed.filter((e) => e.id !== Vu).map((e) => e.id === "" ? {
	...e,
	label: "Not set"
} : e), tp = "__new__";
function np({ open: e, onClose: t }) {
	return id(e) ? /* @__PURE__ */ J(rp, {
		open: e,
		onClose: t
	}) : null;
}
function rp({ open: e, onClose: t }) {
	let n = Ue(), { data: r, isLoading: i } = An(), a = W(() => r?.configurations ?? [], [r]), [o, s] = K(null), [c, l] = K(null), u = c ?? a.at(-1)?.config_id ?? tp, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: t,
		title: "Configurations",
		size: or.Large,
		flush: !0,
		className: "max-w-[820px] md:h-[720px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: o,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ J(Qf, {
				draftLabel: "New configuration",
				draftSelected: u === tp,
				onSelectDraft: () => l(tp),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: l,
				isLoading: i
			}), /* @__PURE__ */ J(ip, {
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
function ip({ record: e, takenNames: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: s }) {
	let c = un(), l = fn(), u = Tr(), d = ar(), f = e?.backend, [p, m] = K(f ?? "openai-responses"), [h, g] = K(e?.name ?? null), [_, v] = K(e?.base_url ?? ""), [y, b] = K(e?.allow_insecure_http ?? !1), [x, S] = K(""), [C, w] = K(e?.model ?? ""), [T, E] = K(e?.reasoning_effort ?? ""), [D, O] = K(e?.orchestrator_compaction_threshold?.toString() ?? ""), k = G(e?.orchestrator_compaction_threshold?.toString() ?? ""), ee = G(e?.orchestrator_compaction_threshold == null), [te, A] = K(() => e && Object.keys(e.extra_headers).length ? JSON.stringify(e.extra_headers, null, 2) : ""), [ne, re] = K(e?.initial_prompt ?? ""), [j, ie] = K({
		mode: e?.light_model ? "dual" : "single",
		light: e?.light_model ?? null
	}), [ae, oe] = K(""), se = h ?? ap(p, t), ce = lr(p), le = Gn(), ue = nd(gu(le.data, p, C).supportedEfforts, T, ep), de = W(() => {
		let e = gu(le.data, p, C).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		le.data,
		p,
		C
	]);
	U(() => {
		de !== "auto" && (k.current === "" || ee.current) && (ee.current = !0, k.current = de, O(de));
	}, [de]);
	let { signedIn: fe } = Pu(p), pe = fd(x.trim(), 600), N = sn(p, pe, null, ce && !!pe), me = bt(p, !ce && fe), he = tn(e && p === f ? e.config_id : null, ""), ge = ce && pe ? N.isFetching ? { status: "validating" } : N.error ? {
		status: "error",
		message: eu(N.error, p)
	} : N.data ? {
		status: "ready",
		models: N.data.models,
		baseUrl: N.data.base_url
	} : { status: "validating" } : { status: "idle" }, P = N.data?.models ?? me.data?.models ?? he.data?.models ?? [], _e = P.some((e) => e.id === C) ? C : C ?? "", ve = ge.status === "idle" ? e?.api_key_env ? "ready" : "idle" : ge.status, I = l.isPending || u.isPending || d.isPending, ye = (e) => (t) => {
		oe(""), e(t);
	}, be = async () => {
		if (I) return;
		if (!se.trim()) {
			oe("A name is required.");
			return;
		}
		if (!_e.trim()) {
			oe("A model is required.");
			return;
		}
		let t;
		try {
			t = Ju(te, {});
		} catch (e) {
			oe(Qn($(e)));
			return;
		}
		let n = D.trim() ? Number(D.trim()) : 0, i = T || null;
		if (!Number.isSafeInteger(n) || n < 0) {
			oe("The compaction threshold must be a whole number, or 0 to disable it.");
			return;
		}
		if (j.mode === "dual" && !j.light) {
			oe("Pick the light model before saving.");
			return;
		}
		let a = j.mode === "dual" ? j.light : null;
		try {
			if (e) {
				let o = {
					name: se.trim(),
					backend: p,
					model: _e.trim(),
					allow_insecure_http: y,
					reasoning_effort: i,
					extra_headers: t,
					orchestrator_compaction_threshold: n,
					initial_prompt: ne.trim() || null,
					light_model: a
				};
				x.trim() && (o.api_key = x.trim()), _.trim() && (o.base_url = _.trim());
				let s = await u.mutateAsync({
					configId: e.config_id,
					payload: o
				});
				r(s.config_id), c.success(`Configuration ${s.name} saved`);
			} else {
				let e = await l.mutateAsync({
					name: se.trim(),
					backend: p,
					model: _e.trim(),
					base_url: _.trim() || null,
					allow_insecure_http: y,
					api_key: ce ? x.trim() : null,
					reasoning_effort: i,
					extra_headers: t,
					orchestrator_compaction_threshold: n,
					initial_prompt: ne.trim() || null,
					light_model: a
				});
				r(e.config_id), c.success(`Configuration ${e.name} created`);
			}
		} catch (e) {
			oe(eu($(e), p));
		}
	}, xe = async () => {
		if (!(!e || I)) try {
			await d.mutateAsync(e.config_id), i(), c.success(`Configuration ${e.name} removed`);
		} catch (e) {
			oe(eu($(e)));
		}
	}, Se = G(be), Ce = G(xe);
	return Yr(() => {
		Se.current = be, Ce.current = xe;
	}), Yr(() => {
		let t = l.isPending || u.isPending;
		return a(/* @__PURE__ */ Y(q, { children: [
			e ? s ? /* @__PURE__ */ J(bi, {
				variant: L.SecondaryDestructive,
				content: o.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: I,
				loading: d.isPending,
				onClick: () => void Ce.current(),
				children: /* @__PURE__ */ J(M, { iconName: F.Trash })
			}) : /* @__PURE__ */ J(V, {
				variant: L.SecondaryDestructive,
				size: B.Large,
				content: o.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: I,
				loading: d.isPending,
				onClick: () => void Ce.current(),
				children: /* @__PURE__ */ J(M, { iconName: F.Trash })
			}) : null,
			s ? /* @__PURE__ */ J(bi, {
				variant: L.Secondary,
				content: o.Text,
				onClick: n,
				children: "Cancel"
			}) : /* @__PURE__ */ J(V, {
				variant: L.Ghost,
				size: B.Large,
				content: o.Text,
				onClick: n,
				children: "Cancel"
			}),
			s ? /* @__PURE__ */ J(bi, {
				variant: L.Primary,
				content: o.Text,
				disabled: I,
				loading: t,
				onClick: () => void Se.current(),
				children: "Save"
			}) : /* @__PURE__ */ J(V, {
				variant: L.Primary,
				size: B.Large,
				content: o.Text,
				disabled: I,
				loading: t,
				onClick: () => void Se.current(),
				children: "Save"
			})
		] })), () => a(null);
	}, [
		I,
		l.isPending,
		d.isPending,
		s,
		n,
		e,
		a,
		u.isPending
	]), /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: /* @__PURE__ */ Y("div", {
			className: z("flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", s && "pb-[88px]"),
			children: [
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col md:rounded-[8px] md:bg-elevation-level-2 md:border md:border-muted md:p-3 gap-4 md:gap-2",
					children: [
						/* @__PURE__ */ J(su, {
							label: "Model Provider",
							required: !0,
							hint: "Service that provides the models for this session.",
							control: /* @__PURE__ */ J(sd, {
								items: $f,
								value: p,
								onValueChange: (e) => {
									ye(m)(e), S(""), w("");
								}
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(su, {
							label: "Name",
							required: !0,
							hint: "How this setup is listed the next time a session is created.",
							verticalOnMobile: !0,
							control: /* @__PURE__ */ J(Z, {
								inputSize: s ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								"aria-label": "Configuration name",
								value: se,
								onChange: (e) => ye(g)(e.target.value)
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						ce ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(su, {
							label: "API Key",
							required: !0,
							invalid: ge.status === "error",
							verticalOnMobile: !0,
							hint: e ? "Held by NAC for this configuration; type a new key to replace it." : "Stored in NAC under a generated name once the setup is saved.",
							control: /* @__PURE__ */ J(Z, {
								inputSize: s ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								type: "password",
								autoComplete: "off",
								placeholder: e?.api_key_env ? cd : "Paste the provider key",
								leadingSlot: /* @__PURE__ */ J(Du, { status: ve }),
								validation: ge.status === "error",
								value: x,
								onChange: (e) => ye(S)(e.target.value)
							})
						}), /* @__PURE__ */ J(Q, {})] }) : null,
						/* @__PURE__ */ J(su, {
							label: "Base URL",
							hint: "Endpoint the session sends its requests to; blank uses the provider's own.",
							control: /* @__PURE__ */ J(Z, {
								inputSize: s ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "https://api.openai.com/v1",
								value: _,
								onChange: (e) => ye(v)(e.target.value)
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(su, {
							label: "Allow insecure HTTP",
							control: /* @__PURE__ */ Y("div", {
								className: "w-full md:w-[280px] flex flex-col items-start gap-1",
								children: [/* @__PURE__ */ J(al, {
									"aria-label": "Allow insecure HTTP",
									checked: y,
									onChange: ye(b)
								}), /* @__PURE__ */ J("p", {
									className: "body-small text-basic-secondary",
									children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
								})]
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(su, {
							label: "Default Model",
							required: !0,
							hint: "Sessions started from this setup begin with this default and may switch to another.",
							verticalOnMobile: !P.length,
							control: P.length ? /* @__PURE__ */ J(sd, {
								items: ld(P),
								value: _e,
								onValueChange: ye(w),
								placeholder: "No models offered"
							}) : /* @__PURE__ */ J(Z, {
								inputSize: s ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "gpt-5.5",
								value: C,
								onChange: (e) => ye(w)(e.target.value)
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(su, {
							label: "Reasoning Effort",
							hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
							control: /* @__PURE__ */ J(sd, {
								items: ue,
								value: T,
								onValueChange: ye(E)
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(su, {
							label: "Context Limit",
							verticalOnMobile: !0,
							labelClassName: "max-w-none",
							hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
							control: /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ J(Z, {
									inputSize: s ? X.Large : X.Medium,
									className: "w-full md:w-[105px]",
									inputClassName: "text-right",
									placeholder: de,
									inputMode: "numeric",
									value: D,
									onChange: (e) => {
										oe(""), ee.current = !1, k.current = e.target.value, O(e.target.value);
									}
								}), /* @__PURE__ */ J("span", {
									className: "shrink-0 text-micro text-basic-muted",
									children: "tokens"
								})]
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(Cd, {
							initial: e?.light_model ?? null,
							onChange: ie
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(nc, {
							label: "Extra headers (JSON object)",
							hintText: "Blank sends none; header values must be strings.",
							placeholder: "{\"X-Title\": \"NAC\"}",
							value: te,
							onChange: (e) => ye(A)(e.target.value),
							textAreaClassName: "h-[108px] resize-none"
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(nc, {
							label: "Initial prompt",
							hintText: "Pre-fills the first message of a session started from this setup.",
							placeholder: "Send a message",
							value: ne,
							onChange: (e) => ye(re)(e.target.value),
							textAreaClassName: "h-[92px] resize-none"
						})
					]
				}),
				/* @__PURE__ */ J(Iu, {
					backend: p,
					className: "mt-2"
				}),
				ae ? /* @__PURE__ */ J("p", {
					className: "label-micro text-error-primary pt-2",
					children: ae
				}) : null,
				/* @__PURE__ */ J("p", {
					className: "text-micro text-basic-muted pt-2",
					children: "* Required fields"
				})
			]
		})
	});
}
function ap(e, t) {
	let n = new Set(t);
	for (let t = 1;; t += 1) {
		let r = `${e}-config-${t}`;
		if (!n.has(r)) return r;
	}
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpEntryDetails.tsx
function op({ entry: e }) {
	let [t, n] = K(!1);
	return /* @__PURE__ */ J("div", {
		className: "flex items-center justify-center size-10 shrink-0 rounded-md bg-elevation-sublevel-variant-B overflow-hidden",
		children: e.icon_url && !t ? /* @__PURE__ */ J("img", {
			src: e.icon_url,
			alt: "",
			className: "size-8 object-contain",
			loading: "lazy",
			onError: () => n(!0)
		}) : /* @__PURE__ */ J("span", {
			className: "text-small text-basic-muted uppercase",
			children: e.name.charAt(0)
		})
	});
}
function sp({ entry: e }) {
	let [t, n] = K(!1), [r, i] = K(!1), a = G(null), o = e.description.replace(/\bDocs:\s*https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
	return Yr(() => {
		let e = a.current;
		e && i(e.scrollHeight > e.clientHeight);
	}, [o]), /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2 rounded-lg border border-muted p-3 bg-elevation-sublevel-variant-A",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 min-w-0",
			children: [
				/* @__PURE__ */ J(op, { entry: e }),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col min-w-0 flex-grow",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-2 min-w-0",
						children: [/* @__PURE__ */ J("span", {
							className: "header-small text-basic-primary truncate",
							children: e.name
						}), e.auth === "required_header" ? /* @__PURE__ */ J(vi, {
							text: "Key required",
							color: _i.Yellow
						}) : null]
					}), /* @__PURE__ */ J("span", {
						className: "tag-label text-basic-muted",
						children: e.category
					})]
				}),
				/* @__PURE__ */ Y("a", {
					href: e.docs_url,
					target: "_blank",
					rel: "noopener noreferrer",
					className: "flex items-center gap-1 shrink-0 text-small text-info-primary hover:underline",
					children: [/* @__PURE__ */ J(M, { iconName: F.BookOpen }), "Docs"]
				})
			]
		}), o ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
			ref: a,
			className: z("text-small text-basic-muted", !t && "line-clamp-3"),
			children: o
		}), r || t ? /* @__PURE__ */ J("button", {
			type: "button",
			className: "self-start text-small text-basic-primary hover:underline",
			onClick: () => n((e) => !e),
			children: t ? "Show less" : "Show more"
		}) : null] }) : null]
	});
}
//#endregion
//#region src/app/components/modals/ModalFooterButton.tsx
function cp({ isMobile: e, variant: t, content: n, className: r, disabled: i, onClick: a, children: s, ariaLabel: c }) {
	return e ? /* @__PURE__ */ J(bi, {
		variant: t,
		content: n ?? o.Text,
		className: r,
		disabled: i,
		"aria-label": c,
		onClick: a,
		children: s
	}) : /* @__PURE__ */ J(V, {
		size: B.Large,
		variant: t === L.Secondary ? L.Ghost : t,
		content: n,
		className: r,
		disabled: i,
		"aria-label": c,
		onClick: a,
		children: s
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpLibraryPicker.tsx
function lp({ onPick: e, onCustom: t, onClose: n, setFooter: r }) {
	let i = Ue(), { data: a } = Tn(), { data: s } = Xt(), [c, l] = K(""), [u, d] = K(null), f = W(() => {
		let e = [];
		for (let t of a?.entries ?? []) e.includes(t.category) || e.push(t.category);
		return e;
	}, [a]), p = W(() => {
		let e = /* @__PURE__ */ new Set(), t = /* @__PURE__ */ new Set();
		for (let n of s?.servers ?? []) n.library_id && e.add(n.library_id), t.add(n.name);
		return (n) => e.has(n.id) || t.has(n.name);
	}, [s]), m = W(() => {
		let e = (a?.entries ?? []).filter((e) => u === null || e.category === u), t = c.trim().toLowerCase();
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
		c,
		u
	]);
	return Yr(() => {
		if (!(!n || !r)) return r(/* @__PURE__ */ J(cp, {
			isMobile: i,
			variant: L.Secondary,
			onClick: n,
			children: "Close"
		})), () => r(null);
	}, [
		i,
		n,
		r
	]), /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: [/* @__PURE__ */ Y("div", {
			className: "shrink-0 flex flex-col gap-2",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 px-4 pt-4",
				children: [/* @__PURE__ */ J(Z, {
					className: "flex-1 min-w-0",
					inputSize: X.Medium,
					leading: Us.Icon,
					leadingIconName: F.Search,
					placeholder: "Search the library",
					value: c,
					onChange: (e) => l(e.target.value)
				}), /* @__PURE__ */ J(V, {
					size: B.Medium,
					variant: L.Secondary,
					content: o.Text,
					className: "shrink-0",
					onClick: t,
					children: i ? "Custom" : "Custom server"
				})]
			}), f.length > 1 ? /* @__PURE__ */ J("div", {
				className: "overflow-x-auto scrollbar-none [&>*]:shrink-0",
				children: /* @__PURE__ */ J("div", {
					className: "flex gap-1.5 px-4 py-2",
					children: [null, ...f].map((e) => /* @__PURE__ */ J(V, {
						size: i ? B.Medium : B.Small,
						variant: u === e ? L.Primary : L.Secondary,
						content: o.Text,
						"aria-pressed": u === e,
						onClick: () => d(e),
						className: i ? "!rounded-full" : "",
						children: e ?? "All"
					}, e ?? "all"))
				})
			}) : null]
		}), /* @__PURE__ */ J("div", {
			className: z("flex-1 overflow-auto px-4 pb-4 flex flex-col gap-2 [&>*]:shrink-0", i && n && "pb-[88px]"),
			children: m.map((t) => /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-2 [&>*]:shrink-0",
				children: [t.category === null ? null : /* @__PURE__ */ J("span", {
					className: "tag-label text-basic-muted pt-6 px-1",
					children: t.category
				}), t.entries.map((t) => {
					let n = p(t);
					return /* @__PURE__ */ Y(qc, {
						size: Gc.Large,
						disabled: n,
						className: z(n && "opacity-50", "!px-2"),
						onClick: () => e(t),
						children: [
							/* @__PURE__ */ J(op, { entry: t }),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col items-start text-left min-w-0 flex-grow py-1",
								children: [/* @__PURE__ */ Y("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ J("span", {
										className: "label-small text-basic-primary",
										children: t.name
									}), n ? /* @__PURE__ */ J(vi, {
										text: "Added",
										color: _i.Green
									}) : t.auth === "required_header" ? /* @__PURE__ */ J(vi, {
										text: "Key required",
										color: _i.Yellow
									}) : null]
								}), /* @__PURE__ */ J("span", {
									className: "text-micro text-basic-muted truncate w-full",
									children: t.description
								})]
							}),
							n ? null : /* @__PURE__ */ J(M, {
								iconName: F.Right,
								className: "shrink-0"
							})
						]
					}, t.id);
				})]
			}, t.category ?? "search"))
		})]
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpKvEditor.tsx
function up({ label: e, hint: t, keyPlaceholder: n, rows: r, onChange: i }) {
	let a = Ue(), s = (e, t) => {
		i(r.map((n, r) => r === e ? {
			...n,
			...t
		} : n));
	};
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-4 md:gap-2",
		children: [
			/* @__PURE__ */ J(ou, {
				label: e,
				hint: t
			}),
			r.map((e, t) => /* @__PURE__ */ Y("div", {
				className: "flex flex-col md:flex-row md:items-center gap-2 p-2 md:p-0 rounded-md bg-elevation-sublevel-variant-A shadow-convex md:shadow-none md:rounded-none md:bg-transparent",
				children: [
					/* @__PURE__ */ J(Z, {
						inputSize: a ? X.Large : X.Medium,
						className: "flex-1 min-w-0",
						placeholder: n,
						value: e.key,
						onChange: (e) => s(t, { key: e.target.value })
					}),
					/* @__PURE__ */ J(Z, {
						inputSize: a ? X.Large : X.Medium,
						className: "flex-1 min-w-0",
						placeholder: e.placeholder ?? "value",
						value: e.value,
						onChange: (e) => s(t, { value: e.target.value })
					}),
					/* @__PURE__ */ Y(V, {
						size: B.Medium,
						variant: L.GhostDestructive,
						content: a ? o.IconLeft : o.Icon,
						"aria-label": "Remove entry",
						onClick: () => i(r.filter((e, n) => n !== t)),
						className: a ? "self-end" : "",
						children: [a ? "Remove" : null, /* @__PURE__ */ J(M, { iconName: F.Trash })]
					})
				]
			}, t)),
			/* @__PURE__ */ Y(qc, {
				size: a ? Gc.Large : Gc.Medium,
				className: "!border !border-tertiary !border-dashed",
				onClick: () => i([...r, {
					key: "",
					value: ""
				}]),
				children: [/* @__PURE__ */ J(M, { iconName: F.Add }), "Add entry"]
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpOAuthPanel.tsx
function dp(e) {
	switch (e) {
		case "connected": return "Connected";
		case "connecting": return "Waiting for authorization";
		case "failed": return "Authorization failed";
		case "needs_authorization": return "Ready to connect";
		case "needs_configuration": return "Not configured";
		default: return "Checking…";
	}
}
function fp({ serverName: e }) {
	let { api: t } = me(), n = Ue(), [r, i] = K(null), [a, s] = K(null), [c, l] = K(!1), [u, d] = K(null), [f, p] = K(!1), [m, h] = K(""), [g, _] = K(""), [v, y] = K("pre_registered"), [b, x] = K(""), [S, C] = K("NAC MCP Client"), [w, T] = K("channels:history\nchat:write"), [E, D] = K(""), O = H(async (n = !1) => {
		try {
			let n = await t.getMcpOAuthStatus(e);
			i(n.status), s(n.message ?? null), d(n.authorization_url ?? null);
		} catch {
			n || i("failed"), s(n ? "OAuth status is temporarily unavailable. Retrying…" : "OAuth status is unavailable.");
		}
	}, [t, e]);
	U(() => {
		let e = window.setTimeout(() => void O(), 0);
		return () => window.clearTimeout(e);
	}, [O]), U(() => {
		if (r !== "connecting" && r !== "connected") return;
		let e = !1, t, n = async () => {
			await O(!0), e || (t = window.setTimeout(() => void n(), 1e3));
		};
		return t = window.setTimeout(() => void n(), 1e3), () => {
			e = !0, t !== void 0 && window.clearTimeout(t);
		};
	}, [O, r]);
	let k = async () => {
		if (v === "pre_registered" && !m.trim()) {
			s("A protected client ID credential name is required.");
			return;
		}
		if (v === "client_metadata" && !b.trim()) {
			s("A client metadata document URL is required.");
			return;
		}
		let n;
		try {
			n = E.trim() ? JSON.parse(E) : void 0;
		} catch {
			s("The authorization metadata override must be valid JSON.");
			return;
		}
		let r = v === "pre_registered" ? {
			type: "pre_registered",
			client_id_credential: m.trim(),
			client_secret_credential: g.trim() || void 0
		} : v === "client_metadata" ? {
			type: "client_metadata",
			url: b.trim()
		} : {
			type: "dynamic",
			client_name: S.trim() || void 0
		};
		l(!0), s(null);
		try {
			let a = await t.configureMcpOAuth(e, {
				registration: r,
				scopes: w.split("\n").map((e) => e.trim()).filter(Boolean),
				authorization_metadata: n
			});
			i(a.status), d(a.authorization_url ?? null), p(!1), h(""), _("");
		} catch {
			s("OAuth configuration was rejected. Check the protected credential names.");
		} finally {
			l(!1);
		}
	}, ee = async () => {
		l(!0), s(null), d(null);
		try {
			let n = await t.authenticateMcpOAuth(e);
			i(n.status), d(n.authorization_url);
		} catch {
			i("failed"), s("OAuth authentication could not start.");
		} finally {
			l(!1);
		}
	}, te = async () => {
		l(!0), s(null), d(null);
		try {
			let n = await t.logoutMcpOAuth(e);
			i(n.status);
		} catch {
			s("OAuth logout could not complete.");
		} finally {
			l(!1);
		}
	};
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-3 p-4 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex items-center justify-between gap-3",
				children: [/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("div", {
					className: "text-medium text-basic-primary",
					children: "OAuth"
				}), /* @__PURE__ */ J("div", {
					className: "text-small text-basic-muted",
					children: "Authorization Code with PKCE. Tokens and callback state stay in protected local storage."
				})] }), /* @__PURE__ */ J("span", {
					className: "text-small text-basic-muted",
					children: dp(r)
				})]
			}),
			r === "needs_configuration" || f ? /* @__PURE__ */ Y(q, { children: [
				/* @__PURE__ */ Y("div", {
					className: "grid md:grid-cols-2 gap-3",
					children: [
						/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ J(ou, {
								label: "Client registration",
								required: !0
							}), /* @__PURE__ */ Y("select", {
								className: "h-10 rounded-md border border-border-subtle bg-elevation-surface px-3 text-small text-basic-primary",
								value: v,
								onChange: (e) => y(e.target.value),
								children: [
									/* @__PURE__ */ J("option", {
										value: "pre_registered",
										children: "Pre-registered client"
									}),
									/* @__PURE__ */ J("option", {
										value: "client_metadata",
										children: "Client metadata document (SEP-991)"
									}),
									/* @__PURE__ */ J("option", {
										value: "dynamic",
										children: "Dynamic client registration"
									})
								]
							})]
						}),
						v === "pre_registered" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ J(ou, {
								label: "Client ID credential",
								required: !0
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: m,
								placeholder: "SLACK_MCP_CLIENT_ID",
								onChange: (e) => h(e.target.value)
							})]
						}), /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ J(ou, {
								label: "Client secret credential",
								hint: "Optional for public clients."
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: g,
								placeholder: "SLACK_MCP_CLIENT_SECRET",
								onChange: (e) => _(e.target.value)
							})]
						})] }) : null,
						v === "client_metadata" ? /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ J(ou, {
								label: "Client metadata URL",
								required: !0
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: b,
								placeholder: "https://nac.example.com/.well-known/oauth-client.json",
								onChange: (e) => x(e.target.value)
							})]
						}) : null,
						v === "dynamic" ? /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ J(ou, {
								label: "Client name",
								hint: "Sent to the authorization server."
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: S,
								onChange: (e) => C(e.target.value)
							})]
						}) : null
					]
				}),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ J(ou, {
						label: "Scopes",
						hint: "One scope per line."
					}), /* @__PURE__ */ J(nc, {
						textAreaClassName: "min-h-[64px] font-mono text-small",
						value: w,
						onChange: (e) => T(e.target.value)
					})]
				}),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ J(ou, {
						label: "Authorization metadata override",
						hint: "Optional JSON for servers without discovery metadata."
					}), /* @__PURE__ */ J(nc, {
						textAreaClassName: "min-h-[72px] font-mono text-small",
						value: E,
						placeholder: v === "client_metadata" ? "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\",\"client_id_metadata_document_supported\":true}" : "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\"}",
						onChange: (e) => D(e.target.value)
					})]
				}),
				/* @__PURE__ */ J("div", {
					className: "flex justify-end",
					children: /* @__PURE__ */ J(V, {
						size: B.Medium,
						variant: L.Secondary,
						content: o.Text,
						disabled: c,
						onClick: () => void k(),
						children: "Configure OAuth"
					})
				})
			] }) : null,
			r && r !== "needs_configuration" && r !== "connecting" && !f ? /* @__PURE__ */ J("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ J(V, {
					size: B.Medium,
					variant: L.Ghost,
					content: o.Text,
					disabled: c,
					onClick: () => p(!0),
					children: "Edit OAuth configuration"
				})
			}) : null,
			r === "needs_authorization" || r === "failed" ? /* @__PURE__ */ J("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ J(V, {
					size: B.Medium,
					variant: L.Secondary,
					content: o.Text,
					disabled: c,
					onClick: () => void ee(),
					children: "Authenticate"
				})
			}) : null,
			u ? /* @__PURE__ */ J("a", {
				className: "text-small text-accent-primary underline self-end",
				href: u,
				target: "_blank",
				rel: "noreferrer",
				children: "Continue OAuth authorization"
			}) : null,
			r === "connected" || r === "connecting" ? /* @__PURE__ */ J("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ J(V, {
					size: B.Medium,
					variant: L.SecondaryDestructive,
					content: o.Text,
					disabled: c,
					onClick: () => void te(),
					children: r === "connected" ? "Log out" : "Cancel authorization"
				})
			}) : null,
			a ? /* @__PURE__ */ J("div", {
				className: "text-small text-error-primary",
				children: a
			}) : null
		]
	});
}
//#endregion
//#region src/app/lib/mcpKvRows.ts
function pp(e) {
	return Object.entries(e).map(([e, t]) => ({
		key: e,
		value: "",
		storedKey: e,
		placeholder: t
	}));
}
function mp(e) {
	let t = {};
	for (let n of e) {
		let e = n.key.trim();
		if (e) {
			if (!n.value) {
				n.storedKey && (t[e] = null);
				continue;
			}
			t[e] = n.value;
		}
	}
	return t;
}
function hp(e) {
	let t = {};
	for (let [n, r] of Object.entries(e)) r !== null && (t[n] = r);
	return t;
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpServerForm.tsx
var gp = [{
	id: "streamable_http",
	label: "Streamable HTTP"
}, {
	id: "stdio",
	label: "Stdio"
}], _p = [
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
function vp(e) {
	return e.split("\n").map((e) => e.trim()).filter(Boolean);
}
function yp(e) {
	return e === "stdio" || e === "streamable_http" ? e : "streamable_http";
}
function bp(e) {
	return e.trim() ? Number(e) : null;
}
function xp({ record: e, template: t, libraryEntry: n, onBack: r, onClose: i, onSaved: a, onDeleted: s, setFooter: c }) {
	let l = Ue(), u = un(), d = er(), f = m(), p = Bn(), h = He(), g = Vt(), _ = hr(), [v, y] = K(e?.name ?? t?.name ?? ""), [b, x] = K(e?.enabled ?? !0), [S, C] = K(e?.required ?? !1), [w, T] = K(e?.protocol ?? "legacy"), [E, D] = K(() => yp(e?.transport ?? t?.transport)), [O, k] = K(e?.url ?? t?.url ?? ""), [ee, te] = K(e?.command ?? ""), [A, ne] = K(e?.args.join("\n") ?? ""), [re, j] = K(e?.cwd ?? ""), [ie, ae] = K(e?.env_vars.join("\n") ?? ""), [oe, se] = K(e?.startup_timeout_ms?.toString() ?? ""), [ce, le] = K(e?.catalog_timeout_ms?.toString() ?? ""), [ue, de] = K(e?.execution_timeout_ms?.toString() ?? ""), [fe, pe] = K(() => e ? pp(e.headers) : t?.auth_header ? [{
		key: t.auth_header,
		value: "",
		placeholder: t.auth_hint ?? void 0
	}] : []), [N, me] = K(e ? pp(e.env) : []), [he, ge] = K(() => Object.entries(e?.env_headers ?? {}).map(([e, t]) => ({
		key: e,
		value: t
	}))), [P, _e] = K(e?.bearer_token_env_var ?? ""), [ve, I] = K(e?.header_helper?.command ?? ""), [ye, be] = K(e?.header_helper?.args?.join("\n") ?? ""), [xe, Se] = K(e?.header_helper?.cwd ?? ""), [Ce, we] = K(() => e?.header_helper ? pp(e.header_helper.env ?? {}) : []), [Te, Ee] = K(e?.header_helper?.env_vars?.join("\n") ?? ""), [De, R] = K(e?.header_helper?.timeout_ms?.toString() ?? ""), [Oe, ke] = K(null), Ae = g.data?.servers.find((t) => t.name === e?.name), je = d.isPending || f.isPending || p.isPending || h.isPending || _.isPending, Me = () => v.trim() ? E === "streamable_http" && !O.trim() ? "A URL is required." : E === "stdio" && !ee.trim() ? "A command is required." : null : "A name is required.", Ne = async () => {
		let n = Me();
		if (n) {
			u.error(n);
			return;
		}
		let r = mp(fe), i = mp(N), o = ve.trim() ? {
			command: ve.trim(),
			args: vp(ye),
			cwd: xe.trim() || null,
			env: mp(Ce),
			env_vars: vp(Te),
			timeout_ms: bp(De)
		} : null;
		try {
			e ? (a((await f.mutateAsync({
				serverName: e.name,
				payload: {
					name: v.trim(),
					enabled: b,
					required: S,
					startup_timeout_ms: bp(oe),
					catalog_timeout_ms: bp(ce),
					execution_timeout_ms: bp(ue),
					protocol: w,
					transport: E,
					command: E === "stdio" ? ee.trim() : null,
					args: E === "stdio" ? vp(A) : [],
					env: E === "stdio" ? i : {},
					env_vars: E === "stdio" ? vp(ie) : [],
					cwd: E === "stdio" && re.trim() || null,
					url: E === "streamable_http" ? O.trim() : null,
					headers: E === "streamable_http" ? r : {},
					env_headers: E === "streamable_http" ? hp(mp(he)) : {},
					bearer_token_env_var: E === "streamable_http" && P.trim() || null,
					header_helper: E === "streamable_http" ? o : null
				}
			})).name), u.success("MCP server updated.")) : (a((await d.mutateAsync({
				name: v.trim(),
				enabled: b,
				required: S,
				startup_timeout_ms: bp(oe),
				catalog_timeout_ms: bp(ce),
				execution_timeout_ms: bp(ue),
				protocol: w,
				transport: E,
				command: E === "stdio" ? ee.trim() : null,
				args: E === "stdio" ? vp(A) : [],
				env: E === "stdio" ? hp(i) : {},
				env_vars: E === "stdio" ? vp(ie) : [],
				cwd: E === "stdio" && re.trim() || null,
				url: E === "streamable_http" ? O.trim() : null,
				headers: E === "streamable_http" ? hp(r) : {},
				env_headers: E === "streamable_http" ? hp(mp(he)) : {},
				bearer_token_env_var: E === "streamable_http" && P.trim() || null,
				header_helper: E === "streamable_http" && o ? {
					...o,
					env: hp(o.env)
				} : null,
				library_id: t?.id ?? null
			})).name), u.success("MCP server saved."));
		} catch (e) {
			u.error(`Save failed: ${Qn($(e))}`);
		}
	}, Pe = async () => {
		if (e) try {
			await p.mutateAsync(e.name), s(), u.success("MCP server deleted.");
		} catch (e) {
			u.error(`Delete failed: ${Qn($(e))}`);
		}
	}, Fe = async (t) => {
		if (e) try {
			let n = await _.mutateAsync({
				serverName: e.name,
				action: t
			});
			n.state === "failed" ? u.error(n.error ?? "MCP runtime operation failed.") : u.success(`MCP server is ${n.state}.`);
		} catch (e) {
			u.error(`Runtime operation failed: ${Qn($(e))}`);
		}
	}, Ie = async () => {
		let t = E === "streamable_http" && !O.trim() ? "A URL is required to test." : E === "stdio" && !ee.trim() ? "A command is required to test." : null;
		if (t) {
			u.error(t);
			return;
		}
		ke(null);
		try {
			let t = await h.mutateAsync({
				stored_name: e?.name ?? null,
				name: v.trim() || null,
				transport: E,
				command: E === "stdio" ? ee.trim() : null,
				args: E === "stdio" ? vp(A) : [],
				env: E === "stdio" ? mp(N) : {},
				env_vars: E === "stdio" ? vp(ie) : [],
				cwd: E === "stdio" && re.trim() || null,
				url: E === "streamable_http" ? O.trim() : null,
				headers: E === "streamable_http" ? mp(fe) : {},
				env_headers: E === "streamable_http" ? hp(mp(he)) : {},
				bearer_token_env_var: E === "streamable_http" && P.trim() || null,
				header_helper: E === "streamable_http" && ve.trim() ? {
					command: ve.trim(),
					args: vp(ye),
					cwd: xe.trim() || null,
					env: mp(Ce),
					env_vars: vp(Te),
					timeout_ms: bp(De)
				} : null,
				startup_timeout_ms: bp(oe),
				catalog_timeout_ms: bp(ce),
				execution_timeout_ms: bp(ue),
				protocol: w
			});
			if (!t.connected) {
				u.error(`Test failed: ${t.error ?? "connection failed"}`);
				return;
			}
			ke(t.tools), u.success(`Connection succeeded: ${t.tools.length} tool${t.tools.length === 1 ? "" : "s"} found.`);
		} catch (e) {
			u.error(`Test failed: ${Qn($(e))}`);
		}
	}, Le = G(Ne), Re = G(Pe), ze = G(i);
	return Yr(() => {
		Le.current = Ne, Re.current = Pe, ze.current = i;
	}), Yr(() => (c(/* @__PURE__ */ Y(q, { children: [
		e ? /* @__PURE__ */ J(cp, {
			isMobile: l,
			variant: L.SecondaryDestructive,
			content: o.Icon,
			className: "mr-auto",
			ariaLabel: "Delete server",
			disabled: je,
			onClick: () => void Re.current(),
			children: /* @__PURE__ */ J(M, { iconName: F.Trash })
		}) : null,
		/* @__PURE__ */ J(cp, {
			isMobile: l,
			variant: L.Secondary,
			onClick: () => ze.current(),
			children: "Cancel"
		}),
		/* @__PURE__ */ J(cp, {
			isMobile: l,
			variant: L.Primary,
			disabled: je,
			onClick: () => void Le.current(),
			children: "Save"
		})
	] })), () => c(null)), [
		l,
		je,
		e,
		c
	]), /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: [r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-1 shrink-0 border-b border-muted px-2 py-2",
			children: [/* @__PURE__ */ J(V, {
				size: B.Medium,
				variant: L.Ghost,
				content: o.Icon,
				"aria-label": "Back to library",
				onClick: r,
				children: /* @__PURE__ */ J(M, { iconName: F.Left })
			}), /* @__PURE__ */ J("span", {
				className: "text-medium text-basic-primary truncate",
				children: v.trim() || "Custom server"
			})]
		}) : null, /* @__PURE__ */ Y("div", {
			className: z("flex-1 overflow-auto p-4 flex flex-col gap-4 [&>*]:shrink-0", l && "pb-[88px]"),
			children: [
				n ? /* @__PURE__ */ J(sp, { entry: n }) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col md:flex-row gap-4",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 flex-grow",
						children: [/* @__PURE__ */ J(ou, {
							label: "Name",
							required: !0
						}), /* @__PURE__ */ J(Z, {
							inputSize: l ? X.Large : X.Medium,
							placeholder: "my_server",
							value: v,
							onChange: (e) => y(e.target.value)
						})]
					}), /* @__PURE__ */ J("div", {
						className: "md:pt-6",
						children: /* @__PURE__ */ Y("div", {
							className: "flex gap-4 items-center px-4 py-2 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
							children: [
								/* @__PURE__ */ J(ou, {
									label: "Enabled",
									hint: "Disabled servers are kept but not connected when a session starts."
								}),
								/* @__PURE__ */ J(al, {
									checked: b,
									size: l ? tl.Large : tl.Medium,
									onChange: x
								}),
								/* @__PURE__ */ J(ou, {
									label: "Required",
									hint: "Fail session admission when this enabled server cannot start."
								}),
								/* @__PURE__ */ J(al, {
									checked: S,
									size: l ? tl.Large : tl.Medium,
									onChange: C
								})
							]
						})
					})]
				}),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-4 p-4 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
					children: [
						/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ J(ou, { label: "Transport" }), /* @__PURE__ */ J("div", {
								className: "flex gap-2",
								children: gp.map((e) => /* @__PURE__ */ J(V, {
									size: l ? B.Medium : B.Small,
									variant: E === e.id ? L.Primary : L.Secondary,
									content: o.Text,
									"aria-pressed": E === e.id,
									onClick: () => D(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ J(ou, {
								label: "Protocol",
								hint: _p.find((e) => e.id === w)?.hint
							}), /* @__PURE__ */ J("div", {
								className: "flex flex-wrap gap-2",
								children: _p.map((e) => /* @__PURE__ */ J(V, {
									size: l ? B.Medium : B.Small,
									variant: w === e.id ? L.Primary : L.Secondary,
									content: o.Text,
									"aria-pressed": w === e.id,
									onClick: () => T(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						E === "streamable_http" ? /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(ou, {
									label: "URL",
									required: !0
								}), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									placeholder: "https://example.com/mcp",
									value: O,
									onChange: (e) => k(e.target.value)
								})]
							}),
							/* @__PURE__ */ J(up, {
								label: "Headers",
								hint: "Sent with every request. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "Authorization",
								rows: fe,
								onChange: pe
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(ou, {
									label: "Bearer token environment variable",
									hint: "The variable value is sent as a Bearer token without persisting it."
								}), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									placeholder: "MCP_TOKEN",
									value: P,
									onChange: (e) => _e(e.target.value)
								})]
							}),
							/* @__PURE__ */ J(up, {
								label: "Environment-backed headers",
								hint: "Map each HTTP header name to the environment variable that supplies its value.",
								keyPlaceholder: "X-API-Key",
								rows: he,
								onChange: ge
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(ou, {
									label: "Header helper command",
									hint: "Optional bounded command that prints a JSON object of same-origin request headers."
								}), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									placeholder: "./refresh-mcp-headers",
									value: ve,
									onChange: (e) => I(e.target.value)
								})]
							}),
							ve.trim() ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(ou, {
										label: "Header helper arguments",
										hint: "One argument per line."
									}), /* @__PURE__ */ J(nc, {
										textAreaClassName: "min-h-[64px] font-mono",
										value: ye,
										onChange: (e) => be(e.target.value)
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(ou, { label: "Header helper working directory" }), /* @__PURE__ */ J(Z, {
										inputSize: l ? X.Large : X.Medium,
										value: xe,
										onChange: (e) => Se(e.target.value)
									})]
								}),
								/* @__PURE__ */ J(up, {
									label: "Header helper environment",
									hint: "Stored literals remain write-only.",
									keyPlaceholder: "TOKEN",
									rows: Ce,
									onChange: we
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(ou, {
										label: "Header helper forwarded environment",
										hint: "One variable name per line."
									}), /* @__PURE__ */ J(nc, {
										textAreaClassName: "min-h-[64px] font-mono",
										value: Te,
										onChange: (e) => Ee(e.target.value)
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(ou, { label: "Header helper timeout (ms)" }), /* @__PURE__ */ J(Z, {
										inputSize: l ? X.Large : X.Medium,
										type: "number",
										min: 100,
										max: 6e5,
										value: De,
										onChange: (e) => R(e.target.value)
									})]
								})
							] }) : null
						] }) : /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(ou, {
									label: "Command",
									required: !0
								}), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									placeholder: "npx",
									value: ee,
									onChange: (e) => te(e.target.value)
								})]
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(ou, {
									label: "Arguments",
									hint: "One argument per line."
								}), /* @__PURE__ */ J(nc, {
									textAreaClassName: z("min-h-[72px] font-mono", l ? "text-medium" : "text-small"),
									placeholder: "-y\nsome-mcp-server",
									value: A,
									onChange: (e) => ne(e.target.value)
								})]
							}),
							/* @__PURE__ */ J(up, {
								label: "Environment",
								hint: "Set for the server process. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "API_KEY",
								rows: N,
								onChange: me
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(ou, {
									label: "Working directory",
									hint: "Relative paths resolve from the workspace."
								}), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									placeholder: "packages/server",
									value: re,
									onChange: (e) => j(e.target.value)
								})]
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(ou, {
									label: "Forward environment variables",
									hint: "One existing host variable name per line."
								}), /* @__PURE__ */ J(nc, {
									textAreaClassName: "min-h-[64px] font-mono",
									value: ie,
									onChange: (e) => ae(e.target.value)
								})]
							})
						] }),
						/* @__PURE__ */ J("div", {
							className: "grid grid-cols-1 md:grid-cols-3 gap-3",
							children: [
								[
									"Startup timeout (ms)",
									oe,
									se
								],
								[
									"Catalog timeout (ms)",
									ce,
									le
								],
								[
									"Execution timeout (ms)",
									ue,
									de
								]
							].map(([e, t, n]) => /* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(ou, { label: e }), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									type: "number",
									min: 100,
									max: 6e5,
									value: t,
									onChange: (e) => n(e.target.value)
								})]
							}, e))
						}),
						e ? /* @__PURE__ */ Y("div", {
							className: "flex flex-wrap items-center gap-2",
							children: [/* @__PURE__ */ Y("span", {
								className: "text-small text-basic-muted",
								children: [
									"Runtime: ",
									Ae?.state ?? "disconnected",
									Ae?.error ? ` — ${Ae.error}` : ""
								]
							}), [
								"connect",
								"disconnect",
								"reload"
							].map((e) => /* @__PURE__ */ J(V, {
								size: B.Small,
								variant: L.Secondary,
								disabled: je,
								onClick: () => void Fe(e),
								children: e[0].toUpperCase() + e.slice(1)
							}, e))]
						}) : null,
						/* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2 justify-end",
							children: [/* @__PURE__ */ Y(V, {
								size: B.Medium,
								variant: L.Secondary,
								disabled: je,
								onClick: () => void Ie(),
								content: o.IconLeft,
								children: [/* @__PURE__ */ J(M, { iconName: F.Bolt }), h.isPending ? "Testing…" : "Test connection"]
							}), Oe ? /* @__PURE__ */ Y("span", {
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
				e && E === "streamable_http" ? /* @__PURE__ */ J(fp, { serverName: e.name }) : null,
				Oe && Oe.length ? /* @__PURE__ */ J("div", {
					className: "flex flex-col gap-1",
					children: Oe.map((e) => /* @__PURE__ */ Y("div", {
						className: "flex items-baseline gap-2 min-w-0",
						children: [/* @__PURE__ */ J("span", {
							className: "code code-small text-basic-primary shrink-0",
							children: e.name
						}), e.description ? /* @__PURE__ */ J("span", {
							className: "text-small text-basic-muted truncate",
							children: e.description
						}) : null]
					}, e.name))
				}) : null
			]
		})]
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpServersLoadError.tsx
function Sp({ error: e, retrying: t, onRetry: n }) {
	let r = e instanceof Error ? e.message : "The MCP configuration could not be read.";
	return /* @__PURE__ */ Y("div", {
		className: "flex h-full min-h-0 flex-col items-start justify-center gap-3 overflow-auto p-6",
		children: [
			/* @__PURE__ */ J("div", {
				className: "label-small text-error-primary",
				children: "MCP servers could not be loaded."
			}),
			/* @__PURE__ */ J("p", {
				className: "max-w-full whitespace-pre-wrap break-words text-micro text-basic-secondary",
				children: r
			}),
			/* @__PURE__ */ J(V, {
				variant: L.Secondary,
				size: B.Small,
				content: o.Text,
				loading: t,
				onClick: n,
				children: "Try again"
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpServersMobile.tsx
function Cp({ open: e, onClose: t }) {
	let { data: n } = Tn(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = Xt(), l = r?.servers ?? [], [u, d] = K(!1), [f, p] = K(null), [m, h] = K(null), [g, _] = K(null), v = l.find((e) => e.name === m) ?? null, y = f?.template ?? null, b = y ?? (v ? n?.entries.find((e) => e.id === v.library_id || e.name === v.name) ?? null : null), x = () => {
		p(null), h(null), d(!1);
	}, S = () => {
		p(null), h(null);
	};
	return /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ J(Vn, {
			open: e,
			onClose: t,
			title: "MCP servers",
			children: a ? /* @__PURE__ */ J(Sp, {
				error: i,
				retrying: o,
				onRetry: () => {
					c();
				}
			}) : /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1 [&>*]:shrink-0",
				children: [
					/* @__PURE__ */ Y(qc, {
						size: Gc.Large,
						onClick: () => d(!0),
						children: [
							/* @__PURE__ */ J(M, { iconName: F.Add }),
							/* @__PURE__ */ J("span", {
								className: "text-left flex-grow truncate",
								children: "Add server"
							}),
							/* @__PURE__ */ J(M, {
								iconName: F.Right,
								className: "shrink-0"
							})
						]
					}),
					l.length ? /* @__PURE__ */ J(Q, {}) : null,
					l.map((e) => /* @__PURE__ */ Y(qc, {
						size: Gc.Large,
						onClick: () => h(e.name),
						children: [/* @__PURE__ */ J("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						}), /* @__PURE__ */ J(M, {
							iconName: F.Right,
							className: "shrink-0"
						})]
					}, e.name)),
					s ? /* @__PURE__ */ Y("div", {
						className: "flex items-center gap-2 px-2 py-1",
						children: [/* @__PURE__ */ J(Ce, { size: je.Micro }), /* @__PURE__ */ J("span", {
							className: "text-micro text-basic-muted",
							children: "Loading…"
						})]
					}) : null
				]
			})
		}),
		/* @__PURE__ */ J(Vn, {
			open: u,
			onClose: () => d(!1),
			title: "Add server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			children: /* @__PURE__ */ J(lp, {
				onPick: (e) => p({ template: e }),
				onCustom: () => p({ template: null })
			})
		}),
		/* @__PURE__ */ J(Vn, {
			open: f !== null || m !== null,
			onClose: S,
			title: v?.name ?? y?.name ?? "Custom server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			footer: g,
			children: /* @__PURE__ */ J(xp, {
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
//#endregion
//#region src/app/components/modals/MCPServersModal/McpServersModal.tsx
var wp = "__new__";
function Tp({ open: e, onClose: t }) {
	let n = id(e), r = Ue();
	return n ? J(r ? Cp : Ep, {
		open: e,
		onClose: t
	}) : null;
}
function Ep({ open: e, onClose: t }) {
	let { data: n } = Tn(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = Xt(), l = W(() => r?.servers ?? [], [r]), [u, d] = K(null), [f, p] = K(null), [m, h] = K(!1), [g, _] = K(null), v = u ?? l.at(-1)?.name ?? wp, y = l.find((e) => e.name === v) ?? null, b = v === wp, x = (e) => {
		d(e), p(null), h(!1);
	}, S = f ?? (y ? n?.entries.find((e) => e.id === y.library_id || e.name === y.name) ?? null : null);
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: t,
		title: "MCP servers",
		size: or.Large,
		flush: !0,
		className: "md:h-[740px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: g,
		children: a ? /* @__PURE__ */ J(Sp, {
			error: i,
			retrying: o,
			onRetry: () => {
				c();
			}
		}) : /* @__PURE__ */ Y("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ J(Qf, {
				draftLabel: "Add server",
				draftSelected: b,
				onSelectDraft: () => x(wp),
				entries: l.map((e) => ({
					id: e.name,
					name: e.name
				})),
				selectedId: v,
				onSelect: x,
				isLoading: s
			}), b && !f && !m ? /* @__PURE__ */ J(lp, {
				onPick: (e) => p(e),
				onCustom: () => h(!0),
				onClose: t,
				setFooter: _
			}) : /* @__PURE__ */ J(xp, {
				record: y,
				template: f,
				libraryEntry: S,
				onBack: () => {
					d(wp), p(null), h(!1);
				},
				onClose: t,
				onSaved: x,
				onDeleted: () => x(wp),
				setFooter: _
			}, y ? y.name : f?.id ?? "custom")]
		})
	});
}
//#endregion
//#region src/app/components/modals/SshConfigsModal.tsx
var Dp = "__new__";
function Op(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function kp({ open: e, onClose: t }) {
	return id(e) ? /* @__PURE__ */ J(Ap, {
		open: e,
		onClose: t
	}) : null;
}
function Ap({ open: e, onClose: t }) {
	let n = Ue(), { data: r, isLoading: i } = jt(), a = W(() => r?.configurations ?? [], [r]), [o, s] = K(null), [c, l] = K(null), u = o ?? a.at(-1)?.config_id ?? Dp, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: t,
		title: "SSH configs",
		size: or.Large,
		flush: !0,
		className: "max-w-[780px] md:h-[480px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: c,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ J(Qf, {
				draftLabel: "Create New",
				draftSelected: u === Dp,
				onSelectDraft: () => s(Dp),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: s,
				isLoading: i
			}), /* @__PURE__ */ J(jp, {
				record: d,
				defaultName: Op(a),
				onClose: t,
				onSaved: s,
				onDeleted: () => s(Dp),
				setFooter: l,
				isMobile: n
			}, u)]
		})
	});
}
function jp({ record: e, defaultName: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: s }) {
	let c = un(), l = Dt(), u = qe(), d = It(), f = Ar(), [p, m] = K(e?.name ?? t), [h, g] = K(e?.ssh_host ?? ""), [_, v] = K(e?.ssh_port ? String(e.ssh_port) : ""), [y, b] = K(e?.ssh_identity_file ?? ""), x = l.isPending || u.isPending || d.isPending || f.isPending, S = async () => {
		let t = p.trim(), n = h.trim();
		if (!t || !n) {
			c.error("Name and SSH host are required.");
			return;
		}
		let i = _.trim() ? Number(_.trim()) : null;
		if (_.trim() && (!Number.isInteger(i) || (i ?? 0) < 1 || (i ?? 0) > 65535)) {
			c.error("Port must be an integer between 1 and 65535.");
			return;
		}
		try {
			e ? (await u.mutateAsync({
				configId: e.config_id,
				payload: {
					name: t,
					ssh_host: n,
					ssh_port: i,
					ssh_identity_file: y.trim() || null
				}
			}), c.success("SSH config updated.")) : (r((await l.mutateAsync({
				name: t,
				ssh_host: n,
				ssh_port: i,
				ssh_identity_file: y.trim() || null
			})).config_id), c.success("SSH config saved."));
		} catch (e) {
			c.error(`Save failed: ${Qn($(e))}`);
		}
	}, C = async () => {
		if (e) try {
			await d.mutateAsync(e.config_id), i(), c.success("SSH config deleted.");
		} catch (e) {
			c.error(`Delete failed: ${Qn($(e))}`);
		}
	}, w = async () => {
		let e = h.trim();
		if (!e) {
			c.error("An SSH host is required to test.");
			return;
		}
		let t = _.trim() ? Number(_.trim()) : null;
		await f.mutateAsync({
			ssh_host: e,
			ssh_port: t,
			ssh_identity_file: y.trim() || null
		}), c.success("SSH connection succeeded.");
	}, T = G(S), E = G(C);
	return Yr(() => {
		T.current = S, E.current = C;
	}), Yr(() => (a(/* @__PURE__ */ Y(q, { children: [
		e ? s ? /* @__PURE__ */ J(bi, {
			variant: L.SecondaryDestructive,
			content: o.Icon,
			className: "mr-auto",
			disabled: x,
			onClick: () => void E.current(),
			children: /* @__PURE__ */ J(M, { iconName: F.Trash })
		}) : /* @__PURE__ */ J(V, {
			size: B.Large,
			variant: L.SecondaryDestructive,
			content: o.Icon,
			className: "mr-auto",
			disabled: x,
			onClick: () => void E.current(),
			children: /* @__PURE__ */ J(M, { iconName: F.Trash })
		}) : null,
		s ? /* @__PURE__ */ J(bi, {
			variant: L.Secondary,
			content: o.Text,
			onClick: n,
			children: "Cancel"
		}) : /* @__PURE__ */ J(V, {
			size: B.Large,
			variant: L.Ghost,
			onClick: n,
			children: "Cancel"
		}),
		s ? /* @__PURE__ */ J(bi, {
			variant: L.Primary,
			content: o.Text,
			disabled: x,
			onClick: () => void T.current(),
			children: "Save"
		}) : /* @__PURE__ */ J(V, {
			size: B.Large,
			variant: L.Primary,
			disabled: x,
			onClick: () => void T.current(),
			children: "Save"
		})
	] })), () => a(null)), [
		x,
		s,
		n,
		e,
		a
	]), /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: /* @__PURE__ */ J("div", {
			className: z("flex-1 overflow-auto p-4 [&>*]:shrink-0", s && "pb-[88px]"),
			children: /* @__PURE__ */ J(Md, {
				mode: "manage",
				connection: null,
				onConnectionChange: () => void 0,
				name: p,
				onNameChange: m,
				host: h,
				onHostChange: g,
				port: _,
				onPortChange: v,
				identityFile: y,
				onIdentityFileChange: b,
				onTest: w,
				testing: f.isPending,
				className: "bg-elevation-level-2"
			})
		})
	});
}
//#endregion
//#region src/app/features/managed/controller/useManagedHost.ts
var Mp = Wr(null);
function Np() {
	let e = qr(Mp);
	if (!e) throw Error("useManagedHost must be used within ManagedHostProvider");
	return e;
}
//#endregion
//#region src/app/components/TopBar.tsx
var Pp = "linear-gradient(to bottom, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))", Fp = { backgroundImage: `${Pp}, ${Pp}` };
function Ip() {
	let { useSidebarOffset: e } = me().stores.sidebarLayoutStore, [t, n] = K(!1), [r, i] = K(!1), [a, s] = K(!1), c = Ue(), l = h(), { pathname: u } = si(), d = Cf(), f = Np(), p = e(), m = zt(u) !== null || Cn(u) !== null;
	return !c && (zt(u) !== null || u === pr.list()) ? null : /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ Y("header", {
			className: z("fixed top-0 right-0 z-10 flex items-center justify-between py-2 shrink-0", "transition-[left] duration-500 ease-in-out", c ? "h-16 px-3 gap-4" : l ? "h-[52px] px-3" : "h-[52px] px-4"),
			style: { left: p },
			children: [
				/* @__PURE__ */ J("div", {
					className: z("absolute inset-x-0 top-0 pointer-events-none", c ? "-bottom-[76px]" : "-bottom-[8px]"),
					style: Fp
				}),
				/* @__PURE__ */ Y("div", {
					className: z("relative flex items-center", c ? "flex-1 min-w-0 gap-4" : l ? "shrink-0 gap-4" : "shrink-0 gap-8"),
					children: [p > 0 ? null : /* @__PURE__ */ J(ni, {
						to: pr.list(),
						className: "shrink-0",
						"aria-label": "All projects",
						children: /* @__PURE__ */ J(cc, {
							height: 36,
							markOnly: c || l,
							className: "text-basic-primary"
						})
					}), /* @__PURE__ */ J(Kf, {})]
				}),
				/* @__PURE__ */ Y("div", {
					className: "relative flex items-center shrink-0 gap-2",
					children: [
						c && !m ? /* @__PURE__ */ J(V, {
							variant: L.Primary,
							size: B.Medium,
							content: o.Icon,
							className: "btn-round",
							"aria-label": f.isManaged ? "Add repository" : "New project",
							onClick: f.isManaged ? f.addRepository : d.create,
							children: /* @__PURE__ */ J(M, { iconName: F.Add })
						}) : null,
						/* @__PURE__ */ J(Zf, {}),
						/* @__PURE__ */ J(Xf, { onOpen: () => s(!0) }),
						/* @__PURE__ */ J(Yf, {
							onConfigurations: () => n(!0),
							onSshConfigs: () => i(!0),
							onManagedHost: f.isManaged ? f.openSettings : void 0
						})
					]
				})
			]
		}),
		/* @__PURE__ */ J(np, {
			open: t,
			onClose: () => n(!1)
		}),
		/* @__PURE__ */ J(kp, {
			open: r,
			onClose: () => i(!1)
		}),
		/* @__PURE__ */ J(Tp, {
			open: a,
			onClose: () => s(!1)
		})
	] });
}
//#endregion
//#region src/app/components/AppShell.tsx
function Lp() {
	return /* @__PURE__ */ Y("div", {
		className: "h-full flex flex-col bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ J(Ip, {}), /* @__PURE__ */ J("main", {
			className: "flex-1 min-h-0",
			children: /* @__PURE__ */ J(ii, {})
		})]
	});
}
//#endregion
//#region src/app/components/sessions/SessionFilters.tsx
var Rp = { paddingInline: "12px" };
function zp() {
	return /* @__PURE__ */ J("div", { className: "h-px w-full bg-divider-muted shrink-0" });
}
function Bp({ children: e, gap: t }) {
	return /* @__PURE__ */ J("div", {
		className: z("flex flex-col px-4 py-6", t),
		children: e
	});
}
function Vp({ label: e, items: t, value: n, onValueChange: r, stacked: i, sidebar: a = !1 }) {
	return /* @__PURE__ */ Y("div", {
		className: z(i ? "flex flex-col gap-1" : a ? "flex items-center gap-1" : "flex items-center justify-between gap-3"),
		children: [/* @__PURE__ */ J("div", {
			className: z(i ? "label-medium text-basic-primary" : "label-small shrink-0", a || i ? "text-basic-primary" : "text-basic-secondary", a && "flex-1 min-w-0"),
			children: e
		}), /* @__PURE__ */ J(Yc, {
			items: t,
			value: n,
			onValueChange: r,
			size: i ? B.Large : B.Small,
			variant: L.Secondary,
			placement: R.BottomLeft,
			sticky: a,
			className: i ? "w-full" : "min-w-0",
			triggerClassName: i ? "w-full btn-field" : a ? "!gap-1.5 !pl-3" : ""
		})]
	});
}
function Hp({ label: e, options: t, selected: n, onToggle: r, labelOf: i = (e) => e, touch: a, sidebar: s = !1 }) {
	return /* @__PURE__ */ Y("div", {
		className: z("flex flex-col", s ? "gap-2" : "gap-3"),
		children: [/* @__PURE__ */ J("div", {
			className: z(a ? "label-medium text-basic-primary" : "label-small", s || a ? "text-basic-primary" : "text-basic-secondary"),
			children: e
		}), /* @__PURE__ */ J("div", {
			className: "flex flex-wrap gap-2",
			children: t.map((e) => /* @__PURE__ */ J(V, {
				size: a ? B.Medium : B.Small,
				content: o.Text,
				variant: n.includes(e) ? L.Primary : L.Secondary,
				onClick: () => r(e),
				"aria-pressed": n.includes(e),
				style: a ? void 0 : Rp,
				children: i(e)
			}, e))
		})]
	});
}
function Up({ sessions: e, showSearch: t = !0, mobile: r = !1, sidebar: i = !1, onChange: a }) {
	let { useSort: o, useSessionProviders: s, useSessionEnvs: c, useSelectedProviders: l, useSelectedEnvs: u, useModifiedRange: d, useFilterQuery: f, useCreatedRange: p, toggleProvider: m, toggleEnv: h, setSort: g, setQuery: _, setModifiedRange: v, setCreatedRange: y, pruneUnavailableFacets: b, SORT_ITEMS: x, RANGE_ITEMS: S } = me().stores.sessionFiltersStore, C = f(), w = o(), T = p(), E = d(), D = u(), O = l(), k = c(e), ee = s(e);
	U(() => {
		b(k, ee);
	}, [
		k,
		ee,
		b
	]);
	let te = (e) => (t) => {
		e(t), a?.();
	}, A = /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ J(Vp, {
			label: "Sort by",
			items: x,
			value: w,
			onValueChange: te((e) => g(e)),
			stacked: r,
			sidebar: i
		}),
		/* @__PURE__ */ J(Vp, {
			label: "Creation date",
			items: S,
			value: T,
			onValueChange: te((e) => y(e)),
			stacked: r,
			sidebar: i
		}),
		/* @__PURE__ */ J(Vp, {
			label: "Modification date",
			items: S,
			value: E,
			onValueChange: te((e) => v(e)),
			stacked: r,
			sidebar: i
		})
	] });
	return i ? /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ J("div", {
				className: "flex flex-col gap-6 py-2",
				children: A
			}),
			k.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(zp, {}), /* @__PURE__ */ J("div", {
				className: "py-2",
				children: /* @__PURE__ */ J(Hp, {
					label: "Environment",
					options: k,
					selected: D,
					onToggle: te(h),
					touch: !1,
					sidebar: !0
				})
			})] }) : null,
			ee.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(zp, {}), /* @__PURE__ */ J("div", {
				className: "py-2",
				children: /* @__PURE__ */ J(Hp, {
					label: "Provider",
					options: ee,
					selected: O,
					onToggle: te(m),
					labelOf: n,
					touch: !1,
					sidebar: !0
				})
			})] }) : null
		]
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col",
		children: [
			t ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Bp, {
				gap: "gap-4",
				children: /* @__PURE__ */ J(Z, {
					inputSize: X.Medium,
					leading: Us.Icon,
					leadingIconName: F.Search,
					placeholder: "Search projects",
					value: C,
					onChange: (e) => _(e.target.value),
					"aria-label": "Search projects"
				})
			}), /* @__PURE__ */ J(zp, {})] }) : null,
			/* @__PURE__ */ J(Bp, {
				gap: r ? "gap-6" : "gap-4",
				children: A
			}),
			k.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(zp, {}), /* @__PURE__ */ J(Bp, {
				gap: "gap-4",
				children: /* @__PURE__ */ J(Hp, {
					label: "Environment",
					options: k,
					selected: D,
					onToggle: te(h),
					touch: r
				})
			})] }) : null,
			ee.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(zp, {}), /* @__PURE__ */ J(Bp, {
				gap: "gap-4",
				children: /* @__PURE__ */ J(Hp, {
					label: "Provider",
					options: ee,
					selected: O,
					onToggle: te(m),
					labelOf: n,
					touch: r
				})
			})] }) : null
		]
	});
}
//#endregion
//#region src/app/components/LeftSidebar/NewSessionPopover.tsx
var Wp = [
	{
		behavior: "direct",
		label: "Agent Session",
		icon: F.Plane
	},
	{
		behavior: "direct-with-orchestrator",
		label: "Agent + Orchestrator Session",
		icon: F.PlaneAdd
	},
	{
		behavior: "orchestrator",
		label: "Orchestrator Session",
		icon: F.Orchestrator
	}
];
function Gp(e) {
	let t = Al(e);
	return [
		t.topLevel,
		t.editing,
		t.delegation,
		t.inspection
	].join(" ");
}
function Kp({ projectId: e, onUnavailable: t, className: n, children: r }) {
	let i = u(), [a, o] = K(!1), s = ci(), c = un(), l = qt(), d = () => {
		if (!e) {
			t();
			return;
		}
		if (!i.orchestrationEnabled) {
			f("direct");
			return;
		}
		o((e) => !e);
	}, f = async (t) => {
		if (!(!e || l.isPending)) try {
			let n = (await l.mutateAsync({
				project_id: e,
				behavior: nt(i, t)
			})).metadata.session_id;
			o(!1), n && s(pr.session(n));
		} catch (e) {
			c.error(`Failed to start a chat: ${eu($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Kn, {
		open: a,
		onClose: () => o(!1),
		sticky: !0,
		placement: R.RightTop,
		size: jn.Medium,
		panelClassName: "gap-2",
		className: n,
		content: /* @__PURE__ */ J(q, { children: Wp.map((e) => {
			let t = Al(e.behavior);
			return /* @__PURE__ */ Y(qc, {
				disabled: l.isPending,
				hoverHint: {
					title: t.label,
					description: Gp(e.behavior),
					muted: !0
				},
				onClick: () => void f(e.behavior),
				children: [/* @__PURE__ */ J(M, { iconName: e.icon }), /* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: e.label
				})]
			}, e.behavior);
		}) }),
		children: r(d)
	});
}
//#endregion
//#region src/app/components/LeftSidebar/SidebarProjectList.tsx
var qp = 6e4, Jp = 4;
function Yp({ projects: e, sessions: t, query: n, activeSessionId: r, activeProjectId: i }) {
	let a = ci(), o = ul(), s = Pn(qp), [c, l] = K(() => /* @__PURE__ */ new Set()), [u, d] = K(() => /* @__PURE__ */ new Map()), [f, p] = K(() => /* @__PURE__ */ new Set()), m = n.trim().toLowerCase(), h = W(() => gl(e, t), [e, t]), g = W(() => t.filter((e) => e.lineage == null && !e.summary.project_id), [t]), _ = (e) => m ? !0 : u.get(e) === r ? !1 : c.has(e) || e === i, v = (e) => {
		if (_(e)) {
			d((t) => new Map(t).set(e, r)), l((t) => {
				let n = new Set(t);
				return n.delete(e), n;
			});
			return;
		}
		l((t) => new Set(t).add(e)), d((t) => {
			let n = new Map(t);
			return n.delete(e), n;
		});
	}, y = h.filter((e) => !m || e.project.name.toLowerCase().includes(m) ? !0 : e.sessions.some((e) => o(e.summary).toLowerCase().includes(m))), b = g.filter((e) => !m || o(e.summary).toLowerCase().includes(m));
	return y.length === 0 && b.length === 0 ? /* @__PURE__ */ J("p", {
		className: "label-small text-basic-muted px-4 py-3",
		children: "No matching sessions"
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col [&>*]:shrink-0",
		children: [y.map((e) => {
			let t = e.project.project_id, n = _(t), i = e.project.name.toLowerCase().includes(m), c = m && !i ? e.sessions.filter((e) => o(e.summary).toLowerCase().includes(m)) : e.sessions;
			return /* @__PURE__ */ Y("section", {
				className: "border-b border-muted py-4",
				children: [/* @__PURE__ */ J("div", {
					className: "px-2 py-1",
					children: /* @__PURE__ */ J(Bc, {
						entityId: t,
						name: e.project.name,
						running: e.running > 0,
						"aria-expanded": n,
						onClick: () => v(t)
					})
				}), /* @__PURE__ */ J(fa, {
					isOpen: n,
					inert: !n,
					"aria-hidden": !n,
					className: "w-full duration-500 ease-in-out",
					children: /* @__PURE__ */ J(Qp, {
						sessions: c,
						activeSessionId: r,
						revealed: m.length > 0 || f.has(t),
						onReveal: () => p((e) => {
							let n = new Set(e);
							return n.add(t), n;
						}),
						now: s,
						onOpen: (e) => a(pr.session(e))
					})
				})]
			}, t);
		}), b.length > 0 ? /* @__PURE__ */ J("section", {
			className: "flex flex-col px-2 py-1",
			children: b.map((e) => /* @__PURE__ */ J(Bc, {
				entityId: e.summary.session_id,
				name: o(e.summary),
				variant: zc.Orphan,
				active: e.summary.session_id === r,
				running: en(e.active_run),
				onClick: () => a(pr.session(e.summary.session_id))
			}, e.summary.session_id))
		}) : null]
	});
}
function Xp(e, t, n) {
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
function Zp(e, t) {
	if (t) return e;
	let n = Jp, r = [];
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
function Qp({ sessions: e, activeSessionId: t, revealed: n, onReveal: r, now: i, onOpen: a }) {
	let o = ul(), s = u(), c = Lf(), l = W(() => Ol(e, (e) => ({
		updatedAt: e.summary.updated_at,
		pinned: !!e.summary.pinned
	}), i), [e, i]);
	if (e.length === 0) return /* @__PURE__ */ J("p", {
		className: "label-small text-basic-muted px-4 pb-3",
		children: "No chats yet"
	});
	let d = Xp(Zp(l, n), l, t), f = d.reduce((e, t) => e + t.items.length, 0), p = Math.max(0, e.length - f);
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1 px-2 pb-2",
		children: [d.map((e) => /* @__PURE__ */ Y("div", {
			className: "flex flex-col",
			children: [/* @__PURE__ */ J("p", {
				className: "tag-label text-basic-tertiary uppercase px-2 pt-4 pb-4",
				children: e.label
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-0.5",
				children: e.items.map((e) => {
					let n = o(e.summary), r = Al(e.summary.behavior);
					return /* @__PURE__ */ J(wi, {
						title: n,
						icon: jl(e.summary.behavior),
						"aria-label": s.orchestrationEnabled ? `${n}, ${r.navigationLabel}` : n,
						active: e.summary.session_id === t,
						running: en(e.active_run),
						forkedFromTitle: e.summary.forked_from?.title,
						onClick: () => a(e.summary.session_id),
						actions: /* @__PURE__ */ J(sl, {
							title: n,
							pinned: e.summary.pinned,
							onPin: () => void c.togglePin(e.summary),
							onRename: () => c.rename(e.summary),
							onDelete: () => c.remove(e.summary)
						})
					}, e.summary.session_id);
				})
			})]
		}, e.label)), p > 0 ? /* @__PURE__ */ Y(qc, {
			onClick: r,
			children: [/* @__PURE__ */ J(M, { iconName: F.MenuHorizontal }), /* @__PURE__ */ Y("span", {
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
//#endregion
//#region src/app/components/LeftSidebar/LeftSidebarPanel.tsx
function $p({ isOpen: e, onToggle: t, toggleKeys: n, commands: r, variant: i }) {
	let { useFilterQuery: a, setQuery: s } = me().stores.sessionFiltersStore, c = i === "projects", [l, u] = K(""), d = a(), { data: f = [] } = Nt(), { data: p } = et(), { data: m } = Gt(), h = m?.store_path ?? "", g = p?.projects ?? [];
	return /* @__PURE__ */ Y("div", {
		className: "flex h-full flex-col bg-elevation-level-2 border-r border-muted",
		style: { boxShadow: "var(--left-sidebar-open)" },
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex items-center justify-between px-4 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ J(cc, {
					height: 28,
					className: "text-basic-primary"
				}), /* @__PURE__ */ J(Zt, {
					title: "Hide sidebar",
					keyboardShortcuts: n,
					position: R.CenterLeft,
					sticky: !0,
					disabled: !e,
					children: /* @__PURE__ */ J(V, {
						variant: L.Ghost,
						content: o.Icon,
						"aria-label": "Hide sidebar",
						onClick: t,
						children: /* @__PURE__ */ J(M, { iconName: F.SidebarChevronLeft })
					})
				})]
			}),
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-3 px-2 py-3 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ J("div", {
					className: "px-1",
					children: /* @__PURE__ */ J(Z, {
						inputSize: X.Medium,
						leading: Us.Icon,
						leadingIconName: F.Search,
						placeholder: c ? "Search Projects" : "Search Sessions",
						value: c ? d : l,
						"aria-label": c ? "Search projects" : "Search sessions",
						onChange: (e) => c ? s(e.target.value) : u(e.target.value)
					})
				}), /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-0.5",
					children: [
						c ? /* @__PURE__ */ Y(qc, {
							onClick: r.newProject,
							children: [/* @__PURE__ */ J(M, { iconName: F.Add }), /* @__PURE__ */ J("span", {
								className: "text-left flex-grow",
								children: r.createLabel
							})]
						}) : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Kp, {
							projectId: r.projectId,
							onUnavailable: r.newSession,
							className: "w-full",
							children: (e) => /* @__PURE__ */ Y(qc, {
								onClick: e,
								children: [
									/* @__PURE__ */ J(M, { iconName: F.Add }),
									/* @__PURE__ */ J("span", {
										className: "text-left flex-grow",
										children: "New Session"
									}),
									/* @__PURE__ */ J(M, { iconName: F.Right })
								]
							})
						}), /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ Y(qc, {
								className: "flex-1 !w-auto",
								onClick: r.openProjects,
								children: [/* @__PURE__ */ J(M, { iconName: F.Folders }), /* @__PURE__ */ J("span", {
									className: "text-left flex-grow truncate",
									children: "All projects"
								})]
							}), /* @__PURE__ */ J(Zt, {
								title: "Create a new project",
								position: R.CenterRight,
								sticky: !0,
								children: /* @__PURE__ */ J(V, {
									variant: L.Ghost,
									content: o.Icon,
									"aria-label": "New project",
									onClick: r.newProject,
									children: /* @__PURE__ */ J(M, { iconName: F.AddCircle })
								})
							})]
						})] }),
						/* @__PURE__ */ Y(qc, {
							onClick: r.openMcp,
							"aria-label": r.mcpLabel,
							children: [
								/* @__PURE__ */ J(M, { iconName: F.Toolbox }),
								/* @__PURE__ */ J("span", {
									className: "text-left flex-grow",
									children: "MCP"
								}),
								r.activeMcp > 0 ? /* @__PURE__ */ J(vi, {
									text: `${r.activeMcp} ACTIVE`,
									color: _i.Blue
								}) : null
							]
						}),
						/* @__PURE__ */ Y(qc, {
							onClick: r.openSsh,
							children: [
								/* @__PURE__ */ J(M, { iconName: F.Globe }),
								/* @__PURE__ */ J("span", {
									className: "text-left flex-grow",
									children: "SSH"
								}),
								r.sshCount > 0 ? /* @__PURE__ */ J("span", {
									className: "label-small text-basic-secondary tabular-nums",
									children: r.sshCount
								}) : null
							]
						})
					]
				})]
			}),
			c ? /* @__PURE__ */ J("div", {
				className: "flex-1 min-h-0 overflow-y-auto p-4 [&>*]:shrink-0",
				children: /* @__PURE__ */ J(Up, {
					sessions: f,
					showSearch: !1,
					sidebar: !0
				})
			}) : /* @__PURE__ */ J("div", {
				className: "flex-1 min-h-0 overflow-y-auto",
				children: /* @__PURE__ */ J(Yp, {
					projects: g,
					sessions: f,
					query: l,
					activeSessionId: r.sessionId,
					activeProjectId: r.projectId
				})
			}),
			/* @__PURE__ */ Y("div", {
				className: "shrink-0 border-t border-muted",
				children: [
					/* @__PURE__ */ Y("div", {
						className: "px-2 py-1",
						children: [/* @__PURE__ */ Y(qc, {
							onClick: r.openConfigurations,
							children: [/* @__PURE__ */ J(M, { iconName: F.Gear }), /* @__PURE__ */ J("span", {
								className: "text-left flex-grow",
								children: "Configurations"
							})]
						}), /* @__PURE__ */ Y(qc, {
							onClick: r.openManaged,
							children: [/* @__PURE__ */ J(M, { iconName: F.Server }), /* @__PURE__ */ J("span", {
								className: "text-left flex-grow",
								children: "Managed host"
							})]
						})]
					}),
					/* @__PURE__ */ J(Q, {}),
					/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-2 h-10 pl-4 pr-2",
						children: [
							/* @__PURE__ */ J("span", {
								className: "label-micro text-basic-primary shrink-0",
								children: "Store:"
							}),
							/* @__PURE__ */ J("span", {
								className: "code code-micro text-basic-tertiary flex-1 min-w-0 truncate",
								title: h,
								children: h || "store path pending"
							}),
							/* @__PURE__ */ J(Ht, {
								value: h,
								size: B.Small,
								variant: L.Tertiary,
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
//#endregion
//#region src/app/components/LeftSidebar/LeftSidebarRail.tsx
function em({ commands: e, onToggle: t, toggleKeys: n, variant: r }) {
	let i = r === "projects";
	return /* @__PURE__ */ Y("div", {
		className: "flex h-full flex-col justify-between p-2",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col items-center gap-4 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ J("button", {
					type: "button",
					className: "text-basic-primary",
					"aria-label": "All projects",
					onClick: e.openProjects,
					children: /* @__PURE__ */ J(cc, {
						markOnly: !0,
						height: 25
					})
				}),
				/* @__PURE__ */ J(tm, {
					label: "Show sidebar",
					keys: n,
					onClick: t,
					children: /* @__PURE__ */ J(M, { iconName: F.SidebarChevronRight })
				}),
				i ? null : /* @__PURE__ */ J(tm, {
					label: "All projects",
					onClick: e.openProjects,
					children: /* @__PURE__ */ J(M, { iconName: F.Folders })
				}),
				i ? /* @__PURE__ */ J(tm, {
					label: e.createLabel,
					onClick: e.newProject,
					children: /* @__PURE__ */ J(M, { iconName: F.Add })
				}) : /* @__PURE__ */ J(Kp, {
					projectId: e.projectId,
					onUnavailable: e.newSession,
					children: (e) => /* @__PURE__ */ J(tm, {
						label: "New session",
						onClick: e,
						children: /* @__PURE__ */ J(M, { iconName: F.Add })
					})
				}),
				/* @__PURE__ */ J(tm, {
					label: e.mcpLabel,
					onClick: e.openMcp,
					children: /* @__PURE__ */ J(M, { iconName: F.Toolbox })
				}),
				/* @__PURE__ */ J(tm, {
					label: "SSH",
					onClick: e.openSsh,
					children: /* @__PURE__ */ J(M, { iconName: F.Globe })
				})
			]
		}), /* @__PURE__ */ Y("div", {
			className: "flex flex-col items-center gap-1 [&>*]:shrink-0",
			children: [/* @__PURE__ */ J(tm, {
				label: "Configurations",
				onClick: e.openConfigurations,
				children: /* @__PURE__ */ J(M, { iconName: F.Gear })
			}), /* @__PURE__ */ J(tm, {
				label: "Managed host",
				onClick: e.openManaged,
				children: /* @__PURE__ */ J(M, { iconName: F.Server })
			})]
		})]
	});
}
function tm({ label: e, keys: t, onClick: n, children: r }) {
	return /* @__PURE__ */ J(Zt, {
		title: e,
		keyboardShortcuts: t,
		position: R.CenterRight,
		sticky: !0,
		children: /* @__PURE__ */ J(V, {
			variant: L.Ghost,
			content: o.Icon,
			"aria-label": e,
			onClick: n,
			children: r
		})
	});
}
//#endregion
//#region src/app/components/LeftSidebar/useSidebarCommands.tsx
function nm() {
	let [e, t] = K(!1), [n, r] = K(!1), [i, a] = K(!1), { pathname: o } = si(), s = ci(), c = Cf(), l = Np(), { data: u = [] } = Ut(), { data: d } = Xt(), { data: f } = jt(), p = zt(o), m = p != null && u.some((e) => e.summary.session_id === p), h = Cn(o) ?? u.find((e) => e.summary.session_id === p)?.summary.project_id ?? null, g = d?.servers.filter((e) => e.enabled).length ?? 0;
	return {
		projectId: h,
		sessionId: p,
		activeMcp: g,
		sshCount: f?.configurations.length ?? 0,
		mcpLabel: g ? `MCP servers, ${g} active` : "MCP servers",
		newSession: () => {
			if (h) {
				c.newChat(h);
				return;
			}
			p && !m || c.create();
		},
		newProject: () => {
			l.isManaged ? l.addRepository() : c.create();
		},
		createLabel: l.isManaged ? "Add repository" : "New Project",
		openProjects: () => s(pr.list()),
		openMcp: () => a(!0),
		openSsh: () => r(!0),
		openConfigurations: () => t(!0),
		openManaged: l.openSettings,
		modals: /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(np, {
				open: e,
				onClose: () => t(!1)
			}),
			/* @__PURE__ */ J(kp, {
				open: n,
				onClose: () => r(!1)
			}),
			/* @__PURE__ */ J(Tp, {
				open: i,
				onClose: () => a(!1)
			})
		] })
	};
}
var rm = [nn, "h"];
function im({ variant: e = "session" }) {
	let { setSidebarOffset: t, storedOpen: n, storeOpen: r } = me().stores.sidebarLayoutStore, i = Ue(), a = jr(), [o, s] = K(null), c = o ?? n() ?? a, l = H(() => {
		s((e) => {
			let t = !(e ?? n() ?? a);
			return r(t), t;
		});
	}, [
		a,
		n,
		r
	]), u = nm();
	return Yr(() => {
		t(i ? 0 : c ? 320 : 52);
	}, [
		i,
		c,
		t
	]), Yr(() => () => t(0), [t]), bf([{
		keys: rm,
		onTrigger: l,
		enabled: !i
	}]), i ? null : /* @__PURE__ */ Y("div", {
		"data-sidebar": "true",
		className: z("relative h-full shrink-0 transition-[width] duration-500 ease-in-out", c ? "w-[320px]" : "w-[52px]"),
		children: [
			c ? null : /* @__PURE__ */ J("div", {
				className: "absolute inset-y-0 left-0 w-[52px]",
				children: /* @__PURE__ */ J(em, {
					commands: u,
					onToggle: l,
					toggleKeys: rm,
					variant: e
				})
			}),
			/* @__PURE__ */ J("div", {
				className: z("absolute inset-y-0 z-[1] h-full w-[320px] transition-[left] duration-500 ease-in-out", c ? "left-0" : "left-[-320px]"),
				"aria-hidden": !c,
				inert: !c,
				children: /* @__PURE__ */ J($p, {
					isOpen: c,
					commands: u,
					onToggle: l,
					toggleKeys: rm,
					variant: e
				})
			}),
			u.modals
		]
	});
}
//#endregion
//#region src/app/components/pages/DesignPreviewPage.tsx
var am = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
], om = [
	{
		id: "sonnet",
		label: "Claude Sonnet",
		icon: F.Brain
	},
	{
		id: "opus",
		label: "Claude Opus",
		icon: F.Brain
	},
	{
		id: "gpt",
		label: "GPT",
		icon: F.Ai
	}
], sm = "pub enum AgentEvent {\n    RunStarted { thread_name: Option<String> },\n    AssistantMessage {\n        thread_name: Option<String>,\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { thread_name: Option<String> },\n}";
function cm() {
	let [e, t] = K("sonnet"), [n, r] = K(!0), [i, a] = K(!1), [s, c] = K(!1), [l, u] = K(!0), [d, f] = K("first"), [p, m] = K("Port the ArceeFM atoms"), [h, g] = K(4), [_, v] = K(.7), [y, b] = K(["local"]), [x, S] = K(1), [C, w] = K(null), [T, E] = K({
		from: null,
		to: null
	});
	return /* @__PURE__ */ Y("div", {
		className: "min-h-full bg-elevation-ground text-basic-primary",
		children: [
			/* @__PURE__ */ Y("header", {
				className: "flex items-center gap-4 h-14 px-6 border-b border-secondary",
				children: [/* @__PURE__ */ J(cc, { height: 18 }), /* @__PURE__ */ J("span", {
					className: "text-basic-muted label-small",
					children: "design system"
				})]
			}),
			/* @__PURE__ */ Y("main", {
				className: "p-6 flex flex-col gap-6 max-w-[1100px]",
				children: [
					/* @__PURE__ */ J(yi, {
						title: "Buttons",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-3",
							children: [
								/* @__PURE__ */ J(V, {
									variant: L.Primary,
									children: "Primary"
								}),
								/* @__PURE__ */ J(V, {
									variant: L.Secondary,
									children: "Secondary"
								}),
								/* @__PURE__ */ J(V, {
									variant: L.Tertiary,
									children: "Tertiary"
								}),
								/* @__PURE__ */ J(V, {
									variant: L.Ghost,
									children: "Ghost"
								}),
								/* @__PURE__ */ J(V, {
									variant: L.GhostDestructive,
									children: "Destructive"
								}),
								/* @__PURE__ */ J(V, {
									variant: L.Primary,
									loading: !0,
									children: "Loading"
								}),
								/* @__PURE__ */ J(V, {
									variant: L.Secondary,
									disabled: !0,
									children: "Disabled"
								}),
								/* @__PURE__ */ Y(V, {
									variant: L.Secondary,
									content: o.IconLeft,
									children: [/* @__PURE__ */ J(M, { iconName: F.Add }), "With icon"]
								})
							]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Badges, loader, switch, tooltip",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-4",
							children: [
								/* @__PURE__ */ J(vi, {
									text: "Running",
									color: _i.Green
								}),
								/* @__PURE__ */ J(vi, {
									text: "Queued",
									color: _i.Blue
								}),
								/* @__PURE__ */ J(vi, {
									text: "Failed",
									color: _i.Red
								}),
								/* @__PURE__ */ J(vi, {
									text: "Idle",
									color: _i.Gray
								}),
								/* @__PURE__ */ J(Ce, { size: je.Small }),
								/* @__PURE__ */ J(al, {
									checked: n,
									onChange: r
								}),
								/* @__PURE__ */ J(Zt, {
									title: "Pin session",
									description: "Keeps the card at the top of the board.",
									position: R.BottomCenter,
									sticky: !0,
									showTooltipOnMobile: !0,
									children: /* @__PURE__ */ J(M, { iconName: F.Pin })
								}),
								/* @__PURE__ */ J(M, { iconName: F.Unpin })
							]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Inputs",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-end gap-4",
							children: [
								/* @__PURE__ */ J(Z, {
									label: "Working directory",
									inputSize: X.Medium,
									placeholder: "/Users/me/project",
									className: "w-[320px]"
								}),
								/* @__PURE__ */ J(Z, {
									label: "Search",
									inputSize: X.Medium,
									leading: Us.Icon,
									leadingIconName: F.Search,
									placeholder: "Filter sessions",
									hintText: "Matches name and cwd",
									className: "w-[280px]"
								}),
								/* @__PURE__ */ J(Yc, {
									items: om,
									value: e,
									onValueChange: t,
									placeholder: "Pick a model"
								}),
								/* @__PURE__ */ J(V, {
									variant: L.Secondary,
									onClick: () => a(!0),
									children: "Open modal"
								})
							]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Popover, copy, shortcuts",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-4",
							children: [
								/* @__PURE__ */ J(Kn, {
									open: s,
									onClose: () => c(!1),
									placement: R.BottomRight,
									sticky: !0,
									content: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("div", {
										className: "label-small text-basic-primary px-2 py-1",
										children: "Anchored panel"
									}), /* @__PURE__ */ J("div", {
										className: "text-micro text-basic-muted px-2 pb-1",
										children: "Closes on Escape or a click outside. On a phone it becomes a bottom sheet instead."
									})] }),
									children: /* @__PURE__ */ J(V, {
										variant: L.Secondary,
										onClick: () => c((e) => !e),
										children: "Open popover"
									})
								}),
								/* @__PURE__ */ J(Ht, { value: "nac" }),
								/* @__PURE__ */ J(cn, { keys: [
									"cmd",
									"shift",
									"k"
								] })
							]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Choices and multi-line input",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-start gap-6",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2",
									children: [/* @__PURE__ */ J(Fi, {
										checked: l,
										onChange: u,
										children: "Skip permission prompts"
									}), /* @__PURE__ */ J(Fi, {
										checked: !1,
										onChange: () => {},
										disabled: !0,
										children: "Disabled"
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2",
									children: [/* @__PURE__ */ J(Vc, {
										name: "preview-choice",
										checked: d === "first",
										onChange: () => f("first"),
										children: "Working tree"
									}), /* @__PURE__ */ J(Vc, {
										name: "preview-choice",
										checked: d === "second",
										onChange: () => f("second"),
										children: "Latest snapshot"
									})]
								}),
								/* @__PURE__ */ J(nc, {
									label: "System prompt",
									rows: 3,
									placeholder: "Extra instructions for the agent",
									className: "w-[320px]"
								})
							]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Notices and loaders",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-4",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-wrap gap-3",
									children: [
										/* @__PURE__ */ J(vc, {
											variant: lc.Info,
											title: "Read-only snapshot",
											className: "w-[280px]",
											children: "Pick the working tree to edit files again."
										}),
										/* @__PURE__ */ J(vc, {
											variant: lc.Error,
											title: "Run failed",
											className: "w-[280px]",
											children: "The provider rejected the request."
										}),
										/* @__PURE__ */ J(vc, {
											variant: lc.Success,
											title: "Branch switched",
											className: "w-[280px]"
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2 w-[398px]",
									children: [
										/* @__PURE__ */ J(ki, {
											variant: Ti.Danger,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										}),
										/* @__PURE__ */ J(ki, {
											variant: Ti.Error,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										}),
										/* @__PURE__ */ J(ki, {
											variant: Ti.Success,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										}),
										/* @__PURE__ */ J(ki, {
											variant: Ti.Info,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-wrap items-center gap-6",
									children: [
										/* @__PURE__ */ J(ic, { size: je.Medium }),
										/* @__PURE__ */ J(Ni, {
											rows: 3,
											className: "w-[200px]"
										}),
										/* @__PURE__ */ J(ac, {
											active: !0,
											className: "w-[200px]"
										})
									]
								})
							]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Session avatars",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-4",
							children: [am.map((e) => /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ J(Rc, {
									id: e,
									size: 40
								}), /* @__PURE__ */ J("span", {
									className: "code code-small text-basic-muted",
									children: e
								})]
							}, e)), /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ J(Mi, {}), /* @__PURE__ */ J("span", {
									className: "code code-small text-basic-muted",
									children: "unassigned"
								})]
							})]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Project navigation",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-6",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex items-start gap-2",
									children: [
										/* @__PURE__ */ J(Pi, {
											title: "Fix the parser",
											active: !0
										}),
										/* @__PURE__ */ J(Pi, { title: "Rewrite the store layer" }),
										/* @__PURE__ */ J(Pi, {
											title: "Investigating",
											running: !0
										}),
										/* @__PURE__ */ J(Pi, {
											title: "Fork: Fix the parser",
											forkedFromTitle: "Fix the parser"
										}),
										/* @__PURE__ */ J(Pi, {
											title: "Fork running",
											forkedFromTitle: "Fix the parser",
											running: !0
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1 max-w-[320px]",
									children: [
										/* @__PURE__ */ J(wi, {
											title: "Fix the parser",
											active: !0
										}),
										/* @__PURE__ */ J(wi, { title: "Rewrite the store layer" }),
										/* @__PURE__ */ J(wi, {
											title: "Investigating",
											running: !0
										}),
										/* @__PURE__ */ J(wi, {
											title: "Fork: Fix the parser",
											forkedFromTitle: "Fix the parser"
										}),
										/* @__PURE__ */ J(wi, {
											title: "Fork running",
											forkedFromTitle: "Fix the parser",
											running: !0
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2 max-w-[320px]",
									children: [/* @__PURE__ */ J(Vs, {
										sessionId: "14231vsd7897-aaaa",
										title: "Fork: Session title"
									}), /* @__PURE__ */ J(Vs, {
										sessionId: "14231vsd7897-aaaa",
										title: "Fork: Session title",
										deleted: !0
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1 max-w-[320px]",
									children: [
										/* @__PURE__ */ J(Bc, {
											entityId: am[3],
											name: "arcee-ai/nac",
											trailing: "4",
											active: !0
										}),
										/* @__PURE__ */ J(Bc, {
											entityId: am[4],
											name: "arcee-ai/telos",
											trailing: "1",
											running: !0
										}),
										/* @__PURE__ */ J(Bc, {
											entityId: am[5],
											name: "Unassigned session",
											variant: zc.Orphan
										})
									]
								})
							]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Avatars and editable header",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-4",
							children: [/* @__PURE__ */ Y("div", {
								className: "flex flex-wrap items-center gap-4",
								children: [
									/* @__PURE__ */ J(gi, {
										name: "Aleksy",
										size: hi.Small
									}),
									/* @__PURE__ */ J(gi, { name: "NAC Orchestrator" }),
									/* @__PURE__ */ J(gi, {
										name: "Opus",
										size: hi.Large
									}),
									/* @__PURE__ */ J(gi, {
										name: "🛠",
										glyph: !0,
										size: hi.Large
									}),
									/* @__PURE__ */ J(gi, {
										name: "Anthropic",
										size: hi.XLarge,
										color: "var(--color-bg-info-primary)"
									})
								]
							}), /* @__PURE__ */ J(ma, {
								value: p,
								onCommit: m,
								size: pa.Medium,
								className: "max-w-[360px]"
							})]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Numeric inputs, tags and pagination",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-6",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-wrap items-center gap-8",
									children: [/* @__PURE__ */ J(Tc, {
										value: h,
										onChange: g,
										min: 1,
										max: 16,
										"aria-label": "Parallel threads"
									}), /* @__PURE__ */ Y("div", {
										className: "flex items-center gap-4 w-[320px]",
										children: [/* @__PURE__ */ J(Wc, {
											min: 0,
											max: 2,
											step: .1,
											value: _,
											onChange: v,
											label: "Temperature"
										}), /* @__PURE__ */ J("span", {
											className: "code code-small text-basic-muted w-8 shrink-0",
											children: _.toFixed(1)
										})]
									})]
								}),
								/* @__PURE__ */ J(ol, {
									tags: [
										"local",
										"docker",
										"remote",
										"sandbox"
									],
									selected: y,
									onChange: b
								}),
								/* @__PURE__ */ J(Ec, {
									page: x,
									pageSize: 10,
									totalItems: 84,
									itemLabel: "sessions",
									onPageChange: S,
									className: "border-t border-muted"
								})
							]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Dates",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-start gap-6",
							children: [
								/* @__PURE__ */ J(da, {
									label: "Created after",
									value: C,
									onChange: w,
									className: "w-[240px]"
								}),
								/* @__PURE__ */ J(da, {
									label: "Window",
									range: T,
									onRangeChange: E,
									hintText: "Two clicks pick the ends.",
									className: "w-[280px]"
								}),
								/* @__PURE__ */ J(ea, {
									selected: C ? /* @__PURE__ */ new Date(`${C}T00:00:00`) : void 0,
									onSelect: (e) => w(`${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`),
									className: "rounded-[8px] border border-muted bg-elevation-level-2"
								})
							]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Code block and chat loader",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-4",
							children: [/* @__PURE__ */ J(pn, {
								code: sm,
								language: "rust",
								title: "events.rs",
								lineNumbers: !0,
								expandable: !0,
								maxHeight: "220px"
							}), /* @__PURE__ */ J(Si, {})]
						})
					}),
					/* @__PURE__ */ J(yi, {
						title: "Typography",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-2",
							children: [
								/* @__PURE__ */ J("div", {
									className: "title",
									children: "Title"
								}),
								/* @__PURE__ */ J("div", {
									className: "header-medium",
									children: "Header medium"
								}),
								/* @__PURE__ */ J("div", {
									className: "label-small text-basic-secondary",
									children: "Label small"
								}),
								/* @__PURE__ */ J("div", {
									className: "paragraph-medium text-basic-secondary",
									children: "Paragraph medium on the secondary text token."
								}),
								/* @__PURE__ */ J("div", {
									className: "code code-small text-basic-muted",
									children: "code-small / IBM Plex Mono"
								})
							]
						})
					})
				]
			}),
			/* @__PURE__ */ J(Vn, {
				open: i,
				onClose: () => a(!1),
				title: "Delete session",
				footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(V, {
					variant: L.Secondary,
					onClick: () => a(!1),
					children: "Cancel"
				}), /* @__PURE__ */ J(V, {
					variant: L.SecondaryDestructive,
					onClick: () => a(!1),
					children: "Delete"
				})] }),
				children: "This is the shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom."
			})
		]
	});
}
//#endregion
//#region src/app/components/pages/ProjectRedirectPage.tsx
var lm = /* @__PURE__ */ new Map();
function um() {
	let { projectId: e = "" } = li(), t = Cf(), n = u(), r = et(), i = Ut(), [a, o] = K(null), s = r.refetch, c = i.refetch;
	U(() => {
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
	let l = W(() => r.data?.projects.find((t) => t.project_id === e) ?? null, [r.data, e]), d = W(() => ml(ot(n, i.data ?? []), e), [
		i.data,
		e,
		n
	]), f = r.isLoading || i.isLoading, p = r.isFetching || i.isFetching, m = r.isError || i.isError, h = r.isSuccess && i.isSuccess, g = a === e && !f && !p && !m && h && l != null && d == null, _ = t.newChat;
	U(() => {
		if (!g) return;
		let t = lm.get(e);
		t || (t = _(e, ie(n, i.data ?? [], e)).finally(() => {
			lm.delete(e);
		}), lm.set(e, t));
	}, [
		g,
		_,
		e,
		n,
		i.data
	]);
	let v = a === e;
	return v && !f && !l ? /* @__PURE__ */ J(ri, {
		to: pr.list(),
		replace: !0
	}) : v && d ? /* @__PURE__ */ J(ri, {
		to: pr.session(d.summary.session_id),
		replace: !0
	}) : /* @__PURE__ */ J("div", {
		className: "flex h-full items-center justify-center",
		children: /* @__PURE__ */ J(Ce, { size: je.Large })
	});
}
//#endregion
//#region src/app/components/projects/ProjectCardActions.tsx
function dm({ title: e, icon: t, onClick: n, variant: r = L.Ghost, disabled: i = !1 }) {
	return /* @__PURE__ */ J(Zt, {
		title: e,
		position: R.TopCenter,
		sticky: !0,
		children: /* @__PURE__ */ J(V, {
			variant: r,
			size: B.Small,
			content: o.Icon,
			"aria-label": e,
			disabled: i,
			onClick: (e) => {
				e.stopPropagation(), n();
			},
			children: /* @__PURE__ */ J(M, { iconName: t })
		})
	});
}
function fm({ orphan: e, pinned: t, onDelete: n, onTogglePin: r, onRename: i, onAssign: a, reorder: o }) {
	return /* @__PURE__ */ Y("div", {
		className: o ? "flex items-center gap-1.5 shrink-0" : "flex items-center gap-4 xl:gap-1.5 shrink-0",
		children: [o ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(dm, {
			title: "Move down",
			icon: F.ArrowDown,
			disabled: !o.canMoveDown,
			onClick: o.onMoveDown
		}), /* @__PURE__ */ J(dm, {
			title: "Move up",
			icon: F.ArrowTop,
			disabled: !o.canMoveUp,
			onClick: o.onMoveUp
		})] }) : null, e ? /* @__PURE__ */ Y(q, { children: [
			i ? /* @__PURE__ */ J(dm, {
				title: "Edit",
				icon: F.Edit,
				onClick: i
			}) : null,
			a ? /* @__PURE__ */ J(dm, {
				title: "Assign to project",
				icon: F.FolderOpen,
				onClick: a
			}) : null,
			/* @__PURE__ */ J(dm, {
				title: "Delete chat",
				icon: F.Trash,
				variant: L.GhostDestructive,
				onClick: n
			})
		] }) : /* @__PURE__ */ Y(q, { children: [
			r ? /* @__PURE__ */ J(dm, {
				title: t ? "Unpin project" : "Pin project",
				icon: t ? F.Unpin : F.Pin,
				onClick: r
			}) : null,
			i ? /* @__PURE__ */ J(dm, {
				title: "Rename project",
				icon: F.Edit,
				onClick: i
			}) : null,
			/* @__PURE__ */ J(dm, {
				title: "Remove project",
				icon: F.Trash,
				variant: L.GhostDestructive,
				onClick: n
			})
		] })]
	});
}
//#endregion
//#region src/app/components/projects/ProjectCard.tsx
var pm = {
	default: "--color-bg-btn-ghost",
	hovered: "--color-bg-btn-ghost-hovered",
	pressed: "--color-bg-btn-ghost-pressed",
	highlighted: "--color-bg-btn-ghost-highlighted",
	highlightedHovered: "--color-bg-btn-ghost-highlighted-hovered",
	highlightedPressed: "--color-bg-btn-ghost-highlighted-pressed"
};
function mm({ highlighted: e, hover: t, pressed: n }) {
	return n ? e ? pm.highlightedPressed : pm.pressed : t ? e ? pm.highlightedHovered : pm.hovered : e ? pm.highlighted : pm.default;
}
function hm(e, t) {
	if (e.kind === "project") {
		let { project: t, sessions: n, running: r, totalCostMicros: i } = e.entry, a = n.find((e) => en(e.active_run));
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
	let { summary: n, active_run: r } = e.session, i = en(r);
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
function gm({ facts: e }) {
	let t = e.costMicros > 0 ? mr(e.costMicros) : null;
	return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2.5 shrink-0 min-w-0",
		children: [t ? /* @__PURE__ */ J("span", {
			className: "text-micro text-basic-primary whitespace-nowrap",
			children: t
		}) : null, e.countLabel ? /* @__PURE__ */ J("span", {
			className: "text-micro text-info-primary whitespace-nowrap truncate",
			children: e.countLabel
		}) : null]
	});
}
function _m({ facts: e }) {
	let t = n(e.representative?.backend);
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-wrap items-center gap-2.5 min-w-0 whitespace-nowrap",
		children: [/* @__PURE__ */ J("span", {
			className: "label-micro text-basic-tertiary",
			children: At(e.representative)
		}), t ? /* @__PURE__ */ J("span", {
			className: "text-micro text-basic-muted truncate md:max-w-[128px]",
			children: t
		}) : null]
	});
}
function vm({ getCardElement: e, onReorderStart: t }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		"aria-label": "Drag to reorder",
		className: z("absolute right-1.5 top-1/2 z-1 -translate-y-1/2", "flex h-6 items-center gap-[3px]", "cursor-grab active:cursor-grabbing touch-none", "rounded-sm border-0 bg-transparent p-0"),
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
		children: [/* @__PURE__ */ J("span", { className: "h-full w-px rounded-[2px] bg-divider-primary" }), /* @__PURE__ */ J("span", { className: "h-full w-px rounded-[2px] bg-divider-primary" })]
	});
}
function ym({ item: e, selected: t, attention: n, onOpen: r, onDelete: i, onTogglePin: a, onRename: o, onAssign: s, reorder: c, dragging: l = !1 }) {
	let u = hm(e, ul()), d = u.representative?.model_config_error, f = Ue(), p = jr(), [m, h] = K(!1), [g, _] = K(!1), [v, y] = K(!1), b = G(!1), x = G(null), S = !p || m || g || t, C = !!c && p, w = !!c && !p, T = p && m, E = () => {
		if (b.current) {
			b.current = !1;
			return;
		}
		r();
	};
	return /* @__PURE__ */ Y("div", {
		ref: x,
		"data-item-id": u.id,
		"data-item-kind": u.orphan ? "orphan" : "project",
		"data-item-pinned": u.pinned ? "true" : "false",
		className: z("group fade relative flex flex-col rounded-[8px] overflow-hidden cursor-default", f ? "gap-4 px-4 pt-4 pb-2" : "gap-4 px-6 pt-5 pb-3", "shadow-convex bg-elevation-level-1", l && "shadow-lg"),
		role: "button",
		tabIndex: 0,
		"aria-pressed": t,
		onClick: E,
		onKeyDown: (e) => {
			e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), E());
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
			/* @__PURE__ */ J("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none ease-out",
				style: { backgroundColor: `var(${mm({
					highlighted: u.running,
					hover: T,
					pressed: v
				})})` }
			}),
			t || g || l ? /* @__PURE__ */ J("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none border-2",
				style: { borderColor: "var(--blue-500)" }
			}) : null,
			n ? /* @__PURE__ */ J(Zt, {
				title: "Run finished",
				position: R.BottomLeft,
				sticky: !0,
				className: "absolute left-2 top-2 z-1",
				children: /* @__PURE__ */ J("span", { className: "block size-2 rounded-full bg-accent-primary" })
			}) : null,
			C && c ? /* @__PURE__ */ J(vm, {
				getCardElement: () => x.current,
				onReorderStart: (e) => {
					b.current = !0, c.onReorderStart(e), window.setTimeout(() => {
						b.current = !1;
					}, 100);
				}
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: "relative flex items-center gap-4 w-full",
				children: [u.orphan ? /* @__PURE__ */ J(Mi, { isRunning: u.running }) : /* @__PURE__ */ J(Rc, {
					id: u.id,
					size: 40,
					isRunning: u.running
				}), /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-0.5 flex-1 min-w-0",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-1.5 w-full",
						children: [
							u.pinned ? /* @__PURE__ */ J(M, {
								iconName: F.Pin,
								className: "text-basic-secondary shrink-0"
							}) : null,
							/* @__PURE__ */ J("div", {
								className: z("header-md flex-1 min-w-0 truncate", u.running ? "text-shimmer-basic" : "text-basic-primary"),
								children: u.title
							}),
							d ? /* @__PURE__ */ J(Zt, {
								title: d,
								position: R.BottomRight,
								sticky: !0,
								children: /* @__PURE__ */ J(M, {
									iconName: F.Repair,
									className: "text-error-primary shrink-0"
								})
							}) : null,
							u.running ? u.orphan ? /* @__PURE__ */ J(Ce, {
								size: je.Micro,
								className: "shrink-0"
							}) : /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-1 shrink-0",
								children: [/* @__PURE__ */ J(Ce, { size: je.XSmall }), /* @__PURE__ */ Y("span", {
									className: "text-micro text-basic-primary whitespace-nowrap",
									children: [u.runningCount, " Running"]
								})]
							}) : null
						]
					}), /* @__PURE__ */ J("div", {
						className: "code code-micro text-basic-tertiary truncate w-full",
						children: u.cwd
					})]
				})]
			}),
			p ? null : /* @__PURE__ */ J(_m, { facts: u }),
			/* @__PURE__ */ Y("div", {
				className: "relative flex items-center justify-between w-full h-6 gap-2",
				children: [/* @__PURE__ */ J(gm, { facts: u }), S ? /* @__PURE__ */ J(fm, {
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
				}) : /* @__PURE__ */ J(_m, { facts: u })]
			})
		]
	});
}
//#endregion
//#region src/app/components/projects/ProjectsEmptyState.tsx
function bm({ onStart: e, onAddRepository: t, onManagedSettings: n, modelReady: r, githubConnected: i, mobile: a }) {
	let s = t != null;
	return /* @__PURE__ */ J("div", {
		className: z("flex h-full flex-col items-center justify-center py-16", a ? "px-4" : "px-6"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex w-[420px] max-w-full flex-col items-center gap-6",
			children: [
				/* @__PURE__ */ J(Qc, {}),
				/* @__PURE__ */ Y("div", {
					className: "w-full text-center",
					children: [/* @__PURE__ */ J("p", {
						className: "header-2xl text-basic-primary",
						children: "No projects yet"
					}), /* @__PURE__ */ J("p", {
						className: "text-medium text-basic-tertiary",
						children: s ? "Connect a repository or create a Project from an existing path." : "Create your first and start building!"
					})]
				}),
				s ? /* @__PURE__ */ Y("div", {
					className: "grid w-full grid-cols-1 gap-2 rounded-lg border border-basic p-4 text-left sm:grid-cols-3",
					"data-testid": "managed-empty-status",
					children: [
						/* @__PURE__ */ J(xm, {
							label: "Arcee model",
							value: r ? "Ready" : "Needs attention",
							ready: !!r
						}),
						/* @__PURE__ */ J(xm, {
							label: "GitHub",
							value: i ? "Connected" : "Not connected",
							ready: !!i
						}),
						/* @__PURE__ */ J(xm, {
							label: "Projects",
							value: "None",
							ready: !1
						})
					]
				}) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-wrap justify-center gap-2",
					children: [
						/* @__PURE__ */ J(V, {
							variant: L.Primary,
							size: B.Large,
							content: o.Text,
							onClick: s ? t : e,
							children: s ? "Add repository" : "Get Started"
						}),
						s ? /* @__PURE__ */ J(V, {
							variant: L.Secondary,
							size: B.Large,
							content: o.Text,
							onClick: e,
							children: "Create Project"
						}) : null,
						s && !i && n ? /* @__PURE__ */ J(V, {
							variant: L.Tertiary,
							size: B.Large,
							content: o.Text,
							onClick: n,
							children: "Connect GitHub"
						}) : null
					]
				})
			]
		})
	});
}
function xm({ label: e, value: t, ready: n }) {
	return /* @__PURE__ */ Y("div", {
		className: "min-w-0",
		children: [/* @__PURE__ */ J("p", {
			className: "text-small text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ J("p", {
			className: `label-small ${n ? "text-success-primary" : "text-basic-primary"}`,
			children: t
		})]
	});
}
//#endregion
//#region src/app/components/pages/ProjectsListPage.tsx
function Sm({ children: e, single: t }) {
	return /* @__PURE__ */ J("div", {
		className: z("grid gap-2", t ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]"),
		children: e
	});
}
function Cm() {
	return /* @__PURE__ */ J("div", {
		"aria-hidden": !0,
		className: "min-h-[112px] rounded-[8px] border-2",
		style: { borderColor: "var(--blue-500)" }
	});
}
function wm(e) {
	return e.kind === "project" ? e.entry.sessions.map((e) => e.summary.session_id) : [e.session.summary.session_id];
}
function Tm(e) {
	return e.kind === "project" && e.entry.project.pinned;
}
function Em({ item: e, onOpen: t, reorderable: n, dragging: r, canMoveUp: i, canMoveDown: a, onMoveUp: o, onMoveDown: s, onReorderStart: c }) {
	let { useAnyAttention: l } = me().stores.attentionStore, u = Cf(), d = Lf(), f = {
		item: e,
		selected: !1,
		attention: l(wm(e)),
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
		return /* @__PURE__ */ J(ym, {
			...f,
			onTogglePin: () => void u.togglePin(t),
			onRename: () => u.rename(t),
			onDelete: () => u.remove(t)
		});
	}
	let { summary: p } = e.session;
	return /* @__PURE__ */ J(ym, {
		...f,
		onRename: () => d.rename(p),
		onDelete: () => d.remove(p),
		onAssign: () => u.assign(p)
	});
}
function Dm(e, t, n, r) {
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
function Om(e, t) {
	return e.filter((e) => e.pinned === t).sort((e, t) => e.sort_order - t.sort_order);
}
function km() {
	let { useVisibleProjectItems: e, useIsDefaultSort: t, useFilterQuery: n, setQuery: r } = me().stores.sessionFiltersStore, { trackAttention: i, clearAttentionAll: a } = me().stores.attentionStore, s = ci(), l = Ue(), d = Cf(), f = Np(), p = un(), m = n(), h = t(), g = c(), _ = Ot(), [v, y] = K(!1), [b, x] = K(null), [S, C] = K(null), [w, T] = K(!1), E = G(null), D = G(null), O = G(!1), { data: k, isLoading: ee, error: te, refetch: A } = Qt(), ne = et(), re = u(), j = W(() => ot(re, k ?? []), [k, re]), ie = W(() => ne.data?.projects ?? [], [ne.data]), ae = W(() => yl(ie, j), [ie, j]), oe = e(ae);
	U(() => {
		k && i(k, null);
	}, [k, i]);
	let se = (e) => {
		let t = vl(e);
		a(wm(e)), s(e.kind === "project" ? pr.project(t) : pr.session(t));
	}, ce = oe.filter(Tm), le = oe.filter((e) => e.kind === "project" && !Tm(e)), ue = oe.filter((e) => e.kind === "orphan"), de = W(() => Om(ie, !0), [ie]), fe = W(() => Om(ie, !1), [ie]), pe = W(() => _l(j), [j]), N = W(() => Oe(j, !1), [j]), he = H(() => {
		E.current = null, D.current = null, O.current = !1, x(null), C(null), T(!1);
	}, []), ge = H(async (e, t, n) => {
		let r = Om(ie, t).findIndex((t) => t.project_id === e), i = ie.find((t) => t.project_id === e);
		if (i && i.pinned === t && r === n) {
			he();
			return;
		}
		try {
			await g.mutateAsync({
				projects: ie,
				projectId: e,
				targetPinned: t,
				targetIndex: n
			});
		} catch (e) {
			p.error(`Failed to reorder projects: ${Qn($(e))}`);
		} finally {
			he();
		}
	}, [
		ie,
		he,
		g,
		p
	]), P = H(async (e, t) => {
		try {
			await _.mutateAsync({
				sessions: j,
				sessionId: e,
				targetPinned: !1,
				targetIndex: t
			});
		} catch (e) {
			p.error(`Failed to reorder chats: ${Qn($(e))}`);
		} finally {
			he();
		}
	}, [
		j,
		he,
		_,
		p
	]), _e = H(async (e, t) => {
		let n = j.find((t) => t.summary.session_id === e), r = ie.find((e) => e.project_id === t);
		if (!n || !r) {
			he();
			return;
		}
		if (Cl(ie, n.summary)?.project_id !== r.project_id) {
			p.error("That chat does not run in this project's location"), he();
			return;
		}
		try {
			d.assign(n.summary);
		} finally {
			he();
		}
	}, [
		j,
		he,
		d,
		ie,
		p
	]), ve = H((e, t) => {
		let n = e.pinned ? de : fe, r = n.findIndex((t) => t.project_id === e.project_id);
		if (r < 0) return;
		let i = r + t;
		i < 0 || i >= n.length || ge(e.project_id, e.pinned, i);
	}, [
		de,
		fe,
		ge
	]), I = H((e, t) => {
		let n = pe.findIndex((t) => t.summary.session_id === e), r = n < 0 ? void 0 : pe[n + t];
		if (!r) return;
		let i = Sn(N, r.summary.session_id, t === -1 ? "before" : "after", e);
		P(e, i);
	}, [
		pe,
		N,
		P
	]), ye = H((e, t, n) => {
		if (t === "orphan") {
			let t = ie.find((e) => e.project_id === n.itemId);
			if (t) {
				_e(e, t.project_id);
				return;
			}
			if (n.itemId === e) {
				he();
				return;
			}
			let r = Sn(N, n.itemId, n.edge, e);
			P(e, r);
			return;
		}
		let r = ie.find((e) => e.project_id === n.itemId);
		if (!r || n.itemId === e) {
			he();
			return;
		}
		let i = Om(ie, r.pinned).map((e) => e.project_id).filter((t) => t !== e).indexOf(n.itemId);
		if (i < 0) {
			he();
			return;
		}
		ge(e, r.pinned, n.edge === "before" ? i : i + 1);
	}, [
		_e,
		he,
		N,
		P,
		ge,
		ie
	]), be = H((e) => {
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
		E.current = t, x(t);
	}, []);
	U(() => {
		if (!b) return;
		let e = (e) => {
			let t = E.current;
			if (!t) return;
			let n = {
				...t,
				x: e.clientX - t.offsetX,
				y: e.clientY - t.offsetY
			};
			E.current = n, x(n);
			let r = Dm(e.clientX, e.clientY, t.itemId, t.kind);
			if (r === "pin-zone") {
				O.current = !0, D.current = null, T(!0), C(null);
				return;
			}
			O.current = !1, T(!1), r && (D.current = r, C((e) => e?.itemId === r.itemId && e.edge === r.edge ? e : r));
		}, t = () => {
			let e = E.current;
			if (!e) {
				he();
				return;
			}
			if (O.current && e.kind === "project") {
				ge(e.itemId, !0, 0);
				return;
			}
			let t = D.current;
			if (t) {
				ye(e.itemId, e.kind, t);
				return;
			}
			he();
		};
		return window.addEventListener("pointermove", e), window.addEventListener("pointerup", t), window.addEventListener("pointercancel", t), () => {
			window.removeEventListener("pointermove", e), window.removeEventListener("pointerup", t), window.removeEventListener("pointercancel", t);
		};
	}, [
		ye,
		he,
		b,
		ge
	]);
	let xe = (e) => {
		let t = vl(e), n = e.kind === "project" ? e.entry.project : null, r = n ? n.pinned ? de : fe : [], i = n ? r.findIndex((e) => e.project_id === n.project_id) : -1, a = e.kind === "orphan" ? pe.findIndex((e) => e.summary.session_id === t) : -1, o = n ? i : a, s = n ? r.length : pe.length, c = b?.itemId === t, l = !c && S?.itemId === t ? S.edge : null;
		return /* @__PURE__ */ Y(Hr, { children: [
			l === "before" ? /* @__PURE__ */ J(Cm, {}) : null,
			/* @__PURE__ */ J("div", {
				"data-item-id": t,
				"data-item-kind": e.kind,
				"data-dragging": c ? "true" : void 0,
				className: "relative",
				style: c && b ? {
					position: "fixed",
					left: b.x,
					top: b.y,
					width: b.width,
					zIndex: 50,
					pointerEvents: "none",
					margin: 0
				} : void 0,
				children: /* @__PURE__ */ J(Em, {
					item: e,
					onOpen: se,
					reorderable: h,
					dragging: c,
					canMoveUp: o > 0,
					canMoveDown: o >= 0 && o < s - 1,
					onMoveUp: () => {
						n ? ve(n, -1) : e.kind === "orphan" && I(t, -1);
					},
					onMoveDown: () => {
						n ? ve(n, 1) : e.kind === "orphan" && I(t, 1);
					},
					onReorderStart: be
				})
			}),
			l === "after" ? /* @__PURE__ */ J(Cm, {}) : null
		] }, t);
	}, Se = /* @__PURE__ */ Y("div", {
		className: "fixed inset-x-0 top-16 z-10 flex items-start gap-3 px-2 py-4",
		children: [/* @__PURE__ */ J(ec, {
			className: "flex-1 min-w-0",
			variant: $s.Search,
			placeholder: "Search projects…",
			value: m,
			onChange: (e) => r(e.target.value),
			onClear: () => r(""),
			"aria-label": "Search projects"
		}), /* @__PURE__ */ J(bi, {
			variant: L.Secondary,
			content: o.Icon,
			"aria-label": "Filters",
			"aria-expanded": v,
			onClick: () => y(!0),
			children: /* @__PURE__ */ J(M, { iconName: F.Controls })
		})]
	}), Ce = /* @__PURE__ */ J(Vn, {
		open: v,
		onClose: () => y(!1),
		title: "Filters",
		bodyClassName: "p-0",
		children: /* @__PURE__ */ J(Up, {
			sessions: j,
			showSearch: !1,
			mobile: !0,
			onChange: () => y(!1)
		})
	});
	if (!ee && !te && ae.length === 0) return /* @__PURE__ */ Y("div", {
		className: "flex h-full min-h-0",
		children: [l ? null : /* @__PURE__ */ J(im, { variant: "projects" }), /* @__PURE__ */ J("div", {
			className: "min-h-0 min-w-0 flex-1",
			children: /* @__PURE__ */ J(bm, {
				mobile: l,
				onStart: d.create,
				onAddRepository: f.isManaged ? f.addRepository : void 0,
				onManagedSettings: f.isManaged ? f.openSettings : void 0,
				modelReady: f.status?.model_ready,
				githubConnected: f.status?.github_status === "connected"
			})
		})]
	});
	let we = h && b != null && b.kind === "project" && ce.length === 0 && !ie.find((e) => e.project_id === b.itemId)?.pinned;
	return /* @__PURE__ */ Y("div", {
		className: "flex h-full min-h-0",
		children: [
			l ? null : /* @__PURE__ */ J(im, { variant: "projects" }),
			l ? Se : null,
			l ? Ce : null,
			/* @__PURE__ */ J("div", {
				className: z("flex-1 min-h-0 overflow-auto", l ? "px-2" : "px-8", b && "select-none cursor-grabbing"),
				children: /* @__PURE__ */ Y("div", {
					className: z("flex flex-col gap-6 [&>*]:shrink-0", l ? "pt-36 pb-8" : "py-4"),
					children: [
						te ? /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2 label-small text-error-primary",
							children: [/* @__PURE__ */ J("span", { children: Qn(te) }), /* @__PURE__ */ J(V, {
								variant: L.Ghost,
								size: B.Small,
								content: o.Text,
								onClick: () => {
									A();
								},
								children: "Try again"
							})]
						}) : null,
						!ee && !te && oe.length === 0 ? /* @__PURE__ */ J("div", {
							className: "label-small text-basic-muted text-center py-16",
							children: "No projects match the current filters."
						}) : null,
						ce.length > 0 || we ? /* @__PURE__ */ Y(Sm, {
							single: l,
							children: [ce.map(xe), we ? /* @__PURE__ */ J("div", {
								"data-pin-drop-zone": "true",
								className: z("min-h-[112px] rounded-[8px] border-2 border-dashed", w && "bg-info-primary/10"),
								style: { borderColor: "var(--blue-500)" }
							}) : null]
						}) : null,
						le.length > 0 ? /* @__PURE__ */ J(Sm, {
							single: l,
							children: le.map(xe)
						}) : null,
						ue.length > 0 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(cl, { children: "Unassigned chat sessions" }), /* @__PURE__ */ J(Sm, {
							single: l,
							children: ue.map(xe)
						})] }) : null
					]
				})
			})
		]
	});
}
//#endregion
//#region src/app/components/inspector/BranchPicker.tsx
function Am(e, t, n) {
	return e ? "A run is in flight; wait for it to finish." : t && !n ? "Uncommitted changes: commit or stash them before switching." : null;
}
function jm({ label: e, icon: t, active: n, disabled: r, title: i, onClick: a }) {
	let o = Ue();
	return /* @__PURE__ */ Y(qc, {
		type: "button",
		size: o ? Gc.Large : Gc.Small,
		active: n,
		disabled: r,
		title: i,
		onClick: a,
		children: [/* @__PURE__ */ J(M, {
			iconName: t,
			className: "shrink-0"
		}), /* @__PURE__ */ J("span", {
			className: "flex-1 min-w-0 truncate text-left",
			children: e
		})]
	});
}
function Mm({ busy: e, children: t }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
		children: [e ? /* @__PURE__ */ J(Ce, {
			size: je.Small,
			variant: O.Neutral
		}) : null, t]
	});
}
function Nm({ sessionId: e, branch: t, placement: n = R.TopRight }) {
	let { useRunning: r } = me().stores.runtimeStore, [i, a] = K(!1), [o, s] = K(""), c = r(e), { data: l, isLoading: u, error: d } = it(e, i), f = pe(e), p = () => {
		a(!1), s(""), f.reset();
	}, m = o.trim(), h = (l?.branches ?? []).filter((e) => e.name.toLowerCase().includes(m.toLowerCase())), g = (l?.branches ?? []).some((e) => e.name === m), _ = l?.dirty ?? !1, v = Am(c, _, !0), y = Am(c, _, !1), b = Ue(), x = (e, t) => {
		f.mutate({
			name: e,
			create: t
		}, { onSuccess: p });
	}, S = d ? Qn(d) : f.error ? Qn(f.error) : null;
	return /* @__PURE__ */ J(Kn, {
		open: i,
		onClose: p,
		placement: n,
		sticky: !0,
		className: "min-w-0",
		content: /* @__PURE__ */ Y("div", {
			className: "h-[calc(70dvh)] md:h-[280px] flex flex-col",
			children: [
				/* @__PURE__ */ Y("div", {
					className: "p-4 pt-0 md:pb-2 md:px-0 flex flex-col gap-2 shrink-0",
					children: [/* @__PURE__ */ J(Z, {
						autoFocus: !0,
						inputSize: b ? X.Large : X.Small,
						placeholder: "Find or create a branch",
						value: o,
						onChange: (e) => s(e.target.value)
					}), m && !g && !d ? /* @__PURE__ */ J(jm, {
						label: /* @__PURE__ */ Y(q, { children: ["Create ", /* @__PURE__ */ J("span", {
							className: "text-basic-primary",
							children: m
						})] }),
						icon: F.Add,
						disabled: !!v,
						title: v ?? void 0,
						onClick: () => x(m, !0)
					}) : null]
				}),
				u ? /* @__PURE__ */ J("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ J(Mm, {
						busy: !0,
						children: "Reading branches…"
					})
				}) : null,
				!u && !d ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-h-0 gap-2 md:gap-1 p-2 md:p-0 overflow-auto [&>*]:shrink-0",
					children: [h.map((e) => {
						let t = e.is_current ? null : y;
						return /* @__PURE__ */ J(jm, {
							label: e.name,
							icon: e.is_current ? F.Check : F.Scheme,
							active: e.is_current,
							disabled: !!t,
							title: t ?? void 0,
							onClick: e.is_current ? () => {} : () => x(e.name, !1)
						}, e.name);
					}), h.length === 0 && !m ? /* @__PURE__ */ J(Mm, { children: "No local branches." }) : null]
				}) : null,
				f.isPending ? /* @__PURE__ */ J("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ J(Mm, {
						busy: !0,
						children: "Working…"
					})
				}) : null,
				S ? /* @__PURE__ */ J("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ J(vc, {
						variant: lc.Error,
						title: S
					})
				}) : null,
				!S && _ && !c ? /* @__PURE__ */ J("div", {
					className: "shrink-0 px-4 pt-2 md:px-0 md:pt-0",
					children: /* @__PURE__ */ J(vc, {
						variant: lc.Info,
						title: "Uncommitted changes: you can branch off them, but not switch away."
					})
				}) : null
			]
		}),
		children: /* @__PURE__ */ Y("button", {
			type: "button",
			className: "flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost",
			"aria-expanded": i,
			"aria-label": `Branch: ${t}`,
			onClick: () => i ? p() : a(!0),
			children: [/* @__PURE__ */ J(M, {
				iconName: F.Scheme,
				size: 16,
				className: "shrink-0"
			}), /* @__PURE__ */ J("span", {
				className: "label-micro text-btn-secondary truncate max-w-[64px] xl:max-w-[128px]",
				children: t
			})]
		})
	});
}
//#endregion
//#region src/app/components/inspector/AgentSpawnMenu.tsx
var Pm = {
	title: "Create Subagent",
	description: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from Subagents.",
	muted: !0
}, Fm = {
	title: "Create Orchestrator Subagent",
	description: "Start a separate NAC planning session. Browse, steer, continue, and cancel it from Subagents.",
	muted: !0
};
function Im({ sessionId: e, behavior: t, className: n, onCreateSubagent: r, onCreateOrchestrator: i }) {
	let a = u().orchestrationEnabled && t === "direct-with-orchestrator", s = fe(e, !0), c = d(e, a), [l, f] = K(!1), p = (s.data ?? []).some((e) => e.status === "running") || a && (c.data ?? []).some((e) => e.status === "running");
	return /* @__PURE__ */ J(Kn, {
		open: l,
		onClose: () => f(!1),
		sticky: !0,
		sheetOnMobile: !1,
		placement: R.TopRight,
		panelClassName: "gap-2",
		className: n,
		content: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y(qc, {
			hoverHint: Pm,
			onClick: () => {
				f(!1), r();
			},
			children: [/* @__PURE__ */ J(M, { iconName: F.Plane }), /* @__PURE__ */ J("span", {
				className: "min-w-0 flex-1 truncate text-left",
				children: "Create Subagent"
			})]
		}), a ? /* @__PURE__ */ Y(qc, {
			hoverHint: Fm,
			onClick: () => {
				f(!1), i();
			},
			children: [/* @__PURE__ */ J(M, { iconName: F.Orchestrator }), /* @__PURE__ */ J("span", {
				className: "min-w-0 flex-1 truncate text-left",
				children: "Create Orchestrator Subagent"
			})]
		}) : null] }),
		children: /* @__PURE__ */ J(V, {
			type: "button",
			size: B.Large,
			variant: p ? L.GhostHighlightedAccent : L.Ghost,
			content: o.Icon,
			"aria-label": "Spawn",
			"aria-expanded": l,
			onClick: () => f((e) => !e),
			children: /* @__PURE__ */ J(M, {
				iconName: F.Add,
				size: 24,
				className: z("transition-transform", l && "rotate-45")
			})
		})
	});
}
//#endregion
//#region src/app/components/inspector/ModelPicker.tsx
var Lm = {
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
}, Rm = [{
	id: "",
	label: "Default effort",
	hoverHint: {
		...Lm[""],
		muted: !0
	}
}, ...$u.map((e) => ({
	...e,
	hoverHint: {
		...Lm[e.id],
		muted: !0
	}
}))];
function zm({ sessionId: e, metadata: t, label: n, disabled: r }) {
	let i = un(), a = Gn(), o = pd(), s = Or(a.data), c = Sr(), l = t?.model ?? n, u = t?.reasoning_effort ?? "", d = t ? {
		backend: t.backend,
		model: t.model,
		baseUrl: t.base_url ?? ""
	} : null, f = gu(a.data, t?.backend, l), p = W(() => nd(f.supportedEfforts, u, Rm), [f.supportedEfforts, u]), m = p.find((e) => e.id === u)?.label, h = typeof m == "string" ? m : "Default effort", [g, _] = K(!1), v = async (n) => {
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
		let d = gu(a.data, n.backend, n.model).supportedEfforts, f = u && d.includes(u) ? u : null, p = s ? {
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
			i.error(`The model was not switched: ${eu($(e), n.backend)}`);
		}
	}, y = async (n) => {
		if (!(!t || n === u)) try {
			await c.mutateAsync({
				id: e,
				patch: { reasoning_effort: n || null }
			}), i.success(`Reasoning set to ${n || "the model default"}`);
		} catch (e) {
			i.error(`Reasoning was not changed: ${eu($(e), t.backend)}`);
		}
	};
	return /* @__PURE__ */ Y("div", {
		className: "flex min-w-0 items-center",
		children: [
			/* @__PURE__ */ J(Eu, {
				catalog: a.data,
				loading: a.isLoading,
				failed: a.isError,
				compact: !0,
				disabled: r || !t || c.isPending,
				liveByBackend: s,
				value: d,
				onSelect: (e) => void v(e)
			}),
			/* @__PURE__ */ J("span", {
				"aria-hidden": !0,
				className: "h-6 w-px shrink-0 bg-divider-muted"
			}),
			/* @__PURE__ */ J(Zt, {
				title: `Effort: ${h}`,
				description: "How much the model reasons before it answers.",
				position: R.TopCenter,
				sticky: !0,
				disabled: g,
				children: /* @__PURE__ */ J(sd, {
					items: p,
					value: u,
					placeholder: "Default effort",
					disabled: r || !t || c.isPending,
					size: B.Small,
					trailingIcon: F.Right,
					triggerClassName: "!gap-1.5 !pl-3",
					placement: R.TopCenter,
					onOpenChange: _,
					onValueChange: (e) => void y(e)
				})
			})
		]
	});
}
//#endregion
//#region src/app/components/inspector/PermissionControls.tsx
function Bm(e) {
	return e.map((e) => e.id).join(":");
}
function Vm({ grant: e, deleting: t, onDelete: n }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex items-start gap-3 rounded-[4px] bg-elevation-level-2 px-3 py-2",
		children: [/* @__PURE__ */ Y("div", {
			className: "min-w-0 flex-1",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex flex-wrap items-center gap-x-2 gap-y-1",
				children: [/* @__PURE__ */ J("span", {
					className: "tag-label uppercase text-basic-secondary",
					children: e.action
				}), /* @__PURE__ */ J("span", {
					className: "tag-label uppercase text-basic-tertiary",
					children: e.backend
				})]
			}), /* @__PURE__ */ J("div", {
				className: "mt-1 break-all code code-small text-basic-primary",
				children: e.resource
			})]
		}), /* @__PURE__ */ J(V, {
			size: B.Small,
			variant: L.GhostDestructive,
			content: o.Icon,
			"aria-label": `Forget ${e.action} permission`,
			loading: t,
			onClick: n,
			children: /* @__PURE__ */ J(M, {
				iconName: F.Trash,
				size: 16
			})
		})]
	});
}
function Hm({ sessionId: e, behavior: t, label: n = "Permissions", autoApprovalAvailable: r = !0, requesterLabel: i }) {
	let a = t === "direct" || t === "direct-with-orchestrator", s = st(e, a), c = rt(), l = ne(), u = Vr(), d = un(), f = s.data?.requests ?? [], p = s.data?.grants ?? [], m = s.data?.approval_mode === "auto_approve", h = m && !r, [g, _] = K(!1), [v, y] = K(""), [b, x] = K(null), [S, C] = K(null), w = Bm(f), T = g || !!(w && w !== v), E = () => {
		y(w), _(!1);
	};
	if (!a) return null;
	let D = f[0] ?? null, O = D?.resources.some((e) => e.save_resource) ?? !1, k = async (t) => {
		if (!(!D || b)) {
			x(D.id);
			try {
				await c.mutateAsync({
					sessionId: e,
					requestId: D.id,
					reply: t
				}), f.length === 1 && E();
			} catch (e) {
				d.error(`Unable to answer permission request: ${Qn($(e))}`);
			} finally {
				x(null);
			}
		}
	}, ee = async (t) => {
		if (!S) {
			C(t.id);
			try {
				await u.mutateAsync({
					sessionId: e,
					grantId: t.id
				});
			} catch (e) {
				d.error(`Unable to forget permission: ${Qn($(e))}`);
			} finally {
				C(null);
			}
		}
	}, te = async (t) => {
		_(!0);
		try {
			await l.mutateAsync({
				sessionId: e,
				mode: t ? "auto_approve" : "manual"
			});
		} catch (e) {
			d.error(`Unable to change approval mode: ${Qn($(e))}`);
		}
	}, A = f.length ? ` (${f.length})` : p.length ? ` (${p.length})` : "", re = m ? "Accept all" : "Manually", j = h ? "Requests are approved automatically because the parent session accepts all. Change the mode on the parent." : m ? "Requests are approved automatically for this session and the agents it owns." : "Each request pauses until you approve or deny it.";
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Zt, {
		title: `Permission: ${re}`,
		description: j,
		position: R.TopCenter,
		children: /* @__PURE__ */ Y(V, {
			size: B.Small,
			variant: f.length ? L.GhostHighlightedAccent : L.Ghost,
			content: o.IconLeft,
			className: "pr-3",
			"aria-label": m ? h ? `${n} — auto-approve inherited; open permissions` : "Auto-approve on — open permissions" : `${n}${A}`,
			onClick: () => _(!0),
			children: [/* @__PURE__ */ J(M, {
				iconName: F.Private,
				size: 16
			}), /* @__PURE__ */ J("span", {
				className: "label-micro",
				children: m ? "Accept all" : "Manually"
			})]
		})
	}), /* @__PURE__ */ J(Vn, {
		open: T,
		onClose: E,
		size: or.Wide,
		flush: !0,
		title: D ? "Permission required" : "Permissions",
		subheader: D ? `${D.tool} requested by ${i ?? "this session"} is paused before execution.` : h ? "Automatic approval is inherited from the parent session; change it from the parent." : m ? "Automatic approval is active for this session and its owned child agents." : "Remembered access for this session.",
		footer: D ? /* @__PURE__ */ Y("div", {
			className: "flex w-full flex-wrap justify-end gap-2",
			children: [
				/* @__PURE__ */ J(V, {
					variant: L.SecondaryDestructive,
					loading: b === D.id && c.variables?.reply === "reject",
					disabled: b !== null,
					onClick: () => void k("reject"),
					children: "Reject"
				}),
				/* @__PURE__ */ J(V, {
					variant: L.Secondary,
					loading: b === D.id && c.variables?.reply === "once",
					disabled: b !== null,
					onClick: () => void k("once"),
					children: "Allow once"
				}),
				/* @__PURE__ */ J(V, {
					variant: L.Primary,
					loading: b === D.id && c.variables?.reply === "always",
					disabled: b !== null || !O,
					title: O ? "Remember the server-derived narrow access pattern" : "This operation has no safe reusable permission pattern",
					onClick: () => void k("always"),
					children: "Always allow"
				})
			]
		}) : void 0,
		children: s.isPending ? /* @__PURE__ */ J("div", {
			className: "py-6 text-center text-small text-basic-secondary",
			children: "Loading permissions…"
		}) : s.isError ? /* @__PURE__ */ J("div", {
			className: "rounded-[4px] bg-error-secondary p-3 text-small text-error-primary",
			children: "Permissions could not be loaded. The run remains fail-closed."
		}) : /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-5",
			children: [
				r ? /* @__PURE__ */ Y("section", {
					"aria-label": "Automatic approval mode",
					className: m ? "rounded-[6px] border border-accent-primary bg-elevation-level-2 p-3" : "rounded-[6px] bg-elevation-level-2 p-3",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex items-start justify-between gap-4",
						children: [/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("div", {
							className: "text-small font-medium text-basic-primary",
							children: "Approve all automatically"
						}), /* @__PURE__ */ J("div", {
							className: "mt-1 text-small text-basic-secondary",
							children: "Automatically allows ordinary requests only after they reach this session’s or an owned child agent’s permission broker. Hard and configured denials still apply."
						})] }), /* @__PURE__ */ J(al, {
							"aria-label": "Approve all automatically",
							checked: m,
							disabled: l.isPending,
							onChange: (e) => void te(e)
						})]
					}), /* @__PURE__ */ J("div", {
						className: "mt-2 text-small text-basic-tertiary",
						children: "This setting governs this session and all existing or future owned child agents. It stays active across restarts until you turn it off and does not create remembered permissions. Separately managed orchestrators are not included."
					})]
				}) : null,
				h ? /* @__PURE__ */ Y("section", {
					"aria-label": "Inherited automatic approval mode",
					className: "rounded-[6px] border border-accent-primary bg-elevation-level-2 p-3",
					children: [/* @__PURE__ */ J("div", {
						className: "text-small font-medium text-basic-primary",
						children: "Auto-approve inherited"
					}), /* @__PURE__ */ J("div", {
						className: "mt-1 text-small text-basic-secondary",
						children: "Ordinary requests from this child agent inherit automatic approval from the parent session. Change this mode from the parent session; hard and configured denials still apply."
					})]
				}) : null,
				D ? /* @__PURE__ */ Y("section", {
					"aria-label": "Requested access",
					children: [
						/* @__PURE__ */ Y("div", {
							className: "mb-2 text-small text-basic-secondary",
							children: [
								"Requested by ",
								i ?? "this session",
								" (",
								D.session_id,
								"). Manual approval is effective because automatic approval is off for this session and its owned child agents."
							]
						}),
						/* @__PURE__ */ J("div", {
							className: "mb-2 tag-label uppercase text-basic-tertiary",
							children: "Requested access"
						}),
						/* @__PURE__ */ J("div", {
							className: "flex flex-col gap-2",
							children: D.resources.map((e, t) => /* @__PURE__ */ Y("div", {
								className: "rounded-[4px] bg-elevation-level-2 px-3 py-2",
								children: [
									/* @__PURE__ */ J("div", {
										className: "tag-label uppercase text-basic-secondary",
										children: e.action
									}),
									/* @__PURE__ */ J("div", {
										className: "mt-1 break-words text-small text-basic-primary",
										children: e.display
									}),
									e.save_resource ? /* @__PURE__ */ Y("div", {
										className: "mt-2 break-all code code-small text-basic-tertiary",
										children: ["Always: ", e.save_resource]
									}) : null
								]
							}, `${e.action}:${e.resource}:${t}`))
						}),
						f.length > 1 ? /* @__PURE__ */ Y("div", {
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
				/* @__PURE__ */ Y("section", {
					"aria-label": "Remembered permissions",
					children: [/* @__PURE__ */ J("div", {
						className: "mb-2 tag-label uppercase text-basic-tertiary",
						children: "Remembered for this session"
					}), p.length ? /* @__PURE__ */ J("div", {
						className: "flex flex-col gap-2",
						children: p.map((e) => /* @__PURE__ */ J(Vm, {
							grant: e,
							deleting: S === e.id,
							onDelete: () => void ee(e)
						}, e.id))
					}) : /* @__PURE__ */ J("div", {
						className: "text-small text-basic-secondary",
						children: "No remembered permissions."
					})]
				})
			]
		})
	})] });
}
//#endregion
//#region src/app/components/inspector/GoalControls.tsx
function Um(e) {
	return e.replaceAll("_", " ");
}
function Wm(e) {
	return e?.token_budget === null || e?.token_budget === void 0 ? "" : String(e.token_budget);
}
function Gm(e) {
	let t = e.trim();
	if (!t) return null;
	let n = Number(t);
	return Number.isSafeInteger(n) && n > 0 ? n : void 0;
}
function Km({ sessionId: e, behavior: t, openRequest: n = 0 }) {
	let r = t === "direct" || t === "direct-with-orchestrator", i = ae(e, r), a = _e(), s = ht(), c = ce(), l = un(), u = i.data ?? null, [d, f] = K(!1), [p, m] = K(""), [h, g] = K(""), _ = G(0);
	if (U(() => {
		n !== 0 && n !== _.current && (_.current = n, m(u?.objective ?? ""), g(Wm(u)), f(!0));
	}, [u, n]), !r) return null;
	let v = a.isPending || s.isPending || c.isPending, y = () => {
		m(u?.objective ?? ""), g(Wm(u)), f(!0);
	}, b = (e, t) => {
		l.error(`${e}: ${Qn($(t))}`);
	}, x = async () => {
		let t = Gm(h);
		if (!p.trim()) {
			l.error("Goal objective is required.");
			return;
		}
		if (t === void 0) {
			l.error("Token budget must be a positive whole number or blank.");
			return;
		}
		try {
			u && u.status !== "complete" ? await s.mutateAsync({
				sessionId: e,
				goalId: u.goal_id,
				payload: {
					expected_version: u.version,
					objective: p.trim(),
					token_budget: t
				}
			}) : await a.mutateAsync({
				sessionId: e,
				payload: {
					objective: p.trim(),
					...t === null ? {} : { token_budget: t }
				}
			});
		} catch (e) {
			b(u && u.status !== "complete" ? "Unable to update goal" : "Unable to create goal", e);
		}
	}, S = async (t) => {
		if (u) try {
			await s.mutateAsync({
				sessionId: e,
				goalId: u.goal_id,
				payload: {
					expected_version: u.version,
					status: t
				}
			});
		} catch (e) {
			b("Unable to change goal status", e);
		}
	}, C = async () => {
		if (u) try {
			await c.mutateAsync({
				sessionId: e,
				goalId: u.goal_id,
				expectedVersion: u.version
			}), m(""), g("");
		} catch (e) {
			b("Unable to clear goal", e);
		}
	};
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Zt, {
		title: "Durable goal",
		position: R.TopCenter,
		children: /* @__PURE__ */ J(V, {
			size: B.Small,
			variant: u?.status === "active" ? L.GhostHighlightedAccent : L.Ghost,
			content: o.Icon,
			"aria-label": u ? `Goal: ${Um(u.status)}` : "Create durable goal",
			onClick: y,
			children: /* @__PURE__ */ J(M, {
				iconName: F.Flag,
				size: 16
			})
		})
	}), /* @__PURE__ */ J(Vn, {
		open: d,
		onClose: () => f(!1),
		size: or.Wide,
		title: u?.status === "complete" ? "Replace durable goal" : u ? "Durable goal" : "Create durable goal",
		subheader: "Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited.",
		children: i.isPending ? /* @__PURE__ */ J("div", {
			className: "py-6 text-center text-small text-basic-secondary",
			children: "Loading goal…"
		}) : i.isError ? /* @__PURE__ */ J("div", {
			className: "rounded-[4px] bg-error-secondary p-3 text-small text-error-primary",
			children: "Goal state could not be loaded."
		}) : /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-4",
			children: [
				u ? /* @__PURE__ */ Y("div", {
					className: "rounded-[4px] bg-elevation-level-2 px-3 py-2 text-small",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex flex-wrap items-center justify-between gap-2",
						children: [/* @__PURE__ */ J("span", {
							className: "tag-label uppercase text-basic-secondary",
							children: Um(u.status)
						}), /* @__PURE__ */ Y("span", {
							className: "text-basic-tertiary",
							children: [
								u.tokens_used.toLocaleString(),
								" tokens ·",
								" ",
								Math.floor(u.time_used_ms / 1e3),
								"s"
							]
						})]
					}), u.token_budget === null ? null : /* @__PURE__ */ Y("div", {
						className: "mt-1 text-basic-tertiary",
						children: [Math.max(0, u.token_budget - u.tokens_used).toLocaleString(), " tokens remaining"]
					})]
				}) : null,
				/* @__PURE__ */ J(nc, {
					label: "Objective",
					textAreaSize: tc.Medium,
					placeholder: "Describe the concrete outcome",
					value: p,
					onChange: (e) => m(e.target.value),
					textAreaClassName: "h-[112px] resize-none"
				}),
				/* @__PURE__ */ J(Z, {
					label: "Token budget (optional)",
					inputSize: X.Medium,
					inputMode: "numeric",
					placeholder: "No limit",
					value: h,
					onChange: (e) => g(e.target.value)
				}),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-wrap justify-end gap-2",
					children: [u ? /* @__PURE__ */ Y(q, { children: [u.status === "active" ? /* @__PURE__ */ Y(q, { children: [
						/* @__PURE__ */ J(V, {
							variant: L.Secondary,
							disabled: v,
							onClick: () => void S("paused"),
							children: "Pause"
						}),
						/* @__PURE__ */ J(V, {
							variant: L.Secondary,
							disabled: v,
							onClick: () => void S("usage_limited"),
							children: "Usage limit"
						}),
						/* @__PURE__ */ J(V, {
							variant: L.Secondary,
							disabled: v,
							onClick: () => void S("budget_limited"),
							children: "Budget limit"
						})
					] }) : u.status === "complete" ? null : /* @__PURE__ */ J(V, {
						variant: L.Secondary,
						disabled: v,
						onClick: () => void S("active"),
						children: "Resume"
					}), /* @__PURE__ */ J(V, {
						variant: L.GhostDestructive,
						disabled: v,
						onClick: () => void C(),
						children: "Clear"
					})] }) : null, /* @__PURE__ */ J(V, {
						variant: L.Primary,
						loading: v,
						onClick: () => void x(),
						children: u?.status === "complete" ? "Replace and start" : u ? "Save" : "Create and start"
					})]
				})
			]
		})
	})] });
}
//#endregion
//#region src/app/components/inspector/GoalComposer.tsx
var qm = "Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited.", Jm = 100, Ym = 1e6, Xm = 100, Zm = 9600;
function Qm(e) {
	let t = e.replaceAll("_", " ");
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function $m(e) {
	return e === "active" ? _i.Green : e === "complete" ? _i.Gray : _i.Yellow;
}
function eh(e) {
	let t = Math.round(e / Xm) * Xm;
	return Math.min(Ym, Math.max(Jm, t));
}
function th({ sessionId: e, className: t, onOpen: n }) {
	let r = ae(e, !0).data ?? null, i = r?.status === "active";
	return /* @__PURE__ */ J(Zt, {
		className: t,
		position: R.TopCenter,
		title: r ? `Current Goal: ${Qm(r.status)} - Click To Edit` : "Set Durable Goal",
		description: r ? r.objective : qm,
		children: /* @__PURE__ */ J(V, {
			type: "button",
			size: B.Large,
			variant: i ? L.GhostHighlightedAccent : L.Ghost,
			content: o.Icon,
			"aria-label": r ? `Edit goal: ${Qm(r.status)}` : "Set durable goal",
			onClick: n,
			children: /* @__PURE__ */ J(M, {
				iconName: F.Flag,
				size: 24
			})
		})
	});
}
function nh({ sessionId: e, onClose: t }) {
	let n = ae(e, !0), r = _e(), i = ht(), a = ce(), s = un(), c = n.data ?? null, [l, u] = K(c?.objective ?? ""), [d, f] = K(c?.token_budget != null), [p, m] = K(eh(c?.token_budget ?? Zm)), h = G(n.data !== void 0);
	U(() => {
		if (h.current || n.isPending) return;
		h.current = !0;
		let e = n.data ?? null;
		u(e?.objective ?? ""), f(e?.token_budget != null), m(eh(e?.token_budget ?? Zm));
	}, [n.data, n.isPending]);
	let g = r.isPending || i.isPending || a.isPending, _ = c != null && c.status !== "complete", v = (e, t) => {
		s.error(`${e}: ${Qn($(t))}`);
	}, y = async (n) => {
		let a = d ? p : null;
		if (!l.trim()) {
			s.error("Goal objective is required.");
			return;
		}
		try {
			_ && c ? await i.mutateAsync({
				sessionId: e,
				goalId: c.goal_id,
				payload: {
					expected_version: c.version,
					objective: l.trim(),
					token_budget: a
				}
			}) : await r.mutateAsync({
				sessionId: e,
				payload: {
					objective: l.trim(),
					...a === null ? {} : { token_budget: a }
				}
			}), n && t();
		} catch (e) {
			v(_ ? "Unable to update goal" : "Unable to create goal", e);
		}
	}, b = async (t) => {
		if (c) try {
			await i.mutateAsync({
				sessionId: e,
				goalId: c.goal_id,
				payload: {
					expected_version: c.version,
					status: t
				}
			});
		} catch (e) {
			v("Unable to change goal status", e);
		}
	}, x = async () => {
		if (c) try {
			await a.mutateAsync({
				sessionId: e,
				goalId: c.goal_id,
				expectedVersion: c.version
			}), u(""), f(!1), m(Zm);
		} catch (e) {
			v("Unable to clear goal", e);
		}
	}, S = rh(c, g || !l.trim());
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 rounded-[8px] bg-input p-2",
			children: [n.isPending ? /* @__PURE__ */ J("div", {
				className: "text-micro text-basic-secondary",
				children: "Loading goal…"
			}) : n.isError ? /* @__PURE__ */ J("div", {
				className: "rounded-[4px] bg-error-secondary p-2 text-micro text-error-primary",
				children: "Goal state could not be loaded."
			}) : c ? /* @__PURE__ */ Y("div", {
				className: "flex flex-wrap items-center gap-2",
				children: [
					/* @__PURE__ */ J("span", {
						className: "shrink-0 text-micro font-semibold text-basic-primary",
						children: "Current Goal"
					}),
					/* @__PURE__ */ J(vi, {
						text: Qm(c.status),
						color: $m(c.status)
					}),
					/* @__PURE__ */ Y("span", {
						className: "min-w-0 flex-1 truncate text-micro text-basic-secondary",
						children: [
							c.tokens_used.toLocaleString(),
							" Tokens, ",
							Math.floor(c.time_used_ms / 1e3),
							"s"
						]
					}),
					/* @__PURE__ */ J(V, {
						type: "button",
						size: B.Small,
						variant: L.GhostDestructive,
						disabled: g,
						onClick: () => void x(),
						children: "Clear"
					}),
					/* @__PURE__ */ J(V, {
						type: "button",
						size: B.Small,
						variant: L.Primary,
						loading: g,
						disabled: !l.trim(),
						onClick: () => void y(!_),
						children: c.status === "complete" ? "Replace" : "Save"
					})
				]
			}) : null, /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2",
				children: [
					/* @__PURE__ */ J(al, {
						checked: d,
						disabled: g,
						"aria-label": "Token budget",
						onChange: f
					}),
					/* @__PURE__ */ J("span", {
						className: "label-micro shrink-0 text-basic-primary",
						children: "Token Budget"
					}),
					d ? null : /* @__PURE__ */ J("span", {
						className: "w-16 shrink-0 text-micro text-basic-muted",
						children: "Disabled"
					}),
					/* @__PURE__ */ J("span", {
						className: "code code-small w-[60px] shrink-0 text-right text-basic-secondary",
						children: p.toLocaleString()
					}),
					/* @__PURE__ */ J(Wc, {
						className: "min-w-0 flex-1",
						min: Jm,
						max: Ym,
						step: Xm,
						value: p,
						disabled: g,
						label: "Token budget",
						onChange: (e) => {
							m(e), f(!0);
						}
					})
				]
			})]
		}), /* @__PURE__ */ Y("div", {
			className: "relative flex items-end rounded-[4px] bg-btn-secondary-accent pr-[96px]",
			children: [
				/* @__PURE__ */ J("textarea", {
					className: "relative block min-h-[48px] w-full resize-none border-none bg-transparent p-3 text-medium text-input outline-none placeholder:text-input-placeholder",
					rows: l.length > 80 ? 3 : 1,
					"aria-label": "Goal objective",
					placeholder: "Describe the concrete output",
					value: l,
					onChange: (e) => u(e.target.value),
					onKeyDown: (e) => {
						if (e.key === "Escape") {
							e.preventDefault(), t();
							return;
						}
						e.key !== "Enter" || e.shiftKey || (e.preventDefault(), y(c == null || c.status === "complete"));
					}
				}),
				/* @__PURE__ */ J(V, {
					type: "button",
					className: "absolute right-[48px] bottom-0",
					size: B.Large,
					variant: L.Ghost,
					content: o.Icon,
					"aria-label": "Close goal editor",
					onClick: t,
					children: /* @__PURE__ */ J(M, {
						iconName: F.Close,
						size: 24
					})
				}),
				/* @__PURE__ */ J(V, {
					type: "button",
					className: "absolute right-0 bottom-0",
					size: B.Large,
					variant: L.Primary,
					content: o.Icon,
					disabled: S.disabled || g,
					loading: g && S.kind === "save",
					"aria-label": S.label,
					onClick: () => {
						S.kind === "pause" ? b("paused") : S.kind === "resume" ? b("active") : y(!0);
					},
					children: /* @__PURE__ */ J(M, { iconName: S.icon })
				})
			]
		})]
	});
}
function rh(e, t) {
	return e?.status === "active" ? {
		kind: "pause",
		label: "Pause goal",
		icon: F.Stop,
		disabled: !1
	} : e && e.status !== "complete" ? {
		kind: "resume",
		label: "Resume goal",
		icon: F.Play,
		disabled: !1
	} : {
		kind: "save",
		label: e?.status === "complete" ? "Replace goal" : "Create goal",
		icon: F.Plane,
		disabled: t
	};
}
//#endregion
//#region src/app/features/direct-session/browserAdapters.ts
function ih(e, t, n = {
	readMessages: mt(e).api.getMessages,
	subscribe: mt(e).events
}) {
	let { applyAssistantDelta: r, applyEnvelope: i, captureRuntimeActivation: a, clearRuntimeThreads: o, resetRuntime: c, setStreamStatus: l, syncRunFromSnapshot: u } = mt(e).stores.runtimeStore, d = T(e, t), f = !1, p = () => !1;
	return {
		attach: () => {
			f = !0, c(t), p = a(t), u(e.getQueryData(tr.sessionSnapshot(t))?.active_run);
		},
		detach: () => {
			f = !1, p() && c(null), We(d), e.cancelQueries({
				queryKey: tr.sessionSnapshot(t),
				exact: !0
			}), e.cancelQueries({ queryKey: tr.threadEventsRoot(t) }), e.removeQueries({ queryKey: tr.threadEventsRoot(t) });
		},
		subscribe: (e) => n.subscribe(t, {
			onEnvelope: (t) => {
				if (!f) return;
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
				f && r(e);
			},
			onStatus: (e) => {
				f && l(e);
			},
			onReplayBoundary: (t) => {
				f && e.epoch(t.epoch_id);
			},
			onReplayGap: e.replayLost,
			onLagged: e.replayLost,
			onSequenceGap: e.replayLost,
			onBackpressure: e.replayLost
		}),
		fenceSnapshot: (n) => {
			n && (o(), e.cancelQueries({ queryKey: tr.threadEventsRoot(t) }), e.removeQueries({ queryKey: tr.threadEventsRoot(t) })), e.cancelQueries({
				queryKey: tr.sessionSnapshot(t),
				exact: !0
			}), g(d, n);
		},
		snapshot: async () => {
			v("query:invalidate.session", { throttleMs: 0 }), await e.invalidateQueries({
				queryKey: tr.sessionSnapshot(t),
				exact: !0
			});
		},
		tail: async (r) => {
			let i = Mr(d), a = AbortSignal.any([r, i.controller.signal]);
			try {
				let r = await n.readMessages(t, {
					limit: 24,
					includeSystem: !0,
					signal: a
				});
				if (!f || a.aborted || !Ye(d, i.generation)) return { kind: "obsolete" };
				let o = !1;
				return e.setQueryData(tr.sessionSnapshot(t), (e) => {
					if (!e) return o = !0, e;
					let t = s(e, r);
					return t.kind === "snapshot-required" ? (o = !0, e) : t.snapshot;
				}), o ? { kind: "snapshot-required" } : {
					kind: "accepted",
					total: r.page.total
				};
			} catch (e) {
				if (a.aborted || !Ye(d, i.generation)) return { kind: "obsolete" };
				throw e;
			} finally {
				Dr(d, i);
			}
		},
		invalidate: (n, r) => {
			let i = n === "permissions" ? tr.sessionPermissions(t) : n === "skills" ? tr.sessionSkills(t) : n === "revisions" ? tr.workspaceRevisions(t) : tr.threadEvents(t, r ?? "");
			e.invalidateQueries({
				queryKey: i,
				exact: !0
			});
		}
	};
}
//#endregion
//#region src/app/features/direct-session/streamReconciliation.ts
var ah = class extends dr("nac/SessionObservation")() {}, oh = 250, sh = Se(function* () {
	let e = yield* ah;
	return yield* xn(j(() => {
		e.attach();
		let t = !1, n = null, r = null, i = !1, o = !1, s = !1, c = 0, u = 0, d = null, f = new AbortController();
		function p(i) {
			t || (i && (c = 0), e.fenceSnapshot(i), clearTimeout(n ?? void 0), n = null, s = !1, clearTimeout(r ?? void 0), r = setTimeout(() => {
				if (r = null, t) return;
				let n = ++u;
				o = !0, P(at({
					try: e.snapshot,
					catch: () => "snapshot-unavailable"
				}).pipe(Ae, _n(j(() => {
					t || n !== u || (o = !1, s && r === null && m());
				}))));
			}, oh));
		}
		function m() {
			if (t || i || o || r !== null) return;
			i = !0;
			let n = Se(function* () {
				let n = 1;
				for (; !t && s && !o && r === null;) {
					s = !1;
					let r = yield* at({
						try: () => e.tail(f.signal),
						catch: () => "tail-unavailable"
					}).pipe(a(() => l({ kind: "snapshot-required" })));
					if (!(t || r.kind === "obsolete")) {
						if (r.kind === "snapshot-required") {
							p(!0);
							return;
						}
						if (r.total < c) {
							if (n === 0) {
								p(!1);
								return;
							}
							--n, s = !0;
						}
					}
				}
			}).pipe(_n(j(() => {
				i = !1;
			})));
			P(n);
		}
		function h(e) {
			t || (c = Math.max(c, e), s = !0, !(r !== null || o || i) && (clearTimeout(n ?? void 0), n = setTimeout(() => {
				n = null, m();
			}, oh)));
		}
		let g = e.subscribe({
			change: (n) => {
				t || (n.finishedThread && e.invalidate("thread", n.finishedThread), n.refresh === "messages" ? h(n.transcriptLength) : n.refresh === "snapshot" ? p(!1) : n.refresh === "replace-snapshot" && p(!0), n.runCompleted && e.invalidate("revisions"), n.permissionsChanged && e.invalidate("permissions"));
			},
			epoch: (n) => {
				t || (d !== null && n !== d && (p(!0), e.invalidate("skills"), e.invalidate("permissions")), d = n);
			},
			replayLost: () => {
				t || (p(!0), e.invalidate("permissions"));
			}
		});
		return { close: () => {
			t || (t = !0, u += 1, g(), clearTimeout(n ?? void 0), clearTimeout(r ?? void 0), f.abort(), e.detach());
		} };
	}), (e) => j(e.close));
});
//#endregion
//#region src/app/features/direct-session/browserRuntime.ts
function ch(e) {
	let t = zr(lt()), n = (() => {
		try {
			return zr(sh.pipe(se(ll(ah, e)), pt(t)));
		} catch (n) {
			throw e.detach(), zr(ue(t, Kt)), n;
		}
	})();
	return () => {
		n.close(), zr(ue(t, Kt));
	};
}
//#endregion
//#region src/app/hooks/useSessionStream.ts
function lh(e) {
	let { resetRuntime: t } = me().stores.runtimeStore, n = ti();
	U(() => {
		if (!e) {
			t(null);
			return;
		}
		return ch(ih(n, e));
	}, [
		e,
		n,
		t
	]);
}
function uh(e, t) {
	let { subscribeToSessionEvents: n } = { subscribeToSessionEvents: me().events }, r = ti();
	U(() => {
		if (!t) return;
		let i = () => {
			r.invalidateQueries({
				queryKey: tr.sessionPermissions(e),
				exact: !0
			});
		};
		return n(e, {
			onEnvelope: (e) => {
				(e.event.type === "permission_asked" || e.event.type === "permission_replied" || e.event.type === "permission_dismissed" || e.event.type === "permission_approval_mode_changed") && i();
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
function dh(e) {
	let { syncRunFromSnapshot: t } = me().stores.runtimeStore;
	U(() => {
		t(e);
	}, [e, t]);
}
//#endregion
//#region src/app/components/inspector/ChildControls.tsx
function fh({ child: e }) {
	let t = e.status === "running";
	return uh(e.child_session_id, t), t ? /* @__PURE__ */ J(Hm, {
		sessionId: e.child_session_id,
		behavior: "direct",
		label: `Permissions for ${e.description}`,
		autoApprovalAvailable: !1,
		requesterLabel: `child agent “${e.description}”`
	}) : null;
}
function ph({ sessionId: e, behavior: t, showTrigger: n = !0, openRequest: r = 0 }) {
	let i = t === "direct" || t === "direct-with-orchestrator", a = fe(e, i), s = Zn(), c = un(), [l, u] = K(!1), [d, f] = K(""), [p, m] = K(""), [h, g] = K(!0), _ = G(0);
	if (U(() => {
		!i || r === 0 || r === _.current || (_.current = r, u(!0));
	}, [i, r]), !i) return null;
	let v = a.data ?? [], y = s.isPending, b = () => {
		f(""), m("");
	}, x = async () => {
		if (!d.trim() || !p.trim()) {
			c.error("A short description and complete child prompt are required.");
			return;
		}
		try {
			await s.mutateAsync({
				sessionId: e,
				payload: {
					profile: "general",
					description: d.trim(),
					prompt: p.trim(),
					background: h
				}
			}), b(), u(!1);
		} catch (e) {
			c.error(`Unable to start child: ${Qn($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(q, { children: [
		v.map((e) => /* @__PURE__ */ J(fh, { child: e }, e.child_session_id)),
		n ? /* @__PURE__ */ J(Zt, {
			title: "Launch coding agent",
			position: R.TopCenter,
			children: /* @__PURE__ */ J(V, {
				size: B.Small,
				variant: v.some((e) => e.status === "running") ? L.GhostHighlightedAccent : L.Ghost,
				content: o.Icon,
				"aria-label": "Launch coding agent",
				onClick: () => u(!0),
				children: /* @__PURE__ */ J(M, {
					iconName: F.People,
					size: 16
				})
			})
		}) : null,
		/* @__PURE__ */ J(Vn, {
			open: l,
			onClose: () => u(!1),
			size: or.Wide,
			title: "Launch coding agent",
			subheader: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from Subagents.",
			children: /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-5",
				children: /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-3 rounded-[6px] bg-elevation-level-2 p-3",
					children: [
						/* @__PURE__ */ J("div", {
							className: "flex items-center justify-between gap-3",
							children: /* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("div", {
								className: "text-small font-medium",
								children: "New coding agent"
							}), /* @__PURE__ */ J("div", {
								className: "mt-0.5 text-xs text-basic-tertiary",
								children: "General profile · read, write, edit, search, and terminal tools"
							})] })
						}),
						/* @__PURE__ */ J(Z, {
							label: "Short description",
							inputSize: X.Medium,
							placeholder: "Review persistence",
							value: d,
							maxLength: 120,
							onChange: (e) => f(e.target.value)
						}),
						/* @__PURE__ */ J(nc, {
							label: "Complete task prompt",
							textAreaSize: tc.Medium,
							placeholder: "Describe the task, relevant context, and expected verification",
							value: p,
							onChange: (e) => m(e.target.value),
							textAreaClassName: "h-[112px] resize-none"
						}),
						/* @__PURE__ */ Y("div", {
							className: "flex flex-wrap items-center justify-between gap-3",
							children: [/* @__PURE__ */ Y("label", {
								className: "flex items-center gap-2 text-small text-basic-secondary",
								children: [/* @__PURE__ */ J(al, {
									checked: h,
									disabled: y,
									onChange: g
								}), "Run in background"]
							}), /* @__PURE__ */ J(V, {
								variant: L.Primary,
								loading: s.isPending,
								disabled: y,
								onClick: () => void x(),
								children: "Start coding agent"
							})]
						})
					]
				})
			})
		})
	] });
}
//#endregion
//#region src/app/components/inspector/OrchestratorControls.tsx
function mh({ sessionId: e, behavior: t, showTrigger: n = !0, openRequest: r = 0 }) {
	let i = u().orchestrationEnabled && t === "direct-with-orchestrator", a = d(e, i), s = he(), c = un(), [l, f] = K(!1), [p, m] = K(""), [h, g] = K(""), [_, v] = K(!0), y = G(0);
	if (U(() => {
		!i || r === 0 || r === y.current || (y.current = r, f(!0));
	}, [i, r]), !i) return null;
	let b = a.data ?? [], x = s.isPending, S = () => {
		m(""), g("");
	}, C = async () => {
		if (!p.trim() || !h.trim()) {
			c.error("A short description and complete orchestration objective are required.");
			return;
		}
		try {
			await s.mutateAsync({
				sessionId: e,
				payload: {
					description: p.trim(),
					prompt: h.trim(),
					background: _
				}
			}), S(), f(!1);
		} catch (e) {
			c.error(`Unable to start orchestrator: ${Qn($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(q, { children: [n ? /* @__PURE__ */ J(Zt, {
		title: "Launch NAC orchestrator",
		position: R.TopCenter,
		children: /* @__PURE__ */ J(V, {
			size: B.Small,
			variant: b.some((e) => e.status === "running") ? L.GhostHighlightedAccent : L.Ghost,
			content: o.Icon,
			"aria-label": "Launch NAC orchestrator",
			onClick: () => f(!0),
			children: /* @__PURE__ */ J(M, {
				iconName: F.Flow,
				size: 16
			})
		})
	}) : null, /* @__PURE__ */ J(Vn, {
		open: l,
		onClose: () => f(!1),
		size: or.Wide,
		title: "Launch NAC orchestrator",
		subheader: "Start a separate NAC planning session. Browse, steer, continue, and cancel it from Subagents.",
		children: /* @__PURE__ */ J("div", {
			className: "flex flex-col gap-5",
			children: /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-3 rounded-[6px] bg-elevation-level-2 p-3",
				children: [
					/* @__PURE__ */ J("div", {
						className: "flex items-center justify-between gap-3",
						children: /* @__PURE__ */ J("div", {
							className: "text-small font-medium",
							children: "New NAC orchestrator"
						})
					}),
					/* @__PURE__ */ J(Z, {
						label: "Short description",
						inputSize: X.Medium,
						placeholder: "Implement the persistence slice",
						value: p,
						maxLength: 120,
						onChange: (e) => m(e.target.value)
					}),
					/* @__PURE__ */ J(nc, {
						label: "Complete objective",
						textAreaSize: tc.Medium,
						placeholder: "Describe scope, constraints, and expected verification",
						value: h,
						onChange: (e) => g(e.target.value),
						textAreaClassName: "h-[112px] resize-none"
					}),
					/* @__PURE__ */ Y("div", {
						className: "flex flex-wrap items-center justify-between gap-3",
						children: [/* @__PURE__ */ Y("label", {
							className: "flex items-center gap-2 text-small text-basic-secondary",
							children: [/* @__PURE__ */ J(al, {
								checked: _,
								disabled: x,
								onChange: v
							}), "Run in background"]
						}), /* @__PURE__ */ J(V, {
							variant: L.Primary,
							loading: s.isPending,
							disabled: x,
							onClick: () => void C(),
							children: "Start NAC orchestrator"
						})]
					})
				]
			})
		})
	})] });
}
//#endregion
//#region src/app/components/inspector/SubagentChatInputBox.tsx
var hh = "The subagent keeps working after you leave this chat. Steer or stop it from here.", gh = {
	completed: {
		text: "Completed",
		color: _i.Green
	},
	cancelled: {
		text: "Cancelled",
		color: _i.Yellow
	},
	failed: {
		text: "Failed",
		color: _i.Red
	},
	interrupted: {
		text: "Interrupted",
		color: _i.Yellow
	}
};
function _h({ value: e, onChange: t, onSubmit: n, onStop: r, running: i, background: a, onBackgroundChange: s, status: c = null, busy: l = !1, permission: u, autoFocus: d = !1, focusRequest: f = 0 }) {
	let p = G(null), m = e.trim().length > 0, h = i ? "Steer a message" : "Send a message", g = !i && c ? gh[c] : void 0, _ = i ? a ? "Running in the background" : "Regular run" : "Run in the background";
	return Yr(() => {
		let e = p.current;
		e && (e.style.height = "auto", e.style.height = `${e.scrollHeight}px`);
	}, [e]), Yr(() => {
		if (!d) return;
		let e = () => p.current?.focus({ preventScroll: !0 });
		e();
		let t = requestAnimationFrame(e);
		return () => cancelAnimationFrame(t);
	}, [d, f]), /* @__PURE__ */ Y("form", {
		className: "flex w-full flex-col gap-4 rounded-[8px] bg-elevation-level-2 p-4 shadow-2xl",
		onSubmit: (e) => {
			e.preventDefault(), i && !m ? r() : m && n();
		},
		children: [/* @__PURE__ */ Y("div", {
			className: "relative flex items-end overflow-hidden rounded-[4px] bg-input py-2 pr-12 pl-2",
			children: [/* @__PURE__ */ J("textarea", {
				ref: p,
				rows: 1,
				value: e,
				placeholder: h,
				"aria-label": h,
				disabled: l,
				className: "max-h-40 min-h-5 w-full resize-none bg-transparent px-1 text-small text-input outline-none placeholder:text-input-placeholder",
				onChange: (e) => t(e.target.value),
				onKeyDown: (e) => {
					e.key !== "Enter" || e.shiftKey || (e.preventDefault(), m && !l && n());
				}
			}), /* @__PURE__ */ J(V, {
				type: "submit",
				size: B.Medium,
				variant: L.Primary,
				content: o.Icon,
				className: "absolute right-0 bottom-0",
				disabled: l || !i && !m,
				"aria-label": i ? m ? "Steer" : "Stop" : "Send",
				children: /* @__PURE__ */ J(M, { iconName: i && !m ? F.Stop : F.ArrowTop })
			})]
		}), /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2.5 h-6",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex min-w-0 flex-1 items-center gap-2",
				children: [
					i ? null : /* @__PURE__ */ J(al, {
						checked: a,
						disabled: l,
						"aria-label": "Run in the background",
						onChange: s
					}),
					/* @__PURE__ */ J("span", {
						className: z("label-micro truncate", i && a ? "text-info-primary" : i ? "text-basic-tertiary" : "text-basic-primary"),
						children: _
					}),
					/* @__PURE__ */ J(Zt, {
						title: _,
						description: hh,
						position: R.TopCenter,
						children: /* @__PURE__ */ J("span", {
							className: "inline-flex text-basic-tertiary",
							children: /* @__PURE__ */ J(M, {
								iconName: F.Info,
								size: 16
							})
						})
					}),
					g ? /* @__PURE__ */ J(vi, {
						text: g.text,
						color: g.color,
						className: "px-1 py-[2px]"
					}) : null
				]
			}), u]
		})]
	});
}
//#endregion
//#region src/app/components/inspector/SubagentComposer.tsx
function vh(e) {
	let t = e.trim().split("\n")[0] ?? "";
	return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}
function yh({ parentSessionId: e, target: t, permissionSessionId: n, permissionBehavior: r, requesterLabel: i, onStarted: a, autoFocus: o = !1, focusRequest: s = 0, showPermissions: c = !0 }) {
	let l = un(), u = Zn(), d = he(), f = k(), p = Me(), [m, h] = K(""), [g, _] = K(t.mode === "child" || t.mode === "orchestrator" ? t.background : !0), v = (t.mode === "child" || t.mode === "orchestrator") && t.status === "running", y = u.isPending || d.isPending || f.isPending || p.isPending, b = t.mode === "child" || t.mode === "orchestrator" ? t : null, x = async () => {
		let n = m.trim();
		if (!n) return;
		let r = b ? b.description : vh(n);
		if (!r) {
			l.error("A message is required.");
			return;
		}
		try {
			if (t.mode === "new-orchestrator" || t.mode === "orchestrator") {
				let i = await d.mutateAsync({
					sessionId: e,
					payload: {
						description: r,
						prompt: n,
						background: g,
						orchestrator_session_id: t.mode === "orchestrator" ? t.id : null
					}
				});
				a?.(i.orchestrator_session_id);
			} else {
				let i = await u.mutateAsync({
					sessionId: e,
					payload: {
						profile: "general",
						description: r,
						prompt: n,
						background: g,
						child_session_id: t.mode === "child" ? t.id : null
					}
				});
				a?.(i.child_session_id);
			}
			h("");
		} catch (e) {
			l.error(`Unable to update the subagent: ${Qn($(e))}`);
		}
	}, S = async () => {
		if (b) try {
			b.mode === "child" ? await f.mutateAsync({
				sessionId: e,
				childId: b.id
			}) : await p.mutateAsync({
				sessionId: e,
				orchestratorId: b.id
			});
		} catch (e) {
			l.error(`Unable to stop the subagent: ${Qn($(e))}`);
		}
	};
	return /* @__PURE__ */ J(_h, {
		value: m,
		onChange: h,
		onSubmit: () => void x(),
		onStop: () => void S(),
		autoFocus: o,
		focusRequest: s,
		running: v,
		background: v && b ? b.background : g,
		onBackgroundChange: _,
		status: b?.status,
		busy: y,
		permission: c ? /* @__PURE__ */ J(Hm, {
			sessionId: n,
			behavior: r,
			autoApprovalAvailable: !1,
			requesterLabel: i
		}) : null
	});
}
function bh({ parentSessionId: e, sessionId: t, kind: n, description: r, behavior: i }) {
	let a = n === "managed-orchestrator", o = fe(e, !a), s = d(e, a), c = a ? s.data?.find((e) => e.orchestrator_session_id === t) : o.data?.find((e) => e.child_session_id === t), l = {
		mode: a ? "orchestrator" : "child",
		id: t,
		description: c?.description || r || "Subagent",
		status: c?.status ?? "idle",
		background: c?.execution_mode !== "foreground"
	};
	return /* @__PURE__ */ J(yh, {
		parentSessionId: e,
		target: l,
		permissionSessionId: t,
		permissionBehavior: a ? "orchestrator" : i ?? "direct",
		requesterLabel: a ? void 0 : `child agent “${l.description}”`
	}, `${l.mode}:${l.id}:${l.status}:${l.background}`);
}
//#endregion
//#region src/app/hooks/usePromptHistoryPreview.ts
var xh = 40;
function Sh(e) {
	let t = e.trim();
	if (!t) return "[empty]";
	let n = t.split("\n")[0] ?? "";
	return n.length <= xh ? n : `${n.slice(0, xh)}…`;
}
function Ch({ prompts: e, value: t, enabled: n, setValue: r, textareaRef: i, afterCommit: a }) {
	let [o, s] = K(-1), [c, l] = K(-1), u = n && o >= 0 && o < e.length, d = u ? e[o] ?? "" : "", f = H(() => {
		s(-1), l(-1);
	}, []), p = H(() => {
		r(d), s(-1), requestAnimationFrame(() => {
			let e = i.current;
			e && (e.selectionStart = d.length, e.selectionEnd = d.length, a?.());
		});
	}, [
		a,
		d,
		r,
		i
	]), m = H((r) => !n || r.nativeEvent.isComposing ? !1 : r.key === "ArrowUp" && e.length > 0 ? t !== "" && !u ? !1 : (r.preventDefault(), s(Math.min((u ? o : -1) + 1, e.length - 1)), !0) : u ? r.key === "ArrowDown" ? (r.preventDefault(), s(o - 1 >= 0 ? o - 1 : -1), !0) : r.key === "Tab" ? (r.preventDefault(), p(), !0) : r.key === "Escape" && (r.preventDefault(), s(-1), !0) : !1, [
		u,
		p,
		n,
		o,
		e.length,
		t
	]), h = H((e) => {
		if (n) {
			if (o >= 0 && e !== "") {
				l(o), s(-1);
				return;
			}
			e === "" && c >= 0 && (s(c), l(-1));
		}
	}, [
		n,
		o,
		c
	]);
	return W(() => ({
		active: u,
		previewText: u ? Sh(d) : "",
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
//#endregion
//#region src/app/lib/skillReferences.ts
var wh = /[\p{Alphabetic}\p{Number}_-]/u;
function Th(e, t) {
	return t >= e.length ? null : e.slice(t)[Symbol.iterator]().next().value ?? null;
}
function Eh(e, t) {
	let n = Th(e, t);
	return n === null || !wh.test(n);
}
function Dh(e) {
	return [...e].sort((e, t) => t.name.length - e.name.length || e.name.localeCompare(t.name));
}
function Oh(e, t) {
	if (!e || t.length === 0) return [{
		text: e,
		skillName: null
	}];
	let n = Dh(t), r = [], i = 0, a = 0;
	for (;;) {
		let t = e.indexOf("$", a);
		if (t === -1) break;
		let o = t + 1, s = n.find((t) => e.startsWith(t.name, o) && Eh(e, o + t.name.length));
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
function kh(e, t, n, r) {
	if (t === 0 || t !== n || r.length === 0 || !Eh(e, n)) return null;
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
//#endregion
//#region src/app/components/inspector/ChatInputBox.tsx
var Ah = "Ask anything…", jh = "Ask anything, or press ↑ for an earlier prompt", Mh = {
	mobile: 40,
	wide: 48
}, Nh = {
	mobile: 128,
	wide: 200
};
function Ph(e) {
	let t = /^(\s*)\/(\S*)$/u.exec(e);
	if (!t || t[0] !== e) return null;
	let n = t[2];
	return n.includes("/") || n.includes("\\") ? null : {
		leadingWhitespace: t[1],
		prefix: n
	};
}
function Fh(e, t) {
	let n = e.trim();
	if (!n.startsWith("/")) return null;
	let r = n.slice(1), i = r.search(/\s/u), a = i === -1 ? r : r.slice(0, i), o = i === -1 ? "" : r.slice(i).trim();
	return t.find((e) => e.name === a && (e.accepts_arguments || !o)) ?? null;
}
function Ih(e, t, n, r) {
	return `${e}:${n}:${r}:${t}`;
}
var Lh = { WebkitTextStroke: "0.45px currentColor" };
function Rh(e) {
	return e.map((e, t) => e.skillName ? /* @__PURE__ */ J("strong", {
		className: "[font-weight:inherit] text-danger-primary",
		style: Lh,
		children: e.text
	}, `${e.skillName}-${t}`) : /* @__PURE__ */ J("span", { children: e.text }, t));
}
var zh = { backgroundImage: "linear-gradient(to top, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))" };
function Bh({ iconName: e, prefix: t, value: n, iconSize: r = 14, className: i, title: a, showIcon: o = !0, labelClassName: s = "label-micro" }) {
	return /* @__PURE__ */ J(Zt, {
		title: a,
		position: R.TopCenter,
		children: /* @__PURE__ */ Y("div", {
			className: z("flex items-center gap-[2px] py-1 whitespace-nowrap", i),
			children: [t ? /* @__PURE__ */ J("span", {
				className: s,
				children: t
			}) : o && e ? /* @__PURE__ */ J(M, {
				iconName: e,
				size: r
			}) : null, /* @__PURE__ */ J("span", {
				className: s,
				children: n
			})]
		})
	});
}
function Vh(e, t) {
	let n = kn(e), r = t.contextWindow;
	if (!r || e == null) return {
		value: n,
		title: "Orchestrator context"
	};
	let i = kn(r);
	return t.estimated ? {
		value: `${n} / ${i} est.`,
		title: `Orchestrator context against ${t.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate`
	} : {
		value: `${n} / ${i}`,
		title: `Orchestrator context — ${Math.round(e / r * 100)}% of the model's context window`
	};
}
function Hh({ sessionId: t, snapshot: n, entry: r }) {
	let { useSshConnectionStatus: i, sshTargetFromSummary: a, markSshDisconnected: s, markSshConnected: c } = me().stores.sshConnectionStore, { useSessionSpend: l, useRunning: u, useRunUsage: d, useRunStartedAt: f, useLastElapsedMs: m, useCancelArmed: g, pushLocalEvent: _, liftSessionSpend: v, captureRuntimeActivation: y } = me().stores.runtimeStore, { revealSidePanel: b, openSubagentLaunch: x } = me().stores.sessionLayoutStore, { consumePromptRequests: S } = me().stores.composerStore, C = ci();
	Ee("ChatInputBox");
	let [w, T] = K(""), E = G(w);
	U(() => {
		E.current = w;
	}, [w]);
	let D = Ue(), O = h(), k = D || O, [ee, te] = K(!1), [A, ne] = K({
		start: 0,
		end: 0
	}), [re, j] = K(null), [ie, oe] = K(0), [se, le] = K(null), ue = D && !ee, de = D ? Mh.mobile : Mh.wide, fe = D ? Nh.mobile : Nh.wide, pe = u(t), N = g(t), he = un(), ge = Lf(), P = ln(), ve = qn(), I = e(), ye = ze(), xe = dt(), Se = we(), Te = r?.summary.behavior ?? n?.metadata.behavior ?? null, De = Te === "direct" || Te === "direct-with-orchestrator", Oe = r?.lineage ?? n?.lineage ?? null, ke = Oe != null, Ae = r !== null || n !== null, Me = $e(t, De && !ke), Ne = ae(t, De && !ke), Pe = _e(), Fe = ht(), Ie = ce(), [Le, Re] = K(0), [Be, Ve] = K(!1), [He, We] = K(t);
	He !== t && (We(t), Ve(!1));
	let { data: Ge, isError: Ke, refetch: qe } = br(t), { data: Je, isError: Ye } = St(t), Xe = G(null), Ze = G(null), Qe = G(null), et = G([]), tt = G(!1), nt = Jr(), rt = d(), it = l();
	U(() => {
		v(p(n));
	}, [v, n]);
	let at = Pr(n, r, pe || N ? rt : null, it), ot = r?.summary.backend ?? n?.metadata.backend ?? null, st = Gn(), ct = p(n), lt = at.usage?.total_tokens || ct?.total_tokens || null, ut = Vh(lt, gu(st.data, n?.metadata?.backend, at.model)), ft = Pn(1e3, pe), pt = f(), mt = m(), gt = (pe && pt != null ? Math.max(0, ft - pt) : null) ?? mt ?? at.lastResponseMs, _t = a(r?.summary), vt = i(_t), yt = Ar(), bt = At(r?.summary) === "SSH", xt = pe && De && !ke, Ct = pe && Te === "orchestrator" && !ke, wt = xt || Ct, Tt = P.isPending || ve.isPending || I.isPending || ye.isPending || xe.isPending || Se.isPending || Pe.isPending || Fe.isPending || Ie.isPending, Et = Tt || N || pe && !wt, Dt = !!w.trim() && !Et, Ot = (Me.data ?? []).filter((e) => e.status === "pending"), kt = async (e, n, r) => {
		try {
			await xe.mutateAsync({
				sessionId: t,
				itemId: e,
				expectedVersion: n,
				delivery: r
			});
		} catch (e) {
			he.error(`Unable to change pending message: ${Qn($(e))}`);
		}
	}, jt = async (e, n) => {
		try {
			await Se.mutateAsync({
				sessionId: t,
				itemId: e,
				expectedVersion: n
			});
		} catch (e) {
			he.error(`Unable to cancel pending message: ${Qn($(e))}`);
		}
	}, Mt = H(() => {
		let e = Xe.current;
		e && (e.style.height = `${de}px`, e.style.height = `${Math.min(e.scrollHeight, fe)}px`);
	}, [de, fe]);
	Yr(() => {
		let e = Qe.current, t = Xe.current;
		e === null || !t || (Qe.current = null, Mt(), t.focus(), t.setSelectionRange(e, e));
	}, [Mt, w]);
	let Nt = Ch({
		prompts: W(() => {
			let e = [];
			for (let t of n?.messages ?? []) t.role === "user" && e.push(Ft(t.content));
			return e.reverse();
		}, [n?.messages]),
		value: w,
		enabled: !D,
		setValue: T,
		textareaRef: Xe,
		afterCommit: Mt
	}), Pt = Nt.reset, It = Jr();
	U(() => Pt(), [t, Pt]);
	let Lt = W(() => Ph(w), [w]), Rt = W(() => {
		if (!Lt || !Ge) return [];
		let e = Lt.prefix.toLocaleLowerCase();
		return Ge.filter((t) => (t.name !== "goal" || De) && t.name.toLocaleLowerCase().startsWith(e));
	}, [
		Ge,
		Lt,
		De
	]), zt = W(() => kh(w, A.start, A.end, Je ?? []), [
		A,
		Je,
		w
	]), Bt = W(() => {
		if (Lt !== null || Je !== void 0 || A.start === 0 || A.start !== A.end) return null;
		let e = w.lastIndexOf("$", A.start - 1);
		return e === -1 ? null : {
			start: e,
			end: A.end
		};
	}, [
		Lt,
		A,
		Je,
		w
	]), Vt = Lt ? "slash" : zt || Bt ? "skill" : null, Ht = W(() => Vt === "slash" ? Rt.map((e) => ({
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
	]), Ut = Vt === "slash" ? Ih("slash", w, 0, w.length) : Vt === "skill" ? Ih("skill", w, zt?.start ?? Bt?.start ?? A.start, zt?.end ?? Bt?.end ?? A.end) : null, Wt = ee && Vt !== null && Ut !== re, Gt = Math.min(ie, Math.max(Ht.length - 1, 0)), Kt = se !== null && se < Ht.length ? se : Gt, qt = Wt ? Ht[Kt] : void 0, Jt = qt ? `${nt}-option-${Kt}` : void 0, Yt = H((e) => {
		qt && e.preventDefault();
	}, [qt]);
	U(() => {
		Wt && et.current[Gt]?.scrollIntoView({ block: "nearest" });
	}, [
		Gt,
		Wt,
		Ht
	]);
	let Xt = H(() => {
		j(Ut), le(null);
	}, [Ut]), Qt = H((e) => {
		let t, n, r;
		if (e.kind === "slash") {
			if (!Lt) return;
			t = `${Lt.leadingWhitespace}/${e.definition.name}${e.definition.accepts_arguments ? " " : ""}`, n = t.length, r = Ih("slash", t, 0, t.length);
		} else {
			if (!zt) return;
			let i = `$${e.definition.name}`;
			t = `${w.slice(0, zt.start)}${i}${w.slice(zt.end)}`, n = zt.start + i.length, r = Ih("skill", t, zt.start, n);
		}
		t === w ? (Qe.current = null, Mt(), Xe.current?.focus(), Xe.current?.setSelectionRange(n, n)) : (Qe.current = n, T(t)), ne({
			start: n,
			end: n
		}), j(r), le(null);
	}, [
		Lt,
		Mt,
		zt,
		w
	]), $t = W(() => Oh(w, Je ?? []), [Je, w]), en = !Nt.active && $t.some((e) => e.skillName !== null);
	Yr(() => {
		let e = Xe.current, t = Ze.current;
		!en || !e || !t || (t.scrollTop = e.scrollTop, t.scrollLeft = e.scrollLeft);
	}, [
		ue,
		en,
		w
	]), U(() => {
		let e = Xe.current;
		e && (ue ? (e.style.height = `${Mh.mobile}px`, e.style.overflow = "hidden") : (e.style.overflow = "", Mt()));
	}, [ue, Mt]);
	let tn = H(() => {
		let e = Xe.current;
		e && (e.focus(), requestAnimationFrame(() => {
			if (!Xe.current) return;
			let e = Xe.current.value.length;
			Xe.current.selectionStart = e, Xe.current.selectionEnd = e, ne({
				start: e,
				end: e
			}), Xe.current.scrollTop = Xe.current.scrollHeight;
		}));
	}, []), nn = H(async () => {
		if (!(!_t || yt.isPending)) try {
			await yt.mutateAsync(_t), c(_t);
		} catch (e) {
			s(_t), he.error(`SSH reconnect failed: ${Qn($(e))}`);
		}
	}, [
		_t,
		yt,
		c,
		s,
		he
	]), rn = H(async (e) => {
		if (!De) throw Error("Durable goals are available only in direct chats");
		let n = y(t), r = Ne.data;
		if (r === void 0) {
			let e = await Ne.refetch();
			if (!n()) return;
			if (e.error) throw e.error;
			r = e.data;
		}
		let i = e.trim().slice(5).trim();
		if (i === "" || i === "edit") {
			D ? Re((e) => e + 1) : Ve(!0);
			return;
		}
		if (i === "clear") {
			if (!r) throw Error("There is no durable goal to clear");
			await Ie.mutateAsync({
				sessionId: t,
				goalId: r.goal_id,
				expectedVersion: r.version
			});
			return;
		}
		if (i === "pause" || i === "resume") {
			if (!r) throw Error(`There is no durable goal to ${i}`);
			await Fe.mutateAsync({
				sessionId: t,
				goalId: r.goal_id,
				payload: {
					expected_version: r.version,
					status: i === "pause" ? "paused" : "active"
				}
			});
			return;
		}
		if (r && r.status !== "complete") throw Error("An unfinished durable goal already exists; use /goal edit or /goal clear first");
		await Pe.mutateAsync({
			sessionId: t,
			payload: { objective: i }
		});
	}, [
		y,
		Ie,
		Pe,
		De,
		Ne,
		D,
		t,
		Fe
	]), an = H(async (e = w, n) => {
		let r = e.trim();
		if (!r || Et || tt.current) return;
		let i = e === w, a = () => {
			!i || E.current !== e || (E.current = "", T(""), ne({
				start: 0,
				end: 0
			}), Pt(), Xe.current && (Xe.current.style.height = `${de}px`));
		};
		tt.current = !0;
		let o = y(t);
		try {
			let i = Ge;
			if (e.trimStart().startsWith("/") && i === void 0) {
				let e = await qe();
				if (!o()) return;
				if (i = e.data, i === void 0) {
					he.error("Unable to load slash commands");
					return;
				}
			}
			let s = i ? Fh(e, i) : null;
			if (s?.command === "compact") {
				try {
					if (await I.mutateAsync(t), !o()) return;
					_("compaction", "▶ compacting context…"), a();
				} catch (e) {
					if (!o()) return;
					_("error", `compact failed: ${Qn($(e))}`, !0), he.error(`Failed to compact: ${eu($(e), ot)}`);
				}
				return;
			}
			if (s?.command === "goal") {
				try {
					if (await rn(r), !o()) return;
					a();
				} catch (e) {
					if (!o()) return;
					he.error(`Goal command failed: ${eu($(e))}`);
				}
				return;
			}
			if (s && s.command !== "mcp_prompt") {
				he.error(`Unsupported slash command: /${s.name}`);
				return;
			}
			try {
				let e = await be(vn({
					mode: xt ? "direct-running" : Ct ? "classic-running" : "idle",
					delivery: n,
					inbox: (e) => ye.mutateAsync({
						sessionId: t,
						delivery: e,
						prompt: r
					}),
					steer: () => ve.mutateAsync({
						id: t,
						instruction: r
					}),
					submit: () => P.mutateAsync({
						id: t,
						prompt: r
					})
				}));
				if (!o()) return;
				e === "submitted" ? _("run", `▶ submitted: ${r.slice(0, 80)}`) : (xt || n) && _("steering", `▶ ${n ?? "steer"}: ${r.slice(0, 80)}`), a();
			} catch (e) {
				if (!o()) return;
				_("error", `submit failed: ${Qn($(e))}`, !0), he.error(`Failed to send: ${eu($(e), ot)}`);
			}
		} finally {
			tt.current = !1;
		}
	}, [
		w,
		Et,
		y,
		t,
		Pt,
		de,
		Ge,
		qe,
		he,
		I,
		_,
		ot,
		rn,
		xt,
		Ct,
		ye,
		ve,
		P
	]);
	U(() => S((e) => void an(e)), [S, an]);
	let on = H(async () => {
		await ge.stopRun(t);
	}, [ge, t]), sn = /* @__PURE__ */ J(Zt, {
		title: "Session settings",
		position: R.TopLeft,
		children: /* @__PURE__ */ J(V, {
			className: D ? "btn-round" : void 0,
			size: D ? B.Medium : B.Small,
			variant: L.Ghost,
			content: o.Icon,
			"aria-label": "Session settings",
			onClick: () => ge.settings(t),
			children: /* @__PURE__ */ J(M, {
				iconName: F.Gear,
				size: D ? void 0 : 16
			})
		})
	}), dn = !!w.trim(), fn = (pe || N) && !dn, pn = /* @__PURE__ */ J(M, { iconName: fn ? F.Stop : F.ArrowTop }), mn = N ? "Stopping run" : pe && !dn ? "Stop run" : wt ? "Steer active run" : "Send", hn = fn ? "button" : "submit", gn = N || !fn && !Dt, _n = pe && !dn && !N ? () => void on() : void 0, yn = D ? /* @__PURE__ */ J(bi, {
		className: "shrink-0",
		variant: L.Primary,
		content: o.Icon,
		type: hn,
		disabled: gn,
		loading: N,
		"aria-label": mn,
		onPointerDown: Yt,
		onClick: _n,
		children: pn
	}) : /* @__PURE__ */ J(V, {
		className: "absolute bottom-0 right-0",
		size: B.Large,
		variant: L.Primary,
		content: o.Icon,
		type: hn,
		disabled: gn,
		loading: N,
		"aria-label": mn,
		onPointerDown: Yt,
		onClick: _n,
		children: pn
	}), bn = Wt ? Vt === "slash" ? Ge === void 0 ? Ke ? "Slash commands unavailable" : "Loading slash commands" : Ht.length ? `${Ht.length} slash ${Ht.length === 1 ? "command" : "commands"} available` : "No matching commands" : Je === void 0 ? Ye ? "Skills unavailable" : "Loading skills" : `${Ht.length} ${Ht.length === 1 ? "skill" : "skills"} available` : "", xn = /* @__PURE__ */ Y("div", {
		className: z("relative flex items-end", D ? z("flex-1 min-w-0 rounded-[20px] bg-elevation-level-3 shadow-2xl overflow-hidden", ue && "pr-[40px]") : z("rounded-[4px] bg-input shadow-concave", De ? "pl-[48px] pr-[96px]" : "pr-[48px]")),
		children: [
			/* @__PURE__ */ Y("div", {
				className: "relative flex-1 min-w-0",
				children: [
					/* @__PURE__ */ J("span", {
						className: "sr-only",
						role: "status",
						"aria-live": "polite",
						"aria-atomic": "true",
						children: bn
					}),
					en && !ue ? /* @__PURE__ */ Y("div", {
						ref: Ze,
						"aria-hidden": "true",
						className: z("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-medium text-input [scrollbar-gutter:stable]", D ? "px-4 py-2" : "p-3"),
						children: [Rh($t), w.endsWith("\n") ? " " : null]
					}) : null,
					/* @__PURE__ */ J("textarea", {
						ref: Xe,
						className: z("relative block w-full bg-transparent resize-none border-none outline-none text-medium text-input placeholder:text-input-placeholder placeholder:whitespace-nowrap [scrollbar-gutter:stable]", D ? "px-4 py-2" : "p-3", ue && "opacity-0 pointer-events-none"),
						rows: 1,
						role: "combobox",
						"aria-label": "Message",
						"aria-autocomplete": "list",
						"aria-haspopup": "listbox",
						"aria-expanded": Wt,
						"aria-controls": Wt ? nt : void 0,
						"aria-activedescendant": Jt,
						"aria-describedby": Nt.active ? It : void 0,
						enterKeyHint: D ? "enter" : void 0,
						placeholder: Nt.active ? "" : Nt.hasHistory && w === "" ? jh : Ah,
						spellCheck: !1,
						value: w,
						style: {
							minHeight: `${de}px`,
							maxHeight: `${fe}px`,
							color: en ? "transparent" : void 0,
							caretColor: en ? "var(--color-text-input)" : void 0
						},
						onChange: (e) => {
							e.target.value !== w && j(null), oe(0), le(null), Nt.onValueChange(e.target.value), T(e.target.value), ne({
								start: e.target.selectionStart,
								end: e.target.selectionEnd
							}), Mt();
						},
						onSelect: (e) => {
							let t = {
								start: e.currentTarget.selectionStart,
								end: e.currentTarget.selectionEnd
							};
							(t.start !== A.start || t.end !== A.end) && (oe(0), le(null), ne(t));
						},
						onScroll: (e) => {
							Ze.current && (Ze.current.scrollTop = e.currentTarget.scrollTop, Ze.current.scrollLeft = e.currentTarget.scrollLeft);
						},
						onFocus: (e) => {
							te(!0), ne({
								start: e.currentTarget.selectionStart,
								end: e.currentTarget.selectionEnd
							});
						},
						onBlur: () => {
							te(!1), le(null), Pt();
						},
						onKeyDown: (e) => {
							if (!e.nativeEvent.isComposing && !(e.key === "Enter" && D && !e.metaKey && !e.ctrlKey)) {
								if (Wt && !e.shiftKey) {
									if (e.key === "Escape") {
										e.preventDefault(), Xt();
										return;
									}
									if ((e.key === "ArrowDown" || e.key === "ArrowUp") && Ht.length) {
										e.preventDefault(), oe(e.key === "ArrowDown" ? Math.min(Kt + 1, Ht.length - 1) : Math.max(Kt - 1, 0)), le(null);
										return;
									}
									if (e.key === "Tab" && qt) {
										e.preventDefault(), Qt(qt);
										return;
									}
									if (e.key === "Enter" && (qt || Vt === "slash")) {
										e.preventDefault(), qt && Qt(qt);
										return;
									}
								}
								Nt.onKeyDown(e) || e.key === "Enter" && (e.shiftKey || (e.preventDefault(), an()));
							}
						}
					}),
					Nt.active ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
						id: It,
						className: "sr-only",
						children: "Press Tab to take this prompt, Escape to leave it, or start typing to dismiss it"
					}), /* @__PURE__ */ Y("div", {
						className: "pointer-events-none absolute inset-0 flex items-center gap-2 px-3",
						children: [/* @__PURE__ */ J("span", {
							className: "min-w-0 truncate text-medium text-input-placeholder",
							children: Nt.previewText
						}), /* @__PURE__ */ J(cn, {
							keys: ["tab"],
							spelled: !0,
							className: "shrink-0"
						})]
					})] }) : null,
					ue ? /* @__PURE__ */ J("div", {
						className: "absolute inset-0 flex items-center px-4 cursor-text",
						onClick: tn,
						children: /* @__PURE__ */ J("span", {
							className: z("w-full truncate text-medium", w ? "text-input" : "text-input-placeholder"),
							children: w ? Rh($t) : Ah
						})
					}) : null
				]
			}),
			!D && De ? /* @__PURE__ */ J(Im, {
				className: "absolute bottom-0 left-0",
				sessionId: t,
				behavior: Te,
				onCreateSubagent: () => {
					x("agent"), b(D), C(pr.session(t, "delegated"));
				},
				onCreateOrchestrator: () => {
					x("orchestrator"), b(D), C(pr.session(t, "delegated"));
				}
			}) : null,
			!D && De ? /* @__PURE__ */ J(th, {
				className: "absolute right-[48px] bottom-0",
				sessionId: t,
				onOpen: () => Ve(!0)
			}) : null,
			D ? ue ? /* @__PURE__ */ J("div", {
				className: "absolute top-0 right-0",
				children: sn
			}) : null : yn
		]
	}), Sn = /* @__PURE__ */ J("div", {
		id: nt,
		role: "listbox",
		"aria-label": Vt === "skill" ? "Skills" : "Slash commands",
		children: Vt === "slash" && Ge === void 0 ? /* @__PURE__ */ J("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: Ke ? "Slash commands unavailable" : "Loading commands…"
		}) : Vt === "skill" && Je === void 0 ? /* @__PURE__ */ J("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: Ye ? "Skills unavailable" : "Loading skills…"
		}) : Ht.length ? Ht.map((e, t) => /* @__PURE__ */ Y("button", {
			id: `${nt}-option-${t}`,
			ref: (e) => {
				et.current[t] = e;
			},
			type: "button",
			role: "option",
			"aria-selected": t === Kt,
			tabIndex: -1,
			className: z("flex min-h-10 w-full items-center gap-3 rounded-[4px] px-3 py-2 text-left", t === Kt ? "btn-ghost-highlighted" : "btn-ghost"),
			onPointerDown: (e) => e.preventDefault(),
			onPointerMove: () => le(t),
			onPointerLeave: () => le((e) => e === t ? null : e),
			onClick: () => Qt(e),
			children: [/* @__PURE__ */ J("span", {
				className: "code code-small shrink-0 text-basic-primary",
				children: e.name
			}), /* @__PURE__ */ J("span", {
				className: z("min-w-0 flex-1 text-small text-basic-secondary", e.kind === "skill" && "truncate"),
				children: e.description
			})]
		}, `${e.kind}-${e.key}`)) : /* @__PURE__ */ J("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: "No matching commands"
		})
	}), Cn = /* @__PURE__ */ J(Kn, {
		open: Wt,
		onClose: Xt,
		content: Sn,
		placement: R.TopRight,
		sticky: !0,
		closeOnEscape: !1,
		sheetOnMobile: !1,
		className: D ? "flex-1 min-w-0" : "w-full",
		size: "w-[min(400px,calc(100vw-16px))]",
		panelClassName: "max-h-[min(40vh,320px)] overflow-y-auto",
		children: xn
	});
	return Ae ? ke && Oe ? /* @__PURE__ */ J(bh, {
		parentSessionId: Oe.parent_session_id,
		sessionId: t,
		kind: Oe.kind,
		description: Oe.description,
		behavior: Te
	}) : /* @__PURE__ */ Y("form", {
		className: z("flex flex-col", D ? "gap-3 px-4 pt-8 pb-8" : O ? "gap-3 px-2 pt-2 pb-4 rounded-[12px] bg-elevation-level-1 shadow-2xl" : "gap-4 p-4 rounded-[8px] bg-elevation-level-1 shadow-2xl"),
		style: D ? zh : void 0,
		onSubmit: (e) => {
			if (e.preventDefault(), !Be) {
				if (qt) {
					Qt(qt);
					return;
				}
				an();
			}
		},
		children: [
			D ? /* @__PURE__ */ Y("div", {
				className: "flex items-end gap-2",
				children: [Cn, yn]
			}) : Be && De ? /* @__PURE__ */ J(nh, {
				sessionId: t,
				onClose: () => Ve(!1)
			}) : Cn,
			Ot.length ? /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-2",
				"aria-label": "Pending messages",
				children: [/* @__PURE__ */ J("div", {
					className: "tag-label uppercase text-basic-secondary",
					children: "Pending messages"
				}), Ot.map((e) => /* @__PURE__ */ Y("div", {
					className: "flex flex-wrap items-center gap-2 rounded-[4px] border border-border-primary px-3 py-2",
					children: [
						/* @__PURE__ */ J("span", {
							className: "tag-label text-accent-primary",
							children: e.delivery
						}),
						/* @__PURE__ */ J("span", {
							className: "min-w-0 flex-1 truncate text-small text-basic-primary",
							children: e.prompt
						}),
						/* @__PURE__ */ Y(V, {
							type: "button",
							size: B.Small,
							variant: L.Ghost,
							disabled: Tt,
							onClick: () => void kt(e.id, e.version, e.delivery === "steer" ? "queue" : "steer"),
							children: ["Change to ", e.delivery === "steer" ? "queue" : "steer"]
						}),
						/* @__PURE__ */ J(V, {
							type: "button",
							size: B.Small,
							variant: L.GhostDestructive,
							disabled: Tt,
							onClick: () => void jt(e.id, e.version),
							children: "Cancel"
						})
					]
				}, e.id))]
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: z("flex flex-wrap items-center gap-[10px]", D && "pl-2"),
				children: [/* @__PURE__ */ Y("div", {
					className: "flex flex-1 min-w-0 flex-wrap items-center gap-y-1 gap-x-4",
					children: [
						xt ? /* @__PURE__ */ J(V, {
							type: "button",
							size: B.Small,
							variant: L.Secondary,
							disabled: !Dt,
							onClick: () => void an(w, "queue"),
							children: "Queue Next"
						}) : null,
						/* @__PURE__ */ J(zm, {
							sessionId: t,
							metadata: n?.metadata ?? null,
							label: at.model,
							disabled: Et
						}),
						D ? null : /* @__PURE__ */ J("div", { className: "flex-1" }),
						D ? /* @__PURE__ */ J(Hm, {
							sessionId: t,
							behavior: Te
						}) : /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2",
							children: [
								sn,
								De ? /* @__PURE__ */ J("span", {
									"aria-hidden": !0,
									className: "h-6 w-px shrink-0 bg-divider-muted"
								}) : null,
								/* @__PURE__ */ J(Hm, {
									sessionId: t,
									behavior: Te
								})
							]
						}),
						!D && De ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(ph, {
							sessionId: t,
							behavior: Te,
							showTrigger: !1
						}), /* @__PURE__ */ J(mh, {
							sessionId: t,
							behavior: Te,
							showTrigger: !1
						})] }) : null,
						D ? /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ J(Km, {
								sessionId: t,
								behavior: Te,
								openRequest: Le
							}),
							/* @__PURE__ */ J(ph, {
								sessionId: t,
								behavior: Te
							}),
							/* @__PURE__ */ J(mh, {
								sessionId: t,
								behavior: Te
							})
						] }) : null,
						bt ? /* @__PURE__ */ J(Of, {
							state: vt === "connected" ? "connected" : "reconnect",
							onReconnect: () => void nn()
						}) : D ? /* @__PURE__ */ J("span", {
							className: "text-[10px] leading-[12px] font-medium uppercase text-basic-tertiary shrink-0",
							children: at.env
						}) : null,
						D && (at.usage || lt) ? /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-[2px] min-w-0",
							children: [/* @__PURE__ */ J(Bh, {
								iconName: F.Timelaps,
								value: ut.value,
								className: "text-info-primary",
								title: ut.title,
								labelClassName: "tag-label"
							}), at.usage && !k ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(Bh, {
									iconName: F.ArrowTop,
									value: kn(at.usage.input_tokens),
									className: "text-info-secondary opacity-75",
									title: "Input tokens",
									labelClassName: "tag-label"
								}),
								at.usage.cache_read_tokens > 0 ? /* @__PURE__ */ J(Bh, {
									prefix: "C",
									value: kn(at.usage.cache_read_tokens),
									className: "text-info-secondary opacity-75",
									title: "Cache read tokens",
									labelClassName: "tag-label"
								}) : null,
								/* @__PURE__ */ J(Bh, {
									iconName: F.ArrowDown,
									value: kn(at.usage.output_tokens),
									className: "text-info-secondary opacity-75",
									title: "Output tokens",
									labelClassName: "tag-label"
								})
							] }) : null]
						}) : null
					]
				}), D ? /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-[10px] shrink-0",
					children: [at.usage ? /* @__PURE__ */ J(Bh, {
						iconName: F.Price,
						iconSize: 16,
						value: mr(at.usage.cost?.total),
						className: "text-basic-primary",
						title: "Session cost",
						showIcon: !1
					}) : null, /* @__PURE__ */ J(Zt, {
						title: pe ? "Run elapsed" : "Last response time",
						position: R.TopRight,
						children: /* @__PURE__ */ Y("div", {
							className: z("flex items-center gap-1 p-1 shrink-0 label-micro", pe ? "text-basic-primary" : "text-basic-tertiary"),
							children: [k ? null : pe ? /* @__PURE__ */ J(Ce, { size: je.Small }) : /* @__PURE__ */ J(M, {
								iconName: F.History,
								size: 16
							}), /* @__PURE__ */ J("span", {
								className: "block w-[40px] text-center",
								children: wn(gt)
							})]
						})
					})]
				}) : null]
			})
		]
	}) : /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-3 rounded-[8px] border border-border-primary bg-elevation-level-1 p-4 text-small text-basic-secondary shadow-2xl",
		children: [/* @__PURE__ */ J("span", {
			className: "flex-1",
			children: "Loading session controls…"
		}), pe && /* @__PURE__ */ J(V, {
			size: B.Small,
			variant: L.GhostDestructive,
			content: o.Text,
			"aria-label": "Stop run",
			onClick: () => void on(),
			children: "Stop"
		})]
	});
}
//#endregion
//#region src/app/components/inspector/MobileBottomBar.tsx
var Uh = {
	sessions: {
		label: "Sessions",
		iconName: F.Chat
	},
	threads: {
		label: "Threads",
		iconName: F.Flow
	},
	delegated: {
		label: "Subagents",
		iconName: F.Robot
	},
	files: {
		label: "Files",
		iconName: F.Folders
	},
	worksets: {
		label: "Worksets",
		iconName: F.Checklist
	},
	history: {
		label: "History",
		iconName: F.History
	}
};
function Wh({ panel: e, onPanelChange: t, panels: n = Rn }) {
	return /* @__PURE__ */ J("div", {
		className: "absolute inset-x-0 bottom-0 z-10 px-2 py-4 pointer-events-none",
		children: /* @__PURE__ */ J("div", {
			className: "flex items-center gap-1 w-full p-[2px] rounded-[18px] bg-elevation-level-3 shadow-2xl overflow-hidden pointer-events-auto",
			role: "tablist",
			children: n.map((n) => {
				let r = e === n;
				return /* @__PURE__ */ Y("button", {
					type: "button",
					role: "tab",
					"aria-selected": r,
					className: z("flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]", r ? "btn-primary" : "btn-ghost"),
					onClick: () => t(n),
					children: [/* @__PURE__ */ J(M, {
						iconName: Uh[n].iconName,
						size: 28
					}), /* @__PURE__ */ J("span", {
						className: z("label-micro font-bold truncate max-w-full", r ? null : "text-basic-primary"),
						children: Uh[n].label
					})]
				}, n);
			})
		})
	});
}
//#endregion
//#region src/app/components/inspector/PanelCountBadge.tsx
function Gh({ count: e }) {
	return /* @__PURE__ */ J("span", {
		className: "pointer-events-none absolute -top-1 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-btn-primary-disabled px-0.5 text-[9px] leading-3 font-medium text-basic-secondary",
		children: e
	});
}
//#endregion
//#region src/app/components/inspector/sessionPanelIcons.ts
var Kh = {
	sessions: F.Chat,
	threads: F.Flow,
	delegated: F.Robot,
	files: F.Folders,
	worksets: F.Checklist,
	history: F.History
};
function qh(e, t, n) {
	return e === "delegated" ? t : e === "worksets" ? n : 0;
}
function Jh({ sessionId: e, snapshot: t, behavior: n, panels: r, onOpen: i, onSelect: a }) {
	let o = u(), s = r.includes("delegated"), c = fe(e, s), l = d(e, s && n === "direct-with-orchestrator"), f = (c.data?.length ?? 0) + (o.orchestrationEnabled ? l.data?.length ?? 0 : 0), p = t?.worksets?.items.length ?? 0;
	return /* @__PURE__ */ J("div", {
		className: "flex h-full flex-col items-center p-2",
		style: { width: 52 },
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col items-center gap-4 [&>*]:shrink-0",
			children: [/* @__PURE__ */ J(Yh, {
				label: "Show panel",
				onClick: i,
				children: /* @__PURE__ */ J(M, { iconName: F.SidebarChevronLeft })
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col items-center gap-4",
				children: r.map((e) => {
					let t = qh(e, f, p);
					return /* @__PURE__ */ Y("span", {
						className: "relative",
						children: [/* @__PURE__ */ J(Yh, {
							label: rr[e],
							onClick: () => a(e),
							children: /* @__PURE__ */ J(M, { iconName: Kh[e] })
						}), t > 0 ? /* @__PURE__ */ J(Gh, { count: t }) : null]
					}, e);
				})
			})]
		})
	});
}
function Yh({ label: e, onClick: t, children: n }) {
	return /* @__PURE__ */ J(Zt, {
		title: e,
		position: R.CenterLeft,
		sticky: !0,
		children: /* @__PURE__ */ J(V, {
			variant: L.Ghost,
			content: o.Icon,
			"aria-label": e,
			onClick: t,
			children: n
		})
	});
}
//#endregion
//#region src/app/components/inspector/CommitPopover.tsx
function Xh(e, t, n) {
	return t == null ? e ? "A run is in flight; wait for it to finish." : n === 0 ? "Nothing to commit: the checkout matches HEAD." : null : "A revision is open; go back to the working tree to commit.";
}
var Zh = (e, t) => `${e} ${t}${e === 1 ? "" : "s"}`;
function Qh({ sessionId: e, changed: t, revision: n }) {
	let { useRunning: r } = me().stores.runtimeStore, [i, a] = K(!1), [o, s] = K(""), c = Ue(), l = r(e), u = un(), d = ee(e), f = Xh(l, n, t.length), p = t.reduce((e, t) => e + (t.additions ?? 0), 0), m = t.reduce((e, t) => e + (t.deletions ?? 0), 0), h = () => {
		a(!1), d.reset();
	}, g = () => {
		let e = o.trim();
		!e || f || d.isPending || d.mutate({ message: e }, { onSuccess: (e) => {
			u.success(`Committed ${Zh(e.files_changed, "file")} as ${e.sha.slice(0, 7)}.`), s(""), h();
		} });
	};
	return /* @__PURE__ */ J(Kn, {
		open: i,
		onClose: h,
		sticky: !0,
		placement: R.BottomRight,
		size: jn.Medium,
		content: /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(nc, {
				autoFocus: !0,
				rows: 3,
				textAreaSize: tc.Small,
				placeholder: "Commit message",
				value: o,
				onChange: (e) => s(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), g());
				}
			}),
			/* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [
					/* @__PURE__ */ Y("span", {
						className: "flex-1 min-w-0 truncate",
						children: ["Staging ", Zh(t.length, "file")]
					}),
					/* @__PURE__ */ Y("span", {
						className: "code code-small text-success-primary",
						children: ["+", p]
					}),
					/* @__PURE__ */ Y("span", {
						className: "code code-small text-error-primary",
						children: ["-", m]
					})
				]
			}),
			d.error ? /* @__PURE__ */ J("div", {
				className: "p-1 label-micro text-error-primary",
				children: Qn(d.error)
			}) : null,
			/* @__PURE__ */ J(V, {
				size: B.Medium,
				variant: L.Secondary,
				disabled: !o.trim(),
				loading: d.isPending,
				onClick: g,
				children: "Commit"
			})
		] }),
		children: c ? /* @__PURE__ */ J(bi, {
			className: "shrink-0",
			variant: L.Secondary,
			disabled: !!f,
			"aria-expanded": i,
			title: f ?? "Commit every change in the checkout",
			onClick: () => i ? h() : a(!0),
			children: "Commit"
		}) : /* @__PURE__ */ J(V, {
			className: "max-w-[120px] shrink-0",
			size: B.Small,
			variant: L.Secondary,
			disabled: !!f,
			"aria-expanded": i,
			title: f ?? "Commit every change in the checkout",
			onClick: () => i ? h() : a(!0),
			children: "Commit"
		})
	});
}
//#endregion
//#region src/app/components/inspector/PanelSplit.tsx
function $h({ list: e, listToolbar: t, listTitle: n, title: r, titleAction: i, actions: a, children: s }) {
	let { setPanelListWidth: c, usePanelListWidth: l } = me().stores.panelWidth, { useSidePanelList: u, toggleSidePanelList: d, showSidePanelList: f } = me().stores.sessionLayoutStore, p = l(), m = Ue(), g = h(), _ = u(), v = G(null), [y, b] = K(0), x = G(!1), S = G(null);
	U(() => () => S.current?.(), []), U(() => {
		let e = v.current;
		if (!e) return;
		let t = () => b(e.clientWidth);
		t();
		let n = new ResizeObserver(t);
		return n.observe(e), () => n.disconnect();
	}, []);
	let w = y > 0 ? y * Ke : p, T = C(p, w);
	return m ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-0-5",
		children: s
	}), /* @__PURE__ */ Y(Vn, {
		open: _,
		onClose: () => f(!1),
		title: n,
		keepOnNavigate: !0,
		bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
		children: [/* @__PURE__ */ J("div", {
			className: z("flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-2 gap-1 [&>*]:shrink-0", t && "pb-[80px]"),
			children: e
		}), t ? /* @__PURE__ */ J("div", {
			className: "absolute inset-x-0 bottom-0 z-10 p-4 pointer-events-none [&>*]:pointer-events-auto",
			children: t
		}) : null]
	})] }) : g ? /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-h-0 w-full",
		children: [_ ? null : /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-[10px] h-12 px-2 shrink-0 border-b border-muted bg-elevation-level-1",
			children: [
				/* @__PURE__ */ J("span", {
					className: "min-w-0 truncate label-small text-basic-primary",
					children: r
				}),
				i,
				/* @__PURE__ */ J("span", { className: "flex-1" }),
				a,
				/* @__PURE__ */ J(V, {
					size: B.Medium,
					variant: L.Ghost,
					content: o.Icon,
					"aria-label": "Open list",
					"aria-expanded": !1,
					onClick: d,
					children: /* @__PURE__ */ J(M, { iconName: F.List })
				})
			]
		}), _ ? /* @__PURE__ */ Y("div", {
			className: "flex flex-col flex-1 min-h-0 bg-elevation-level-1",
			children: [t, /* @__PURE__ */ J("div", {
				className: "flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-1 [&>*]:shrink-0",
				children: e
			})]
		}) : /* @__PURE__ */ J("div", {
			className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-0-5",
			children: s
		})]
	}) : /* @__PURE__ */ Y("div", {
		ref: v,
		className: "flex flex-1 min-h-0 w-full",
		children: [/* @__PURE__ */ Y("div", {
			className: "relative flex flex-col shrink-0 min-h-0 border-r border-muted bg-elevation-level-1",
			style: { width: T },
			children: [
				t,
				/* @__PURE__ */ J("div", {
					className: "flex flex-col flex-1 min-h-0 overflow-auto pt-4 px-1 [&>*]:shrink-0",
					children: e
				}),
				/* @__PURE__ */ J("div", {
					role: "separator",
					"aria-orientation": "vertical",
					"aria-label": "Resize list panel",
					"aria-valuemin": 180,
					"aria-valuemax": Math.round(w),
					"aria-valuenow": T,
					tabIndex: 0,
					className: "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none",
					onPointerDown: (e) => {
						if (e.button !== 0) return;
						let t = v.current;
						if (!t) return;
						e.preventDefault(), S.current?.(), x.current = !0, e.currentTarget.setPointerCapture(e.pointerId);
						let n = e.currentTarget, r = t.style.cursor, i = t.style.userSelect;
						t.style.cursor = "col-resize", t.style.userSelect = "none";
						let a = (n) => {
							if (!x.current || n.pointerId !== e.pointerId) return;
							let r = t.getBoundingClientRect(), i = n.clientX - r.left;
							c(C(i, r.width * Ke));
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
						e.key === "ArrowLeft" ? (e.preventDefault(), c(C(T - t, w))) : e.key === "ArrowRight" && (e.preventDefault(), c(C(T + t, w)));
					}
				})
			]
		}), /* @__PURE__ */ J("div", {
			className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-1",
			children: s
		})]
	});
}
function eg({ label: e, active: t = !1, disabled: n = !1, icon: r, trailing: i, labelClassName: a, title: o, onClick: s }) {
	let c = Ue();
	return /* @__PURE__ */ Y(qc, {
		type: "button",
		size: c ? Gc.Large : Gc.Small,
		active: t,
		disabled: n,
		"aria-pressed": t,
		title: o,
		onClick: s,
		children: [
			r,
			/* @__PURE__ */ J("span", {
				className: z("flex-1 min-w-0 truncate text-left", a),
				children: e
			}),
			i
		]
	});
}
function tg({ listTitle: e }) {
	return /* @__PURE__ */ J($h, {
		listTitle: e,
		list: /* @__PURE__ */ J("div", {
			className: "px-1",
			children: /* @__PURE__ */ J(Ni, {
				rows: 2,
				rowClassName: "h-6"
			})
		}),
		children: /* @__PURE__ */ J("div", {
			role: "status",
			"aria-label": `Loading ${e ?? "panel"}`,
			className: "flex flex-1 flex-col min-h-0 overflow-hidden p-4",
			children: /* @__PURE__ */ J(Ni, {
				rows: 3,
				rowClassName: "h-6"
			})
		})
	});
}
function ng({ title: e, children: t }) {
	return e === void 0 ? /* @__PURE__ */ J("div", {
		className: "flex flex-1 flex-col min-h-0 overflow-auto p-6 label-small text-basic-muted [&>*]:shrink-0",
		children: t
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-1 flex-col min-h-0 overflow-auto p-4 code code-small [&>*]:shrink-0",
		children: [/* @__PURE__ */ J("p", {
			className: "text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ J("p", {
			className: "text-basic-muted",
			children: t
		})]
	});
}
//#endregion
//#region src/app/hooks/useLiveWorkspace.ts
var rg = 3e3;
function ig(e, t) {
	let { useWorkspaceEpoch: n } = me().stores.runtimeStore, r = ti(), i = n(), a = G(null), o = G(0);
	U(() => {
		if (t != null || i === 0 || a.current !== null) return;
		let n = Math.max(0, rg - (Date.now() - o.current));
		a.current = window.setTimeout(() => {
			a.current = null, o.current = Date.now(), v("query:invalidate.workspace", { throttleMs: 0 }), r.invalidateQueries({
				queryKey: tr.sessionSnapshot(e),
				exact: !0
			}), r.invalidateQueries({ queryKey: tr.workspaceFilesRoot(e) }), r.invalidateQueries({ queryKey: tr.workspaceDiffRoot(e) }), r.invalidateQueries({ queryKey: tr.workspaceFileRoot(e) });
		}, n);
	}, [
		r,
		i,
		t,
		e
	]), U(() => () => {
		a.current !== null && clearTimeout(a.current);
	}, []);
}
//#endregion
//#region src/app/lib/fileStatus.ts
var ag = {
	M: "text-danger-primary",
	A: "text-info-primary",
	"?": "text-info-primary",
	R: "text-info-primary",
	C: "text-info-primary",
	D: "text-error-primary",
	U: "text-error-primary"
}, og = (e) => e ? ag[e.trim()[0]] ?? "text-basic-primary" : null, sg = (e) => z(og(e), e?.trim()[0] === "D" && "line-through") || void 0, cg = (e) => e.endsWith("/");
function lg(e) {
	let t = e.replace(/\/+$/, ""), n = t.split("/").pop() || t;
	return cg(e) ? `${n}/` : n;
}
var ug = (e, t) => ({
	name: e,
	path: t,
	dirs: /* @__PURE__ */ new Map(),
	files: []
}), dg = (e, t) => e.name.localeCompare(t.name);
function fg(e) {
	let t = e, n = e.name;
	for (; t.files.length === 0 && t.dirs.size === 1;) {
		let [e] = t.dirs.values();
		n = `${n}/${e.name}`, t = e;
	}
	let r = [...t.dirs.values()].map(fg).sort(dg), i = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: n,
		path: t.path,
		dirs: r,
		files: i,
		hasChanges: i.some((e) => e.status) || r.some((e) => e.hasChanges)
	};
}
function pg(e) {
	let t = ug("", "");
	for (let n of e) {
		let e = n.path.replace(/\/+$/, "").split("/");
		e.pop();
		let r = t, i = "";
		for (let t of e) {
			i = i ? `${i}/${t}` : t;
			let e = r.dirs.get(t);
			e || (e = ug(t, i), r.dirs.set(t, e)), r = e;
		}
		r.files.push(n);
	}
	let n = [...t.dirs.values()].map(fg).sort(dg), r = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: "",
		path: "",
		dirs: n,
		files: r,
		hasChanges: r.some((e) => e.status) || n.some((e) => e.hasChanges)
	};
}
function mg(e, t = []) {
	for (let n of e.dirs) n.hasChanges && (t.push(n.path), mg(n, t));
	return t;
}
//#endregion
//#region src/app/components/inspector/FilesView.tsx
function hg({ open: e }) {
	return /* @__PURE__ */ J(M, {
		iconName: F.Right,
		size: 16,
		className: z("shrink-0 transition-transform", e && "rotate-90")
	});
}
function gg({ dir: e, depth: t, open: n, selected: r, onToggle: i, onSelect: a }) {
	let o = Ue();
	return /* @__PURE__ */ Y("div", {
		className: z("flex flex-col gap-[2px]", t > 0 && "pl-1 ml-[3px] border-l border-muted"),
		children: [e.dirs.map((e) => {
			let o = n.has(e.path);
			return /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-[2px] w-full",
				children: [/* @__PURE__ */ J(eg, {
					label: e.name,
					icon: /* @__PURE__ */ J(hg, { open: o }),
					labelClassName: e.hasChanges ? "text-danger-primary" : void 0,
					onClick: () => i(e.path)
				}), o ? /* @__PURE__ */ J(gg, {
					dir: e,
					depth: t + 1,
					open: n,
					selected: r,
					onToggle: i,
					onSelect: a
				}) : null]
			}, e.path);
		}), e.files.map((e) => /* @__PURE__ */ J(eg, {
			label: lg(e.path),
			active: r === e.path,
			title: e.path,
			labelClassName: sg(e.status),
			icon: /* @__PURE__ */ J(zs, {
				path: e.path,
				size: o ? 24 : 16
			}),
			onClick: () => a(e.path)
		}, e.path))]
	});
}
function _g({ files: e, selected: t, onSelect: n }) {
	let r = Ue();
	return e.length === 0 ? /* @__PURE__ */ J("div", {
		className: "p-1 label-micro text-basic-muted",
		children: "Nothing has changed here yet."
	}) : /* @__PURE__ */ J("div", {
		className: "flex flex-col gap-[2px]",
		children: e.map((e) => /* @__PURE__ */ J(eg, {
			label: lg(e.path),
			active: t === e.path,
			title: e.path,
			labelClassName: sg(e.status),
			icon: /* @__PURE__ */ J(zs, {
				path: e.path,
				size: r ? 24 : 16
			}),
			onClick: () => n(e.path)
		}, e.path))
	});
}
function vg({ iconName: e, label: t, active: n, round: r = !1, onClick: i }) {
	return /* @__PURE__ */ J(V, {
		className: r ? "btn-round" : void 0,
		size: r ? B.Medium : B.Small,
		variant: n ? L.Primary : L.Ghost,
		content: o.Icon,
		"aria-pressed": n,
		"aria-label": t,
		title: t,
		onClick: i,
		children: /* @__PURE__ */ J(M, { iconName: e })
	});
}
function yg({ sessionId: e, listing: t, changed: n, revision: r, readOnly: i }) {
	let { selectFileListing: a } = me().stores.sessionLayoutStore, o = Ue(), s = /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(vg, {
		iconName: F.Folders,
		label: "Show every file",
		active: t === "tree",
		round: o,
		onClick: () => a("tree")
	}), /* @__PURE__ */ J(vg, {
		iconName: F.Scheme,
		label: "Show changed files only",
		active: t === "changed",
		round: o,
		onClick: () => a("changed")
	})] }), c = i ? null : /* @__PURE__ */ J(Qh, {
		sessionId: e,
		changed: n,
		revision: r
	});
	return o ? /* @__PURE__ */ Y("div", {
		className: "flex items-center justify-between gap-2",
		children: [/* @__PURE__ */ J("div", {
			className: "flex items-center gap-4 p-1 rounded-full bg-elevation-level-3 shadow-2xl",
			children: s
		}), c]
	}) : /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-3 h-12 px-3 shrink-0 border-b border-muted @max-[560px]:gap-2 @max-[560px]:px-2",
		children: [/* @__PURE__ */ J("div", {
			className: "flex items-center gap-2 flex-1",
			children: s
		}), c]
	});
}
function bg({ lineNo: e, content: t, tokens: n, tone: r, trailing: i }) {
	return /* @__PURE__ */ Y("div", {
		className: z("flex items-start w-full border-l-2 border-solid", r === "add" ? "bg-success-primary border-success-primary" : r === "delete" ? "bg-error-primary border-error-primary" : "border-transparent"),
		children: [/* @__PURE__ */ J("span", {
			className: "shrink-0 w-12 pr-1 text-right opacity-50 code code-small text-basic-muted select-none",
			children: e ?? ""
		}), /* @__PURE__ */ Y("span", {
			className: "flex-1 min-w-0 px-2 code code-small text-basic-primary whitespace-pre-wrap break-words",
			children: [n ? n.map((e, t) => /* @__PURE__ */ J("span", {
				style: gr(e),
				children: e.text
			}, t)) : t, i]
		})]
	});
}
function xg({ line: e, tokens: t }) {
	let n = e.kind === "delete", r = n ? e.old_lineno : e.new_lineno ?? e.old_lineno;
	return /* @__PURE__ */ J(bg, {
		lineNo: r,
		content: e.content,
		tokens: t,
		tone: e.kind === "insert" ? "add" : n ? "delete" : void 0,
		trailing: e.has_trailing_newline === !1 ? /* @__PURE__ */ J("span", {
			className: "italic text-basic-muted",
			children: " No newline at end of file"
		}) : null
	});
}
function Sg({ tone: e, children: t }) {
	return /* @__PURE__ */ J("div", {
		className: z("mx-4 my-2 rounded-md px-3 py-2 code code-small", e === "error" ? "text-error-primary bg-error-tertiary border border-error-muted" : "text-basic-muted bg-elevation-level-0-5"),
		children: t
	});
}
function Cg({ section: e, highlighted: t }) {
	return e.error ? /* @__PURE__ */ Y(Sg, {
		tone: "error",
		children: ["Error: ", e.error]
	}) : e.binary ? /* @__PURE__ */ J(Sg, { children: "Binary or non-UTF-8 content; inline hunks are unavailable." }) : e.too_large ? /* @__PURE__ */ J(Sg, { children: "File is too large for inline diff rendering." }) : e.hunks.length === 0 ? /* @__PURE__ */ J(Sg, { children: "No hunks for this section." }) : /* @__PURE__ */ Y("div", {
		className: "pb-[128px] md:pb-0",
		children: [e.hunks.map((e, n) => /* @__PURE__ */ Y("div", {
			className: "flex flex-col w-full",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex items-start w-full border-l-2 border-transparent bg-info-tertiary",
				children: [/* @__PURE__ */ J("span", {
					className: "shrink-0 w-12 pr-1 text-right opacity-50 code code-small text-basic-muted select-none",
					children: "@@"
				}), /* @__PURE__ */ Y("span", {
					className: "flex-1 min-w-0 px-2 code code-small text-info-primary truncate",
					children: [`-${e.old_start},${e.old_lines} +${e.new_start},${e.new_lines}`, e.function_context ? ` ${e.function_context}` : ""]
				})]
			}), e.lines.map((e, n) => /* @__PURE__ */ J(xg, {
				line: e,
				tokens: t.get(e)
			}, n))]
		}, n)), e.truncated ? /* @__PURE__ */ J(Sg, { children: "Diff was truncated by the backend." }) : null]
	});
}
function wg({ path: e, trailing: t }) {
	return jr() ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 h-10 px-4 shrink-0 border-b border-muted bg-elevation-level-1",
		title: e,
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-1 items-center gap-[6px] min-w-0",
			children: [/* @__PURE__ */ J(zs, { path: e }), /* @__PURE__ */ J("span", {
				className: "label-micro text-btn-secondary truncate",
				children: lg(e)
			})]
		}), /* @__PURE__ */ J("div", {
			className: "flex items-center gap-2 shrink-0 code code-small",
			children: t
		})]
	}) : null;
}
function Tg({ children: e }) {
	return /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-h-0 overflow-auto py-2 [&>*]:shrink-0",
		children: e
	});
}
function Eg({ sessionId: e, file: t, revision: n }) {
	let { data: r, isFetching: i, error: a } = Jn(e, t.path, "all", 3, n), o = W(() => t.additions != null || t.deletions != null ? {
		additions: t.additions ?? 0,
		deletions: t.deletions ?? 0
	} : r ? r.sections.reduce((e, t) => ({
		additions: e.additions + t.additions,
		deletions: e.deletions + t.deletions
	}), {
		additions: 0,
		deletions: 0
	}) : null, [t, r]);
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(wg, {
		path: t.path,
		trailing: o ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("span", {
			className: "text-success-primary",
			children: ["+", o.additions]
		}), /* @__PURE__ */ Y("span", {
			className: "text-error-primary",
			children: ["-", o.deletions]
		})] }) : null
	}), /* @__PURE__ */ Y(Tg, { children: [
		i && !r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ J(Ce, { size: je.Small }), " Loading diff…"]
		}) : null,
		a ? /* @__PURE__ */ J(Sg, {
			tone: "error",
			children: Qn(a)
		}) : null,
		r ? /* @__PURE__ */ J(Dg, { diff: r }) : null
	] })] });
}
function Dg({ diff: e }) {
	let [t, n] = K(() => /* @__PURE__ */ new Map());
	return U(() => {
		let t = !0;
		return En(e.path, e.sections).then((e) => {
			t && n(e);
		}), () => {
			t = !1;
		};
	}, [e]), e.error ? /* @__PURE__ */ J(Sg, {
		tone: "error",
		children: e.error
	}) : e.sections.length === 0 ? /* @__PURE__ */ J(Sg, { children: "No diff sections returned." }) : /* @__PURE__ */ J(q, { children: e.sections.map((e, n) => /* @__PURE__ */ J(Cg, {
		section: e,
		highlighted: t
	}, n)) });
}
var Og = (e) => e < 1024 ? `${e} B` : `${Math.round(e / 1024)} KB`;
function kg({ sessionId: e, path: t, revision: n }) {
	let { data: r, isFetching: i, error: a } = le(e, t, n), [o, s] = K(null), c = r?.content?.replace(/\n$/, "") ?? null, l = W(() => c?.split("\n") ?? null, [c]);
	U(() => {
		if (c === null) return;
		let e = !0;
		return Lt(t, c).then((t) => {
			e && t && s({
				text: c,
				lines: t
			});
		}), () => {
			e = !1;
		};
	}, [t, c]);
	let u = o?.text === c ? o.lines : null;
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(wg, {
		path: t,
		trailing: r ? /* @__PURE__ */ J("span", {
			className: "text-basic-muted",
			children: Og(r.size)
		}) : null
	}), /* @__PURE__ */ Y(Tg, { children: [
		i && !r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ J(Ce, { size: je.Small }), " Loading file…"]
		}) : null,
		a ? /* @__PURE__ */ J(Sg, {
			tone: "error",
			children: Qn(a)
		}) : null,
		r?.binary ? /* @__PURE__ */ J(Sg, { children: "Binary file; nothing to show inline." }) : null,
		r?.too_large ? /* @__PURE__ */ Y(Sg, { children: [
			"File is too large to display (",
			Og(r.size),
			")."
		] }) : null,
		l ? l.map((e, t) => /* @__PURE__ */ J(bg, {
			lineNo: t + 1,
			content: e,
			tokens: u?.[t]
		}, t)) : null
	] })] });
}
function Ag({ sessionId: e, snapshot: t, revision: n = null, readOnly: r = !1 }) {
	let { useToggledFolders: i, useSelectedFile: a, useFileListing: o, toggleFolder: s, selectFile: c } = me().stores.sessionLayoutStore, l = ti(), u = a(), d = i(), f = o(), { data: p, error: m } = ft(e, n), h = ct(e, n);
	U(() => {
		n ?? l.invalidateQueries({ queryKey: tr.sessionSnapshot(e) });
	}, [
		l,
		e,
		n
	]), ig(e, n);
	let g = t?.workspace ?? null, _ = W(() => n == null ? g?.changed_files ?? [] : h.data?.changed_files ?? [], [
		n,
		g,
		h.data
	]), v = W(() => jg(p?.files ?? [], _), [p, _]), y = W(() => pg(v), [v]), b = W(() => v.filter((e) => e.status !== null), [v]), x = W(() => {
		let e = new Set(mg(y));
		for (let t of d) e.delete(t) || e.add(t);
		return e;
	}, [y, d]), S = W(() => new Map(b.map((e) => [e.path, e])), [b]), C = u ?? b[0]?.path ?? null, w = C ? S.get(C) : void 0, T = m ?? (n == null ? null : h.error);
	return n == null && g?.error ? /* @__PURE__ */ J("div", {
		className: "p-6 label-small text-error-primary",
		children: g.error
	}) : T ? /* @__PURE__ */ J("div", {
		className: "p-6 label-small text-error-primary",
		children: Qn(T)
	}) : p ? /* @__PURE__ */ J($h, {
		listTitle: "Files",
		title: C?.split("/").pop(),
		actions: w && (w.additions || w.deletions) ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 shrink-0 code code-small",
			children: [/* @__PURE__ */ Y("span", {
				className: "text-success-primary",
				children: ["+", w.additions ?? 0]
			}), /* @__PURE__ */ Y("span", {
				className: "text-error-primary",
				children: ["-", w.deletions ?? 0]
			})]
		}) : null,
		listToolbar: /* @__PURE__ */ J(yg, {
			sessionId: e,
			listing: f,
			changed: _,
			revision: n,
			readOnly: r
		}),
		list: v.length === 0 ? /* @__PURE__ */ J("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "No files in the workspace."
		}) : f === "changed" ? /* @__PURE__ */ J(_g, {
			files: b,
			selected: C,
			onSelect: c
		}) : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(gg, {
			dir: y,
			depth: 0,
			open: x,
			selected: C,
			onToggle: s,
			onSelect: c
		}), p.truncated ? /* @__PURE__ */ J("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "Listing truncated."
		}) : null] }),
		children: C ? w ? /* @__PURE__ */ J(Eg, {
			sessionId: e,
			file: w,
			revision: n
		}, C) : /* @__PURE__ */ J(kg, {
			sessionId: e,
			path: C,
			revision: n
		}, C) : /* @__PURE__ */ J(ng, { children: v.length === 0 ? "No files in the workspace." : "Select a file to see it." })
	}) : /* @__PURE__ */ J(tg, { listTitle: "Files" });
}
function jg(e, t) {
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
//#endregion
//#region src/app/lib/markdownChunk.ts
var Mg = null, Ng = !1;
function Pg() {
	return Mg ??= import("./chunks/markdown-renderer-CsRVQvZv.js").then((e) => (Ng = !0, e)), Mg;
}
function Fg() {
	return Ng;
}
//#endregion
//#region src/app/lib/markdown.tsx
var Ig = Gr(Pg);
function Lg({ children: e, streaming: t = !1, className: n }) {
	return /* @__PURE__ */ J("div", {
		className: z("chat-response markdown markdown-content text-basic-primary w-full", t && "streaming", n),
		children: /* @__PURE__ */ J(Ur, {
			fallback: /* @__PURE__ */ J("pre", {
				className: "whitespace-pre-wrap font-sans",
				children: e
			}),
			children: /* @__PURE__ */ J(Ig, {
				streaming: t,
				children: e
			})
		})
	});
}
//#endregion
//#region src/app/components/inspector/ChatBadge.tsx
var Rg = 240;
function zg({ label: e, pending: t = !1, active: n = !1, trailing: r, preface: i, body: a, onClick: o }) {
	Ee("ChatBadge");
	let [s, c] = K(!1), l = !!a, u = l || !!o, d = s || n;
	return /* @__PURE__ */ Y("div", {
		className: z("flex flex-col items-start w-full my-6 border-l-2 border-solid transition-colors duration-150", d ? "border-primary" : "border-tertiary"),
		children: [
			i,
			/* @__PURE__ */ Y("button", {
				type: "button",
				className: z("group flex items-center py-2 rounded-[4px] max-w-full", l ? "gap-[6px] pl-4 pr-2" : "gap-4 px-4", u ? d ? "btn-ghost-highlighted" : "btn-ghost" : "cursor-default"),
				disabled: !u,
				"aria-expanded": l ? s : void 0,
				"aria-pressed": n || void 0,
				onClick: () => {
					l && c((e) => !e), o?.();
				},
				children: [
					/* @__PURE__ */ J("span", {
						className: z("label-small truncate", t ? "text-shimmer-basic" : "text-btn-secondary"),
						children: e
					}),
					r,
					l ? /* @__PURE__ */ J(M, {
						iconName: s ? F.Down : F.Right,
						size: 20,
						className: z("shrink-0", s ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100")
					}) : null
				]
			}),
			l && a ? /* @__PURE__ */ J(fa, {
				isOpen: s,
				className: "w-full",
				isScrollable: t,
				scrollToBottom: t,
				style: t ? { maxHeight: Rg } : void 0,
				children: /* @__PURE__ */ J("div", {
					className: "thinking-content w-full pl-4 py-3",
					children: /* @__PURE__ */ J(Lg, {
						className: "text-basic-tertiary",
						streaming: t,
						children: a
					})
				})
			}) : null
		]
	});
}
function Bg({ additions: e, deletions: t }) {
	return /* @__PURE__ */ Y("span", {
		className: "flex items-center gap-2 shrink-0 code code-small",
		children: [/* @__PURE__ */ Y("span", {
			className: "text-success-primary",
			children: ["+", e]
		}), /* @__PURE__ */ Y("span", {
			className: "text-error-primary",
			children: ["-", t]
		})]
	});
}
//#endregion
//#region src/app/components/inspector/SnapshotFiles.tsx
var Vg = 8;
function Hg({ file: e, active: t, onOpen: n }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		className: z("flex items-center gap-[6px] max-w-full py-2 md:py-1 px-2 rounded-[4px] shrink-0", t ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": t,
		title: e.path,
		onClick: () => n(e.path),
		children: [
			/* @__PURE__ */ J(zs, { path: e.path }),
			/* @__PURE__ */ J("span", {
				className: "text-micro truncate",
				children: lg(e.path)
			}),
			e.additions != null || e.deletions != null ? /* @__PURE__ */ Y("span", {
				className: "flex items-center gap-1 shrink-0 code code-micro",
				children: [/* @__PURE__ */ Y("span", {
					className: "text-success-primary",
					children: ["+", e.additions ?? 0]
				}), /* @__PURE__ */ Y("span", {
					className: "text-error-primary",
					children: ["-", e.deletions ?? 0]
				})]
			}) : null
		]
	});
}
function Ug({ files: e, selected: t, onOpen: n, onOpenAll: r }) {
	if (!e.length) return null;
	let i = e.slice(0, Vg), a = e.length - i.length;
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1 md:gap-0 w-full pl-2 pr-4 pb-1 items-start",
		children: [i.map((e) => /* @__PURE__ */ J(Hg, {
			file: e,
			active: t === e.path,
			onOpen: n
		}, e.path)), a > 0 ? /* @__PURE__ */ J("button", {
			type: "button",
			className: "btn-ghost flex items-center shrink-0 py-1 px-2 rounded-[4px] label-micro text-basic-muted shrink-0",
			onClick: r,
			children: `+${a} more`
		}) : null]
	});
}
//#endregion
//#region src/app/components/inspector/SnapshotBadge.tsx
function Wg({ revision: e, panel: t }) {
	let { data: n } = ct(t.sessionId, e.id), r = W(() => (n?.changed_files ?? []).filter((e) => !e.path.endsWith("/")), [n]), i = t.selectedRevision === e.id;
	return /* @__PURE__ */ J(zg, {
		label: "Snapshot",
		trailing: /* @__PURE__ */ J(Bg, {
			additions: e.additions,
			deletions: e.deletions
		}),
		preface: /* @__PURE__ */ J(Ug, {
			files: r,
			selected: i ? t.selectedFile : null,
			onOpen: (n) => t.onOpenFile(e.id, n),
			onOpenAll: () => t.onOpenPanel(e.id)
		}),
		active: i,
		onClick: () => t.onOpenPanel(e.id)
	});
}
//#endregion
//#region src/app/components/inspector/ThreadLogTail.tsx
var Gg = 16, Kg = 150;
function qg(e) {
	switch (e) {
		case 0: return "";
		case 1: return "opacity-50";
		case 2: return "opacity-10";
		default: return "opacity-0";
	}
}
function Jg(e) {
	let t = G(null), n = G(e);
	return Yr(() => {
		let r = t.current;
		!r || e === n.current || (n.current = e, e && (r.style.transition = "none", r.style.transform = `translateY(${Gg}px)`, r.offsetHeight, r.style.transition = `transform ${Kg}ms ease-out`, r.style.transform = "translateY(0)"));
	}, [e]), t;
}
function Yg({ lines: e, className: t }) {
	let n = e.slice(-4), r = Jg(n[n.length - 1]?.key);
	return /* @__PURE__ */ J("div", {
		className: z("flex flex-col justify-end overflow-hidden", t),
		children: /* @__PURE__ */ J("div", {
			ref: r,
			className: "flex flex-col",
			children: n.map((e, t) => /* @__PURE__ */ J("span", {
				className: z("w-full truncate code code-micro !text-[11px] !leading-[16px] !m-0 block", "transition-opacity duration-150 ease-out", "text-basic-tertiary", qg(n.length - 1 - t)),
				children: e.isError && e.mark ? /* @__PURE__ */ Y(q, { children: [
					/* @__PURE__ */ J("span", {
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
//#endregion
//#region src/app/components/inspector/ThreadWave.tsx
var Xg = {
	error: 0,
	running: 1,
	pending: 2,
	cancelled: 3,
	done: 4
};
function Zg({ state: e }) {
	return e === "running" ? /* @__PURE__ */ J(Ce, {
		size: je.Small,
		variant: O.Neutral
	}) : e === "pending" ? /* @__PURE__ */ J(M, {
		iconName: F.Timelaps,
		size: 20,
		className: "[&>path]:!fill-basic-muted"
	}) : e === "error" ? /* @__PURE__ */ J(M, {
		iconName: F.Danger,
		size: 20,
		className: "[&>path]:!fill-error-primary"
	}) : e === "cancelled" ? /* @__PURE__ */ J(M, {
		iconName: F.Close,
		size: 20,
		className: "[&>path]:!fill-basic-muted"
	}) : /* @__PURE__ */ J(M, {
		iconName: F.CheckCircle,
		size: 20,
		className: "[&>path]:!fill-basic-primary"
	});
}
function Qg(e) {
	return e.reduce((e, t) => Xg[t.state] < Xg[e] ? t.state : e, "done");
}
function $g({ thread: e, selected: t, onSelect: n }) {
	let r = Ue(), i = e.state === "running", a = e.state === "pending", o = e.state === "cancelled", s = e.log.length ? e.log : [{
		key: "action",
		text: e.action,
		bare: e.action,
		mark: null,
		name: null,
		body: e.action,
		isError: !1
	}];
	return /* @__PURE__ */ J("div", {
		className: z("shrink-0 h-[84px] max-w-full overflow-hidden rounded-[4px]", r ? "w-[172px]" : "w-[220px]", i || a ? "bg-elevation-level-2" : "bg-elevation-level-1"),
		children: /* @__PURE__ */ Y("button", {
			type: "button",
			className: z("flex flex-col items-start w-full h-full text-left", t ? "btn-ghost-highlighted" : "btn-ghost"),
			"aria-pressed": t,
			onClick: () => n(e.name, e.key),
			children: [/* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 shrink-0 p-2 w-full",
				children: [
					/* @__PURE__ */ J(Zg, { state: e.state }),
					/* @__PURE__ */ J("span", {
						className: z("flex-1 min-w-0 truncate label-small", i ? "text-shimmer-basic" : a ? "text-basic-muted" : e.state === "error" ? "text-error-primary" : "text-basic-primary"),
						children: e.name
					}),
					e.weight && /* @__PURE__ */ J("span", {
						className: "shrink-0 rounded-[3px] bg-elevation-level-3 px-1 text-[9px] uppercase tracking-wide text-basic-muted",
						children: e.weight
					})
				]
			}), i || o ? /* @__PURE__ */ J(Yg, {
				lines: s,
				className: "flex-1 min-h-0 w-full px-2 pb-2"
			}) : /* @__PURE__ */ J("div", {
				className: "w-full px-2 pt-2",
				children: /* @__PURE__ */ J("span", {
					className: "line-clamp-2 text-micro text-basic-muted !my-0 !text-[11px]",
					children: a ? "Pending..." : e.summary
				})
			})]
		})
	});
}
function e_({ threads: e, selected: t, onSelect: n }) {
	let r = Qg(e);
	return /* @__PURE__ */ J("div", {
		className: z("pl-4 py-3 w-full min-w-0 border-l-2 border-solid", r === "error" ? "border-error-primary" : r === "running" ? "border-primary" : "border-tertiary"),
		children: /* @__PURE__ */ J("div", {
			className: "flex flex-wrap items-start gap-1 w-full min-w-0",
			children: e.map((e) => /* @__PURE__ */ J($g, {
				thread: e,
				selected: t === e.key,
				onSelect: n
			}, e.key))
		})
	});
}
function t_({ rows: e, selected: t, onSelect: n }) {
	return /* @__PURE__ */ J("div", {
		className: "my-8 w-full flex flex-col items-start",
		children: e.map((e, r) => /* @__PURE__ */ J(e_, {
			threads: e,
			selected: t,
			onSelect: n
		}, e.map((e) => e.key).join("|") || `row-${r}`))
	});
}
//#endregion
//#region src/app/components/inspector/ToolCallDetail.tsx
var n_ = {
	pending: "○",
	running: "▸",
	"awaiting-approval": "◇",
	success: "✓",
	error: "✕",
	"timed-out": "◷",
	cancelled: "■",
	interrupted: "!"
}, r_ = Kr(function({ tool: e }) {
	let t = e.status === "pending" || e.status === "running", n = e.status === "awaiting-approval";
	return /* @__PURE__ */ Y("div", {
		className: "my-3 w-full max-w-full min-w-0 rounded-[6px] border border-tertiary px-3 py-2",
		"data-tool-call-id": e.callId,
		children: [/* @__PURE__ */ Y("div", {
			className: "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1",
			children: [
				/* @__PURE__ */ J("span", {
					"aria-hidden": "true",
					className: z("code code-small shrink-0", n ? "text-accent-primary" : t ? "text-shimmer-basic" : e.status === "success" ? "text-success-primary" : "text-error-primary"),
					children: n_[e.status]
				}),
				/* @__PURE__ */ J("span", {
					className: "label-small break-words text-basic-primary",
					children: e.label
				}),
				e.summary ? /* @__PURE__ */ J("span", {
					className: "code code-small min-w-0 break-all text-basic-tertiary",
					children: e.summary
				}) : null,
				/* @__PURE__ */ J("span", {
					"aria-label": `${e.label} status: ${e.statusLabel}`,
					className: z("label-micro shrink-0", n ? "text-accent-primary" : t ? "text-basic-secondary" : "text-basic-muted"),
					children: e.statusLabel
				})
			]
		}), e.resultPreview ? /* @__PURE__ */ J("p", {
			className: "code code-small mt-1 min-w-0 break-all pl-5 text-basic-tertiary",
			children: e.resultPreview
		}) : null]
	});
}), i_ = [
	"parameter",
	"tool_use",
	"tool_call",
	"tool_name",
	"invoke",
	"arguments",
	"parameters",
	"function"
].join("|"), a_ = RegExp(`<(${i_})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), o_ = RegExp(`<\\/?(?:${i_})\\b[^>]*>`, "gi");
function s_(e) {
	if (!e.includes("<")) return e;
	let t = e, n = "";
	for (; t !== n;) n = t, a_.lastIndex = 0, t = t.replace(a_, "");
	return o_.lastIndex = 0, t = t.replace(o_, ""), t;
}
//#endregion
//#region src/app/lib/toolPresentation.ts
function c_(e) {
	return typeof e == "string" ? {
		text: e,
		hasImage: !1
	} : {
		text: e.map((e) => e.type === "text" ? e.text : `[Image: ${e.image.mime_type}]`).join("\n\n"),
		hasImage: e.some((e) => e.type === "image")
	};
}
function l_(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role === "tool") {
			n.set(t.tool_call_id, c_(t.content));
			continue;
		}
		if (t.role === "assistant" || t.role === "user") break;
	}
	return n;
}
function u_(e, t, n) {
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role !== "tool") return t.role === "assistant" && typeof t.content == "string" && t.content.trim() === n;
	}
	return !1;
}
var d_ = {
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
	subagent: "Start coding agent",
	subagent_status: "Check coding agent",
	subagent_cancel: "Cancel coding agent",
	orchestrator_launch: "Start NAC orchestrator",
	orchestrator_status: "Check NAC orchestrator",
	orchestrator_steer: "Steer NAC orchestrator",
	orchestrator_read: "Read NAC orchestrator",
	orchestrator_wait: "Wait for NAC orchestrator",
	orchestrator_cancel: "Cancel NAC orchestrator"
}, f_ = {
	pending: "Pending",
	running: "Running",
	"awaiting-approval": "Awaiting approval",
	success: "Succeeded",
	error: "Failed",
	"timed-out": "Timed out",
	cancelled: "Cancelled",
	interrupted: "Interrupted"
}, p_ = "[tool call cancelled by user]", m_ = "Tool execution was interrupted; no result was recorded.", h_ = 160, g_ = 180;
function __(e, t) {
	let n = [...e ?? ""].map((e) => {
		let t = e.codePointAt(0) ?? 0;
		return t < 32 || t === 127 ? " " : e;
	}).join("").trim();
	return [...n].length <= t ? n : `${[...n].slice(0, t - 1).join("")}…`;
}
function v_(e) {
	let t = e.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	return t ? t[0].toUpperCase() + t.slice(1) : "Tool call";
}
function y_(e) {
	return d_[e] || (e.startsWith("mcp__") ? `MCP · ${v_(e.split("__").filter(Boolean).at(-1) ?? "tool")}` : v_(e || "tool call"));
}
function b_(e) {
	return e.completion_status === "timed_out" ? "timed-out" : e.completion_status === "cancelled" ? "cancelled" : e.completion_status === "error" ? "error" : e.completion_status === "success" ? "success" : e.command_status === "timed_out" ? "timed-out" : e.command_status === "cancelled" ? "cancelled" : e.command_status === "spawn_error" || e.is_error || e.exit_code != null && e.exit_code !== 0 ? "error" : "success";
}
function x_(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		if (n.type !== "tool_call_started" && n.type !== "tool_call_finished" || n.thread_name) continue;
		let e = t.get(n.call_id) ?? {};
		n.type === "tool_call_started" ? e.started = n : e.finished = n, t.set(n.call_id, e);
	}
	return t;
}
function S_({ call: e, events: t, hasResult: n, resultText: r, resultHasImage: i, active: a, awaitingApproval: o, turnCancelled: s }) {
	let c = __(t?.started?.name ?? t?.finished?.name ?? e.function?.name ?? "tool", h_) || "tool", l;
	l = t?.finished ? b_(t.finished) : r?.startsWith(p_) || s && !n ? "cancelled" : r?.trim() === m_ ? "interrupted" : n ? "success" : a && o ? "awaiting-approval" : a && t?.started ? "running" : a ? "pending" : "interrupted";
	let u = __(t?.finished?.content_preview, g_) || null;
	return !u && i && (u = "Image result"), !u && l === "cancelled" && (u = "No result was retained."), !u && l === "interrupted" && (u = "No result was recorded."), {
		callId: e.id,
		name: c,
		label: y_(c),
		summary: __(t?.started?.key_arg_preview, g_) || null,
		resultPreview: u,
		status: l,
		statusLabel: f_[l]
	};
}
//#endregion
//#region src/app/lib/transcript.ts
var C_ = "[run cancelled by user]", w_ = "[run failed after this partial assistant response]";
function T_(e) {
	let t = e.trim();
	if (t === "[run failed after this partial assistant response]") return "";
	let n = `\n\n${w_}`;
	return t.endsWith(n) ? t.slice(0, -n.length).trimEnd() : t;
}
var E_ = "[tool call cancelled by user]", D_ = /* @__PURE__ */ new Set([
	"threads",
	"thread_read",
	"workset_read",
	"workset_list"
]), O_ = "model-streaming";
function k_(e) {
	try {
		let t = JSON.parse(e.function?.arguments || "{}");
		return Object(t) === t ? t : {};
	} catch {
		return {};
	}
}
function A_(e) {
	return gn(e) ? e : "";
}
function j_(e, t, n, r, i) {
	if (n.has(e) || i.liveFinishedToolCalls[e]) return !1;
	if (!t || !r) return !0;
	let a = i.worksets.find((e) => e.id === t);
	if (!a) return !0;
	let o = yr(a.updated_at), s = yr(r);
	return !Number.isFinite(o) || !Number.isFinite(s) || o < s;
}
function M_(e) {
	let t = [];
	return e.forEach((e) => {
		(e.type === "thread_started" || !t.length) && t.push([]), t[t.length - 1].push(e);
	}), t;
}
function N_(e) {
	let t = {};
	return Object.entries(e).forEach(([e, n]) => {
		t[e] = M_(n);
	}), t;
}
function P_(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = F_(e);
			t[n] = (t[n] ?? 0) + 1;
		});
	}), t;
}
function F_(e) {
	return A_(k_(e).name) || "thread";
}
function I_(e) {
	return F_(e);
}
function L_(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = A_(k_(e).action);
			n && (t[F_(e)] = n);
		});
	}), t;
}
function R_(e) {
	let t = k_(e).threads;
	return Array.isArray(t) ? t.filter(gn) : [];
}
function z_(e) {
	let t = e.length;
	if (t <= 1) return t ? [e] : [];
	let n = /* @__PURE__ */ new Map();
	for (let r = 0; r < t; r += 1) {
		let t = F_(e[r]);
		if (n.has(t)) return [e];
		n.set(t, r);
	}
	let r = Array.from({ length: t }, () => []), i = Array.from({ length: t }, () => 0);
	for (let a = 0; a < t; a += 1) {
		let t = /* @__PURE__ */ new Set();
		for (let o of R_(e[a])) {
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
function B_(e, t, n) {
	let r = e.threadEpisodes[t] ?? [];
	return r[n - ((e.dispatchCounts[t] ?? r.length) - r.length)];
}
function V_(e) {
	let t = /* @__PURE__ */ new Set();
	return e.forEach((n, r) => {
		if (n.role !== "assistant") return;
		let i = l_(e, r), a = (n.tool_calls ?? []).filter((e) => e.function?.name === "thread");
		if (!a.length) return;
		let o = u_(e, r, C_), s = !1;
		for (let e of a) {
			let n = i.get(e.id)?.text, r = I_(e);
			if (n == null) {
				o || t.delete(r);
				continue;
			}
			n.startsWith(E_) ? (t.add(r), s = !0) : t.delete(r);
		}
		if (!(!s && !o)) for (let e of a) i.get(e.id) ?? t.add(I_(e));
	}), t;
}
function H_(e, t, n, r, i, a, o) {
	let s = F_(e), c = k_(e), l = A_(c.action), u = A_(c.weight), d = u === "light" || u === "heavy" ? u : null, f = i.get(e.id)?.text ?? null, p = t === (r.dispatchCounts[s] ?? 1) - 1 ? r.liveThreads[s] : void 0, m = R_(e).some((e) => a.has(e) && !o.has(e)), h = B_(r, s, t), g = p?.status !== "running" && h?.some((e) => e.type === "thread_finished"), _ = p?.status === "finished", v = !(p?.status === "running" && !p.cancelled) && (f?.startsWith(E_) === !0 || p?.cancelled || f == null && t === (r.dispatchCounts[s] ?? 1) - 1 && r.cancelledNames.has(s)) ? "cancelled" : p?.isError ? "error" : f != null || _ || g ? "done" : m ? "pending" : "running";
	return {
		key: n,
		name: s,
		action: l,
		weight: d,
		summary: f || l,
		log: Et(zn(h), p?.log ?? []),
		state: v
	};
}
function U_(e, t) {
	for (let n = e.length - 1; n >= 0; --n) {
		let r = e[n];
		if (r.kind === t && (t !== "text" || r.kind !== "text" || r.text.trim() !== "[run cancelled by user]")) return r.text;
	}
	return null;
}
function W_(e, t) {
	return e.reduce((e, n) => n.kind === t ? e + 1 : e, 0);
}
function G_(e, t, n = !1) {
	let r = s_(t.reasoning).trim(), i = s_(t.text).trim();
	if (!r && !i) return e;
	let a = e[e.length - 1], o = a?.kind === "model" && !n, s = o ? {
		...a,
		blocks: a.blocks.slice()
	} : {
		kind: "model",
		key: O_,
		blocks: [],
		durationMs: null,
		messageIndex: null
	}, c = !1;
	return r && !U_(s.blocks, "thoughts")?.includes(r) && (s.blocks.push({
		kind: "thoughts",
		key: `thoughts-${W_(s.blocks, "thoughts")}`,
		text: r,
		durationMs: null,
		streaming: !i
	}), c = !0), i && !U_(s.blocks, "text")?.includes(i) && (s.blocks.push({
		kind: "text",
		key: `text-${W_(s.blocks, "text")}`,
		text: i
	}), c = !0), c ? o ? [...e.slice(0, -1), s] : [...e, s] : e;
}
function K_(e, t, n = {}, r = [], i = /* @__PURE__ */ new Set()) {
	let a = e?.messages ?? [], o = e?.response_timing.response_durations_ms ?? [], s = e?.message_created_at ?? [], c = e?.message_page?.start ?? 0, l = e?.metadata?.behavior === "direct" || e?.metadata?.behavior === "direct-with-orchestrator", u = x_(l ? [...e?.primary_tool_events ?? [], ...r] : []), d = -1;
	a.forEach((e, t) => {
		e.role === "user" && (d = t);
	});
	let f = P_(a), p = new Map((e?.threads ?? []).map((e) => [e.name, e.episode_count])), m = new Set(e?.active_threads ?? []), h = {}, g = {};
	for (let [e, t] of Object.entries(f)) {
		let n = p.get(e) ?? 0, r = Math.max(t, n + +!!m.has(e));
		h[e] = r, g[e] = Math.max(0, r - t);
	}
	let _ = {
		liveThreads: t,
		liveFinishedToolCalls: n,
		worksets: e?.worksets?.items ?? [],
		threadEpisodes: N_(e?.thread_events ?? {}),
		dispatchCounts: h,
		cancelledNames: V_(a)
	}, v = [], y = null, b = /* @__PURE__ */ new Map();
	a.forEach((t, n) => {
		let r = c + n;
		if (t.role === "system" || t.role === "tool") return;
		if (t.role === "user") {
			y = null;
			let e = wr(t.content);
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
				text: Ft(t.content),
				invokedSkills: on(t.content),
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
		let f = s_(t.reasoning_text ?? "").trim();
		f && o.push({
			kind: "thoughts",
			key: `thoughts-${W_(o, "thoughts")}`,
			text: f,
			durationMs: t.duration_ms ?? null,
			streaming: !1
		});
		let p = T_(s_(t.content ?? ""));
		p && o.push({
			kind: "text",
			key: `text-${W_(o, "text")}`,
			text: p
		});
		let m = l_(a, n), h = [];
		if ((t.tool_calls ?? []).forEach((t, c) => {
			let f = t.function?.name ?? "tool", p = `${f}-${r}-${c}`;
			if (f === "thread") h.push(t);
			else if (f === "workset_define") {
				let e = A_(k_(t).id);
				o.push({
					kind: "workset",
					key: p,
					worksetId: e,
					pending: j_(t.id, e, m, s[n] ?? null, _)
				});
			} else if (!D_.has(f)) {
				let r = m.get(t.id);
				l ? o.push({
					kind: "tool-detail",
					key: `tool-${t.id}`,
					presentation: S_({
						call: t,
						events: u.get(t.id),
						hasResult: r != null,
						resultText: r?.text ?? null,
						resultHasImage: r?.hasImage ?? !1,
						active: !!e?.active_run && n > d,
						awaitingApproval: i.has(t.id),
						turnCancelled: u_(a, n, C_)
					})
				}) : o.push({
					kind: "tool",
					key: p,
					name: f,
					pending: r == null
				});
			}
		}), h.length) {
			let e = new Set(h.map(F_)), t = /* @__PURE__ */ new Set();
			for (let e of h) {
				let n = F_(e);
				if (m.has(e.id)) {
					t.add(n);
					continue;
				}
				if (_.liveThreads[n]?.status === "finished") {
					t.add(n);
					continue;
				}
				let r = _.threadEpisodes[n] ?? [], i = r[r.length - 1];
				_.liveThreads[n]?.status !== "running" && i?.some((e) => e.type === "thread_finished") && t.add(n);
			}
			let n = z_(h).map((n) => n.map((n) => {
				let i = F_(n), a = g[i] ?? 0;
				return g[i] = a + 1, H_(n, a, `${i}@${r}:${n.id}`, _, m, e, t);
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
//#endregion
//#region src/app/components/inspector/ModelMessage.tsx
function q_(e) {
	return e.streaming ? "Thinking" : e.durationMs == null ? "Thoughts" : `Thoughts, ${Yt(e.durationMs)}`;
}
function J_(e) {
	return e.blocks.filter((e) => e.kind === "text").map((e) => e.text).join("\n\n").trim();
}
var Y_ = Kr(function({ turn: e, model: t, active: n, activity: r, isLast: i = !1, selectedThreadEpisode: a, selectedWorkset: s, onSelectThread: c, onSelectWorkset: l, userMessageIndex: u, userText: d = "", onRefresh: f = null, onRevert: p = null, onFork: m = null, forks: h = [], onOpenFork: g, onDismissFork: _, actionsDisabled: v = !1, readOnly: y = !1, snapshotRevision: b = null, filesPanel: x = null }) {
	Ee("ModelMessage");
	let S = !y && f != null && u != null, C = !y && p != null && u != null, w = e.messageIndex, T = J_(e), E = e.blocks.some((e) => e.kind === "text" && e.text.trim() === "[run cancelled by user]"), D = Ue();
	return /* @__PURE__ */ J("div", {
		className: z("group/model-msg flex gap-1 items-start w-full max-w-full py-8 relative", i && "min-h-[calc(70vh-316px)]"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col flex-grow gap-1 pt-2 md:max-w-[calc(100%-36px)] min-w-0",
			children: [
				/* @__PURE__ */ Y("div", {
					className: "flex gap-3 items-center mb-4 min-w-0",
					children: [
						/* @__PURE__ */ J(Sc, { active: n }),
						/* @__PURE__ */ J("span", {
							className: "label-small text-basic-primary truncate",
							children: t
						}),
						n && r ? /* @__PURE__ */ J(q, { children: " " }) : e.durationMs == null ? null : /* @__PURE__ */ J("span", {
							className: "label-micro text-basic-muted shrink-0 fade",
							children: Bt(e.durationMs)
						})
					]
				}),
				/* @__PURE__ */ Y("div", {
					className: z("chat-response chat-response-content paragraph-medium text-basic-secondary relative w-full min-w-0 md:pl-3", n && "streaming"),
					children: [
						e.blocks.map((e) => {
							switch (e.kind) {
								case "thoughts": return e.text.trim() ? /* @__PURE__ */ J(zg, {
									label: q_(e),
									pending: e.streaming,
									body: e.text
								}, e.key) : null;
								case "text": return e.text.trim() === "[run cancelled by user]" ? null : /* @__PURE__ */ J(Lg, {
									streaming: n,
									children: e.text
								}, e.key);
								case "workset": return /* @__PURE__ */ J(zg, {
									label: e.worksetId ? `Worksets_${e.worksetId}` : e.pending ? "Defining worksets…" : "Worksets",
									pending: e.pending,
									active: s === e.worksetId,
									onClick: () => l(e.worksetId)
								}, e.key);
								case "tool": return /* @__PURE__ */ J(zg, {
									label: e.pending ? `${e.name}…` : e.name,
									pending: e.pending
								}, e.key);
								case "tool-detail": return /* @__PURE__ */ J(r_, { tool: e.presentation }, e.key);
								case "wave": return /* @__PURE__ */ J(t_, {
									rows: e.rows,
									selected: a,
									onSelect: c
								}, e.key);
								default: return null;
							}
						}),
						b && x ? /* @__PURE__ */ J(Wg, {
							revision: b,
							panel: x
						}) : null,
						E ? /* @__PURE__ */ J(ki, {
							variant: Ti.Danger,
							title: "Run cancelled by user"
						}) : null
					]
				}),
				!y && h.length > 0 ? /* @__PURE__ */ J("div", {
					className: "flex flex-col gap-2 pt-4 md:pl-3 [&>*]:shrink-0",
					children: h.map((e) => /* @__PURE__ */ J(Vs, {
						sessionId: e.session_id,
						title: e.title,
						deleted: e.deleted,
						onOpen: g ? () => g(e.session_id) : void 0,
						onDismiss: _ && e.deleted ? () => _(e.session_id) : void 0
					}, e.session_id))
				}) : null,
				n ? null : /* @__PURE__ */ Y("div", {
					className: z("flex items-center justify-start gap-3 pt-4 md:pl-3", "opacity-0 pointer-events-none transition-opacity duration-150", "group-hover/model-msg:opacity-100 group-hover/model-msg:pointer-events-auto", "group-focus-within/model-msg:opacity-100 group-focus-within/model-msg:pointer-events-auto", "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"),
					children: [
						S ? /* @__PURE__ */ J(Zt, {
							title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
							position: R.BottomRight,
							children: /* @__PURE__ */ J(V, {
								size: D ? B.Medium : B.Small,
								variant: D ? L.Ghost : L.Tertiary,
								content: o.Icon,
								"aria-label": "Regenerate from original prompt",
								disabled: v,
								onClick: () => f(u),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(M, {
									iconName: F.Refresh,
									size: 16
								})
							})
						}) : null,
						C ? /* @__PURE__ */ J(Zt, {
							title: "Revert to this snapshot",
							position: R.BottomRight,
							children: /* @__PURE__ */ J(V, {
								size: D ? B.Medium : B.Small,
								variant: D ? L.Ghost : L.Tertiary,
								content: o.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: v,
								onClick: () => p(u, d),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(M, {
									iconName: F.TurnLeft,
									size: 16
								})
							})
						}) : y ? null : /* @__PURE__ */ J(Zt, {
							title: "This message is not in the transcript yet",
							position: R.BottomRight,
							children: /* @__PURE__ */ J("span", {
								className: "inline-flex",
								children: /* @__PURE__ */ J(V, {
									size: D ? B.Medium : B.Small,
									variant: D ? L.Ghost : L.Tertiary,
									content: o.Icon,
									"aria-label": "Revert to this snapshot",
									disabled: !0,
									className: "md:!h-4 md:!min-h-4 md:!p-0",
									children: /* @__PURE__ */ J(M, {
										iconName: F.TurnLeft,
										size: 16
									})
								})
							})
						}),
						!y && m != null && w != null ? /* @__PURE__ */ J(Zt, {
							title: "Create fork",
							position: R.BottomRight,
							children: /* @__PURE__ */ J(V, {
								size: D ? B.Medium : B.Small,
								variant: D ? L.Ghost : L.Tertiary,
								content: o.Icon,
								"aria-label": "Create fork",
								disabled: v,
								onClick: () => m(w),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(M, {
									iconName: F.Scheme,
									size: 16
								})
							})
						}) : null,
						/* @__PURE__ */ J(Ht, {
							value: T,
							size: D ? B.Medium : B.Small,
							variant: D ? L.Ghost : L.Tertiary,
							title: "Copy message",
							position: R.BottomRight,
							className: "md:!h-4 md:!min-h-4 md:!p-0"
						})
					]
				})
			]
		})
	});
}), X_ = Kr(function({ text: e, pending: t = !1, invokedSkills: n = null, timestamp: r = null, messageIndex: i, onRefresh: a = null, onRevert: s = null, actionsDisabled: c = !1, readOnly: l = !1 }) {
	Ee("UserMessage");
	let u = !l && a != null && i != null, d = !l && s != null && i != null, f = Ue();
	return /* @__PURE__ */ Y("div", {
		className: "group/user-msg flex flex-col items-end w-full max-w-full pt-4 pb-8",
		children: [
			/* @__PURE__ */ J("div", {
				className: z("py-3 px-5 rounded-[12px] bg-elevation-sublevel-variant-B shadow-convex", "label-small text-basic-primary whitespace-pre-wrap break-words", t && "opacity-60"),
				children: e
			}),
			n && n.length > 0 ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-1 pt-1.5 pr-1 label-micro text-basic-tertiary",
				title: "Skill content was expanded into the prompt sent to the agent",
				children: [/* @__PURE__ */ J(M, {
					iconName: F.Bolt,
					size: 12,
					color: "var(--color-fill-basic-tertiary)"
				}), /* @__PURE__ */ Y("span", { children: [
					n.length === 1 ? "Skill" : "Skills",
					" expanded:",
					" ",
					n.map((e) => `$${e}`).join(", ")
				] })]
			}) : null,
			t ? null : /* @__PURE__ */ Y("div", {
				className: z("flex items-center justify-end gap-3 pt-3", "opacity-0 pointer-events-none transition-opacity duration-150", "group-hover/user-msg:opacity-100 group-hover/user-msg:pointer-events-auto", "group-focus-within/user-msg:opacity-100 group-focus-within/user-msg:pointer-events-auto", "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"),
				children: [
					r ? /* @__PURE__ */ J("span", {
						className: "label-micro text-basic-tertiary whitespace-nowrap truncate",
						children: r
					}) : null,
					u ? /* @__PURE__ */ J(Zt, {
						title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
						position: R.BottomLeft,
						children: /* @__PURE__ */ J(V, {
							size: f ? B.Medium : B.Small,
							variant: f ? L.Ghost : L.Tertiary,
							content: o.Icon,
							"aria-label": "Regenerate from original prompt",
							disabled: c,
							onClick: () => a(i),
							className: "md:!h-4 md:!min-h-4 md:!p-0",
							children: /* @__PURE__ */ J(M, {
								iconName: F.Refresh,
								size: 16
							})
						})
					}) : null,
					d ? /* @__PURE__ */ J(Zt, {
						title: "Revert to this snapshot",
						position: R.BottomLeft,
						children: /* @__PURE__ */ J(V, {
							size: f ? B.Medium : B.Small,
							variant: f ? L.Ghost : L.Tertiary,
							content: o.Icon,
							"aria-label": "Revert to this snapshot",
							disabled: c,
							onClick: () => s(i, e),
							className: "md:!h-4 md:!min-h-4 md:!p-0",
							children: /* @__PURE__ */ J(M, {
								iconName: F.TurnLeft,
								size: 16
							})
						})
					}) : l ? null : /* @__PURE__ */ J(Zt, {
						title: "This message is not in the transcript yet",
						position: R.BottomLeft,
						children: /* @__PURE__ */ J("span", {
							className: "inline-flex",
							children: /* @__PURE__ */ J(V, {
								size: f ? B.Medium : B.Small,
								variant: f ? L.Ghost : L.Tertiary,
								content: o.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: !0,
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(M, {
									iconName: F.TurnLeft,
									size: 16
								})
							})
						})
					}),
					/* @__PURE__ */ J(Ht, {
						value: e,
						size: f ? B.Medium : B.Small,
						variant: f ? L.Ghost : L.Tertiary,
						title: "Copy message",
						position: R.BottomLeft,
						className: "md:!h-4 md:!min-h-4 md:!p-0"
					})
				]
			})
		]
	});
});
//#endregion
//#region src/app/features/delegation/presentation/DelegatedCompletionEvent.tsx
function Z_({ turn: e }) {
	let t = u().orchestrationEnabled || e.completion.kind === "coding-agent", n = ci(), r = e.completion.kind === "coding-agent" ? "Coding agent" : "NAC orchestrator", i = e.completion.status === "completed" ? Ti.Success : e.completion.status === "failed" ? Ti.Error : Ti.Danger;
	return /* @__PURE__ */ J(ki, {
		role: "status",
		"aria-label": `${r} ${e.completion.status}`,
		className: "my-5",
		variant: i,
		title: `${r} ${e.completion.status}: ${e.completion.description}`,
		children: /* @__PURE__ */ Y("span", {
			className: "flex flex-col gap-2",
			children: [
				/* @__PURE__ */ Y("span", { children: ["Generation ", e.completion.generation] }),
				e.completion.outcome ? /* @__PURE__ */ J("span", {
					className: "whitespace-pre-wrap",
					children: e.completion.outcome
				}) : null,
				e.completion.changes ? /* @__PURE__ */ Y("span", {
					className: "whitespace-pre-wrap",
					children: ["Changes: ", e.completion.changes]
				}) : null,
				e.completion.verification ? /* @__PURE__ */ Y("span", {
					className: "whitespace-pre-wrap",
					children: ["Verification: ", e.completion.verification]
				}) : null,
				t ? /* @__PURE__ */ J(V, {
					size: B.Small,
					variant: L.Ghost,
					onClick: () => n(pr.session(e.completion.sessionId)),
					children: "Open exact transcript"
				}) : null
			]
		})
	});
}
//#endregion
//#region src/app/hooks/useDelegatedPreviewStream.ts
var Q_ = 250, $_ = {
	text: "",
	reasoning: "",
	running: !1
};
function ev(e) {
	let { subscribeToSessionEvents: t } = { subscribeToSessionEvents: me().events }, n = ti(), [r, i] = K($_), [a, o] = K(e);
	return a !== e && (o(e), i($_)), U(() => {
		if (!e || typeof EventSource > "u") return;
		let r = !1, a = !1, o = null, s = () => {
			clearTimeout(o ?? void 0), o = window.setTimeout(() => {
				o = null, !r && n.invalidateQueries({
					queryKey: tr.sessionSnapshot(e),
					exact: !0
				});
			}, Q_);
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
						a = !0, i($_), s();
						return;
					default: return;
				}
			},
			onAssistantDelta: (e) => {
				if (e.thread_name) return;
				if (e.reset) {
					a = !1, i($_);
					return;
				}
				let t = a;
				a = !1, i((n) => {
					let r = t ? $_ : n;
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
//#endregion
//#region src/app/lib/scroll.ts
var tv = (e) => 1 - (1 - e) ** 3, nv = (e) => e.scrollHeight - (e.scrollTop + e.clientHeight);
function rv(e) {
	e.scrollTop = e.scrollHeight - e.clientHeight;
}
function iv(e, t, n = 300, r) {
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
			let r = Math.min(1, (t - c) / n), i = Math.max(0, e.scrollHeight - e.clientHeight), s = a + ((p ? i : Math.min(o, i)) - a) * tv(r);
			e.scrollTop = p ? Math.max(e.scrollTop, s) : s, r < 1 ? l = requestAnimationFrame(m) : d(!0);
		};
		l = requestAnimationFrame(m);
	});
}
//#endregion
//#region src/app/hooks/useStickToBottom.ts
var av = 400, ov = 60, sv = 400, cv = 200, lv = 300, uv = 1, dv = 50, fv = 150, pv = /* @__PURE__ */ new Set([
	"ArrowUp",
	"ArrowDown",
	"PageUp",
	"PageDown",
	"Home",
	"End"
]);
function mv({ resetKey: e = null } = {}) {
	let t = G(null), n = G(null), [r, i] = K(!1), a = G(!0), o = G(!1), s = G(0), c = G(!1), l = G(null), u = G(null), d = G(null), f = G(!1), p = G(cv), m = G(0), h = G(null), g = H(() => {
		h.current !== null && (clearTimeout(h.current), h.current = null), c.current = !1, o.current = !0;
	}, []), _ = H(() => {
		h.current !== null && clearTimeout(h.current), h.current = window.setTimeout(() => {
			h.current = null, o.current = !1;
		}, dv);
	}, []), v = H(() => {
		let e = t.current;
		e && i(nv(e) > av);
	}, []), y = H(() => {
		let e = u.current !== null;
		u.current?.abort(), u.current = null, d.current !== null && (cancelAnimationFrame(d.current), d.current = null), e && _();
	}, [_]), b = H((e) => {
		let n = t.current;
		if (!n || !a.current || (p.current = e, u.current)) return;
		v();
		let r = nv(n);
		if (r <= 0) return;
		let i = !f.current;
		if (f.current = !0, i || r > n.clientHeight * uv) {
			y(), g(), rv(n), v(), _();
			return;
		}
		let o = new AbortController();
		u.current = o, g(), iv(n, n.scrollHeight, e, o.signal).then((e) => {
			u.current === o && (u.current = null, _(), v(), p.current = cv);
		});
	}, [
		g,
		y,
		_,
		v
	]);
	return U(() => {
		let e = t.current;
		if (!e) return;
		let n = () => {
			c.current = !0, l.current !== null && clearTimeout(l.current), l.current = window.setTimeout(() => {
				c.current = !1, l.current = null;
			}, fv);
		}, r = () => {
			let t = nv(e), n = s.current, r = e.scrollHeight !== n;
			if (s.current = e.scrollHeight, r) {
				t <= 60 && (a.current = !0);
				return;
			}
			o.current && !c.current || (t > ov ? (a.current && y(), a.current = !1) : a.current = !0, v());
		}, i = (t) => {
			n();
			let r = nv(e);
			t.deltaY < 0 && r > ov ? (y(), a.current = !1, v()) : t.deltaY > 0 && r <= 60 && (a.current = !0);
		}, u = (t) => {
			let r = e.getBoundingClientRect();
			t.clientX >= r.left + e.clientWidth && n();
		}, d = (e) => {
			pv.has(e.key) && n();
		};
		return e.addEventListener("scroll", r, { passive: !0 }), e.addEventListener("wheel", i, { passive: !0 }), e.addEventListener("pointerdown", u, { passive: !0 }), e.addEventListener("touchmove", n, { passive: !0 }), e.addEventListener("keydown", d), r(), () => {
			e.removeEventListener("scroll", r), e.removeEventListener("wheel", i), e.removeEventListener("pointerdown", u), e.removeEventListener("touchmove", n), e.removeEventListener("keydown", d), l.current !== null && clearTimeout(l.current);
		};
	}, [y, v]), U(() => {
		let e = t.current, r = n.current;
		if (!e || !r) return;
		let i = () => {
			y(), g(), rv(e), v(), _();
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
			if (m.current = o, n) {
				a.current && i();
				return;
			}
			if (!f.current) {
				s();
				return;
			}
			if (d) {
				if (!a.current || nv(e) <= 60) return;
				i();
				return;
			}
			c();
		});
		x.observe(r);
		let S = new ResizeObserver(() => {
			a.current && (u.current || o.current || nv(e) <= 60 || i());
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
	]), Yr(() => {
		y(), a.current = !0, s.current = 0, m.current = 0;
		let e = t.current;
		if (!e) {
			f.current = !1;
			return;
		}
		f.current = !0, g(), rv(e), v(), _();
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
		jumpToLatest: H(() => {
			let e = t.current;
			e && (y(), a.current = !0, i(!1), g(), iv(e, e.scrollHeight, sv).then((t) => {
				_(), t || (a.current = nv(e) <= 60, v());
			}));
		}, [
			g,
			y,
			_,
			v
		]),
		followLatest: H((e = lv) => {
			f.current = !0, b(e);
		}, [b])
	};
}
//#endregion
//#region src/app/hooks/useMarkdownReady.ts
function hv() {
	let [e, t] = K(Fg);
	return U(() => {
		if (e) return;
		let n = !0;
		return Pg().finally(() => {
			n && t(!0);
		}), () => {
			n = !1;
		};
	}, [e]), e;
}
//#endregion
//#region src/app/hooks/useTranscriptReveal.ts
var gv = 1500;
function _v(e, t) {
	let n = hv(), r = $r({ queryKey: tr.sessionRoot(e) }), [i, a] = K(null), o = G(null), s = G(!1), c = i === e;
	return U(() => {
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
	]), U(() => {
		if (c || !t) return;
		let n = setTimeout(() => a(e), gv);
		return () => clearTimeout(n);
	}, [
		c,
		t,
		e
	]), c;
}
//#endregion
//#region src/app/components/inspector/SubagentPreview.tsx
function vv() {}
function yv() {}
function bv(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function xv({ sessionId: e, title: t, fallbackText: n, icon: r }) {
	let i = ci(), a = Dn(e, { retry: !1 }), s = ev(e), c = mn(e), l = a.data, u = !!l?.message_page?.has_older, d = l?.message_page?.start ?? 0, [f, p] = K(!1), [m, h] = K(e), g = G(!1);
	m !== e && (h(e), p(!1));
	let _ = s.running || !!l?.active_run, v = _v(e, !!l && (!u || f) || a.isError), { scrollRef: y, contentRef: b } = mv({ resetKey: e }), x = G(null);
	Yr(() => {
		let e = x.current, t = y.current;
		!e || !t || (t.scrollTop = e.top + (t.scrollHeight - e.height), x.current = null);
	}, [y, d]);
	let S = c.mutateAsync;
	U(() => {
		g.current = !1;
	}, [e]), U(() => {
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
	let C = W(() => K_(l ?? null, {}, {}, []), [l]), w = _ ? l?.active_run?.submitted_user_message : void 0, T = w ? Ft(w.content) : "", E = w ? on(w.content) : null, D = !!(T && bv(C) !== T), O = s.running && !l?.active_run && !!(s.text || s.reasoning), k = W(() => G_(C, {
		text: s.text,
		reasoning: s.reasoning
	}, D || O), [
		s.reasoning,
		s.text,
		D,
		C,
		O
	]), ee = k[k.length - 1], te = _ && ee?.kind === "model" && (!D || ee.key === "model-streaming"), A = _ && !te, ne = D && ee?.key === "model-streaming", re = l?.metadata.model ?? "", j = v ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
	return /* @__PURE__ */ Y("div", {
		className: "flex min-h-0 flex-1 flex-col",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex h-14 shrink-0 items-center gap-2 border-b border-muted bg-elevation-level-1 px-4",
			children: [
				/* @__PURE__ */ J(M, {
					iconName: r,
					size: 20,
					className: "shrink-0 text-basic-secondary"
				}),
				/* @__PURE__ */ J("p", {
					className: z("label-small min-w-0 flex-1 truncate", _ ? "text-shimmer-basic" : "text-basic-primary"),
					children: t
				}),
				/* @__PURE__ */ Y(V, {
					size: B.Small,
					variant: L.Ghost,
					content: o.IconRight,
					"aria-label": "Open",
					onClick: () => i(pr.session(e)),
					children: ["Open", /* @__PURE__ */ J(M, { iconName: F.Right })]
				})
			]
		}), /* @__PURE__ */ Y("div", {
			className: "relative min-h-0 flex-1",
			children: [/* @__PURE__ */ J("div", {
				role: "status",
				"aria-label": v ? void 0 : "Loading conversation",
				className: z("pointer-events-none absolute inset-0 px-4 pt-4 transition-opacity duration-150 ease-in-out", v ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ J(Ni, {
					rows: 3,
					rowClassName: "h-[48px]"
				})
			}), /* @__PURE__ */ J("div", {
				ref: y,
				className: z("h-full overflow-y-auto", j, !v && "invisible"),
				children: /* @__PURE__ */ Y("div", {
					ref: b,
					className: "flex flex-col px-4 pt-2 pb-6 [&>*]:shrink-0",
					children: [
						f && u ? /* @__PURE__ */ Y("div", {
							role: "alert",
							className: "mb-4 flex items-center gap-2",
							children: [/* @__PURE__ */ J("span", {
								className: "label-small text-basic-muted",
								children: "Couldn’t load older messages."
							}), /* @__PURE__ */ J(V, {
								size: B.Small,
								variant: L.Ghost,
								onClick: () => p(!1),
								children: "Try again"
							})]
						}) : null,
						k.map((e, t) => {
							if (e.kind === "delegated-completion") return /* @__PURE__ */ J(Z_, { turn: e }, e.key);
							if (e.kind === "user") return /* @__PURE__ */ J(X_, {
								text: e.text,
								invokedSkills: e.invokedSkills,
								timestamp: e.createdAt ? Wn(e.createdAt) : null,
								readOnly: !0
							}, e.key);
							let n = t === k.length - 1, r = /* @__PURE__ */ J(Y_, {
								turn: e,
								model: re,
								active: _ && n,
								isLast: !1,
								selectedThreadEpisode: null,
								selectedWorkset: null,
								onSelectThread: vv,
								onSelectWorkset: yv,
								readOnly: !0
							}, e.key);
							return ne && e.key === "model-streaming" ? /* @__PURE__ */ Y(Hr, { children: [/* @__PURE__ */ J(X_, {
								text: T,
								invokedSkills: E,
								pending: !0,
								readOnly: !0
							}), r] }, e.key) : r;
						}),
						D && !ne ? /* @__PURE__ */ J(X_, {
							text: T,
							invokedSkills: E,
							pending: !0,
							readOnly: !0
						}) : null,
						A ? /* @__PURE__ */ J(Y_, {
							turn: {
								kind: "model",
								key: "model-pending",
								blocks: [],
								durationMs: null,
								messageIndex: null
							},
							model: re,
							active: !0,
							isLast: !1,
							selectedThreadEpisode: null,
							selectedWorkset: null,
							onSelectThread: vv,
							onSelectWorkset: yv,
							readOnly: !0
						}) : null,
						k.length === 0 && !_ && n ? /* @__PURE__ */ J("p", {
							className: "label-small py-4 text-basic-secondary",
							children: n
						}) : null
					]
				})
			})]
		})]
	});
}
//#endregion
//#region src/app/components/inspector/DelegatedWorkView.tsx
function Sv(e) {
	return e.startsWith("child:") ? {
		mode: "child",
		id: e.slice(6)
	} : e.startsWith("orchestrator:") ? {
		mode: "orchestrator",
		id: e.slice(13)
	} : null;
}
function Cv(e) {
	return e?.trim() || null;
}
function wv(e) {
	return {
		key: `child:${e.child_session_id}`,
		mode: "child",
		id: e.child_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: Cv(e.failure) ?? Cv(e.report) ?? Cv(e.change_summary) ?? Cv(e.verification_summary),
		icon: F.Plane
	};
}
function Tv(e) {
	return {
		key: `orchestrator:${e.orchestrator_session_id}`,
		mode: "orchestrator",
		id: e.orchestrator_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: Cv(e.failure) ?? Cv(e.report),
		icon: F.Orchestrator
	};
}
var Ev = {
	agent: {
		title: "Launch Subagent",
		body: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from this chat.",
		icon: F.Plane
	},
	orchestrator: {
		title: "Launch Suborchestrator",
		body: "Start a separate NAC planning session. Browse, steer, continue, and cancel it from this chat.",
		icon: F.Orchestrator
	}
};
function Dv({ kind: e }) {
	let t = Ev[e];
	return /* @__PURE__ */ Y("div", {
		className: "flex min-h-0 flex-1 flex-col items-center justify-center px-4",
		children: [
			/* @__PURE__ */ J(M, {
				iconName: t.icon,
				size: 32,
				className: "text-basic-primary"
			}),
			/* @__PURE__ */ J("p", {
				className: "label-big mt-2 text-center text-basic-primary",
				children: t.title
			}),
			/* @__PURE__ */ J("p", {
				className: "label-small mt-2 max-w-[311px] text-center text-basic-tertiary",
				children: t.body
			})
		]
	});
}
function Ov({ sessionId: e, behavior: t }) {
	let { useSubagentLaunch: n, showSidePanelList: r, useSubagentLaunchRequest: i, openSubagentLaunch: a, clearSubagentLaunch: o } = me().stores.sessionLayoutStore, s = u().orchestrationEnabled && t === "direct-with-orchestrator", c = fe(e, !0), l = d(e, s), f = n(), p = !s && f === "orchestrator" ? null : f, m = i(), h = Pn(6e4), [g, _] = K(null), [v, y] = K(e);
	v !== e && (y(e), _(null));
	let b = W(() => {
		let e = (c.data ?? []).map(wv), t = s ? (l.data ?? []).map(Tv) : [];
		return [...e, ...t];
	}, [
		c.data,
		l.data,
		s
	]), x = [...b].sort((e, t) => t.updatedAt.localeCompare(e.updatedAt))[0]?.key ?? null, S = !s && g?.startsWith("orchestrator:") ? null : g, C = p ? null : S ?? x;
	U(() => {
		!s && f === "orchestrator" && o();
	}, [
		s,
		f,
		o
	]), !s && g?.startsWith("orchestrator:") && _(null), !p && g == null && x != null && _(x);
	let w = b.find((e) => e.key === C) ?? null, T = !p && !w && C ? Sv(C) : null, E = W(() => Ol(b, (e) => ({
		updatedAt: e.updatedAt,
		pinned: !1
	}), h), [b, h]), D = (e) => {
		a(e), r(!1);
	}, O = (e) => {
		o(), _(e), r(!1);
	}, k = p ? { mode: p === "agent" ? "new-agent" : "new-orchestrator" } : w ? {
		mode: w.mode,
		id: w.id,
		description: w.description,
		status: w.status,
		background: w.background
	} : T ? {
		mode: T.mode,
		id: T.id,
		description: "Subagent",
		status: "running",
		background: !1
	} : { mode: "new-agent" }, ee = b.length === 0 && (c.isError || s && l.isError) ? /* @__PURE__ */ Y("div", {
		role: "alert",
		className: "rounded-[6px] border border-error-primary p-3",
		children: [/* @__PURE__ */ J("div", {
			className: "text-small text-error-primary",
			children: "Subagents could not be loaded."
		}), /* @__PURE__ */ J(V, {
			className: "mt-2",
			size: B.Small,
			variant: L.Ghost,
			onClick: () => {
				c.refetch(), s && l.refetch();
			},
			children: "Try again"
		})]
	}) : /* @__PURE__ */ J("div", {
		className: "flex flex-col gap-8",
		children: E.map((e) => /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex items-baseline gap-2 px-2",
				children: [/* @__PURE__ */ J("span", {
					className: "tag-label shrink-0 text-basic-muted",
					children: e.label
				}), /* @__PURE__ */ J("span", { className: "h-px min-w-0 flex-1 bg-divider-muted" })]
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => /* @__PURE__ */ J(wi, {
					title: e.description,
					icon: e.icon,
					running: e.status === "running",
					active: !p && w?.key === e.key,
					onClick: () => O(e.key)
				}, e.key))
			})]
		}, e.label))
	});
	return /* @__PURE__ */ J($h, {
		listTitle: "Subagents",
		title: p ? Ev[p].title : w?.description,
		listToolbar: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-1 border-b border-muted p-2",
			children: [/* @__PURE__ */ Y(qc, {
				active: p === "agent",
				onClick: () => D("agent"),
				children: [/* @__PURE__ */ J(M, { iconName: F.Add }), /* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: "New Agent"
				})]
			}), s ? /* @__PURE__ */ Y(qc, {
				active: p === "orchestrator",
				onClick: () => D("orchestrator"),
				children: [/* @__PURE__ */ J(M, { iconName: F.Add }), /* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: "New Orchestrator"
				})]
			}) : null]
		}),
		list: ee,
		children: /* @__PURE__ */ Y("div", {
			className: "flex min-h-0 flex-1 flex-col",
			children: [p ? /* @__PURE__ */ J(Dv, { kind: p }) : w ? /* @__PURE__ */ J(xv, {
				sessionId: w.id,
				title: w.description,
				fallbackText: w.fallbackText,
				icon: w.icon
			}) : T ? /* @__PURE__ */ J(xv, {
				sessionId: T.id,
				title: "Subagent",
				fallbackText: null,
				icon: T.mode === "orchestrator" ? F.Orchestrator : F.Plane
			}) : /* @__PURE__ */ J(Dv, { kind: "agent" }), /* @__PURE__ */ J("div", {
				className: z("shrink-0 p-2"),
				children: /* @__PURE__ */ J(yh, {
					autoFocus: p != null,
					focusRequest: m,
					parentSessionId: e,
					target: k,
					permissionSessionId: "id" in k ? k.id : e,
					permissionBehavior: k.mode === "orchestrator" || k.mode === "new-orchestrator" ? "orchestrator" : "direct",
					showPermissions: !1,
					onStarted: (e) => {
						o(), _(k.mode === "new-orchestrator" || k.mode === "orchestrator" ? `orchestrator:${e}` : `child:${e}`);
					}
				}, `${k.mode}:${"id" in k ? k.id : "new"}:${"status" in k ? k.status : ""}`)
			})]
		})
	});
}
//#endregion
//#region src/app/lib/revisions.ts
var kv = (e) => `Snapshot ${e}`, Av = (e, t) => t - e;
function jv(e, t) {
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
//#endregion
//#region src/app/components/inspector/HistoryView.tsx
function Mv({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		className: z("flex items-start gap-2 w-full p-2 rounded-[8px] text-left", r ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": r,
		onClick: i,
		children: [
			/* @__PURE__ */ J(M, {
				iconName: r ? F.Check : F.History,
				size: 20,
				className: "shrink-0 mt-[2px]"
			}),
			/* @__PURE__ */ Y("span", {
				className: "flex-1 min-w-0 flex flex-col",
				children: [/* @__PURE__ */ J("span", {
					className: "label-medium text-basic-primary truncate",
					children: e
				}), t ? /* @__PURE__ */ J("span", {
					className: "label-small text-basic-muted truncate",
					children: t
				}) : null]
			}),
			n ? /* @__PURE__ */ J("span", {
				className: "shrink-0 flex items-center gap-1 code code-small mt-[6px]",
				children: n
			}) : null
		]
	});
}
function Nv({ sessionId: e, selected: t, onSelect: n }) {
	let { data: r, isLoading: i, error: a } = gt(e), o = r ?? [];
	return a ? /* @__PURE__ */ J(ng, { children: Qn(a) }) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-h-0 overflow-auto p-2 gap-1 bg-elevation-level-1 [&>*]:shrink-0",
		children: [
			/* @__PURE__ */ J(Mv, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => n(null)
			}),
			i ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 p-2 label-small text-basic-muted",
				children: [/* @__PURE__ */ J(Ce, {
					size: je.Small,
					variant: O.Neutral
				}), "Reading snapshots…"]
			}) : null,
			o.map((e, r) => /* @__PURE__ */ J(Mv, {
				title: `${kv(Av(r, o.length))} · ${Wn(e.created_at)}`,
				subtitle: e.label.trim() || null,
				selected: e.id === t,
				trailing: e.additions || e.deletions ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("span", {
					className: "text-success-primary",
					children: ["+", e.additions]
				}), /* @__PURE__ */ Y("span", {
					className: "text-error-primary",
					children: ["-", e.deletions]
				})] }) : null,
				onClick: () => n(e.id)
			}, e.id)),
			!i && o.length === 0 ? /* @__PURE__ */ J("div", {
				className: "p-2 label-small text-basic-muted",
				children: "No snapshots yet. One is taken every time a run finishes."
			}) : null
		]
	});
}
//#endregion
//#region src/app/hooks/usePagedRows.ts
var Pv = 50, Fv = "200px";
function Iv(e, { key: t, step: n = Pv, atLeast: r = 0 }) {
	let [i, a] = K({
		key: t,
		count: n
	}), o = Math.max(i.key === t ? i.count : n, r), s = e.length > o, [c, l] = K(null), u = H(() => {
		a((e) => ({
			key: t,
			count: Math.max(e.key === t ? e.count : n, r) + n
		}));
	}, [
		t,
		n,
		r
	]);
	return U(() => {
		if (!c || !s) return;
		let e = new IntersectionObserver((e) => {
			e.some((e) => e.isIntersecting) && u();
		}, { rootMargin: Fv });
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
//#endregion
//#region src/app/components/inspector/TaskPreview.tsx
function Lv({ text: e, active: t, large: n = !1 }) {
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(M, {
		iconName: F.Info,
		size: n ? 20 : 16,
		className: z("shrink-0", t ? "text-basic-primary" : "text-btn-secondary")
	}), /* @__PURE__ */ J("span", {
		className: z("underline", n ? "label-small" : "label-micro", t ? "text-basic-primary" : "text-btn-secondary"),
		children: e
	})] });
}
function Rv({ action: e, open: t, onClose: n, children: r }) {
	return /* @__PURE__ */ J(Kn, {
		open: t,
		onClose: n,
		placement: R.BottomRight,
		sticky: !0,
		size: "w-[430px] max-w-[calc(100vw-16px)]",
		panelClassName: "p-4 overflow-auto max-h-[70vh]",
		sheetClassName: "max-h-[70vh] overflow-auto",
		className: "shrink-0",
		content: /* @__PURE__ */ J(Lg, {
			className: "text-basic-primary px-4 md:px-0",
			children: e
		}),
		children: r
	});
}
function zv({ action: e, large: t = !1 }) {
	let [n, r] = K(!1);
	return /* @__PURE__ */ J(Rv, {
		action: e,
		open: n,
		onClose: () => r(!1),
		children: /* @__PURE__ */ J("button", {
			type: "button",
			className: "flex items-center gap-1 shrink-0",
			"aria-expanded": n,
			onClick: () => r((e) => !e),
			children: /* @__PURE__ */ J(Lv, {
				text: "See task",
				active: n,
				large: t
			})
		})
	});
}
function Bv({ action: e }) {
	let [t, n] = K(!1);
	return /* @__PURE__ */ J(Rv, {
		action: e,
		open: t,
		onClose: () => n(!1),
		children: /* @__PURE__ */ J(V, {
			size: B.Medium,
			variant: t ? L.Primary : L.Secondary,
			"aria-expanded": t,
			onClick: () => n((e) => !e),
			children: "Task"
		})
	});
}
//#endregion
//#region src/app/components/inspector/SteeringPromptModal.tsx
function Vv({ open: e, title: t, subheader: n, value: r, submitting: i, disabled: a = !1, footerLeading: o, onChange: s, onClose: c, onSubmit: l }) {
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: i ? void 0 : c,
		onNavigate: c,
		size: or.Wide,
		title: t,
		subheader: n,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ J(nc, {
				label: "Steering message",
				"aria-label": "Steering message",
				textAreaSize: tc.Medium,
				value: r,
				onChange: (e) => s(e.target.value),
				isDisabled: i,
				textAreaClassName: "h-[140px] resize-none"
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-wrap items-center justify-between gap-3",
				children: [/* @__PURE__ */ J("div", { children: o }), /* @__PURE__ */ J(V, {
					variant: L.Primary,
					loading: i,
					disabled: a || i,
					onClick: l,
					children: "Send steering"
				})]
			})]
		})
	});
}
//#endregion
//#region src/app/components/inspector/ThreadSteeringModal.tsx
function Hv({ sessionId: e, threadName: t, onClose: n }) {
	let [r, i] = K(""), a = Mn(), o = un(), s = async () => {
		let s = r.trim();
		if (!s) {
			o.error("A steering message is required.");
			return;
		}
		try {
			await a.mutateAsync({
				id: e,
				threadName: t,
				instruction: s
			}), i(""), n();
		} catch (e) {
			o.error(`Unable to steer ${t}: ${Qn($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Vv, {
		open: !0,
		title: `Steer ${t}`,
		value: r,
		submitting: a.isPending,
		onChange: i,
		onClose: n,
		onSubmit: () => void s()
	});
}
//#endregion
//#region src/app/components/inspector/ThreadsView.tsx
function Uv(e, t, n, r) {
	return r ? t.has(r) || n[r] ? !0 : e ? e.threads.some((e) => e.name === r) || Object.hasOwn(e.thread_episodes, r) ? !0 : (e.active_threads ?? []).includes(r) : !1 : !1;
}
function Wv(e, t) {
	return {
		name: e,
		session_id: t,
		created_at: "",
		updated_at: "",
		episode_count: 0,
		latest_action: null
	};
}
function Gv(e) {
	let t = /* @__PURE__ */ new Map();
	if (!e?.length) return t;
	for (let n = e.length - 1; n >= 0; --n) {
		let r = e[n];
		if (r.role !== "assistant") continue;
		let i = (r.tool_calls ?? []).filter((e) => e.function?.name === "thread");
		if (i.length) {
			z_(i).forEach((e, n) => {
				for (let r of e) t.set(I_(r), n);
			});
			break;
		}
	}
	return t;
}
var Kv = Kr(function({ entry: e, running: t }) {
	let n = e.status === "pending" && t;
	return /* @__PURE__ */ Y("div", {
		className: "pt-1",
		children: [/* @__PURE__ */ J("p", {
			className: z("code code-small whitespace-pre-wrap break-words", n ? "text-shimmer-basic" : "text-basic-tertiary"),
			children: n ? /* @__PURE__ */ Y(q, { children: [
				"▸ ",
				`${e.toolName}: `,
				e.keyArg
			] }) : /* @__PURE__ */ Y(q, { children: [
				/* @__PURE__ */ J("span", {
					className: "text-info-primary",
					children: "▸ "
				}),
				/* @__PURE__ */ J("span", {
					className: "text-basic-primary",
					children: `${e.toolName}: `
				}),
				e.keyArg
			] })
		}), e.resultPreview === null ? null : /* @__PURE__ */ Y("p", {
			className: "pl-4 pt-0.5 code code-small whitespace-pre-wrap break-words text-basic-tertiary",
			children: [/* @__PURE__ */ J("span", {
				className: e.isError ? "text-error-primary" : "text-success-primary",
				children: `${e.isError ? "✕" : "✓"} `
			}), e.resultPreview]
		})]
	});
}), qv = Kr(function({ entry: e }) {
	return /* @__PURE__ */ Y("p", {
		className: "pt-1 code code-small whitespace-pre-wrap break-words text-basic-tertiary",
		children: [
			e.mark ? /* @__PURE__ */ J("span", {
				className: e.isError ? "text-error-primary" : "text-success-primary",
				children: `${e.mark} `
			}) : null,
			e.name ? /* @__PURE__ */ J("span", {
				className: "text-basic-primary",
				children: `${e.name}: `
			}) : null,
			e.body
		]
	});
}), Jv = Kr(function({ entry: e, running: t }) {
	return e.kind === "tool_call" ? /* @__PURE__ */ J(Kv, {
		entry: e,
		running: t
	}) : /* @__PURE__ */ J(qv, { entry: e });
}), Yv = {
	error: {
		label: "Failed",
		color: _i.Red
	},
	timed_out: {
		label: "Timed out",
		color: _i.Yellow
	},
	cancelled: {
		label: "Cancelled",
		color: _i.Yellow
	}
};
function Xv({ episode: e, index: t }) {
	let [n, r] = K(!1), i = Ue(), a = Yv[e.status], o = i ? "label-small" : "label-micro";
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col items-start w-full",
		children: [/* @__PURE__ */ Y("button", {
			type: "button",
			className: "group flex items-center gap-2 w-full py-3 pl-1 pr-3 md:py-2 md:pl-3 md:pr-2 rounded-[4px] btn-ghost",
			"aria-expanded": n,
			onClick: () => r((e) => !e),
			children: [
				/* @__PURE__ */ J(M, {
					iconName: n ? F.Down : F.Right,
					size: 16,
					className: "shrink-0 text-basic-muted"
				}),
				/* @__PURE__ */ J("span", {
					className: `shrink-0 ${o} text-basic-primary`,
					children: `Episode ${t + 1}`
				}),
				a ? /* @__PURE__ */ J(vi, {
					text: a.label,
					color: a.color,
					className: "shrink-0"
				}) : null
			]
		}), /* @__PURE__ */ J(fa, {
			isOpen: n,
			className: "w-full",
			children: /* @__PURE__ */ J("div", {
				className: "flex flex-col pl-1 pr-1 md:pl-3 md:pr-2 pt-2 pb-6",
				children: e.content.trim() ? /* @__PURE__ */ J(Lg, {
					className: "text-basic-primary",
					children: e.content
				}) : /* @__PURE__ */ J("p", {
					className: "label-small text-basic-muted",
					children: a ? "The dispatch ended before the thread answered." : "The thread answered with nothing."
				})
			})
		})]
	});
}
var Zv = {
	pending: 0,
	running: 1,
	done: 2
};
function Qv({ scrollRef: e, stuckRef: t, entries: n, running: r, thinking: i, loading: a, className: o, historyControl: s }) {
	return /* @__PURE__ */ Y("div", {
		ref: e,
		className: z("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0 bg-elevation-level-0-5", o),
		onScroll: () => {
			let n = e.current;
			n && (t.current = nv(n) <= 60);
		},
		children: [s, /* @__PURE__ */ Y("div", {
			className: "pb-[128px] md:pb-4",
			children: [
				n.map((e) => /* @__PURE__ */ J(Jv, {
					entry: e,
					running: r
				}, e.kind === "tool_call" ? `call-${e.callId}` : e.key)),
				i ? /* @__PURE__ */ Y("p", {
					className: "pt-1 code code-small",
					children: [/* @__PURE__ */ J("span", {
						className: "text-info-primary",
						children: "▸ "
					}), /* @__PURE__ */ J("span", {
						className: "text-shimmer-basic",
						children: "Working…"
					})]
				}) : null,
				!n.length && !i && (a || r) ? /* @__PURE__ */ J("div", {
					role: "status",
					"aria-label": "Loading command log",
					className: "pt-4",
					children: /* @__PURE__ */ J(Ni, {
						rows: 3,
						rowClassName: "h-6"
					})
				}) : null,
				!n.length && !r && !a ? /* @__PURE__ */ J("p", {
					className: "pt-4 code code-small text-basic-muted",
					children: "No commands recorded."
				}) : null
			]
		})]
	});
}
function $v({ lines: e, running: t, hasOlder: n, loadingOlder: r, loadingInitial: i, historyError: a, onRetry: o, onLoadOlder: s, className: c }) {
	let l = G(null), u = G(null), d = G(!0), f = W(() => $n(e), [e]), p = W(() => ir(t, e), [t, e]), m = f[0]?.kind === "tool_call" ? `call-${f[0].callId}` : f[0]?.key ?? null;
	Yr(() => {
		let e = l.current, t = u.current;
		!e || !t || e.firstKey === m || (t.scrollTop = e.top + (t.scrollHeight - e.height), l.current = null);
	}, [m]), U(() => {
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
	return Yr(() => {
		let e = u.current;
		!e || !d.current || rv(e);
	}, [f.length, p]), /* @__PURE__ */ J(Qv, {
		scrollRef: u,
		stuckRef: d,
		entries: f,
		running: t,
		thinking: p,
		loading: i,
		className: c,
		historyControl: n || a ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 pb-3",
			children: [n ? /* @__PURE__ */ J(V, {
				size: B.Small,
				variant: L.Secondary,
				disabled: r,
				onClick: h,
				children: r ? "Loading…" : "Load older commands"
			}) : null, a ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
				className: "text-micro text-error-primary",
				children: a
			}), /* @__PURE__ */ J(V, {
				size: B.Small,
				variant: L.Ghost,
				onClick: () => {
					n ? h() : o();
				},
				children: "Try again"
			})] }) : null]
		}) : null
	});
}
function ey({ episodes: e, running: t, className: n }) {
	return e.length ? /* @__PURE__ */ J("div", {
		className: z("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", n),
		children: /* @__PURE__ */ J("div", {
			className: "pb-[128px] md:pb-4 flex flex-col",
			children: e.map((e, t) => /* @__PURE__ */ Y("div", {
				className: "flex flex-col",
				children: [t > 0 ? /* @__PURE__ */ J(Q, {}) : null, /* @__PURE__ */ J(Xv, {
					episode: e,
					index: t
				})]
			}, e.id))
		})
	}) : /* @__PURE__ */ J("div", {
		className: z("flex flex-1 min-h-0", n),
		children: /* @__PURE__ */ J("p", {
			className: "p-4 max-w-prose label-small text-basic-muted",
			children: t ? "An episode records one dispatch — what the thread was asked to do and what came back. This one is written when the dispatch ends; until then the Command Log is the live view." : "This thread has not been dispatched yet, so it has no episodes."
		})
	});
}
var ty = {
	log: "Command Log",
	overview: "Episodes"
}, ny = ["log", "overview"];
function ry({ view: e, action: t, canSteer: n, onSteer: r, onChange: i }) {
	return /* @__PURE__ */ Y("div", {
		className: "absolute inset-x-0 top-0 flex items-center gap-2 overflow-x-auto overscroll-x-contain p-2",
		role: "toolbar",
		"aria-label": "Thread controls",
		children: [
			ny.map((t) => /* @__PURE__ */ J("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ J(V, {
					className: "w-full",
					size: B.Medium,
					variant: e === t ? L.Primary : L.Secondary,
					"aria-pressed": e === t,
					onClick: () => i(t),
					children: ty[t]
				})
			}, t)),
			t ? /* @__PURE__ */ J("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ J(Bv, { action: t })
			}) : null,
			n ? /* @__PURE__ */ J("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ J(V, {
					size: B.Medium,
					variant: L.Secondary,
					onClick: r,
					children: "Steer"
				})
			}) : null
		]
	});
}
function iy({ view: e, onChange: t }) {
	return /* @__PURE__ */ J("div", {
		className: "flex items-center gap-2 shrink-0",
		role: "tablist",
		"aria-label": "Thread detail view",
		children: ny.map((n) => /* @__PURE__ */ J(V, {
			size: B.Small,
			variant: e === n ? L.Primary : L.Secondary,
			className: "!rounded-full",
			"aria-pressed": e === n,
			onClick: () => t(n),
			children: ty[n]
		}, n))
	});
}
function ay({ view: e, onChange: t }) {
	return /* @__PURE__ */ J(Yc, {
		size: B.Small,
		variant: L.Secondary,
		value: e,
		items: ny.map((e) => ({
			id: e,
			label: ty[e]
		})),
		onValueChange: (e) => t(e)
	});
}
function oy({ thread: e, action: t, episodes: n, events: r, liveLog: i, running: a, hasOlder: o, loadingOlder: s, loadingInitial: c, historyError: l, onLoadOlder: u, onRetry: d, view: f, canSteer: p, onSteer: m, onViewChange: g }) {
	let _ = Ue(), v = h(), y = W(() => Et(zn(r), i), [r, i]), b = _ ? "pt-14" : void 0, x = f === "log" ? /* @__PURE__ */ J($v, {
		lines: y,
		running: a,
		hasOlder: o,
		loadingInitial: c,
		loadingOlder: s,
		historyError: l,
		onLoadOlder: u,
		onRetry: d,
		className: b
	}) : /* @__PURE__ */ J(ey, {
		episodes: n,
		running: a,
		className: b
	});
	return _ || v ? /* @__PURE__ */ Y("div", {
		className: "relative flex flex-col flex-1 min-h-0 min-w-0",
		children: [x, _ ? /* @__PURE__ */ J(ry, {
			view: f,
			action: t,
			canSteer: p,
			onSteer: m,
			onChange: g
		}) : null]
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-h-0 min-w-0",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 h-14 px-4 shrink-0 border-b border-muted bg-elevation-level-1",
			children: [
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-w-0 justify-center",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-3 min-w-0",
						children: [/* @__PURE__ */ J("span", {
							className: z("label-small truncate", a ? "text-shimmer-basic" : "text-basic-primary"),
							children: e.name
						}), t ? /* @__PURE__ */ J(zv, { action: t }) : null]
					}), /* @__PURE__ */ J("span", {
						className: "code code-micro text-basic-muted truncate",
						children: e.updated_at
					})]
				}),
				p ? /* @__PURE__ */ J(V, {
					size: B.Small,
					variant: L.Secondary,
					onClick: m,
					children: "Steer"
				}) : null,
				/* @__PURE__ */ J(iy, {
					view: f,
					onChange: g
				}),
				/* @__PURE__ */ Y("span", {
					className: "shrink-0 text-micro text-basic-muted",
					children: [n.length, " ep"]
				})
			]
		}), x]
	});
}
function sy({ snapshot: e, selected: t, onSelect: n, canSteerWorkers: r }) {
	let { setSelectedThreadRunning: i } = me().stores.sessionLayoutStore, { useStreamStatus: a, useLiveThreads: o } = me().stores.runtimeStore, s = o(), c = a(), [l, u] = K("log"), [d, f] = K(null), p = W(() => e?.threads ?? [], [e]), m = e?.active_threads, h = e?.metadata.session_id ?? "", g = W(() => Gv(e?.messages), [e?.messages]), _ = W(() => L_(e?.messages ?? []), [e?.messages]), v = W(() => V_(e?.messages ?? []), [e?.messages]), y = W(() => {
		let t = /* @__PURE__ */ new Set();
		for (let n of e?.messages ?? []) if (n.role === "assistant") for (let e of n.tool_calls ?? []) e.function?.name === "thread" && t.add(I_(e));
		return t;
	}, [e?.messages]), b = c === "connecting" || c === "reconnecting", { runningNames: x, pendingNames: S } = W(() => {
		let e = /* @__PURE__ */ new Set(), t = /* @__PURE__ */ new Set();
		for (let n of m ?? []) {
			let r = s[n];
			r?.status === "running" ? e.add(n) : r?.status === "finished" || (b ? e.add(n) : t.add(n));
		}
		for (let [n, r] of Object.entries(s)) r.status === "running" ? (e.add(n), t.delete(n)) : r.status === "finished" && (e.delete(n), t.delete(n));
		return {
			runningNames: e,
			pendingNames: t
		};
	}, [
		m,
		s,
		b
	]), C = W(() => {
		let n = new Set(p.map((e) => e.name)), r = /* @__PURE__ */ new Set();
		for (let e of y) n.has(e) || r.add(e);
		t && !n.has(t) && Uv(e, y, s, t) && r.add(t);
		for (let e of x) n.has(e) || r.add(e);
		for (let e of S) n.has(e) || r.add(e);
		for (let [e, t] of Object.entries(s)) t.status === "finished" && !n.has(e) && r.add(e);
		let i = [...p, ...[...r].map((e) => Wv(e, h))], a = (e) => S.has(e) ? "pending" : x.has(e) ? "running" : "done";
		return i.sort((e, t) => {
			let n = Zv[a(e.name)] - Zv[a(t.name)];
			if (n !== 0) return n;
			let r = (g.get(t.name) ?? -1) - (g.get(e.name) ?? -1);
			return r === 0 ? 0 : r;
		});
	}, [
		p,
		y,
		t,
		x,
		S,
		s,
		h,
		e,
		g
	]), w = W(() => C.filter((e) => !S.has(e.name)), [C, S]), T = C.find((e) => e.name === t) ?? w[0] ?? C[0] ?? null, { visible: E, hasMore: D, sentinelRef: k } = Iv(C, {
		key: h,
		atLeast: (T ? C.findIndex((e) => e.name === T.name) : -1) + 1
	}), ee = T ? s[T.name] : void 0, te = T && (_[T.name] || T.latest_action) || "", A = T?.name ?? null, ne = !!(A && x.has(A)), re = r && ee?.status === "running", j = rn(e ? h : null, A), ie = W(() => j.data ? dn(j.data.pages) : void 0, [j.data]);
	return U(() => {
		A && t !== A && (t && C.some((e) => e.name === t) || n(A));
	}, [
		t,
		A,
		C,
		n
	]), U(() => {}, [
		t,
		C,
		y,
		s,
		e,
		h,
		p
	]), U(() => (i(ne), () => i(!1)), [ne, i]), e ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J($h, {
		listTitle: "Threads",
		title: T?.name,
		titleAction: te ? /* @__PURE__ */ J(zv, { action: te }) : null,
		actions: T ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2",
			children: [re ? /* @__PURE__ */ J(V, {
				size: B.Small,
				variant: L.Secondary,
				onClick: () => f(T.name),
				children: "Steer"
			}) : null, /* @__PURE__ */ J(ay, {
				view: l,
				onChange: u
			})]
		}) : null,
		list: C.length === 0 ? /* @__PURE__ */ Y("div", {
			className: "flex flex-col px-2 pb-4 pt-2 text-micro",
			children: [/* @__PURE__ */ J("p", {
				className: "text-basic-tertiary",
				children: "No threads yet."
			}), /* @__PURE__ */ J("p", {
				className: "text-basic-muted",
				children: "Start a conversation to create one."
			})]
		}) : /* @__PURE__ */ Y(q, { children: [E.map((t) => {
			let r = S.has(t.name), i = x.has(t.name), a = s[t.name], o = e.thread_episodes?.[t.name]?.at(-1), c = e.thread_episodes?.[t.name]?.length ?? t.episode_count, l = !!a?.cancelled || v.has(t.name) || o?.status === "cancelled" || !i && !r && c === 0, u = a?.isError, d = _[t.name] || t.latest_action || "";
			return /* @__PURE__ */ J(eg, {
				label: t.name,
				active: t.name === T?.name,
				disabled: r,
				title: r ? "Waiting on source threads" : d || void 0,
				icon: r ? /* @__PURE__ */ J(M, {
					iconName: F.Timelaps,
					size: 16,
					className: "shrink-0 [&>path]:!fill-basic-muted"
				}) : i ? /* @__PURE__ */ J(Ce, {
					size: je.Micro,
					variant: O.Neutral
				}) : l ? /* @__PURE__ */ J(M, {
					iconName: F.Close,
					size: 16,
					className: "shrink-0 [&>path]:!fill-basic-muted"
				}) : /* @__PURE__ */ J(M, {
					iconName: u ? F.Danger : F.CheckCircle,
					size: 16,
					className: z("shrink-0", u && "text-error-primary")
				}),
				trailing: /* @__PURE__ */ J("span", {
					className: "code code-micro text-basic-muted shrink-0",
					children: e.thread_episodes?.[t.name]?.length ?? t.episode_count
				}),
				onClick: () => n(t.name)
			}, t.name);
		}), D ? /* @__PURE__ */ J("div", {
			ref: k,
			"aria-hidden": !0,
			className: "h-px"
		}) : null] }),
		children: T ? /* @__PURE__ */ J(oy, {
			thread: T,
			action: te,
			episodes: e.thread_episodes?.[T.name] ?? [],
			events: ie ?? e.thread_events?.[T.name],
			liveLog: ee?.log ?? [],
			running: x.has(T.name),
			hasOlder: !!j.hasNextPage,
			loadingOlder: j.isFetchingNextPage,
			loadingInitial: j.isPending,
			historyError: j.error instanceof Error ? j.error.message : null,
			onLoadOlder: async () => {
				await j.fetchNextPage();
			},
			onRetry: async () => {
				j.data ? await j.fetchNextPage() : await j.refetch();
			},
			view: l,
			canSteer: re,
			onSteer: () => f(T.name),
			onViewChange: u
		}, `${h}:${T.name}`) : /* @__PURE__ */ J(ng, {
			title: "No thread selected",
			children: "Threads contain conversations, command output, and file changes for each task. Select a thread to view its details."
		})
	}), d ? /* @__PURE__ */ J(Hv, {
		sessionId: h,
		threadName: d,
		onClose: () => f(null)
	}) : null] }) : /* @__PURE__ */ J(tg, { listTitle: "Threads" });
}
//#endregion
//#region src/app/components/inspector/WorksetsView.tsx
var cy = {
	done: "text-success-primary",
	completed: "text-success-primary",
	finished: "text-success-primary",
	active: "text-info-primary",
	running: "text-info-primary",
	in_progress: "text-info-primary",
	blocked: "text-error-primary",
	failed: "text-error-primary"
}, ly = (e) => cy[e.toLowerCase()] ?? "text-basic-secondary";
function uy({ label: e, children: t }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1",
		children: [/* @__PURE__ */ J("span", {
			className: "tag-label text-basic-muted",
			children: e
		}), t]
	});
}
function dy({ item: e }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-4 p-4 rounded-[8px] border border-muted bg-elevation-level-1",
		children: [
			e.role ? /* @__PURE__ */ J(vi, {
				text: e.role,
				color: _i.Blue,
				className: "self-start"
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1",
				children: [
					/* @__PURE__ */ J("span", {
						className: "header-small text-basic-primary",
						children: e.title
					}),
					e.scope ? /* @__PURE__ */ J("span", {
						className: "code code-small text-danger-primary break-words",
						children: e.scope
					}) : null,
					e.description ? /* @__PURE__ */ J("p", {
						className: "text-small text-basic-secondary",
						children: e.description
					}) : null
				]
			}),
			e.acceptance ? /* @__PURE__ */ J(uy, {
				label: "Acceptance",
				children: /* @__PURE__ */ J("p", {
					className: "text-small text-basic-secondary",
					children: e.acceptance
				})
			}) : null,
			e.depends_on.length > 0 ? /* @__PURE__ */ J(uy, {
				label: "Depends on",
				children: /* @__PURE__ */ J("span", {
					className: "code code-small text-basic-tertiary",
					children: e.depends_on.join(", ")
				})
			}) : null,
			e.notes ? /* @__PURE__ */ J("p", {
				className: "text-small text-basic-muted italic",
				children: e.notes
			}) : null
		]
	});
}
function fy({ workset: e }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-6 flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0",
		children: [
			/* @__PURE__ */ J(uy, {
				label: "ID",
				children: /* @__PURE__ */ J("span", {
					className: "header-medium text-basic-primary break-words",
					children: e.id
				})
			}),
			e.goal ? /* @__PURE__ */ J(uy, {
				label: "Goal",
				children: /* @__PURE__ */ J("p", {
					className: "paragraph-small text-basic-primary",
					children: e.goal
				})
			}) : null,
			e.status ? /* @__PURE__ */ J(uy, {
				label: "Status",
				children: /* @__PURE__ */ J("span", {
					className: z("code code-medium", ly(e.status)),
					children: e.status
				})
			}) : null,
			e.summary ? /* @__PURE__ */ J(uy, {
				label: "Summary",
				children: /* @__PURE__ */ J("p", {
					className: "paragraph-small text-basic-primary",
					children: e.summary
				})
			}) : null,
			e.verification_recipe ? /* @__PURE__ */ J(uy, {
				label: "Verification recipe",
				children: /* @__PURE__ */ J("p", {
					className: "paragraph-small text-basic-primary whitespace-pre-wrap",
					children: e.verification_recipe
				})
			}) : null,
			e.items.length > 0 ? /* @__PURE__ */ J(uy, {
				label: "Workset items",
				children: /* @__PURE__ */ J("div", {
					className: "flex flex-col gap-2 pt-1",
					children: e.items.map((e) => /* @__PURE__ */ J(dy, { item: e }, e.position))
				})
			}) : null
		]
	});
}
function py({ snapshot: e, selected: t, onSelect: n }) {
	if (!e) return /* @__PURE__ */ J(tg, { listTitle: "Worksets" });
	let r = e.worksets;
	if (r.error) return /* @__PURE__ */ J("div", {
		className: "p-6 label-small text-error-primary",
		children: r.error
	});
	let i = r.items.find((e) => e.id === t) ?? r.items[0] ?? null;
	return /* @__PURE__ */ J($h, {
		listTitle: "Worksets",
		title: i?.id,
		list: r.items.length === 0 ? /* @__PURE__ */ J("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "No worksets defined for this session."
		}) : r.items.map((e) => /* @__PURE__ */ J(eg, {
			label: e.id,
			active: e.id === i?.id,
			trailing: /* @__PURE__ */ J("span", {
				className: "code code-micro text-basic-muted shrink-0",
				children: e.items.length
			}),
			onClick: () => n(e.id)
		}, e.id)),
		children: i ? /* @__PURE__ */ J(fy, { workset: i }) : /* @__PURE__ */ J(ng, { children: "No worksets defined for this session." })
	});
}
//#endregion
//#region src/app/hooks/useSessionFetching.ts
var my = 150, hy = 500;
function gy(e) {
	let t = $r({ queryKey: tr.sessionRoot(e) }) > 0, [n, r] = K(!1), i = G(0);
	return U(() => {
		if (t) {
			if (n) return;
			let e = window.setTimeout(() => {
				i.current = Date.now(), r(!0);
			}, my);
			return () => clearTimeout(e);
		}
		if (!n) return;
		let e = hy - (Date.now() - i.current), a = window.setTimeout(() => r(!1), Math.max(0, e));
		return () => clearTimeout(a);
	}, [t, n]), n;
}
//#endregion
//#region src/app/components/inspector/SessionSideBox.tsx
function _y({ sessionId: e }) {
	let t = gy(e);
	return /* @__PURE__ */ J(ac, {
		active: t,
		className: "absolute bottom-[-1px] left-0 right-0 z-[1]"
	});
}
function vy({ sessionId: e, snapshot: t, behavior: n, panel: r, onPanelChange: i }) {
	let { useSidePanelExpanded: a, useSelectedWorkset: s, useSelectedThread: c, useSelectedRevision: l, toggleSidePanelExpanded: f, toggleSidePanelCollapsed: p, showSidePanelList: m, selectWorkset: h, selectThread: g, selectRevision: _ } = me().stores.sessionLayoutStore, v = a(), y = Ue(), b = c(), x = s(), S = l(), C = n === void 0 ? t?.metadata.behavior ?? "orchestrator" : n, w = C === "direct" || C === "direct-with-orchestrator", T = C == null ? null : Il(C, t?.lineage?.kind), E = T?.readOnly ?? !1, D = T?.widePanels ?? [], O = u(), k = D.includes("delegated"), ee = fe(e, k), te = d(e, k && C === "direct-with-orchestrator"), A = (ee.data?.length ?? 0) + (O.orchestrationEnabled ? te.data?.length ?? 0 : 0), ne = T == null ? null : D.includes(r) || y && T.mobilePanels.includes(r) ? r : T.defaultPanel, re = /* @__PURE__ */ Y(q, { children: [
		ne === "files" ? /* @__PURE__ */ J(Ag, {
			sessionId: e,
			snapshot: t,
			revision: S,
			readOnly: E
		}) : null,
		ne === "delegated" && w && !E ? /* @__PURE__ */ J(Ov, {
			sessionId: e,
			behavior: C
		}) : null,
		ne === "worksets" ? /* @__PURE__ */ J(py, {
			snapshot: t,
			selected: x,
			onSelect: h
		}) : null,
		ne === "threads" ? /* @__PURE__ */ J(sy, {
			snapshot: t,
			selected: b,
			onSelect: g,
			canSteerWorkers: C === "orchestrator" && !E
		}) : null,
		ne === "history" ? /* @__PURE__ */ J(Nv, {
			sessionId: e,
			selected: S,
			onSelect: _
		}) : null
	] });
	return y ? /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-h-0",
		children: re
	}) : /* @__PURE__ */ Y("div", {
		className: z("flex flex-col min-h-0 h-full overflow-hidden bg-elevation-level-1", v ? null : "border-l border-muted"),
		children: [/* @__PURE__ */ Y("div", {
			className: z("flex items-center gap-4 pl-3 pr-2 py-2 shrink-0 bg-elevation-level-1 relative border-b border-muted", v ? "pr-10" : null),
			children: [
				/* @__PURE__ */ J(_y, { sessionId: e }),
				/* @__PURE__ */ J("div", {
					className: "flex flex-1 min-w-0 items-center gap-3",
					role: "tablist",
					children: D.map((e) => {
						let n = ne === e, r = qh(e, A, t?.worksets?.items.length ?? 0);
						return /* @__PURE__ */ Y("span", {
							className: "relative shrink-0",
							children: [/* @__PURE__ */ Y("button", {
								type: "button",
								role: "tab",
								"aria-selected": n,
								"aria-label": rr[e],
								className: z("btn btn-medium btn-icon-left !rounded-full", n ? "btn-secondary-highlighted" : "btn-ghost"),
								onClick: () => {
									m(!1), i(e);
								},
								children: [/* @__PURE__ */ J(M, { iconName: Kh[e] }), rr[e]]
							}), r > 0 ? /* @__PURE__ */ J(Gh, { count: r }) : null]
						}, e);
					})
				}),
				v ? null : /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-2 pb-[2px] shrink-0",
					children: [/* @__PURE__ */ J(Zt, {
						title: "Expand panel",
						position: R.BottomLeft,
						children: /* @__PURE__ */ J(V, {
							size: B.Medium,
							variant: L.Ghost,
							content: o.Icon,
							"aria-label": "Expand panel",
							onClick: f,
							children: /* @__PURE__ */ J(M, { iconName: F.FullScreen })
						})
					}), /* @__PURE__ */ J(Zt, {
						title: "Hide panel",
						position: R.BottomLeft,
						children: /* @__PURE__ */ J(V, {
							size: B.Medium,
							variant: L.Ghost,
							content: o.Icon,
							"aria-label": "Hide panel",
							onClick: p,
							children: /* @__PURE__ */ J(M, { iconName: F.SidebarChevronRight })
						})
					})]
				})
			]
		}), /* @__PURE__ */ J("div", {
			className: "flex-1 min-h-0 flex flex-col",
			children: re
		})]
	});
}
//#endregion
//#region src/app/components/inspector/InitialPrompts.tsx
var yy = [
	{
		icon: F.FolderOpen,
		title: "Explore this repository",
		prompt: "Understand the project structure, key components, and how they work together."
	},
	{
		icon: F.Eye,
		title: "Review current changes",
		prompt: "Review the working tree for bugs, regressions, and opportunities to simplify the code."
	},
	{
		icon: F.SearchPage,
		title: "Find something to improve",
		prompt: "Identify one meaningful improvement, explain its impact, and propose an implementation plan."
	},
	{
		icon: F.Bolt,
		title: "Help me get started",
		prompt: "Read the project documentation and suggest the best first task based on the current repository state"
	}
];
function by() {
	let { sendPrompt: e } = me().stores.composerStore;
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-1 flex-col justify-center gap-2",
		children: [/* @__PURE__ */ J("p", {
			className: "text-[10px] leading-[12px] font-medium uppercase text-input-placeholder",
			children: "Get started"
		}), /* @__PURE__ */ J("div", {
			className: "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]",
			children: yy.map((t) => /* @__PURE__ */ J(Hs, {
				icon: t.icon,
				title: t.title,
				description: t.prompt,
				onClick: () => e(t.prompt)
			}, t.title))
		})]
	});
}
//#endregion
//#region src/app/hooks/useAuthErrorSuppressed.ts
function xy(e, t) {
	let n = t != null && $l(t, e).fix?.kind === "login", r = e ? Fe(e) : null, i = On(n && r !== null), a = i.data?.providers.find((e) => e.provider === r), o = a?.backend ?? null, s = !!a?.signed_in, c = bt(o, n && s), l = ti();
	U(() => {
		!n || o === null || l.invalidateQueries({ queryKey: tr.managedProviderModels(o) });
	}, [
		n,
		o,
		l
	]);
	let u = r === null || i.isError || i.data != null && !s || c.isError;
	return n && !u;
}
//#endregion
//#region src/app/hooks/useErrorNotice.ts
function Sy(e, t) {
	let n = Lf(), { start: r } = Nu(), i = t ? Fe(t) : null;
	return H((a, o) => {
		let { title: s, description: c, fix: l } = $l(a, t);
		return {
			title: s,
			description: c,
			action: Cy(l, {
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
function Cy(e, t) {
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
//#endregion
//#region src/app/components/modals/RevertModal.tsx
function wy({ open: e, onClose: t, sessionId: n, messageIdx: r, prompt: i }) {
	let a = un(), s = sr();
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: t,
		title: "Revert to this snapshot",
		size: or.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(V, {
			variant: L.Ghost,
			size: B.Large,
			content: o.Text,
			onClick: t,
			disabled: s.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(V, {
			variant: L.SecondaryDestructive,
			size: B.Large,
			content: o.Text,
			onClick: async () => {
				if (!(r == null || s.isPending)) try {
					let e = await s.mutateAsync({
						id: n,
						messageIdx: r
					});
					a.success(e.workspace_restored ? "Reverted to this snapshot" : "Transcript reverted; no workspace snapshot covered this point"), t();
				} catch (e) {
					a.error(`Failed to revert: ${Qn($(e))}`);
				}
			},
			loading: s.isPending,
			children: "Revert"
		})] }),
		children: /* @__PURE__ */ Y("p", { children: [
			"This removes ",
			/* @__PURE__ */ Y("span", {
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
//#endregion
//#region src/app/lib/runFailure.ts
function Ty(e, t, n) {
	return e.recovery_action === "resume_goal" ? t?.status === "blocked" ? "resume_goal" : null : e.recovery_action === "settings" ? "settings" : e.recovery_action === "regenerate_with_rewind" && n ? "regenerate" : null;
}
//#endregion
//#region src/app/components/inspector/Transcript.tsx
function Ey({ warning: e }) {
	return e ? /* @__PURE__ */ J(ki, {
		role: "status",
		variant: Ti.Info,
		title: "Session recovered",
		children: e
	}) : null;
}
function Dy({ failure: e, goal: t, action: n }) {
	let r = e.recovery_action === "automatic_retry" && t?.status === "active", i = e.recovery_action === "resume_goal" && t?.status === "blocked", a = e.kind === "capacity", o = !!(e.partial_output?.text || e.partial_output?.reasoning || e.partial_output?.tool_call), s = a ? e.summary : r ? "Goal retry scheduled" : i ? "Goal stopped after repeated run failures" : o ? "Run stopped after a partial response" : e.summary, c = t?.next_attempt_at_epoch_ms ? new Date(t.next_attempt_at_epoch_ms).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit"
	}) : null, l = a ? "" : `${e.summary} `, u = r ? `${l}The durable goal and its usage were preserved. NAC will continue automatically${c ? ` at ${c}` : ""}.` : i ? `${l}The durable goal and its usage were preserved. Resume it when you want another bounded retry sequence.` : a ? `Retrying later may be necessary.${Oy(e.retry_after_ms)}` : e.summary;
	return /* @__PURE__ */ Y(ki, {
		role: r ? "status" : "alert",
		variant: r ? Ti.Info : Ti.Danger,
		title: s,
		action: n,
		children: [/* @__PURE__ */ J("span", { children: u }), /* @__PURE__ */ Y("details", {
			className: "mt-2",
			children: [/* @__PURE__ */ J("summary", {
				className: "cursor-pointer",
				children: "Diagnostics"
			}), /* @__PURE__ */ J("pre", {
				className: "mt-1 whitespace-pre-wrap break-words font-mono text-xs",
				children: e.diagnostic
			})]
		})]
	});
}
function Oy(e) {
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
function ky(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		if (e[t]?.kind === "delegated-completion") return null;
		if (e[t]?.kind === "user") return t;
	}
	return null;
}
function Ay(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function jy({ sessionId: e, snapshot: t, panel: n, onFocusPanel: r, errorNotice: i = null }) {
	let { useStreamText: a, useStreamReasoning: s, useModelRetryAttempt: c, useRunning: l, useRunFailure: u, useRunError: d, useOptimisticUserPrompt: f, useLiveThreads: p, useCancelArmed: m, usePrimaryToolEvents: h, useFinishedToolCalls: g, useActivity: _, setOptimisticUserPrompt: y, pushLocalEvent: b } = me().stores.runtimeStore, { useSelectedWorkset: x, useSelectedThreadEpisode: S, useSelectedRevision: C, useSelectedFile: w, selectWorkset: T, selectThread: E, selectRevision: D, selectFile: O } = me().stores.sessionLayoutStore, k = l(e), ee = m(e), te = _(), A = d(), ne = u(), re = c(), j = p(), ie = g(), oe = h(), se = a(), ce = s(), le = f(), ue = S(), de = x(), fe = w(), pe = C(), N = un(), he = Lf(), ge = ci(), P = t?.metadata.backend ?? null, _e = Sy(e, P), ve = xy(P, A), I = ln(), ye = Hn(), be = nr(), xe = Ln(), Se = mn(e), { data: Ce } = gt(e), we = t?.metadata.behavior === "direct" || t?.metadata.behavior === "direct-with-orchestrator", Te = ae(e, we), De = ht(), { data: R } = st(e, we), Oe = W(() => new Set((R?.requests ?? []).map((e) => e.call_id).filter((e) => !!e)), [R?.requests]), { scrollRef: ke, contentRef: Ae, showJumpButton: je, jumpToLatest: Me, followLatest: Ne } = mv({ resetKey: e }), Pe = G(null), Fe = G(!1), Ie = G(!1), Le = t?.message_page?.start ?? 0;
	Yr(() => {
		let e = Pe.current, t = ke.current;
		!e || !t || (t.scrollTop = e.top + (t.scrollHeight - e.height), Pe.current = null);
	}, [Le, ke]);
	let Re = H(() => {
		let e = ke.current;
		e && (Pe.current = {
			height: e.scrollHeight,
			top: e.scrollTop
		}), Se.mutateAsync().then((e) => {
			e || (Pe.current = null);
		}).catch(() => {
			Pe.current = null;
		});
	}, [Se, ke]);
	Ee("Transcript");
	let ze = W(() => bn("buildTranscript", () => K_(t, j, ie, oe, Oe)), [
		t,
		j,
		ie,
		oe,
		Oe
	]), Be = k ? t?.active_run?.submitted_user_message : void 0, Ve = Be ? Ft(Be.content) : le ?? "", He = Be ? on(Be.content) : null, We = !!(Ve && Ay(ze) !== Ve);
	Yr(() => {
		Fe.current = !1, Ie.current = !1;
	}, [e]), U(() => {
		Ie.current = !0;
	}, [e]), Yr(() => {
		let e = We && !Fe.current;
		Fe.current = We, e && Ie.current && Ne(300);
	}, [We, Ne]);
	let Ge = W(() => G_(ze, {
		text: se,
		reasoning: ce
	}, We), [
		ze,
		se,
		ce,
		We
	]), Ke = We && Ge[Ge.length - 1]?.key === "model-streaming";
	v("transcript:turns", {
		fields: {
			turns: Ge.length,
			streamChars: se.length
		},
		throttleMs: 1e3
	});
	let qe = W(() => ky(Ge), [Ge]), Je = k || ee || I.isPending || ye.isPending || be.isPending, [Ye, Xe] = K(null), Ze = ye.mutateAsync, Qe = H((t) => {
		Je || (async () => {
			try {
				let n = await Ze({
					id: e,
					messageIdx: t
				});
				b("run", `▶ regenerated: ${n.display_prompt.slice(0, 80)}`);
			} catch (e) {
				b("error", `regeneration failed: ${Qn($(e))}`, !0), N.error(`Failed to regenerate: ${eu($(e), P)}`);
			}
		})();
	}, [
		Je,
		P,
		b,
		Ze,
		e,
		N
	]), $e = be.mutateAsync, et = H((t) => {
		Je || (async () => {
			try {
				let n = await $e({
					id: e,
					messageIdx: t
				});
				ge(pr.session(n.session_id));
			} catch (e) {
				N.error(`Failed to create fork: ${eu($(e), P)}`);
			}
		})();
	}, [
		Je,
		P,
		$e,
		ge,
		e,
		N
	]), tt = H((e) => {
		ge(pr.session(e));
	}, [ge]), nt = xe.mutate, rt = H((t) => {
		nt({
			id: e,
			forkId: t
		}, { onError: (e) => {
			N.error(`Failed to dismiss fork: ${eu($(e), P)}`);
		} });
	}, [
		P,
		nt,
		e,
		N
	]), it = H((e, t) => {
		Xe({
			messageIdx: e,
			prompt: t
		});
	}, []), at = Ue(), ot = t?.metadata.model ?? "", ct = t?.lineage != null, lt = W(() => jv(Ge, Ce), [Ge, Ce]);
	U(() => {
		!We && le && y(null);
	}, [
		We,
		le,
		y
	]);
	let ut = Ge[Ge.length - 1], dt = k && ut?.kind === "model" && (!We || ut.key === "model-streaming"), ft = (k || We) && !dt, pt = H((e, t) => {
		E(e, t), r("threads");
	}, [r, E]), mt = H((e) => {
		T(e), r("worksets");
	}, [r, T]), _t = H((e) => {
		D(e), r("files");
	}, [r, D]), vt = H((e, t) => {
		D(e), O(t), r("files");
	}, [
		r,
		O,
		D
	]), yt = W(() => ({
		sessionId: e,
		selectedFile: n === "files" ? fe : null,
		selectedRevision: n === "files" ? pe : null,
		onOpenFile: vt,
		onOpenPanel: _t
	}), [
		e,
		n,
		fe,
		pe,
		vt,
		_t
	]), bt = !!(t && Ge.length === 0 && !k && !We), xt = A && !k ? A : null, St = k ? null : ne ?? t?.run_failure ?? Te.data?.last_failure ?? null, Ct = [...Ge].reverse().find((e) => e.kind === "user"), wt = St ? Ty(St, Te.data, Ct?.kind === "user") : null, Tt = St ? wt === "resume_goal" ? {
		label: "Resume goal",
		onClick: () => {
			let t = Te.data;
			t && De.mutateAsync({
				sessionId: e,
				goalId: t.goal_id,
				payload: {
					expected_version: t.version,
					status: "active"
				}
			}).catch((e) => N.error(`Failed to resume goal: ${eu($(e), P)}`));
		}
	} : wt === "settings" ? {
		label: "Open settings",
		onClick: () => he.settings(e)
	} : wt === "regenerate" && Ct?.kind === "user" ? {
		label: "Regenerate from original prompt",
		onClick: () => Qe(Ct.messageIndex)
	} : void 0 : void 0, Et = St ? null : i ?? (xt && !ve ? _e(xt) : null), Dt = _v(e, !!t || i !== null), Ot = Dt ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
	return /* @__PURE__ */ Y("div", {
		className: "relative flex-1 min-h-0",
		children: [
			/* @__PURE__ */ J("div", {
				role: "status",
				"aria-label": Dt ? void 0 : "Loading conversation",
				className: z("pointer-events-none absolute inset-x-0 top-[96px] px-4 transition-opacity duration-150 ease-in-out md:top-[72px] md:px-0", Dt ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ J("div", {
					className: "mx-auto w-full max-w-[720px]",
					children: /* @__PURE__ */ J(Ni, {
						rows: 3,
						rowClassName: "h-[48px]"
					})
				})
			}),
			bt ? /* @__PURE__ */ J("div", {
				className: z("absolute inset-x-0 top-[96px] flex overflow-auto px-4 md:top-[72px] md:px-0", at ? "bottom-[128px]" : "bottom-[136px]", Ot),
				children: /* @__PURE__ */ J("div", {
					className: "m-auto w-full max-w-[720px]",
					children: /* @__PURE__ */ J(by, {})
				})
			}) : null,
			/* @__PURE__ */ J("div", {
				ref: ke,
				className: z("h-full overflow-auto", Ot, !Dt && "invisible"),
				children: /* @__PURE__ */ Y("div", {
					ref: Ae,
					className: z("flex flex-col pt-[96px] md:pt-[72px] [&>*]:shrink-0 px-4 md:px-0", at ? "pb-[180px]" : "pb-[320px] mx-auto max-w-[720px]"),
					children: [
						t?.message_page?.has_older ? /* @__PURE__ */ Y("div", {
							className: "mb-4 flex flex-col items-start gap-2",
							children: [/* @__PURE__ */ J(V, {
								variant: L.Ghost,
								size: B.Small,
								content: o.Text,
								disabled: Se.isPending,
								onClick: Re,
								children: Se.isPending ? "Loading…" : "Load older"
							}), Se.isError ? /* @__PURE__ */ Y("div", {
								role: "alert",
								className: "flex items-center gap-2 text-basic-muted label-small",
								children: [/* @__PURE__ */ J("span", { children: "Couldn’t load older messages." }), /* @__PURE__ */ J(V, {
									variant: L.Ghost,
									size: B.Small,
									content: o.Text,
									onClick: Re,
									children: "Try again"
								})]
							}) : null]
						}) : null,
						/* @__PURE__ */ J(cr, {
							id: "turns",
							children: Ge.map((e, r) => {
								if (e.kind === "delegated-completion") return /* @__PURE__ */ J(Z_, { turn: e }, e.key);
								if (e.kind === "user") return /* @__PURE__ */ J(X_, {
									text: e.text,
									invokedSkills: e.invokedSkills,
									timestamp: e.createdAt ? Wn(e.createdAt) : null,
									messageIndex: e.messageIndex,
									actionsDisabled: Je,
									readOnly: ct,
									onRefresh: !ct && qe === r ? Qe : null,
									onRevert: ct ? null : it
								}, e.key);
								let i = null, a = null;
								for (let e = r - 1; e >= 0; --e) {
									let t = Ge[e];
									if (t?.kind === "delegated-completion") break;
									if (t?.kind === "user") {
										i = e, a = t;
										break;
									}
								}
								let o = r === Ge.length - 1 && !(We && e.key !== "model-streaming"), s = /* @__PURE__ */ J(Y_, {
									turn: e,
									model: ot,
									active: k && o,
									isLast: o && !ft,
									activity: k && o ? te : void 0,
									selectedThreadEpisode: n === "threads" ? ue : null,
									selectedWorkset: n === "worksets" ? de : null,
									onSelectThread: pt,
									onSelectWorkset: mt,
									userMessageIndex: a?.messageIndex,
									userText: a?.text,
									actionsDisabled: Je,
									readOnly: ct,
									onRefresh: !ct && i != null && qe === i ? Qe : null,
									onRevert: ct ? null : it,
									onFork: ct ? null : et,
									forks: ct ? [] : (t?.forks ?? []).filter((t) => t.source_message_idx === e.messageIndex),
									onOpenFork: tt,
									onDismissFork: rt,
									snapshotRevision: e.messageIndex == null ? null : lt.get(e.messageIndex) ?? null,
									filesPanel: yt
								}, e.key);
								return Ke && e.key === "model-streaming" ? /* @__PURE__ */ Y(Hr, { children: [/* @__PURE__ */ J(X_, {
									text: Ve,
									invokedSkills: He,
									pending: !0
								}), s] }, e.key) : s;
							})
						}),
						We && !Ke ? /* @__PURE__ */ J(X_, {
							text: Ve,
							invokedSkills: He,
							pending: !0
						}) : null,
						ft ? /* @__PURE__ */ J(Y_, {
							turn: {
								kind: "model",
								key: "model-pending",
								blocks: [],
								durationMs: null,
								messageIndex: null
							},
							model: ot,
							active: !0,
							isLast: !0,
							selectedThreadEpisode: n === "threads" ? ue : null,
							selectedWorkset: n === "worksets" ? de : null,
							onSelectThread: pt,
							onSelectWorkset: mt
						}) : null,
						Et ? /* @__PURE__ */ J(ki, {
							role: "alert",
							variant: Ti.Error,
							title: Et.title,
							action: Et.action,
							children: Et.description
						}) : null,
						k && re ? /* @__PURE__ */ J(ki, {
							role: "status",
							variant: Ti.Info,
							title: `Connection interrupted; retrying model response (attempt ${re})`,
							children: "The abandoned partial stream was cleared before this attempt began."
						}) : null,
						St ? /* @__PURE__ */ J(Dy, {
							failure: St,
							goal: Te.data,
							action: Tt
						}) : null,
						/* @__PURE__ */ J(Ey, { warning: t?.transcript_recovery_warning })
					]
				})
			}),
			/* @__PURE__ */ J("div", {
				className: `absolute z-[2] left-1/2 bottom-0 -translate-x-1/2 rounded-full  transition-all duration-150 ease-out ${je ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-75 opacity-0 pointer-events-none"}`,
				children: /* @__PURE__ */ Y(V, {
					variant: L.Primary,
					size: B.Small,
					content: o.IconRight,
					className: "!rounded-b-none !shadow-3xl",
					onClick: Me,
					children: ["Last messages", /* @__PURE__ */ J(M, { iconName: F.Down })]
				})
			}),
			/* @__PURE__ */ J(wy, {
				open: Ye !== null,
				onClose: () => Xe(null),
				sessionId: e,
				messageIdx: Ye?.messageIdx ?? null,
				prompt: Ye?.prompt ?? ""
			})
		]
	});
}
//#endregion
//#region src/app/features/direct-session/RunDetails.tsx
function My({ context: e, input: t, output: n, cost: r, elapsed: i }) {
	return /* @__PURE__ */ Y("details", {
		className: "group relative shrink-0",
		children: [/* @__PURE__ */ J("summary", {
			className: "label-micro cursor-pointer rounded px-2 py-1 text-basic-tertiary hover:text-basic-primary focus-visible:outline focus-visible:outline-2",
			children: "Run details"
		}), /* @__PURE__ */ Y("dl", {
			className: "absolute right-0 top-full z-30 mt-1 grid w-52 grid-cols-2 gap-x-4 gap-y-2 rounded-lg border border-tertiary bg-elevation-level-3 p-3 text-micro shadow-xl",
			children: [
				/* @__PURE__ */ J("dt", { children: "Context tokens" }),
				/* @__PURE__ */ J("dd", {
					className: "text-right",
					children: e
				}),
				/* @__PURE__ */ J("dt", { children: "Input tokens" }),
				/* @__PURE__ */ J("dd", {
					className: "text-right",
					children: t
				}),
				/* @__PURE__ */ J("dt", { children: "Output tokens" }),
				/* @__PURE__ */ J("dd", {
					className: "text-right",
					children: n
				}),
				/* @__PURE__ */ J("dt", { children: "Session cost" }),
				/* @__PURE__ */ J("dd", {
					className: "text-right",
					children: r
				}),
				/* @__PURE__ */ J("dt", { children: "Elapsed" }),
				/* @__PURE__ */ J("dd", {
					className: "text-right",
					children: i
				})
			]
		})]
	});
}
//#endregion
//#region src/app/components/inspector/RevisionPicker.tsx
function Ny({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		className: "flex items-start gap-2 w-full p-1 rounded-[4px] text-left btn-ghost",
		onClick: i,
		children: [
			/* @__PURE__ */ J(M, {
				iconName: r ? F.Check : F.History,
				size: 16,
				className: "shrink-0 mt-[2px]"
			}),
			/* @__PURE__ */ Y("span", {
				className: "flex-1 min-w-0 flex flex-col",
				children: [/* @__PURE__ */ J("span", {
					className: "label-micro text-btn-secondary truncate",
					children: e
				}), t ? /* @__PURE__ */ J("span", {
					className: "label-micro text-basic-muted truncate",
					children: t
				}) : null]
			}),
			n ? /* @__PURE__ */ J("span", {
				className: "shrink-0 flex items-center gap-1 code code-small mt-[2px]",
				children: n
			}) : null
		]
	});
}
function Py({ sessionId: e, selected: t, onSelect: n, placement: r = R.TopRight }) {
	let [i, a] = K(!1), { data: o, isLoading: s, error: c } = gt(e), l = o ?? [], u = (e) => Av(e, l.length), d = l.findIndex((e) => e.id === t), f = d >= 0 ? kv(u(d)) : "Working tree", p = (e) => {
		n(e), a(!1);
	};
	return /* @__PURE__ */ J(Kn, {
		open: i,
		onClose: () => a(!1),
		placement: r,
		className: "min-w-0",
		content: /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(Ny, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => p(null)
			}),
			s ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [/* @__PURE__ */ J(Ce, {
					size: je.Small,
					variant: O.Neutral
				}), "Reading snapshots…"]
			}) : null,
			c ? /* @__PURE__ */ J("div", {
				className: "p-1 label-micro text-error-primary",
				children: Qn(c)
			}) : null,
			!s && !c ? /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1 max-h-[280px] overflow-auto [&>*]:shrink-0",
				children: [l.map((e, n) => /* @__PURE__ */ J(Fy, {
					revision: e,
					ordinal: u(n),
					selected: e.id === t,
					onClick: () => p(e.id)
				}, e.id)), l.length === 0 ? /* @__PURE__ */ J("div", {
					className: "p-1 label-micro text-basic-muted",
					children: "No snapshots yet. One is taken every time a run finishes."
				}) : null]
			}) : null
		] }),
		children: /* @__PURE__ */ Y("button", {
			type: "button",
			className: z("flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost", t != null && "text-info-primary"),
			"aria-expanded": i,
			"aria-label": `Snapshot: ${f}`,
			onClick: () => a(!i),
			children: [/* @__PURE__ */ J(M, {
				iconName: F.History,
				size: 16,
				className: "shrink-0"
			}), /* @__PURE__ */ J("span", {
				className: "label-micro text-btn-secondary truncate max-w-[64px] xl:max-w-[128px]",
				children: f
			})]
		})
	});
}
function Fy({ revision: e, ordinal: t, selected: n, onClick: r }) {
	let i = e.label.trim();
	return /* @__PURE__ */ J(Ny, {
		title: `${kv(t)} · ${Wn(e.created_at)}`,
		subtitle: i || null,
		selected: n,
		trailing: e.additions || e.deletions ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("span", {
			className: "text-success-primary",
			children: ["+", e.additions]
		}), /* @__PURE__ */ Y("span", {
			className: "text-error-primary",
			children: ["-", e.deletions]
		})] }) : null,
		onClick: r
	});
}
//#endregion
//#region src/app/components/inspector/TopSingleSessionHeader.tsx
var Iy = {
	direct: "Agent",
	"direct-with-orchestrator": "Agent + NAC",
	orchestrator: "Orchestrator"
};
function Ly(e, t) {
	let n = t.contextWindow;
	return !n || e == null ? "Context tokens" : t.estimated ? `Context against ${t.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate` : `Context — ${Math.round(e / n * 100)}% of the model's context window`;
}
function Ry({ iconName: e, value: t, title: n, className: r, labelClassName: i }) {
	return /* @__PURE__ */ J(Zt, {
		title: n,
		position: R.BottomCenter,
		children: /* @__PURE__ */ Y("div", {
			className: z("flex items-center gap-0.5 whitespace-nowrap", r),
			children: [/* @__PURE__ */ J(M, {
				iconName: e,
				size: 14
			}), /* @__PURE__ */ J("span", {
				className: i,
				children: t
			})]
		})
	});
}
function zy({ sessionId: e, snapshot: t, entry: n, onShowPanel: r }) {
	let { useSessionSpend: i, useRunning: a, useRunUsage: s, useRunStartedAt: c, useLastElapsedMs: l, useCancelArmed: d, liftSessionSpend: f } = me().stores.runtimeStore, { useSelectedRevision: m, selectRevision: h } = me().stores.sessionLayoutStore, g = ci(), _ = ul(), { data: v = [] } = Nt(), y = a(e), b = d(e), x = s(), S = i();
	U(() => {
		f(p(t));
	}, [f, t]);
	let C = Pr(t, n, y || b ? x : null, S), w = Gn(), T = p(t), E = C.usage?.total_tokens || T?.total_tokens || null, D = Ly(E, gu(w.data, t?.metadata?.backend, C.model)), O = Pn(1e3, y), k = c(), ee = l(), te = (y && k != null ? Math.max(0, O - k) : null) ?? ee ?? C.lastResponseMs, A = m(), ne = ct(e, A), re = t?.workspace ?? null, j = A == null ? re : ne.data ?? {
		total_additions: 0,
		total_deletions: 0
	}, ie = j?.total_additions ?? 0, ae = j?.total_deletions ?? 0, oe = re?.repo_label ?? re?.workspace_display ?? null, se = re?.branch ?? null, ce = n?.lineage ?? t?.lineage ?? null, le = ce != null, ue = ce?.kind === "traditional-child" ? "Traditional coding agent" : ce?.kind === "managed-orchestrator" ? "Managed NAC orchestrator" : null, de = ce ? v.find((e) => e.summary.session_id === ce.parent_session_id) : void 0, fe = de ? _(de.summary) : "Parent session", pe = () => {
		ce && g(pr.session(ce.parent_session_id, "delegated"));
	}, N = u(), he = n?.summary.behavior ?? t?.metadata.behavior ?? null, ge = _(n?.summary);
	return /* @__PURE__ */ J("div", {
		className: "pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col justify-center px-4 py-2 bg-elevation-ground",
		children: /* @__PURE__ */ Y("div", {
			className: "pointer-events-auto flex w-full flex-col",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex w-full items-center gap-4",
				children: [
					/* @__PURE__ */ Y("div", {
						className: "flex min-w-0 flex-1 items-center gap-2",
						children: [
							ce ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(V, {
									size: B.Large,
									variant: L.Ghost,
									content: o.Icon,
									className: "!h-6 !w-6 !min-h-0 !p-0",
									"aria-label": "Parent chat",
									onClick: pe,
									children: /* @__PURE__ */ J(M, { iconName: F.Left })
								}),
								/* @__PURE__ */ J("button", {
									type: "button",
									className: "label-medium max-w-[120px] truncate text-btn-secondary",
									title: fe,
									onClick: pe,
									children: fe
								}),
								/* @__PURE__ */ J(M, {
									iconName: F.Right,
									size: 16,
									className: "shrink-0 text-btn-secondary"
								})
							] }) : null,
							/* @__PURE__ */ J("p", {
								className: z("header-md min-w-0 truncate", y ? "text-shimmer-basic" : "text-basic-primary"),
								children: ge
							}),
							ue ? /* @__PURE__ */ J("span", {
								className: "tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-1 py-[2px] text-basic-tertiary",
								children: ue
							}) : he && N.orchestrationEnabled ? /* @__PURE__ */ J("span", {
								className: "tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-1 py-[2px] text-basic-tertiary",
								children: Iy[he]
							}) : null
						]
					}),
					he === "direct" || he === "direct-with-orchestrator" ? /* @__PURE__ */ J(My, {
						context: kn(E),
						input: kn(C.usage?.input_tokens),
						output: kn(C.usage?.output_tokens),
						cost: mr(C.usage?.cost?.total),
						elapsed: wn(te)
					}) : /* @__PURE__ */ Y(q, { children: [C.usage || E ? /* @__PURE__ */ Y("div", {
						className: "shrink-0 items-center gap-0.5 hidden xl:flex",
						children: [/* @__PURE__ */ J(Ry, {
							iconName: F.Timelaps,
							value: kn(E),
							title: D,
							className: "text-info-primary",
							labelClassName: "label-micro"
						}), C.usage ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Ry, {
							iconName: F.ArrowTop,
							value: kn(C.usage.input_tokens),
							title: "Input tokens",
							className: "text-info-secondary opacity-75",
							labelClassName: "text-micro"
						}), /* @__PURE__ */ J(Ry, {
							iconName: F.ArrowDown,
							value: kn(C.usage.output_tokens),
							title: "Output tokens",
							className: "text-info-secondary opacity-75",
							labelClassName: "text-micro"
						})] }) : null]
					}) : null, /* @__PURE__ */ Y("div", {
						className: "flex shrink-0 items-center",
						children: [C.usage ? /* @__PURE__ */ J(Zt, {
							title: "Session cost",
							position: R.BottomCenter,
							children: /* @__PURE__ */ J("span", {
								className: "text-micro whitespace-nowrap text-basic-primary",
								children: mr(C.usage.cost?.total)
							})
						}) : null, /* @__PURE__ */ J(Zt, {
							title: y ? "Run elapsed" : "Last response time",
							position: R.BottomRight,
							children: /* @__PURE__ */ J("span", {
								className: "label-micro flex h-6 w-14 items-center justify-end text-basic-tertiary",
								children: wn(te)
							})
						})]
					})] }),
					r ? /* @__PURE__ */ J(Zt, {
						title: "Show panel",
						position: R.BottomLeft,
						children: /* @__PURE__ */ J(V, {
							size: B.Medium,
							variant: L.Ghost,
							content: o.Icon,
							"aria-label": "Show panel",
							onClick: r,
							children: /* @__PURE__ */ J(M, { iconName: F.SidebarChevronLeft })
						})
					}) : null
				]
			}), /* @__PURE__ */ Y("div", {
				className: "flex w-full items-center gap-2",
				children: [
					/* @__PURE__ */ Y("div", {
						className: "flex min-w-0 flex-1 items-center gap-4 overflow-hidden",
						children: [
							ce?.description ? /* @__PURE__ */ J("span", {
								className: "label-micro min-w-0 truncate text-basic-secondary",
								children: ce.description
							}) : null,
							oe ? /* @__PURE__ */ Y("div", {
								className: "flex shrink-0 items-center gap-0.5",
								children: [/* @__PURE__ */ J("span", {
									className: "label-micro max-w-[120px] truncate text-basic-tertiary",
									children: oe
								}), /* @__PURE__ */ J("span", {
									className: "tag-label text-basic-muted",
									children: At(n?.summary)
								})]
							}) : null,
							se && !le ? /* @__PURE__ */ J(Nm, {
								sessionId: e,
								branch: se,
								placement: R.BottomRight
							}) : null,
							se && le ? /* @__PURE__ */ Y("span", {
								className: "label-micro flex min-w-0 items-center gap-1.5 text-btn-secondary",
								children: [/* @__PURE__ */ J(M, {
									iconName: F.Scheme,
									size: 16,
									className: "shrink-0"
								}), /* @__PURE__ */ J("span", {
									className: "truncate",
									children: se
								})]
							}) : null
						]
					}),
					/* @__PURE__ */ J(Py, {
						sessionId: e,
						selected: A,
						onSelect: h,
						placement: R.BottomLeft
					}),
					ie || ae ? /* @__PURE__ */ Y("div", {
						className: "code code-small flex shrink-0 items-center gap-2",
						children: [/* @__PURE__ */ Y("span", {
							className: "text-success-primary",
							children: ["+", ie]
						}), /* @__PURE__ */ Y("span", {
							className: "text-error-primary",
							children: ["-", ae]
						})]
					}) : null
				]
			})]
		})
	});
}
//#endregion
//#region src/app/components/pages/SessionPage.tsx
function By(e, t) {
	let { useSshConnectionStatus: n, sshTargetKey: r, sshTargetFromSummary: i, markSshDisconnected: a, markSshConnected: o } = me().stores.sshConnectionStore, s = W(() => i(t), [i, t]), c = n(s), l = Ar(), u = G(null);
	U(() => {
		u.current = null;
	}, [e]), U(() => {
		if (!s) return;
		let e = r(s);
		if (c === "connected") {
			u.current = e;
			return;
		}
		u.current === e || l.isPending || (u.current = e, l.mutateAsync(s).then(() => o(s)).catch(() => a(s)));
	}, [
		s,
		c,
		l,
		r,
		o,
		a
	]);
}
function Vy() {
	let { useSidePanelExpanded: e, useSidePanelCollapsed: t, useSidePanelAnimate: n, useSelectedWorkset: r, useSelectedThreadRunning: i, useSelectedThread: a, useSelectedRevision: s, useSelectedFile: c, toggleSidePanelList: l, toggleSidePanelExpanded: d, toggleSidePanelCollapsed: f, showSidePanelList: p, revealSidePanel: m, setSidePanelAnimate: h, resetSessionSelection: g, unbindSidePanelProject: _, bindSidePanelProject: v } = me().stores.sessionLayoutStore, { clearAttention: y } = me().stores.attentionStore, { sessionId: b, panel: x } = li(), S = ci(), C = b ?? null, w = u(), T = Cf();
	Ee("SessionPage");
	let { data: E = null, error: D, refetch: O } = Dn(C), { data: k = null } = _r(C), ee = Sy(C, k?.summary.backend), te = t(), A = n(), ne = e(), re = a(), j = i(), ie = r(), ae = c(), oe = s(), se = Ue(), ce = k != null || E != null, le = ce ? k?.summary.behavior ?? E?.metadata.behavior ?? "orchestrator" : null, ue = !ce || Qe(w, le, k?.lineage ?? E?.lineage);
	lh(ue ? C : null), dh(ue ? E?.active_run : null), By(ue ? C : null, ue ? k?.summary : null);
	let de = le == null ? null : Il(le, E?.lineage?.kind), fe = de?.mobilePanels ?? [], pe = Pt(x) ? x : Tt, N = de == null || de.mobilePanels.includes(pe) ? pe : de.defaultPanel;
	U(() => {
		!C || !E || !Pt(x) || x === N || S(pr.session(C, N), { replace: !0 });
	}, [
		N,
		C,
		S,
		x,
		E
	]);
	let he = ct(C, se && N === "files" ? oe : null);
	U(() => {
		C && y(C), g();
	}, [
		y,
		C,
		g
	]);
	let ge = k ? k.summary.project_id ?? "" : null;
	if (Yr(() => {
		_(), ge != null && v(ge);
	}, [
		v,
		C,
		ge,
		_
	]), U(() => {
		if (A) return;
		let e = requestAnimationFrame(() => h(!0));
		return () => cancelAnimationFrame(e);
	}, [A, h]), ce && !ue) return /* @__PURE__ */ Y("div", {
		className: "flex flex-1 flex-col items-center justify-center gap-4 p-8",
		children: [
			/* @__PURE__ */ J("h1", {
				className: "heading-small",
				children: "This chat is unavailable in direct-only mode"
			}),
			/* @__PURE__ */ J("p", { children: "Its saved behavior and history are preserved. An operator can enable orchestration to open it." }),
			/* @__PURE__ */ J(V, {
				onClick: () => {
					let e = k?.summary.project_id ?? E?.metadata.project_id;
					e ? T.newChat(e) : T.create();
				},
				children: "New direct chat"
			})
		]
	});
	if (!C) return /* @__PURE__ */ J(ri, {
		to: pr.list(),
		replace: !0
	});
	if (!Pt(x)) return /* @__PURE__ */ J(ri, {
		to: pr.session(C, Tt),
		replace: !0
	});
	let P = k?.summary.model_config_error ?? (!E && D ? D : null), _e = P ? ee(P, () => void O()) : null, ve = (e) => S(pr.session(C, e)), I = (e) => {
		m(se), ve(e);
	}, ye = oe == null ? E?.workspace?.changed_files ?? [] : he.data?.changed_files ?? [], be = ae ?? ye[0]?.path ?? null, xe = be ? ye.find((e) => e.path === be) : void 0, Se = xe && (xe.additions || xe.deletions) ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 shrink-0 code code-small",
		children: [/* @__PURE__ */ Y("span", {
			className: "text-success-primary",
			children: ["+", xe.additions ?? 0]
		}), /* @__PURE__ */ Y("span", {
			className: "text-error-primary",
			children: ["-", xe.deletions ?? 0]
		})]
	}) : null, Ce = re, we = N === "threads" && j, Te = /* @__PURE__ */ J(vy, {
		sessionId: C,
		snapshot: E,
		behavior: le,
		panel: N,
		onPanelChange: ve
	});
	return /* @__PURE__ */ Y("section", {
		className: "relative flex min-h-0 min-w-0 flex-1 h-full overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ Y("div", {
			className: "relative flex flex-1 min-w-0 h-full min-h-0",
			children: [/* @__PURE__ */ J("div", {
				className: z("flex flex-col items-center flex-1 min-w-0 h-full", se ? "px-0" : "px-2"),
				children: /* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-h-0 w-full relative",
					children: [
						se && (k?.lineage ?? E?.lineage) ? /* @__PURE__ */ J("div", {
							className: "pointer-events-none absolute inset-x-0 top-16 z-20 flex items-center px-3 pt-2",
							children: /* @__PURE__ */ J(V, {
								className: "pointer-events-auto relative",
								size: B.Small,
								variant: L.Ghost,
								onClick: () => {
									let e = (k?.lineage ?? E?.lineage)?.parent_session_id;
									e && S(pr.session(e, "delegated"));
								},
								children: "Parent chat"
							})
						}) : null,
						se ? null : /* @__PURE__ */ J(zy, {
							sessionId: C,
							snapshot: E,
							entry: k
						}),
						/* @__PURE__ */ J(jy, {
							sessionId: C,
							snapshot: E,
							panel: N,
							onFocusPanel: I,
							errorNotice: _e
						}),
						/* @__PURE__ */ J("div", {
							className: z("absolute bottom-0 left-0 right-0", se ? "-mx-2" : "pb-2 mx-auto max-w-[720px]"),
							children: /* @__PURE__ */ J(Hh, {
								sessionId: C,
								snapshot: E,
								entry: k
							})
						})
					]
				})
			}), se ? null : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("div", {
				className: z("relative h-full shrink-0", A && "transition-[width] duration-500 ease-in-out", te ? "w-[52px]" : "w-1/2"),
				style: A ? void 0 : { transition: "none" },
				children: te ? /* @__PURE__ */ J("div", {
					className: "absolute inset-y-0 right-0 w-[52px]",
					children: /* @__PURE__ */ J(Jh, {
						sessionId: C,
						snapshot: E,
						behavior: le,
						panels: de?.widePanels ?? [],
						onOpen: f,
						onSelect: I
					})
				}) : null
			}), /* @__PURE__ */ J("div", {
				className: z("absolute inset-y-0 right-0 z-[1] flex flex-col min-w-0 w-1/2", A && "transition-transform duration-500 ease-in-out", te && "translate-x-full"),
				style: A ? void 0 : { transition: "none" },
				"aria-hidden": te,
				inert: te,
				children: /* @__PURE__ */ J("div", {
					className: "flex flex-col flex-1 min-h-0",
					children: /* @__PURE__ */ J("div", {
						className: "flex-1 min-h-0",
						children: ne ? null : Te
					})
				})
			})] })]
		}), se ? /* @__PURE__ */ Y(Vn, {
			open: ne,
			onClose: d,
			keepOnNavigate: !0,
			title: /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 min-w-0",
				children: [/* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-w-0 justify-center",
					children: [/* @__PURE__ */ J("div", {
						className: "min-w-0 truncate",
						children: /* @__PURE__ */ J("span", {
							className: z("header-small", we ? "text-shimmer-basic" : "text-basic-primary"),
							children: N === "threads" ? Ce ?? rr.threads : N === "worksets" ? ie ?? E?.worksets.items[0]?.id ?? rr.worksets : N === "files" ? ae?.split("/").pop() ?? E?.workspace?.changed_files?.[0]?.path.split("/").pop() ?? rr.files : rr[N]
						})
					}), N === "files" ? Se : null]
				}), E?.workspace?.branch && !E.lineage ? /* @__PURE__ */ J(Nm, {
					sessionId: C,
					branch: E.workspace.branch
				}) : null]
			}),
			headerActions: N === "history" ? null : /* @__PURE__ */ J(V, {
				size: B.Large,
				variant: L.Ghost,
				content: o.Icon,
				"aria-label": "Open list",
				onClick: l,
				children: /* @__PURE__ */ J(M, {
					iconName: F.List,
					size: 24
				})
			}),
			bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
			children: [/* @__PURE__ */ J("div", {
				className: "flex flex-col flex-1 min-h-0",
				children: Te
			}), fe.length > 0 ? /* @__PURE__ */ J(Wh, {
				panel: N,
				panels: fe,
				onPanelChange: (e) => {
					p(!1), ve(e);
				}
			}) : null]
		}) : /* @__PURE__ */ J(Vn, {
			open: ne,
			onClose: d,
			fullScreen: !0,
			chromeless: !0,
			keepOnNavigate: !0,
			children: /* @__PURE__ */ J("div", {
				className: "flex flex-col flex-1 min-h-0",
				children: Te
			})
		})]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedGitHubPanel.tsx
function Hy({ onConnected: e }) {
	let { api: t } = me(), n = un(), r = ti(), i = an(), [a, s] = K(null), [c, l] = K(""), [u, d] = K(!1);
	U(() => {
		if (!a) return;
		let i = !1, o = new AbortController();
		return (async () => {
			for (; !i;) {
				try {
					let i = await t.pollManagedGitHubLogin(a.login_id, o.signal);
					if (i.state === "complete") {
						r.setQueryData(Jt.github, i.auth), s(null), l(""), Promise.all([r.invalidateQueries({ queryKey: Jt.github }), r.invalidateQueries({ queryKey: Jt.hostStatus })]), n.success("GitHub connected"), e?.();
						return;
					}
					if (i.state === "failed") {
						l(i.error), s(null);
						return;
					}
				} catch (e) {
					o.signal.aborted || l(eu($(e)));
					return;
				}
				await new Promise((e) => setTimeout(e, 1e3));
			}
		})(), () => {
			i = !0, o.abort();
		};
	}, [
		a,
		r,
		e,
		n,
		t
	]);
	let f = async () => {
		d(!0), l("");
		try {
			s(await t.startManagedGitHubLogin());
		} catch (e) {
			l(eu($(e)));
		} finally {
			d(!1);
		}
	}, p = async () => {
		d(!0);
		try {
			await t.disconnectManagedGitHub(), await Promise.all([r.invalidateQueries({ queryKey: Jt.github }), r.invalidateQueries({ queryKey: Jt.hostStatus })]), n.success("GitHub disconnected");
		} catch (e) {
			n.error(`Disconnect failed: ${Qn($(e))}`);
		} finally {
			d(!1);
		}
	};
	return i.isLoading ? /* @__PURE__ */ J(Ce, { size: je.Medium }) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-5",
		"data-testid": "managed-github-settings",
		children: [
			/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
				className: "header-xl text-basic-primary",
				children: "GitHub"
			}), /* @__PURE__ */ J("p", {
				className: "text-small text-basic-tertiary",
				children: "Connect the private Arcee GitHub App. Tokens are never shown in NAC."
			})] }),
			i.data?.connected ? /* @__PURE__ */ Y("div", {
				className: "rounded-lg border border-basic p-4",
				children: [/* @__PURE__ */ Y("div", {
					className: "flex items-center gap-3",
					children: [
						i.data.avatar_url ? /* @__PURE__ */ J("img", {
							src: i.data.avatar_url,
							alt: "",
							className: "h-10 w-10 rounded-full"
						}) : /* @__PURE__ */ J(M, { iconName: F.Github }),
						/* @__PURE__ */ Y("div", {
							className: "min-w-0 flex-1",
							children: [/* @__PURE__ */ J("p", {
								className: "label-medium text-basic-primary truncate",
								children: i.data.name ?? i.data.login
							}), /* @__PURE__ */ Y("p", {
								className: "text-small text-basic-tertiary truncate",
								children: ["@", i.data.login]
							})]
						}),
						/* @__PURE__ */ Y("span", {
							className: "flex shrink-0 items-center gap-1.5 label-small text-success-primary",
							children: [/* @__PURE__ */ J(M, {
								iconName: F.CheckCircle,
								"aria-hidden": "true"
							}), "Connected"]
						})
					]
				}), i.data.git_name && i.data.git_email ? /* @__PURE__ */ Y("p", {
					className: "mt-3 text-small text-basic-tertiary",
					children: [
						"Git commits: ",
						i.data.git_name,
						" · ",
						i.data.git_email
					]
				}) : null]
			}) : null,
			a ? /* @__PURE__ */ Y("div", {
				className: "rounded-lg border border-info-primary p-4",
				"data-testid": "github-device-code",
				children: [
					/* @__PURE__ */ J("p", {
						className: "label-medium text-basic-primary",
						children: "Authorize this host on GitHub"
					}),
					/* @__PURE__ */ J("p", {
						className: "mt-1 text-small text-basic-tertiary",
						children: "Open GitHub and enter this code. Returning here will preserve this pending login."
					}),
					/* @__PURE__ */ Y("div", {
						className: "mt-4 flex items-center gap-2",
						children: [/* @__PURE__ */ J("code", {
							className: "flex-1 rounded bg-elevation-level-2 px-4 py-3 text-center text-xl tracking-[0.2em] text-basic-primary",
							children: a.user_code
						}), /* @__PURE__ */ J(Ht, {
							value: a.user_code,
							title: "Copy device code"
						})]
					}),
					/* @__PURE__ */ Y("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: [/* @__PURE__ */ Y(V, {
							variant: L.Primary,
							content: o.IconRight,
							onClick: () => window.open(a.verification_uri, "_blank", "noopener"),
							children: ["Open GitHub ", /* @__PURE__ */ J(M, { iconName: F.External })]
						}), /* @__PURE__ */ J(V, {
							variant: L.Tertiary,
							content: o.Text,
							onClick: () => {
								t.cancelManagedGitHubLogin(a.login_id), s(null);
							},
							children: "Cancel"
						})]
					})
				]
			}) : null,
			c ? /* @__PURE__ */ J("p", {
				className: "text-small text-error-primary",
				children: c
			}) : null,
			a ? null : /* @__PURE__ */ Y("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ J(V, {
					variant: L.Primary,
					content: o.Text,
					onClick: () => void f(),
					loading: u,
					children: i.data?.connected ? "Reconnect GitHub" : "Connect GitHub"
				}), i.data?.connected ? /* @__PURE__ */ J(V, {
					variant: L.SecondaryDestructive,
					content: o.Text,
					onClick: () => void p(),
					disabled: u,
					children: "Disconnect"
				}) : null]
			})
		]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedSecretsPanel.tsx
function Uy() {
	let e = vr(), t = kt(), n = Un(), r = un(), [i, a] = K(""), [s, c] = K(""), [l, u] = K(!1), d = W(() => l ? ke(i) : "", [l, i]), f = async () => {
		if (u(!0), !(ke(i) || s.length === 0)) try {
			await t.mutateAsync({
				name: i,
				value: s
			}), a(""), c(""), u(!1), r.success("Secret saved for future command spawns");
		} catch (e) {
			r.error(`Secret was not saved: ${Qn($(e))}`);
		}
	};
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-5",
		"data-testid": "managed-secrets-settings",
		children: [
			/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
				className: "header-xl text-basic-primary",
				children: "Host secrets"
			}), /* @__PURE__ */ J("p", {
				className: "text-small text-basic-tertiary",
				children: "Values are write-only and are injected into every newly spawned agent command on this single-owner host. Running processes keep their existing snapshot."
			})] }),
			/* @__PURE__ */ J("div", {
				className: "rounded-lg border border-warning-primary p-4 text-small text-basic-secondary",
				children: "Agents have arbitrary shell access and can print injected values. Add only secrets trusted across every Project and agent on this host."
			}),
			/* @__PURE__ */ Y("div", {
				className: "grid grid-cols-1 gap-3 sm:grid-cols-2",
				children: [/* @__PURE__ */ J(Z, {
					inputSize: X.Large,
					label: "Variable name",
					"aria-label": "Variable name",
					placeholder: "SERVICE_TOKEN",
					value: i,
					onChange: (e) => {
						a(e.target.value), u(!1);
					},
					validation: !!d,
					validationText: d,
					autoCapitalize: "none",
					spellCheck: !1
				}), /* @__PURE__ */ J(Z, {
					inputSize: X.Large,
					label: "New value",
					"aria-label": "New value",
					placeholder: "Write-only value",
					type: "password",
					value: s,
					onChange: (e) => c(e.target.value),
					validation: l && s.length === 0,
					validationText: "Enter a value.",
					autoComplete: "new-password"
				})]
			}),
			/* @__PURE__ */ J("div", { children: /* @__PURE__ */ J(V, {
				variant: L.Primary,
				content: o.Text,
				onClick: () => void f(),
				loading: t.isPending,
				children: "Save secret"
			}) }),
			/* @__PURE__ */ J(Q, {}),
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-2",
				children: [
					/* @__PURE__ */ J("p", {
						className: "label-medium text-basic-primary",
						children: "Stored names"
					}),
					e.isLoading ? /* @__PURE__ */ J(Ce, { size: je.Small }) : null,
					e.data?.secrets.length === 0 ? /* @__PURE__ */ J("p", {
						className: "text-small text-basic-tertiary",
						children: "No host secrets saved."
					}) : null,
					e.data?.secrets.map((e) => /* @__PURE__ */ Y("div", {
						className: "flex items-center gap-3 rounded-lg border border-basic p-3",
						children: [
							/* @__PURE__ */ J(M, { iconName: F.Key }),
							/* @__PURE__ */ J("code", {
								className: "min-w-0 flex-1 truncate text-basic-primary",
								children: e.name
							}),
							/* @__PURE__ */ J("span", {
								className: "text-small text-basic-muted",
								children: "value hidden"
							}),
							/* @__PURE__ */ J(V, {
								variant: L.Ghost,
								size: B.Small,
								content: o.Icon,
								"aria-label": `Delete ${e.name}`,
								onClick: async () => {
									try {
										await n.mutateAsync(e.name), r.success(`${e.name} removed from future command spawns`);
									} catch (e) {
										r.error(`Secret was not removed: ${Qn($(e))}`);
									}
								},
								loading: n.isPending,
								children: /* @__PURE__ */ J(M, { iconName: F.Trash })
							})
						]
					}, e.name))
				]
			})
		]
	});
}
//#endregion
//#region src/app/features/managed/controller/useManagedUpgrade.ts
function Wy() {
	return `nac-upgrade-${globalThis.crypto.randomUUID()}`;
}
function Gy(e) {
	if (!e) throw Error("managed upgrade action target is unavailable");
	return e;
}
async function Ky(e, t) {
	if (!t.actionable || t.action === "wait" || !t.target) throw Error("managed upgrade blocker is wait-only");
	let n = t.target;
	switch (t.action) {
		case "cancel_active_run": {
			let t = Gy(n.session_id), r = Gy(n.run_id);
			await e.cancelExactRun(t, r);
			return;
		}
		case "cancel_traditional_child":
			await e.cancelTraditionalChild(Gy(n.session_id), Gy(n.child_session_id));
			return;
		case "cancel_managed_orchestrator":
			await e.cancelManagedOrchestrator(Gy(n.session_id), Gy(n.orchestrator_session_id));
			return;
		case "terminate_terminal":
			await e.terminateTerminal(Gy(n.session_id), Gy(n.terminal_id));
			return;
		case "cancel_clone_operation":
			await e.cancelManagedClone(Gy(n.clone_operation_id));
			return;
	}
}
function qy(e, t, n) {
	if (!t) return !1;
	let r = t.target_release ?? t.desired_release;
	return !r || !i(r, n) ? !1 : !e || t.operation_id !== e.operation_id || t.state !== e.state || t.updated_at !== e.updated_at;
}
function Jy() {
	let { api: e } = me(), t = Nr(), n = Be(), r = G(null), i = t.data?.operation?.operation_id ?? null, [a, o] = K(!1), [s, c] = K(""), [l, u] = K({}), d = G(i);
	U(() => {
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
	let f = H(() => {
		c(""), o(!0);
	}, []), p = H(() => {
		n.isPending || (o(!1), c(""));
	}, [n.isPending]), m = H(async () => {
		if (n.isPending) return;
		let e = r.current ?? Wy(), i = t.data?.operation ?? null, a = t.data?.preview.latest_beta;
		r.current = e, c("");
		try {
			await n.mutateAsync(e), r.current = null, o(!1);
		} catch (e) {
			c(Te(e).message), Cr(e) && (r.current = null, o(!1));
			let n = await t.refetch();
			!Cr(e) && !n.error && a && qy(i, n.data?.operation, a) && (r.current = null, c(""), o(!1));
		}
	}, [t, n]), h = H(async (n) => {
		u((e) => ({
			...e,
			[n.selection_key]: "requesting"
		}));
		try {
			await Ky(e, n), u((e) => ({
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
//#endregion
//#region src/app/features/managed/presentation/ManagedUpgradePanel.tsx
function Yy() {
	let e = Jy(), t = e.snapshot, n = yn(t.error);
	if (t.isLoading) return /* @__PURE__ */ Y("section", {
		"aria-labelledby": "managed-upgrade-heading",
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ J("h2", {
			id: "managed-upgrade-heading",
			className: "label-medium text-basic-primary",
			children: "Managed NAC upgrade"
		}), /* @__PURE__ */ J("div", {
			className: "mt-3",
			children: /* @__PURE__ */ J(Ce, { size: je.Small })
		})]
	});
	if (!t.data || n) {
		let e = Te(t.error);
		return /* @__PURE__ */ Y("section", {
			"aria-labelledby": "managed-upgrade-heading",
			className: "rounded-lg border border-basic p-4",
			"data-testid": "managed-upgrade-unavailable",
			children: [
				/* @__PURE__ */ J("h2", {
					id: "managed-upgrade-heading",
					className: "label-medium text-basic-primary",
					children: "Managed NAC upgrade"
				}),
				/* @__PURE__ */ J("p", {
					className: "mt-1 text-small text-error-primary",
					children: e.message
				}),
				e.retryLabel ? /* @__PURE__ */ J(V, {
					className: "mt-3",
					size: B.Small,
					variant: L.Secondary,
					content: o.Text,
					onClick: () => void t.refetch(),
					loading: t.isFetching,
					children: e.retryLabel
				}) : null
			]
		});
	}
	let { preview: r, operation: a } = t.data, s = a ? S(a.state) : !1, c = r.upgrade_available && !s, l = a?.target_release, u = l && !i(l, r.latest_beta);
	return /* @__PURE__ */ Y("section", {
		"aria-labelledby": "managed-upgrade-heading",
		className: "rounded-lg border border-basic p-4",
		"data-testid": "managed-upgrade",
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex flex-wrap items-start justify-between gap-3",
				children: [/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("h2", {
					id: "managed-upgrade-heading",
					className: "label-medium text-basic-primary",
					children: "Managed NAC upgrade"
				}), /* @__PURE__ */ J("p", {
					className: "mt-1 text-small text-basic-tertiary",
					children: Ge(r.distance?.accepted_releases ?? null)
				})] }), c ? /* @__PURE__ */ J(V, {
					size: B.Small,
					variant: L.Primary,
					content: o.Text,
					onClick: e.requestStart,
					children: a?.state === "failed" ? "Retry upgrade to latest beta" : "Upgrade to latest beta"
				}) : !r.upgrade_available && !s ? /* @__PURE__ */ J("span", {
					className: "rounded-full bg-success-secondary px-3 py-1 text-small text-success-primary",
					children: "Up to date"
				}) : null]
			}),
			/* @__PURE__ */ Y("div", {
				className: "mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2",
				children: [
					/* @__PURE__ */ J(Xy, {
						label: "Current",
						release: r.current
					}),
					/* @__PURE__ */ J(Xy, {
						label: "Latest beta",
						release: r.latest_beta
					}),
					u ? /* @__PURE__ */ J(Xy, {
						label: "Accepted target",
						release: l,
						className: "lg:col-span-2"
					}) : null
				]
			}),
			a ? /* @__PURE__ */ J(Zy, {
				operation: a,
				settlements: e.settlements,
				onSettle: (t) => void e.requestSettlement(t)
			}) : null,
			/* @__PURE__ */ Y(Vn, {
				open: e.confirmationOpen,
				onClose: e.cancelStart,
				title: "Upgrade Managed NAC?",
				size: or.Small,
				footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(V, {
					variant: L.Tertiary,
					content: o.Text,
					onClick: e.cancelStart,
					disabled: e.startPending,
					children: "Cancel"
				}), /* @__PURE__ */ J(V, {
					variant: L.Primary,
					content: o.Text,
					onClick: () => void e.confirmStart(),
					loading: e.startPending,
					children: "Start upgrade"
				})] }),
				children: [/* @__PURE__ */ Y("p", {
					className: "text-small text-basic-secondary",
					children: [
						"Upgrade from ",
						/* @__PURE__ */ J("strong", { children: r.current.product_version }),
						" to the exact accepted latest beta, ",
						/* @__PURE__ */ J("strong", { children: r.latest_beta.product_version }),
						". Active work must finish or be explicitly stopped before this host is replaced. The page may disconnect briefly while NAC starts and verifies the replacement."
					]
				}), e.startError ? /* @__PURE__ */ J("p", {
					role: "alert",
					className: "mt-3 text-small text-error-primary",
					children: e.startError
				}) : null]
			})
		]
	});
}
function Xy({ label: e, release: t, className: n = "" }) {
	return /* @__PURE__ */ Y("div", {
		className: `min-w-0 rounded-lg bg-elevation-level-2 p-3 ${n}`,
		children: [
			/* @__PURE__ */ J("p", {
				className: "label-small text-basic-secondary",
				children: e
			}),
			/* @__PURE__ */ J("p", {
				className: "mt-1 label-medium text-basic-primary",
				children: t.product_version
			}),
			/* @__PURE__ */ Y("dl", {
				className: "mt-2 grid grid-cols-[auto,minmax(0,1fr)] gap-x-3 gap-y-1 text-small",
				children: [
					/* @__PURE__ */ J("dt", {
						className: "text-basic-tertiary",
						children: "Release"
					}),
					/* @__PURE__ */ J("dd", {
						className: "code-small break-all text-basic-primary",
						children: t.release_id
					}),
					/* @__PURE__ */ J("dt", {
						className: "text-basic-tertiary",
						children: "Source"
					}),
					/* @__PURE__ */ J("dd", {
						className: "code-small break-all text-basic-primary",
						children: t.source_revision
					}),
					/* @__PURE__ */ J("dt", {
						className: "text-basic-tertiary",
						children: "Build"
					}),
					/* @__PURE__ */ J("dd", {
						className: "code-small break-all text-basic-primary",
						children: t.build_id
					}),
					/* @__PURE__ */ J("dt", {
						className: "text-basic-tertiary",
						children: "Schema"
					}),
					/* @__PURE__ */ J("dd", {
						className: "code-small text-basic-primary",
						children: t.schema_version
					})
				]
			})
		]
	});
}
function Zy({ operation: e, settlements: t, onSettle: n }) {
	let r = e.blockers ?? [], i = e.state === "failed", a = e.state === "succeeded";
	return /* @__PURE__ */ Y("div", {
		className: `mt-4 rounded-lg border p-4 ${i ? "border-error-primary" : a ? "border-success-primary" : "border-basic"}`,
		"aria-live": "polite",
		"data-testid": "managed-upgrade-operation",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-wrap items-start justify-between gap-2",
			children: [/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
				className: "label-medium text-basic-primary",
				children: _(e.state)
			}), e.message ? /* @__PURE__ */ J("p", {
				className: "mt-1 text-small text-basic-tertiary",
				children: e.message
			}) : null] }), /* @__PURE__ */ J("span", {
				className: "code-small break-all text-basic-muted",
				children: e.operation_id
			})]
		}), r.length > 0 ? /* @__PURE__ */ Y("div", {
			className: "mt-4",
			children: [/* @__PURE__ */ J("p", {
				className: "label-small text-basic-secondary",
				children: "Before replacement can begin"
			}), /* @__PURE__ */ J("ul", {
				className: "mt-2 flex flex-col gap-2",
				children: r.map((e) => {
					let r = t[e.selection_key];
					return /* @__PURE__ */ J("li", {
						className: "rounded-lg bg-elevation-level-2 p-3",
						children: /* @__PURE__ */ Y("div", {
							className: "flex flex-wrap items-center justify-between gap-3",
							children: [/* @__PURE__ */ Y("div", {
								className: "min-w-0 flex-1",
								children: [/* @__PURE__ */ J("p", {
									className: "text-small text-basic-primary",
									children: e.message
								}), e.actionable ? r === "settling" ? /* @__PURE__ */ J("p", {
									className: "mt-1 text-small text-basic-tertiary",
									children: "Stop requested. Waiting for cleanup to finish."
								}) : r === "failed" ? /* @__PURE__ */ J("p", {
									role: "alert",
									className: "mt-1 text-small text-error-primary",
									children: "The stop request failed. Refresh status or try again."
								}) : null : /* @__PURE__ */ J("p", {
									className: "mt-1 text-small text-basic-tertiary",
									children: "Wait for this work to finish safely."
								})]
							}), e.actionable ? /* @__PURE__ */ J(V, {
								size: B.Small,
								variant: L.SecondaryDestructive,
								content: o.Text,
								onClick: () => n(e),
								loading: r === "requesting",
								disabled: r === "settling",
								children: r === "settling" ? "Waiting for cleanup" : r === "failed" ? `Try again: ${f(e.action)}` : f(e.action)
							}) : /* @__PURE__ */ J("span", {
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
//#endregion
//#region src/app/features/managed/presentation/ManagedStatusPanel.tsx
function Qy({ ready: e }) {
	return /* @__PURE__ */ J("span", {
		"aria-hidden": !0,
		className: `inline-block h-2 w-2 rounded-full ${e ? "bg-success-primary" : "bg-warning-primary"}`
	});
}
function $y() {
	let e = $t();
	if (e.isLoading) return /* @__PURE__ */ J(Ce, { size: je.Medium });
	if (!e.data) return /* @__PURE__ */ J("p", {
		className: "text-error-primary",
		children: "Managed host status is unavailable."
	});
	let t = e.data;
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-5",
		"data-testid": "managed-host-status",
		children: [
			/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
				className: "header-xl text-basic-primary",
				children: t.logical_host_id
			}), /* @__PURE__ */ Y("p", {
				className: "text-small text-basic-tertiary",
				children: ["Managed NAC · ", t.public_hostname]
			})] }),
			/* @__PURE__ */ J(Yy, {}),
			/* @__PURE__ */ Y("div", {
				className: "grid grid-cols-1 gap-2 sm:grid-cols-2",
				children: [
					/* @__PURE__ */ J(eb, {
						label: t.model.display_name,
						value: t.model_ready ? t.model.id : "Needs attention",
						ready: t.model_ready
					}),
					/* @__PURE__ */ J(eb, {
						label: "GitHub",
						value: t.github_status.replace("-", " "),
						ready: t.github_status === "connected"
					}),
					/* @__PURE__ */ J(eb, {
						label: "Projects",
						value: String(t.project_count),
						ready: !0
					}),
					/* @__PURE__ */ J(eb, {
						label: "Host secrets",
						value: String(t.secret_count),
						ready: !0
					})
				]
			}),
			/* @__PURE__ */ Y("div", {
				className: "rounded-lg bg-elevation-level-2 p-4",
				children: [
					/* @__PURE__ */ J("p", {
						className: "label-small text-basic-secondary",
						children: "Managed model endpoint"
					}),
					/* @__PURE__ */ J("p", {
						className: "code-small mb-3 break-all text-basic-primary",
						children: t.model.endpoint
					}),
					/* @__PURE__ */ J("p", {
						className: "label-small text-basic-secondary",
						children: "Repository root"
					}),
					/* @__PURE__ */ J("p", {
						className: "code-small break-all text-basic-primary",
						children: t.repository_root
					})
				]
			}),
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-2",
				children: [/* @__PURE__ */ Y("div", {
					className: "flex items-center justify-between",
					children: [/* @__PURE__ */ J("p", {
						className: "label-medium text-basic-primary",
						children: "Readiness"
					}), /* @__PURE__ */ Y("span", {
						className: "text-small text-basic-tertiary",
						children: [
							"v",
							t.version,
							" · schema ",
							t.schema_version
						]
					})]
				}), t.checks.map((e) => /* @__PURE__ */ Y("div", {
					className: "flex items-start gap-2 rounded-lg border border-basic p-3",
					children: [/* @__PURE__ */ J("span", {
						className: "mt-2",
						children: /* @__PURE__ */ J(Qy, { ready: e.ready })
					}), /* @__PURE__ */ Y("div", {
						className: "min-w-0",
						children: [/* @__PURE__ */ J("p", {
							className: "label-small text-basic-primary",
							children: e.name
						}), /* @__PURE__ */ J("p", {
							className: "text-small text-basic-tertiary break-words",
							children: e.detail
						})]
					})]
				}, e.name))]
			})
		]
	});
}
function eb({ label: e, value: t, ready: n }) {
	return /* @__PURE__ */ Y("div", {
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ J("p", {
			className: "text-small text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ Y("div", {
			className: "mt-1 flex items-center gap-2",
			children: [/* @__PURE__ */ J(Qy, { ready: n }), /* @__PURE__ */ J("p", {
				className: "label-medium capitalize text-basic-primary",
				children: t
			})]
		})]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedHostModal.tsx
function tb({ open: e, onClose: t, tab: n, onTabChange: r, onGitHubConnected: i }) {
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: t,
		title: "Managed host",
		size: or.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		children: /* @__PURE__ */ Y("div", {
			className: "flex h-full min-h-0 flex-col md:flex-row",
			children: [/* @__PURE__ */ J("nav", {
				className: "flex shrink-0 gap-1 overflow-x-auto border-b border-basic md:w-44 md:flex-col md:border-b-0 md:border-r p-2",
				children: hn.map((e) => /* @__PURE__ */ J("button", {
					type: "button",
					className: `rounded px-3 py-2 text-left label-small capitalize ${n === e ? "bg-elevation-level-2 text-basic-primary" : "text-basic-tertiary"}`,
					onClick: () => r(e),
					children: e === "github" ? "GitHub" : e
				}, e))
			}), /* @__PURE__ */ Y("div", {
				className: "min-h-0 flex-1 overflow-auto p-4 md:p-6",
				children: [
					n === "status" ? /* @__PURE__ */ J($y, {}) : null,
					n === "github" ? /* @__PURE__ */ J(Hy, { onConnected: i }) : null,
					n === "secrets" ? /* @__PURE__ */ J(Uy, {}) : null
				]
			})]
		})
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedBranchPicker.tsx
function nb(e, t) {
	return e.toLowerCase().localeCompare(t.toLowerCase()) || e.localeCompare(t);
}
function rb({ branches: e, value: t, onValueChange: n, isLoading: r, error: i }) {
	let [a, o] = K(!1), [s, c] = K(""), [l, u] = K(null), d = G(null), f = G(null), p = Jr(), m = Ue(), h = W(() => {
		let t = s.trim().toLowerCase(), n = [...e].sort(nb);
		return t ? n.filter((e) => e.toLowerCase().includes(t)) : n;
	}, [e, s]), g = l === null ? -1 : h.indexOf(l), _ = (e = !0) => {
		o(!1), c(""), u(null), e && d.current?.focus();
	}, v = () => {
		if (a) {
			_();
			return;
		}
		let n = [...e].sort(nb);
		u(t || n[0] || null), o(!0);
	};
	U(() => {
		a && f.current?.focus();
	}, [a]), U(() => {
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
	}, x = (e) => {
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
	}, S = r ? /* @__PURE__ */ Y("div", {
		role: "status",
		className: "flex items-center gap-2 p-3 text-small text-basic-tertiary",
		children: [/* @__PURE__ */ J(Ce, {
			size: je.Small,
			variant: O.Neutral
		}), "Loading branches…"]
	}) : i ? /* @__PURE__ */ J("p", {
		role: "alert",
		className: "p-3 text-small text-error-primary",
		children: i
	}) : e.length === 0 ? /* @__PURE__ */ J("p", {
		role: "status",
		className: "p-3 text-small text-basic-tertiary",
		children: "No branches found."
	}) : h.length === 0 ? /* @__PURE__ */ Y("p", {
		role: "status",
		className: "p-3 text-small text-basic-tertiary",
		children: [
			"No branches match \"",
			s.trim(),
			"\"."
		]
	}) : null;
	return /* @__PURE__ */ Y("div", {
		className: "flex min-w-0 flex-col gap-1 text-small text-basic-secondary",
		children: [/* @__PURE__ */ J("span", { children: "Branch" }), /* @__PURE__ */ J(Kn, {
			open: a,
			onClose: () => _(),
			placement: R.BottomLeft,
			sticky: !0,
			className: "w-full",
			size: "w-[min(420px,calc(100vw-32px))]",
			panelClassName: "max-w-[calc(100vw-32px)]",
			sheetClassName: "px-4",
			content: /* @__PURE__ */ Y("div", {
				className: "flex h-[min(420px,70dvh)] min-h-[220px] flex-col gap-2 p-2 md:p-0",
				children: [/* @__PURE__ */ J(Z, {
					ref: f,
					inputSize: m ? X.Large : X.Medium,
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
						let n = t.target.value, r = n.trim().toLowerCase(), i = [...e].sort(nb).filter((e) => !r || e.toLowerCase().includes(r));
						c(n), u(i[0] ?? null);
					},
					onKeyDown: x
				}), /* @__PURE__ */ Y("div", {
					id: p,
					role: "listbox",
					"aria-label": "Branches",
					className: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded border border-basic p-1",
					children: [S, !r && !i ? h.map((e, n) => /* @__PURE__ */ Y(qc, {
						id: `${p}-option-${n}`,
						role: "option",
						"aria-selected": e === t,
						tabIndex: -1,
						size: m ? Gc.Large : Gc.Medium,
						active: e === l,
						className: "shrink-0",
						onMouseEnter: () => u(e),
						onMouseDown: (e) => e.preventDefault(),
						onClick: () => y(e),
						children: [/* @__PURE__ */ J("span", {
							className: "min-w-0 flex-1 truncate text-left",
							title: e,
							children: e
						}), e === t ? /* @__PURE__ */ J(M, {
							iconName: F.Check,
							className: "shrink-0"
						}) : null]
					}, e)) : null]
				})]
			}),
			children: /* @__PURE__ */ Y("button", {
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
				children: [/* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					title: t,
					children: t || "Select a branch"
				}), /* @__PURE__ */ J(M, {
					iconName: F.Down,
					className: `shrink-0 transition-transform duration-150 ${a ? "rotate-180" : "rotate-0"}`
				})]
			})
		})]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedRepositoryModal.tsx
function ib({ open: e, onClose: t, onConnect: n }) {
	let { api: r } = me(), i = ci(), a = un(), s = ti(), c = $t(), l = an(e), [u, d] = K(""), [f, p] = K(null), [m, h] = K(""), [g, _] = K(""), [v, y] = K(""), [b, x] = K(null), [S, C] = K(""), [w, T] = K(!1), E = ei({
		queryKey: ["managed-github-repositories"],
		queryFn: ({ signal: e }) => r.listManagedGitHubRepositories(e),
		enabled: e && l.data?.connected === !0,
		retry: !1
	}), D = oe(f?.full_name), O = ei({
		queryKey: ["managed-github-branches", f?.full_name],
		queryFn: ({ signal: e }) => r.listManagedGitHubBranches(D[0], D[1], e),
		enabled: e && D !== null,
		retry: !1
	});
	U(() => {
		if (!b || !ve(b)) return;
		let e = !1, n = new AbortController();
		return (async () => {
			for (; !e;) {
				await new Promise((e) => setTimeout(e, 500));
				try {
					let e = await r.getManagedClone(b.operation_id, n.signal);
					if (x(e), e.status !== "running") {
						e.status === "completed" && (await Promise.all([s.invalidateQueries({ queryKey: tr.projects }), s.invalidateQueries({ queryKey: Jt.hostStatus })]), a.success(`${e.project_name} is ready`), t(), i(pr.project(e.project_id)));
						return;
					}
				} catch (e) {
					n.signal.aborted || C(eu($(e)));
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
		s,
		a,
		r
	]);
	let k = W(() => {
		let e = u.trim().toLowerCase(), t = E.data?.repositories ?? [];
		return e ? t.filter((t) => t.full_name.toLowerCase().includes(e)) : t;
	}, [E.data, u]), ee = async () => {
		if (!(!f || !m || !g.trim() || !v.trim())) {
			T(!0), C("");
			try {
				x(await r.startManagedClone({
					repository_id: f.id,
					repository: f.full_name,
					branch: m,
					destination: g.trim(),
					project_name: v.trim(),
					project_description: null
				}));
			} catch (e) {
				C(eu($(e)));
			} finally {
				T(!1);
			}
		}
	}, te = async () => {
		if (!(!b || !ve(b))) try {
			x(await r.cancelManagedClone(b.operation_id));
		} catch (e) {
			C(Qn($(e)));
		}
	}, A = w || ve(b), ne = O.error ? eu($(O.error)) : null;
	return /* @__PURE__ */ J(Vn, {
		open: e,
		onClose: A ? void 0 : t,
		title: "Add repository",
		size: or.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		footer: b?.status === "running" ? /* @__PURE__ */ J(V, {
			variant: L.SecondaryDestructive,
			content: o.Text,
			onClick: () => void te(),
			children: "Cancel clone"
		}) : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(V, {
			variant: L.Tertiary,
			content: o.Text,
			onClick: t,
			children: "Cancel"
		}), /* @__PURE__ */ J(V, {
			variant: L.Primary,
			content: o.Text,
			onClick: () => void ee(),
			disabled: !f || !m || !g.trim() || !v.trim(),
			loading: w,
			children: "Clone repository"
		})] }),
		children: /* @__PURE__ */ Y("div", {
			className: "flex h-full min-h-0 flex-col gap-4 overflow-auto p-4 md:p-6",
			"data-testid": "managed-repository-modal",
			children: [
				l.data?.connected ? null : /* @__PURE__ */ Y("div", {
					className: "flex flex-col items-start gap-3 rounded-lg border border-basic p-4",
					children: [/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
						className: "label-medium text-basic-primary",
						children: "Connect GitHub to browse Arcee repositories"
					}), /* @__PURE__ */ J("p", {
						className: "text-small text-basic-tertiary",
						children: "You can still create a Project through NAC's existing local or SSH flow."
					})] }), /* @__PURE__ */ J(V, {
						variant: L.Primary,
						content: o.Text,
						onClick: n,
						children: "Connect GitHub"
					})]
				}),
				l.data?.connected && !b ? /* @__PURE__ */ Y(q, { children: [
					/* @__PURE__ */ J(Z, {
						inputSize: X.Large,
						label: "Find repository",
						"aria-label": "Find repository",
						placeholder: "Search accessible repositories",
						value: u,
						onChange: (e) => d(e.target.value)
					}),
					/* @__PURE__ */ Y("div", {
						className: "min-h-[140px] max-h-60 overflow-auto rounded-lg border border-basic p-1",
						children: [
							E.isLoading ? /* @__PURE__ */ J("div", {
								className: "p-4",
								children: /* @__PURE__ */ J(Ce, { size: je.Small })
							}) : null,
							E.error ? /* @__PURE__ */ J("p", {
								className: "p-4 text-small text-error-primary",
								children: eu($(E.error))
							}) : null,
							k.map((e) => /* @__PURE__ */ Y("button", {
								type: "button",
								className: `flex w-full items-center gap-3 rounded p-3 text-left ${f?.id === e.id ? "bg-elevation-level-2" : "hover:bg-elevation-level-1"}`,
								onClick: () => {
									p(e), h(e.default_branch), _(e.name), y(e.name), C("");
								},
								children: [
									/* @__PURE__ */ J(M, { iconName: e.private ? F.Lock : F.Github }),
									/* @__PURE__ */ Y("span", {
										className: "min-w-0 flex-1",
										children: [/* @__PURE__ */ J("span", {
											className: "block label-small text-basic-primary truncate",
											children: e.full_name
										}), /* @__PURE__ */ Y("span", {
											className: "block text-small text-basic-tertiary",
											children: ["Default branch: ", e.default_branch]
										})]
									}),
									f?.id === e.id ? /* @__PURE__ */ J(M, { iconName: F.CheckCircle }) : null
								]
							}, e.id)),
							!E.isLoading && k.length === 0 ? /* @__PURE__ */ J("p", {
								className: "p-4 text-small text-basic-tertiary",
								children: "No repositories match."
							}) : null
						]
					}),
					f ? /* @__PURE__ */ Y("div", {
						className: "grid grid-cols-1 gap-3 sm:grid-cols-2",
						children: [
							/* @__PURE__ */ J(rb, {
								branches: O.data?.branches ?? [],
								value: m,
								onValueChange: h,
								isLoading: O.isLoading,
								error: ne
							}, f.full_name),
							/* @__PURE__ */ J(Z, {
								inputSize: X.Large,
								label: "Project name",
								"aria-label": "Project name",
								value: v,
								onChange: (e) => y(e.target.value)
							}),
							/* @__PURE__ */ J(Z, {
								className: "sm:col-span-2",
								inputSize: X.Large,
								label: "Checkout directory",
								"aria-label": "Checkout directory",
								value: g,
								onChange: (e) => _(e.target.value),
								hintText: `${c.data?.repository_root ?? "Repository root"}/${g || "directory"}`
							})
						]
					}) : null
				] }) : null,
				b ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-4 rounded-lg border border-basic p-4",
					children: [
						/* @__PURE__ */ Y("div", {
							className: "flex items-center gap-3",
							children: [b.status === "running" ? /* @__PURE__ */ J(Ce, { size: je.Small }) : /* @__PURE__ */ J(M, { iconName: b.status === "completed" ? F.CheckCircle : F.Danger }), /* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
								className: "label-medium text-basic-primary capitalize",
								children: b.status
							}), /* @__PURE__ */ Y("p", {
								className: "text-small text-basic-tertiary break-all",
								children: [
									b.repository,
									" · ",
									b.branch
								]
							})] })]
						}),
						/* @__PURE__ */ J("pre", {
							className: "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-elevation-level-2 p-3 code-small text-basic-secondary",
							children: b.progress || "Preparing clone…"
						}),
						b.error ? /* @__PURE__ */ J("p", {
							className: "text-small text-error-primary",
							children: b.error
						}) : null
					]
				}) : null,
				S ? /* @__PURE__ */ J("p", {
					className: "text-small text-error-primary",
					children: S
				}) : null
			]
		})
	});
}
//#endregion
//#region src/app/features/managed/controller/ManagedHostProvider.tsx
function ab({ children: e }) {
	let t = $t(), [n, r] = K(!1), [i, a] = K("status"), [o, s] = K(!1), [c, l] = K(!1), u = t.data ?? null, d = H(() => {
		l(!1), a("status"), r(!0);
	}, []), f = H(() => {
		s(!1), l(!0), a("github"), r(!0);
	}, []), p = H(() => {
		if (u?.github_status === "connected") {
			s(!0);
			return;
		}
		f();
	}, [f, u?.github_status]), m = H(() => {
		c && (l(!1), r(!1), s(!0));
	}, [c]), h = W(() => ({
		status: u,
		isManaged: u?.managed === !0,
		openSettings: d,
		addRepository: p
	}), [
		p,
		d,
		u
	]);
	return /* @__PURE__ */ Y(Mp.Provider, {
		value: h,
		children: [
			e,
			/* @__PURE__ */ J(tb, {
				open: n,
				tab: i,
				onTabChange: a,
				onClose: () => {
					r(!1), l(!1);
				},
				onGitHubConnected: m
			}),
			o ? /* @__PURE__ */ J(ib, {
				open: !0,
				onClose: () => s(!1),
				onConnect: f
			}) : null
		]
	});
}
//#endregion
//#region src/App.tsx
function ob() {
	let { sessionId: e } = li();
	return /* @__PURE__ */ Y("section", {
		className: "relative flex h-full min-h-0 overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ J(im, {}), /* @__PURE__ */ J(Vy, {}, e)]
	});
}
function sb() {
	return u().orchestrationEnabled ? /* @__PURE__ */ J(cm, {}) : /* @__PURE__ */ J(ri, {
		to: pr.list(),
		replace: !0
	});
}
function cb() {
	return /* @__PURE__ */ J(mi, { children: /* @__PURE__ */ J(Nn, { children: /* @__PURE__ */ J(If, { children: /* @__PURE__ */ J(Sf, { children: /* @__PURE__ */ J(ab, { children: /* @__PURE__ */ Y(oi, { children: [
		/* @__PURE__ */ Y(ai, {
			element: /* @__PURE__ */ J(Lp, {}),
			children: [
				/* @__PURE__ */ J(ai, {
					path: "/",
					element: /* @__PURE__ */ J(km, {})
				}),
				/* @__PURE__ */ J(ai, {
					path: "/project/:projectId",
					element: /* @__PURE__ */ J(um, {})
				}),
				/* @__PURE__ */ J(ai, {
					path: "/session/:sessionId/:panel?",
					element: /* @__PURE__ */ J(ob, {})
				})
			]
		}),
		/* @__PURE__ */ J(ai, {
			path: "/design",
			element: /* @__PURE__ */ J(sb, {})
		}),
		/* @__PURE__ */ J(ai, {
			path: "*",
			element: /* @__PURE__ */ J(ri, {
				to: pr.list(),
				replace: !0
			})
		})
	] }) }) }) }) }) });
}
//#endregion
//#region src/app/providers/ThemeProvider.tsx
var lb = [
	"light",
	"dark",
	"system"
], ub = "nac-theme", db = "dark", fb = Wr(null), pb = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
function mb(e) {
	return db;
}
function hb() {
	let e = document.documentElement;
	e.setAttribute("data-theme", db), e.classList.remove("light", "dark"), e.classList.add(db), e.style.colorScheme = db;
}
function gb() {
	let e = localStorage.getItem(ub);
	return e && lb.includes(e) ? e : pb() ? "dark" : "light";
}
var _b = ({ children: e, local: t = !1 }) => {
	let [n, r] = K(() => t ? "dark" : gb()), i = H((e) => {
		lb.includes(e) && (r(e), t || (localStorage.setItem(ub, e), hb()));
	}, [t]), a = H(() => {
		r((e) => {
			let n = e === "light" ? "dark" : e === "dark" ? "system" : "light";
			return t || (localStorage.setItem(ub, n), hb()), n;
		});
	}, [t]);
	return U(() => {
		t || hb();
	}, [t]), /* @__PURE__ */ J(fb.Provider, {
		value: {
			theme: n,
			resolved: mb(n),
			setTheme: i,
			toggleTheme: a
		},
		children: e
	});
};
function vb() {
	let e = qr(fb);
	if (!e) throw Error("useTheme must be used within a ThemeProvider");
	return e;
}
//#endregion
//#region src/app/runtime/NativePresentationRoot.tsx
function yb(e) {
	return /* @__PURE__ */ J(bb, { ...e }, e.runtime.id);
}
function bb({ runtime: e, router: t, theme: n, className: r, styles: i, globalKeyboard: a }) {
	if (U(() => e.retain(), [e]), Xr(e.subscribe, e.isClosed, e.isClosed)) return null;
	let o = /* @__PURE__ */ J(xb, {
		runtime: e,
		className: r,
		styles: i,
		globalKeyboard: a,
		children: t(/* @__PURE__ */ J(cb, {}))
	});
	return /* @__PURE__ */ J(A.Provider, {
		value: e,
		children: /* @__PURE__ */ J(Zr, {
			client: e.queryClient,
			children: n ? n(o) : /* @__PURE__ */ J(_b, {
				local: !0,
				children: o
			})
		})
	});
}
function xb({ runtime: e, className: t, styles: n, globalKeyboard: r, children: i }) {
	let { resolved: a } = vb();
	return /* @__PURE__ */ Y("div", {
		className: `${t ?? "nac-presentation h-full min-h-0"} ${a}`,
		style: { contain: "layout paint" },
		"data-nac-runtime": e.id,
		"data-theme": a,
		children: [n, /* @__PURE__ */ J(Er, {
			globalKeyboard: r,
			children: i
		})]
	});
}
//#endregion
export { yb as NativePresentationRoot, Xn as NativeRuntime, A as RuntimeContext, de as createNativeRuntime, me as useNativeRuntime };
