import { $ as e, $n as t, $r as n, $t as r, A as i, Ai as a, An as o, Ar as s, At as c, B as l, Bn as u, Br as d, Bt as f, C as p, Ci as m, Cn as h, Cr as g, Ct as _, D as v, Di as y, Dn as b, Dt as x, E as S, Ei as C, En as w, Er as T, Et as E, F as D, Fi as O, Fn as k, Fr as A, Ft as ee, G as te, Gn as ne, Gr as re, Gt as ie, H as ae, Hn as oe, Hr as se, Ht as ce, I as le, In as ue, Ir as de, It as fe, J as pe, Jn as me, Jr as j, Jt as he, K as ge, Kn as _e, Kr as ve, Kt as ye, L as be, Ln as xe, Lr as M, Lt as N, M as Se, Mi as P, Mn as Ce, Mr as F, Mt as we, N as Te, Ni as Ee, Nn as De, Nr as I, Nt as Oe, O as ke, Oi as Ae, On as je, Or as Me, Ot as Ne, P as Pe, Pi as Fe, Pn as Ie, Pr as Le, Pt as Re, Q as ze, Qn as Be, Qr as Ve, Qt as He, R as Ue, Rn as We, Rr as L, Rt as Ge, S as Ke, Si as qe, Sn as Je, Sr as Ye, St as Xe, T as Ze, Ti as Qe, Tn as $e, Tr as et, Tt as tt, U as nt, Un as rt, Ur as it, Ut as at, V as ot, Vn as st, Vr as ct, Vt as lt, W as ut, Wn as dt, Wr as ft, Wt as pt, X as mt, Xn as ht, Xr as gt, Xt as _t, Y as vt, Yn as yt, Yr as bt, Yt as xt, Z as St, Zn as Ct, Zr as wt, Zt as Tt, _ as Et, _i as Dt, _n as Ot, _r as kt, _t as At, a as jt, ai as Mt, an as Nt, ar as Pt, at as Ft, b as It, bi as Lt, bn as Rt, br as zt, bt as Bt, c as Vt, ci as Ht, cn as Ut, cr as Wt, ct as Gt, d as Kt, di as qt, dn as Jt, dr as Yt, dt as Xt, ei as Zt, en as Qt, er as $t, et as en, f as tn, fi as nn, fn as rn, fr as an, ft as on, g as sn, gi as cn, gn as ln, gr as un, gt as dn, h as fn, hi as pn, hn as mn, hr as hn, ht as gn, i as _n, ii as vn, in as yn, ir as bn, it as xn, j as Sn, jn as Cn, jr as R, jt as wn, k as Tn, ki as En, kn as Dn, kr as z, kt as On, l as kn, li as An, ln as jn, lr as Mn, lt as Nn, m as Pn, mi as Fn, mn as In, mr as Ln, mt as Rn, n as zn, ni as Bn, nn as Vn, nr as Hn, nt as Un, o as Wn, oi as Gn, on as Kn, ot as qn, p as Jn, pi as Yn, pn as Xn, pr as Zn, pt as Qn, q as $n, qn as er, qr as B, qt as tr, r as nr, ri as rr, rn as ir, rr as ar, rt as or, s as sr, si as cr, sn as lr, sr as ur, st as dr, t as fr, ti as pr, tn as mr, tr as hr, tt as gr, u as _r, ui as vr, un as yr, ur as br, ut as xr, v as Sr, vi as Cr, vn as wr, vr as Tr, vt as Er, w as Dr, wi as Or, wn as kr, wr as Ar, wt as jr, x as Mr, xi as Nr, xn as Pr, xr as Fr, xt as Ir, y as Lr, yi as Rr, yn as zr, yr as Br, yt as Vr, z as Hr, zn as Ur, zr as V, zt as Wr } from "./chunks/PerfProfiler-CjXbbkmt.js";
import { Fragment as Gr, Suspense as Kr, createContext as qr, lazy as Jr, memo as Yr, useCallback as H, useContext as Xr, useEffect as U, useId as Zr, useLayoutEffect as Qr, useMemo as W, useRef as G, useState as K, useSyncExternalStore as $r } from "react";
import { QueryClientProvider as ei, QueryObserver as ti, useIsFetching as ni, useMutation as ri, useQuery as ii, useQueryClient as ai } from "@tanstack/react-query";
import { Link as oi, Navigate as si, Outlet as ci, Route as li, Routes as ui, useLocation as di, useNavigate as fi, useParams as pi } from "react-router-dom";
import { Fragment as q, jsx as J, jsxs as Y } from "react/jsx-runtime";
import { flushSync as mi } from "react-dom";
//#region src/app/features/ui-policy/UiPolicyProvider.tsx
var hi = /* @__PURE__ */ new WeakMap(), gi = 0;
function _i(e) {
	let t = hi.get(e);
	return t === void 0 && (t = ++gi, hi.set(e, t)), t;
}
function vi({ children: e, client: t }) {
	let n = B(), r = t ?? n.client, i = ii({
		queryKey: [
			"ui-configuration",
			r.transport.endpoint,
			_i(r)
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
	}) : /* @__PURE__ */ Y(d.Provider, {
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
var yi = /* @__PURE__ */ function(e) {
	return e.Micro = "w-4 h-4 text-[10px]", e.Small = "w-5 h-5 text-xs", e.Medium = "w-6 h-6 text-xs", e.Large = "w-8 h-8 text-sm", e.XLarge = "w-12 h-12 text-lg", e;
}({}), bi = ({ imageUrl: e, name: t, size: n = "w-6 h-6 text-xs", color: r = "var(--color-bg-accent-primary)", glyph: i = !1, className: a = "" }) => {
	let o = t?.trim() ?? "", s = i ? o : o[0]?.toUpperCase() ?? "?";
	return /* @__PURE__ */ J("div", {
		className: V("flex items-center justify-center shrink-0 rounded-full overflow-hidden", "font-semibold text-basic-primary-inverse shadow-convex", n, a),
		style: { background: e ? void 0 : r },
		children: e ? /* @__PURE__ */ J("img", {
			src: e,
			alt: o,
			className: "w-full h-full object-cover"
		}) : s
	});
};
bi.Size = yi;
//#endregion
//#region src/app/atoms/badge/index.tsx
var xi = /* @__PURE__ */ function(e) {
	return e.Neutral = "bg-elevation-sublevel-variant-B text-basic-secondary border-tertiary", e.Green = "bg-success-tertiary text-success-primary border-success-muted", e.Blue = "bg-info-tertiary text-info-primary border-info-muted", e.Red = "bg-error-tertiary text-error-primary border-error-muted", e.Yellow = "bg-danger-tertiary  text-danger-primary border-danger-muted", e.Violet = "bg-indigo-400 text-indigo-800 border-indigo-300", e.Gray = "bg-elevation-sublevel-variant-A text-basic-secondary border-muted", e;
}({}), Si = ({ text: e, color: t = "bg-elevation-sublevel-variant-B text-basic-secondary border-tertiary", className: n = "" }) => {
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
Si.Color = xi;
//#endregion
//#region src/app/atoms/box-surface/index.tsx
var Ci = ({ title: e, headerContent: t, footer: n, className: r = "", bodyClassName: i = "", children: a }) => {
	let o = e != null || t != null;
	return /* @__PURE__ */ Y("div", {
		className: V("flex flex-col rounded-[8px] overflow-hidden bg-elevation-level-1 shadow-convex", r),
		children: [
			o ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-4 h-14 px-4 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ J("div", {
					className: "header-md text-basic-primary flex-1 min-w-0 truncate",
					children: e
				}), t]
			}) : null,
			/* @__PURE__ */ J("div", {
				className: V("flex-1 min-h-0 flex flex-col [&>*]:shrink-0", i),
				children: a
			}),
			n ? /* @__PURE__ */ J("div", {
				className: "flex items-center p-4 border-t border-muted shrink-0",
				children: n
			}) : null
		]
	});
}, wi = ({ variant: e = I.Ghost, content: t = R.Text, disabled: n, className: r = "", buttonClassName: i = "", children: a, loading: o = !1, type: c = "button", ...l }) => {
	let u = r.includes("flex-grow") || r.includes("flex-1");
	return /* @__PURE__ */ J("div", {
		className: V("bg-elevation-level-3 shadow-2xl rounded-full overflow-hidden h-10", u ? "flex w-full" : "inline-flex w-fit", r),
		children: /* @__PURE__ */ J(s, {
			size: F.Large,
			variant: e,
			content: t,
			type: c,
			disabled: n,
			loading: o,
			className: V("btn-sticky", u && "w-full", i),
			...l,
			children: a
		})
	});
};
wi.Variant = I, wi.Content = R;
//#endregion
//#region src/app/atoms/chat-loader/index.tsx
var Ti = /* @__PURE__ */ function(e) {
	return e.Small = "w-1.5 h-1.5", e.Medium = "w-2 h-2", e.Large = "w-3 h-3", e;
}({}), Ei = ({ size: e = "w-2 h-2", className: t = "" }) => /* @__PURE__ */ J("div", {
	role: "status",
	"aria-label": "Waiting for a response",
	className: V("flex items-end gap-1 fade", t),
	children: [
		0,
		1,
		2
	].map((t) => /* @__PURE__ */ J("span", { className: V("chat-loader-dot rounded-full bg-divider-secondary", e) }, t))
});
Ei.Size = Ti;
//#endregion
//#region src/app/atoms/chat-session-fork-mark/index.tsx
var Di = ({ forkedFromTitle: e, running: t = !1, className: n = "" }) => {
	if (t) return /* @__PURE__ */ J(Le, {
		size: A.Micro,
		variant: de.Neutral,
		className: "shrink-0"
	});
	let r = e?.trim();
	if (!r) return null;
	let i = `Fork of ${r}`;
	return /* @__PURE__ */ J(Zn, {
		title: i,
		position: Zn.Position.BottomCenter,
		sticky: !0,
		className: "shrink-0",
		children: /* @__PURE__ */ J("span", {
			className: "inline-flex shrink-0",
			"aria-label": i,
			children: /* @__PURE__ */ J(M, {
				iconName: L.Scheme,
				size: 16,
				className: V("shrink-0", n)
			})
		})
	});
}, Oi = ({ title: e, active: t = !1, running: n = !1, icon: r = L.Plane, forkedFromTitle: i, badge: a, badgeLabel: o, unread: s = !1, isMobile: c = !1, actions: l, className: u = "", type: d = "button", "aria-label": f, ...p }) => {
	let m = t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered", h = n ? "text-shimmer-basic" : m;
	return /* @__PURE__ */ Y("div", {
		className: V("group flex items-center min-w-0 rounded-[4px]", c ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1", t ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered" : "hover:bg-btn-ghost-hovered", u),
		children: [/* @__PURE__ */ Y("button", {
			type: d,
			title: o ? `${e} · ${o}` : e,
			"aria-label": f ?? (o ? `${e}, ${o}` : e),
			"aria-current": t ? "page" : void 0,
			className: V("flex flex-1 items-center min-w-0 rounded-[3px] text-left", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary", c ? "gap-3" : "gap-1.5"),
			...p,
			children: [
				/* @__PURE__ */ J(M, {
					iconName: r,
					size: 20,
					"aria-hidden": !0,
					"data-session-behavior-icon": r,
					className: V("shrink-0", m)
				}),
				/* @__PURE__ */ J("span", {
					className: V("min-w-0 flex-1 truncate", c ? "text-medium" : "label-small", h),
					children: e
				}),
				/* @__PURE__ */ J(Di, {
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
			className: V("flex items-center gap-1 shrink-0", c ? null : "hidden group-hover:flex group-has-[:focus-visible]:flex"),
			children: l
		}) : null]
	});
}, ki = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), Ai = {
	info: "border-info-primary text-info-primary",
	error: "border-error-primary text-error-primary",
	danger: "border-danger-primary text-danger-primary",
	success: "border-success-primary text-success-primary"
}, ji = {
	info: L.Info,
	error: L.Close,
	danger: L.Danger,
	success: L.CheckCircle
}, Mi = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, Ni = ({ title: e, variant: t = "info", action: n, className: r = "", children: i, ...a }) => /* @__PURE__ */ J("div", {
	className: V("flex w-full items-start overflow-hidden border-l-2 px-4 py-2", Ai[t], r),
	...a,
	children: /* @__PURE__ */ Y("div", {
		className: "flex flex-1 min-w-0 flex-col items-start gap-2",
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex w-full items-start gap-1.5",
				children: [/* @__PURE__ */ J(M, {
					iconName: ji[t],
					size: 20,
					color: Mi[t],
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
			n ? /* @__PURE__ */ J(s, {
				size: F.Small,
				variant: I.Primary,
				content: R.Text,
				onClick: n.onClick,
				children: n.label
			}) : null
		]
	})
});
Ni.Variant = ki;
//#endregion
//#region src/app/atoms/chat-session-orphan-avatar/index.tsx
var Pi = (e) => Math.round(e * .7 / 4) * 4, Fi = (e) => Math.round(e / 10), Ii = ({ size: e = 40, isRunning: t = !1, className: n = "", ...r }) => /* @__PURE__ */ J("div", {
	className: V("flex items-center justify-center shrink-0", "border border-muted bg-elevation-sublevel-variant-B", n),
	style: {
		width: e,
		height: e,
		borderRadius: Fi(e)
	},
	"aria-hidden": "true",
	...r,
	children: /* @__PURE__ */ J(M, {
		iconName: L.Chat,
		size: Pi(e),
		className: V("text-basic-secondary", t && "pulse-dim")
	})
}), Li = ({ rows: e = 3, className: t = "", rowClassName: n = "" }) => /* @__PURE__ */ J("div", {
	className: V("flex flex-col gap-2", t),
	children: Array.from({ length: e }).map((e, t) => /* @__PURE__ */ J("div", {
		className: V("relative h-4 rounded-[4px] overflow-hidden bg-elevation-level-2", n),
		children: /* @__PURE__ */ J("div", {
			className: "absolute inset-0 animate-shimmer bg-[length:200%_100%] bg-[position:-200%_0]",
			style: { backgroundImage: "linear-gradient(90deg, transparent 0%, var(--color-bg-btn-secondary-highlighted-hovered) 50%, transparent 100%)" }
		})
	}, t))
}), Ri = ({ title: e, active: t = !1, running: n = !1, forkedFromTitle: r, behaviorIcon: i, behaviorLabel: a, onDismiss: o, className: c = "", type: l = "button", "aria-label": u, ...d }) => {
	let f = n ? "text-shimmer-basic" : r ? "text-btn-secondary group-hover:text-btn-secondary-hovered" : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered", p = /* @__PURE__ */ Y("button", {
		type: l,
		title: e,
		"aria-label": u ?? (a ? `${e}, ${a}` : e),
		"aria-current": t ? "page" : void 0,
		className: "flex h-10 w-full min-w-0 flex-1 items-center justify-start gap-1 py-1 pl-2 pr-2 group-hover:pr-8 group-has-[:focus-visible]:pr-8",
		...d,
		children: [
			/* @__PURE__ */ J(Di, {
				forkedFromTitle: r,
				running: n,
				className: n ? void 0 : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered"
			}),
			i ? /* @__PURE__ */ J(M, {
				iconName: i,
				size: 16,
				"aria-hidden": !0,
				"data-session-behavior-icon": i,
				className: V("shrink-0", f)
			}) : null,
			/* @__PURE__ */ J("span", {
				"data-session-tab-title": !0,
				className: V("label-micro w-full min-w-0 flex-1 truncate text-left", f),
				children: e
			})
		]
	});
	return /* @__PURE__ */ Y("div", {
		className: V("chat-session-tab group relative flex w-32 max-w-full shrink-0 items-center justify-start gap-1", t ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered" : "hover:bg-btn-ghost-hovered", c),
		children: [a ? /* @__PURE__ */ J(Zn, {
			title: a,
			position: Zn.Position.BottomLeft,
			sticky: !0,
			className: "min-w-0 flex-1",
			children: p
		}) : p, o ? /* @__PURE__ */ J(s, {
			variant: I.Tertiary,
			size: F.Small,
			content: R.Icon,
			"aria-label": `Close ${e}`,
			title: "Close tab",
			onClick: (e) => {
				e.stopPropagation(), o();
			},
			className: "absolute right-1 top-1/2 -translate-y-1/2 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto",
			children: /* @__PURE__ */ J(M, { iconName: L.Close })
		}) : null]
	});
}, zi = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ Y("label", {
	className: V("flex items-center gap-2 w-fit", n ? "cursor-not-allowed opacity-60" : "", i),
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
			className: V("flex items-center justify-center shrink-0 w-4 h-4 rounded-[4px] border transition-colors duration-150", "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-primary", n ? "bg-btn-secondary-disabled border-muted" : e ? "bg-btn-secondary-accent border-accent-primary hover:bg-btn-secondary-accent-hovered" : "bg-btn-secondary border-secondary hover:bg-btn-secondary-hovered hover:border-tertiary"),
			children: e ? /* @__PURE__ */ J(M, {
				iconName: L.Check,
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
}), Bi = "en-US", Vi = new Intl.DateTimeFormat(Bi, {
	month: "long",
	year: "numeric"
}), Hi = new Intl.DateTimeFormat(Bi, { weekday: "short" }), Ui = (e) => new Date(e.getFullYear(), e.getMonth(), 1), Wi = (e, t) => new Date(e.getFullYear(), e.getMonth() + t, 1), Gi = (e, t) => new Date(e.getFullYear(), e.getMonth(), e.getDate() + t), Ki = (e) => new Date(e.getFullYear(), e.getMonth(), e.getDate()), qi = (e, t) => e.getFullYear() === t.getFullYear() && e.getMonth() === t.getMonth() && e.getDate() === t.getDate(), Ji = (e) => qi(e, /* @__PURE__ */ new Date()), Yi = (e, t, n) => {
	let r = Ki(e).getTime();
	return r >= Ki(t).getTime() && r <= Ki(n).getTime();
}, Xi = (e, t, n) => {
	let r = Ki(e).getTime();
	return !!(t && r < Ki(t).getTime() || n && r > Ki(n).getTime());
}, Zi = (e) => Vi.format(e), Qi = () => {
	let e = new Date(2021, 7, 1);
	return Array.from({ length: 7 }, (t, n) => Hi.format(Gi(e, n)));
}, $i = (e) => `${e.getFullYear()}-${e.getMonth()}-${e.getDate()}`;
function ea(e) {
	let t = Ui(e), n = t.getDay(), r = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate(), i = [];
	for (let e = -n; e < 0; e += 1) i.push({
		date: Gi(t, e),
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
function ta(e, t, n, r) {
	return e || t ? I.Primary : n ? I.GhostHighlightedAccent : r ? I.SecondaryHighlighted : I.Ghost;
}
var na = ({ days: e, selected: t, range: n, focused: r, min: i, max: a, disabled: o = !1, onSelect: c, onFocusDay: l, onNavigate: u }) => {
	let d = G(null);
	U(() => {
		let e = d.current;
		if (!r || !e) return;
		let t = requestAnimationFrame(() => {
			let t = e.querySelector(`button[data-day="${$i(r)}"]`);
			t && !t.disabled && t.focus();
		});
		return () => cancelAnimationFrame(t);
	}, [r, e]);
	let f = (e, t) => {
		let n = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -7,
			ArrowDown: 7
		}[e.key];
		n !== void 0 && (e.preventDefault(), u(t, n));
	};
	return /* @__PURE__ */ J("div", {
		ref: d,
		className: "grid grid-cols-7 gap-y-1 p-2",
		role: "rowgroup",
		children: e.map(({ date: e, inMonth: u }) => {
			let d = t ? qi(e, t) : !1, p = n?.from ? qi(e, n.from) : !1, m = n?.to ? qi(e, n.to) : !1, h = n?.from && n?.to ? Yi(e, n.from, n.to) : !1, g = o || !u || Xi(e, i, a), _ = p && m ? null : p ? "rounded-r-none" : m ? "rounded-l-none" : h ? "rounded-none" : null;
			return /* @__PURE__ */ J("div", {
				role: "gridcell",
				"aria-selected": d,
				children: /* @__PURE__ */ J(s, {
					"data-day": $i(e),
					variant: ta(d, p || m, h, Ji(e)),
					size: F.Medium,
					disabled: g,
					tabIndex: r && qi(e, r) ? 0 : -1,
					className: V("w-full", _, !u && "invisible"),
					onClick: () => c(e),
					onFocus: () => l(e),
					onKeyDown: (t) => f(t, e),
					children: e.getDate()
				})
			}, $i(e));
		})
	});
}, ra = Qi(), ia = ({ selected: e, onSelect: t, range: n, onRangeChange: r, min: i, max: a, disabled: o = !1, defaultMonth: c, className: l = "" }) => {
	let u = n ? n.to ?? n.from : e, [d, f] = K(() => Ui(c ?? u ?? /* @__PURE__ */ new Date())), [p, m] = K(u), h = W(() => ea(d), [d]);
	return /* @__PURE__ */ Y("div", {
		role: "group",
		"aria-label": "Calendar",
		className: V("flex flex-col min-w-0 w-[280px]", l),
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex items-center justify-between gap-2 p-1 border-b border-muted",
				children: [
					/* @__PURE__ */ J(s, {
						variant: I.Ghost,
						size: F.Medium,
						content: R.Icon,
						"aria-label": "Previous month",
						onClick: () => f((e) => Wi(e, -1)),
						children: /* @__PURE__ */ J(M, { iconName: L.Left })
					}),
					/* @__PURE__ */ J("div", {
						className: "label-small text-basic-primary",
						"aria-live": "polite",
						children: Zi(d)
					}),
					/* @__PURE__ */ J(s, {
						variant: I.Ghost,
						size: F.Medium,
						content: R.Icon,
						"aria-label": "Next month",
						onClick: () => f((e) => Wi(e, 1)),
						children: /* @__PURE__ */ J(M, { iconName: L.Right })
					})
				]
			}),
			/* @__PURE__ */ J("div", {
				className: "grid grid-cols-7 px-2 pt-2",
				role: "row",
				children: ra.map((e) => /* @__PURE__ */ J("div", {
					role: "columnheader",
					className: "label-micro text-basic-tertiary text-center py-1",
					children: e
				}, e))
			}),
			/* @__PURE__ */ J(na, {
				days: h,
				selected: n ? void 0 : e,
				range: n,
				focused: p,
				min: i,
				max: a,
				disabled: o,
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
					let n = Gi(e, t);
					m(n), (n.getFullYear() !== d.getFullYear() || n.getMonth() !== d.getMonth()) && f(Ui(n));
				}
			})
		]
	});
}, aa = /* @__PURE__ */ function(e) {
	return e[e.Small = 16] = "Small", e[e.Medium = 20] = "Medium", e[e.Large = 24] = "Large", e;
}({}), oa = ({ title: e, description: t, size: n = 16, position: r = z.TopCenter, className: i = "", muted: a = !1 }) => /* @__PURE__ */ J(Zn, {
	title: e,
	description: t,
	position: r,
	sticky: !0,
	showTooltipOnMobile: !0,
	className: i,
	children: /* @__PURE__ */ J(M, {
		iconName: L.Info,
		size: n,
		className: V("cursor-help shrink-0", a && "[&>path]:!fill-basic-muted"),
		color: a ? void 0 : "var(--color-fill-basic-tertiary)"
	})
});
oa.Size = aa;
//#endregion
//#region src/app/atoms/label/index.tsx
var sa = /* @__PURE__ */ function(e) {
	return e.Micro = "label-micro", e.Small = "label-small", e.Medium = "label-medium", e;
}({}), ca = {
	"label-micro": 16,
	"label-small": 20,
	"label-medium": 24
}, la = {
	"label-micro": aa.Small,
	"label-small": aa.Small,
	"label-medium": aa.Medium
}, ua = ({ children: e, htmlFor: t, size: n = "label-small", icon: r, validation: i = !1, tone: a = "secondary", hoverHint: o, className: s = "" }) => /* @__PURE__ */ Y("label", {
	htmlFor: t,
	className: V("flex items-center gap-1.5 min-w-0", n, i ? "text-error-primary" : a === "primary" ? "text-basic-primary" : a === "muted" ? "text-basic-muted" : "text-basic-secondary", s),
	children: [
		r ? /* @__PURE__ */ J(M, {
			iconName: r,
			size: ca[n],
			className: "shrink-0"
		}) : null,
		/* @__PURE__ */ J("span", {
			className: "truncate",
			children: e
		}),
		o ? /* @__PURE__ */ J(oa, {
			title: o.title,
			description: o.description,
			muted: o.muted,
			size: la[n]
		}) : null
	]
});
ua.Size = sa;
//#endregion
//#region src/app/atoms/input/InputWrapper.tsx
var da = ({ label: e, required: t, validation: n, validationText: r, hintText: i, hoverHint: a, className: o, children: s }) => /* @__PURE__ */ Y("div", {
	className: V("flex text-left flex-col gap-1", o),
	children: [
		e ? /* @__PURE__ */ Y("div", {
			className: "flex gap-2 items-center",
			children: [/* @__PURE__ */ J(ua, {
				validation: n,
				hoverHint: a,
				tone: "primary",
				className: "flex-1",
				children: e
			}), t ? /* @__PURE__ */ J("div", {
				className: V("text-micro shrink-0", n ? "text-error-secondary" : "text-basic-tertiary"),
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
}), fa = (e) => `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`, pa = (e) => {
	let t = e?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (t) return new Date(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
}, ma = (e) => {
	let t = pa(e);
	return t ? t.toLocaleDateString("en-US") : "";
}, ha = ({ value: e, onChange: t, range: n, onRangeChange: r, size: i = F.Medium, disabled: a = !1, validation: o, validationText: c, placement: l = z.BottomRight, min: u, max: d, placeholder: f, label: p, required: m, hintText: h, hoverHint: g, className: _ = "" }) => {
	let [v, y] = K(!1), b = !!n, x = b ? n?.from || n?.to ? `${ma(n?.from) || "Start"} – ${ma(n?.to) || "End"}` : f ?? "Select range" : (ma(e) || f) ?? "Select date", S = b ? /* @__PURE__ */ J(ia, {
		range: {
			from: pa(n?.from),
			to: pa(n?.to)
		},
		onRangeChange: (e) => {
			r?.({
				from: e.from ? fa(e.from) : null,
				to: e.to ? fa(e.to) : null
			}), e.from && e.to && y(!1);
		},
		min: pa(u),
		max: pa(d),
		disabled: a
	}) : /* @__PURE__ */ J(ia, {
		selected: pa(e),
		onSelect: (e) => {
			t?.(fa(e)), y(!1);
		},
		min: pa(u),
		max: pa(d),
		disabled: a
	});
	return /* @__PURE__ */ J(da, {
		label: p,
		required: m,
		validation: o,
		validationText: c,
		hintText: h,
		hoverHint: g,
		className: _,
		children: /* @__PURE__ */ J(Ln, {
			open: v,
			onClose: () => y(!1),
			placement: l,
			size: hn.Fit,
			sticky: !0,
			className: "w-full",
			panelClassName: "p-0",
			content: S,
			children: /* @__PURE__ */ Y(s, {
				variant: v ? I.SecondaryHighlighted : I.Secondary,
				size: i,
				content: R.IconLeft,
				disabled: a,
				"aria-haspopup": "dialog",
				"aria-expanded": v,
				className: V("w-full justify-between", o && "input-validation"),
				onClick: () => y((e) => !e),
				children: [
					/* @__PURE__ */ J(M, { iconName: L.Calendar }),
					/* @__PURE__ */ J("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: x
					}),
					/* @__PURE__ */ J(M, {
						iconName: L.Down,
						className: V("transition-transform", v && "rotate-180")
					})
				]
			})
		})
	});
}, ga = ({ isOpen: e, children: t, className: n = "", onCloseMaxHeight: r, isScrollable: i = !1, scrollToBottom: a = !1, ...o }) => {
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
		className: V(f, "transition-[height] duration-150 ease-out", n),
		style: {
			height: `${l}px`,
			...o.style
		},
		children: /* @__PURE__ */ J("div", {
			ref: s,
			children: t
		})
	});
}, _a = /* @__PURE__ */ function(e) {
	return e.Micro = "header-micro", e.Small = "header-small", e.Medium = "header-medium", e;
}({}), va = ({ value: e, onCommit: t, size: n = "header-small", placeholder: r = "Untitled", disabled: i = !1, className: a = "" }) => {
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
		className: V("flex items-center min-w-0 h-8", n, a),
		children: o ? /* @__PURE__ */ J("input", {
			ref: u,
			value: c,
			placeholder: r,
			className: V("w-full min-w-0 bg-btn-secondary-hovered text-basic-primary font-normal", "rounded-t-[4px] border-b border-primary outline-none px-1", n),
			onChange: (e) => l(e.target.value),
			onBlur: p,
			onKeyDown: (t) => {
				t.key === "Enter" && (t.preventDefault(), p()), t.key === "Escape" && (t.preventDefault(), l(e), s(!1));
			}
		}) : /* @__PURE__ */ J("button", {
			type: "button",
			disabled: i,
			className: V("min-w-0 truncate text-left text-basic-primary px-1", i ? "cursor-default" : "cursor-text", n),
			onClick: () => !i && s(!0),
			children: e || r
		})
	});
};
va.Size = _a;
//#endregion
//#region src/app/atoms/file-icon/icons/asciidoc.svg?raw
var ya = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M4 18V8l5.39 10Zm0 4v3.67A2.33 2.33 0 0 0 6.33 28h8.9l-3.496-6Zm12.444 0 3.177 5.444A11.88 11.88 0 0 0 26.448 22Zm11.419-4A15 15 0 0 0 28 16 12 12 0 0 0 16 4L6 3.995q-.08 0-.158.005L14 18Z\"/></svg>", ba = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff6e40\" d=\"M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2v-1H2V2h2V1Zm10 0v1h2v12h-2v1h2a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1ZM6 3c0 1 0 1-1 1v1h1v2h1V3Zm3 0a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm0 1h1v2H9ZM6 9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Zm4 0c0 1 0 1-1 1v1h1v2h1V9Zm-4 1h1v2H6Z\"/></svg>", xa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M12.106 25.849c-1.262-1.156-1.63-3.586-1.105-5.346a5.18 5.18 0 0 0 3.484 1.66 9.68 9.68 0 0 0 5.882-.734c.215-.106.413-.247.648-.39a3.5 3.5 0 0 1 .16 1.555 4.26 4.26 0 0 1-1.798 3.021c-.404.3-.832.569-1.25.852a2.613 2.613 0 0 0-1.15 3.372l.048.161a3.4 3.4 0 0 1-1.5-1.285 3.6 3.6 0 0 1-.578-1.962 9 9 0 0 0-.05-1.037c-.114-.831-.504-1.204-1.238-1.225a1.45 1.45 0 0 0-1.507 1.18c-.012.056-.028.112-.046.178M4.901 20a17.75 17.75 0 0 1 7.4-2l2.913-8.38a.765.765 0 0 1 1.527 0L19.7 18a14.24 14.24 0 0 1 7.399 2S20.704 2.877 20.692 2.842C20.51 2.33 20.202 2 19.787 2h-7.619c-.415 0-.71.33-.904.842z\"/></svg>", Sa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m6 10h-4v8a4 4 0 1 1-4-4 3.96 3.96 0 0 1 2 .555V8h6Z\"/></svg>", Ca = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fbc02d\" d=\"M3 18S4.15 6.885 7 3l5 1-1 3H9v7h1c1.9-2.915 5.783-3.98 8.157-2.915 4.475 1.915 2.998 5.967.148 7.905C16.025 20.548 10.113 23.05 3 18\"/></svg>", wa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", Ta = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g transform=\"translate(0 -822.52)\"><rect width=\"107.25\" height=\"156.59\" x=\"405.55\" y=\"967.22\" fill=\"#0097a7\" rx=\"12.306\" ry=\"12.31\" transform=\"matrix(-.98339 .18149 .60192 .79856 0 0)\"/><rect width=\"108.34\" height=\"123.15\" x=\"-1156.5\" y=\"1461.9\" fill=\"#3f51b5\" rx=\"10.69\" ry=\"12.31\" transform=\"matrix(-.98528 .17093 -.59175 .80612 0 0)\"/><path fill=\"#3f51b5\" d=\"M52.112 965.158c-1.343 3.515-26.292 23.248-25.744 27.277.548 4.03 29.812 16.023 32.04 19.027s10.545 41.668 13.603 42.5 18.828-31.274 21.548-32.932 32.808 2.503 34.15-1.01c1.343-3.515-18.174-35.352-18.721-39.381s9.732-40.12 7.502-43.125-30.06 9.427-33.118 8.594-26.793-27.3-29.514-25.643-.405 41.177-1.747 44.693z\"/></g></svg>", Ea = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M2 2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h6v3l2-1.25L12 14v-3h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Zm0 1h4v1H2Zm6 0 2 1.25L12 3v2.5l2 1-2 1V10l-2-1.25L8 10V7.5l-2-1 2-1zM2 5h3v1H2Zm0 2h3v1H2Zm0 2h4v1H2Z\"/></svg>", Da = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path fill=\"#64dd17\" d=\"M123.456 129.975a507 507 0 0 0-3.54 7.846c-4.406 9.981-9.284 22.127-11.066 29.908-.64 2.77-1.037 6.205-1.03 10.013 0 1.506.081 3.09.21 4.702a58.1 58.1 0 0 0 19.98 3.559 58.2 58.2 0 0 0 18.29-2.98c-1.352-1.237-2.642-2.554-3.816-4.038-7.796-9.942-12.146-24.512-19.028-49.01m-28.784-49.39C79.782 91.08 70.039 108.387 70.002 128c.037 19.32 9.487 36.403 24.002 46.94 3.56-14.83 12.485-28.41 25.868-55.63a219 219 0 0 0-2.714-7.083c-3.708-9.3-9.059-20.102-13.834-24.993-2.435-2.555-5.389-4.763-8.652-6.648\"/><path fill=\"#7cb342\" d=\"M178.532 194.535c-7.683-.963-14.023-2.124-19.57-4.081a69.4 69.4 0 0 1-30.958 7.249c-38.491 0-69.693-31.198-69.698-69.7 0-20.891 9.203-39.62 23.764-52.392-3.895-.94-7.956-1.49-12.104-1.482-20.45.193-42.037 11.51-51.025 42.075-.84 4.45-.64 7.813-.64 11.8 0 60.591 49.12 109.715 109.705 109.715 37.104 0 69.882-18.437 89.732-46.633-10.736 2.675-21.06 3.955-29.902 3.982-3.314 0-6.425-.177-9.305-.53\"/><path fill=\"#29b6f6\" d=\"M157.922 173.271c.678.336 2.213.884 4.35 1.49 14.375-10.553 23.717-27.552 23.754-46.764h-.005c-.055-32.03-25.974-57.945-58.011-58.009a58.2 58.2 0 0 0-18.213 2.961c11.779 13.426 17.443 32.613 22.922 53.6l.01.025c.01.017 1.752 5.828 4.743 13.538 2.97 7.7 7.203 17.231 11.818 24.178 3.03 4.655 6.363 8 8.632 8.981\"/><path fill=\"#1e88e5\" d=\"M128.009 18.29c-36.746 0-69.25 18.089-89.16 45.826 10.361-6.49 20.941-8.83 30.174-8.747 12.753.037 22.779 3.991 27.589 6.696a51 51 0 0 1 3.345 2.131 69.4 69.4 0 0 1 28.049-5.894c38.496.004 69.703 31.202 69.709 69.698h-.006c0 19.409-7.938 36.957-20.736 49.594 3.142.352 6.492.571 9.912.554 12.15.006 25.284-2.675 35.13-10.956 6.42-5.408 11.798-13.327 14.78-25.199.584-4.586.92-9.247.92-13.991 0-60.588-49.116-109.715-109.705-109.715\"/></svg>", Oa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M11.94 2.984 2.928 21.017l9.875-8.47z\"/><path fill=\"#e53935\" d=\"m11.958 2.982.002.29 1.312 14.499-.002.006.023.26 7.363 2.978h.415l-.158-.31-.114-.228h-.001l-8.84-17.494z\"/><path fill=\"#7cb342\" d=\"m8.558 16.13-5.627 4.884h17.743v-.016z\"/></svg>", ka = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff7043\" d=\"M2 2a1 1 0 0 0-1 1v10c0 .554.446 1 1 1h12c.554 0 1-.446 1-1V3a1 1 0 0 0-1-1zm0 3h12v8H2zm1 2 2 2-2 2 1 1 3-3-3-3zm5 3.5V12h5v-1.5z\"/></svg>", Aa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#0288d1\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", ja = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#cfd8dc\" d=\"m179.363 121.67-57.623 57.507c-.23.23-.576.346-.806.23l-78.713-21.09c-.346-.115-.577-.345-.577-.576L20.44 79.144c-.115-.345 0-.576.23-.806L78.294 20.83c.23-.23.576-.346.807-.23l78.713 21.09c.345.114.576.345.576.575l21.09 78.597c.23.346.115.577-.115.807zm-77.215-62.58-77.33 20.63c-.115 0-.23.23-.115.345l56.586 56.47c.115.115.346.115.346-.115l20.744-77.215c.115 0-.115-.23-.23-.116z\"/></svg>", Ma = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M30 14v-2h-2V8h-2v4h-2V8h-2v4h-2v2h2v2h-2v2h2v4h2v-4h2v4h2v-4h2v-2h-2v-2Zm-4 2h-2v-2h2Zm-12.437 6A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", Na = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7e57c2\" d=\"M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034\"/><path fill=\"#7e57c2\" d=\"M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z\"/></svg>", Pa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#4fc3f7\" d=\"M16.83 2a1.3 1.3 0 0 0-.916.377l-.013.01L7.323 7.34l8.556 8.55v.005l10.283 10.277 1.96-3.529-7.068-16.96-3.299-3.297A1.3 1.3 0 0 0 16.828 2Z\"/><path fill=\"#01579b\" d=\"m7.343 7.32-4.955 8.565-.01.013a1.297 1.297 0 0 0 .004 1.835l.005.005 4.106 4.107 16.064 6.314 3.632-2.015-.098-.098-.025.002L15.995 15.97h-.012z\"/><path fill=\"#01579b\" d=\"m7.321 7.324 8.753 8.755h.013L26.16 26.156l3.835-.73L30 14.089l-4.049-3.965a6.5 6.5 0 0 0-3.618-1.612l.002-.043L7.323 7.325Z\"/><path fill=\"#64b5f6\" d=\"m7.332 7.335 8.758 8.75v.013l10.079 10.071L25.436 30H14.09l-3.967-4.048a6.5 6.5 0 0 1-1.611-3.618l-.045.004Z\"/></svg>", Fa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M16 24c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-8c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-12C10.477 4 6 4.895 6 6v4c0 1.1 4.475 2 10 2s10-.9 10-2V6c0-1.105-4.477-2-10-2\"/></svg>", Ia = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M18 23H4c-1.1 0-2-.9-2-2V7h2v14h14zM14.5 7V5h-2v2h-2v2h2v2h2V9h2V7zm2 6h-6v2h6zM15 1H8c-1.1 0-1.99.9-1.99 2L6 17c0 1.1.89 2 1.99 2H19c1.1 0 2-.9 2-2V7zm4 16H8V3h6.17L19 7.83z\"/></svg>", La = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#42a5f5\" d=\"M6 2a2 2 0 0 0-2 2v16c0 1.11.89 2 2 2h6v-2H6V4h7v5h5v3h2V8l-6-6m4 12a.26.26 0 0 0-.26.21l-.19 1.32c-.3.13-.59.29-.85.47l-1.24-.5c-.11 0-.24 0-.31.13l-1 1.73c-.06.11-.04.24.06.32l1.06.82a4.2 4.2 0 0 0 0 1l-1.06.82a.26.26 0 0 0-.06.32l1 1.73c.06.13.19.13.31.13l1.24-.5c.26.18.54.35.85.47l.19 1.32c.02.12.12.21.26.21h2c.11 0 .22-.09.24-.21l.19-1.32c.3-.13.57-.29.84-.47l1.23.5c.13 0 .26 0 .33-.13l1-1.73a.26.26 0 0 0-.06-.32l-1.07-.82c.02-.17.04-.33.04-.5s-.01-.33-.04-.5l1.06-.82a.26.26 0 0 0 .06-.32l-1-1.73c-.06-.13-.19-.13-.32-.13l-1.23.5c-.27-.18-.54-.35-.85-.47l-.19-1.32A.236.236 0 0 0 20 14m-1 3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5c-.84 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5\"/></svg>", Ra = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M21.81 10.25c-.06-.04-.56-.43-1.64-.43-.28 0-.56.03-.84.08-.21-1.4-1.38-2.11-1.43-2.14l-.29-.17-.18.27c-.24.36-.43.77-.51 1.19-.2.8-.08 1.56.33 2.21-.49.28-1.29.35-1.46.35H2.62c-.34 0-.62.28-.62.63 0 1.15.18 2.3.58 3.38.45 1.19 1.13 2.07 2 2.61.98.6 2.59.94 4.42.94.79 0 1.61-.07 2.42-.22 1.12-.2 2.2-.59 3.19-1.16A8.3 8.3 0 0 0 16.78 16c1.05-1.17 1.67-2.5 2.12-3.65h.19c1.14 0 1.85-.46 2.24-.85.26-.24.45-.53.59-.87l.08-.24zm-17.96.99h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H3.85c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.43 0h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H6.28c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.47 0h1.75c.1 0 .17-.07.17-.16V9.5c0-.08-.06-.16-.17-.16H8.75c-.08 0-.15.07-.15.16v1.58c0 .09.06.16.15.16m2.44 0h1.77c.08 0 .15-.07.15-.16V9.5c0-.08-.06-.16-.15-.16h-1.77c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16M6.28 9h1.76c.08 0 .16-.09.16-.18V7.25c0-.09-.07-.16-.16-.16H6.28c-.09 0-.16.06-.16.16v1.57c.01.09.07.18.16.18m2.47 0h1.75c.1 0 .17-.09.17-.18V7.25c0-.09-.06-.16-.17-.16H8.75c-.08 0-.15.06-.15.16v1.57c0 .09.06.18.15.18m2.44 0h1.77c.08 0 .15-.09.15-.18V7.25c0-.09-.07-.16-.15-.16h-1.77c-.08 0-.15.06-.15.16v1.57c0 .09.07.18.15.18m0-2.28h1.77c.08 0 .15-.07.15-.16V5c0-.1-.07-.17-.15-.17h-1.77c-.08 0-.15.06-.15.17v1.56c0 .08.07.16.15.16m2.46 4.52h1.76c.09 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16h-1.76c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16\"/></svg>", za = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 16h8v2H8zm0-4h8v2H8zm6-10H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm4 18H6V4h7v5h5z\"/></svg>", Ba = "<svg xmlns=\"http://www.w3.org/2000/svg\" clip-rule=\"evenodd\" image-rendering=\"optimizeQuality\" shape-rendering=\"geometricPrecision\" text-rendering=\"geometricPrecision\" viewBox=\"0 0 3473 3473\"><path fill=\"#ede7f6\" d=\"M989.342 1977.409c41.146-26.835 75.137-93.922 54.564-141.33-56.353 24.151-53.67 79.61-54.564 141.33m636.877 153.851c44.724-14.311 87.66-64.402 63.509-116.283-34.886 24.151-57.248 57.247-63.51 116.284z\"/><g fill=\"#fafafa\"><path d=\"M374.827 2871.899c0 56.352 14.312 117.178 53.67 138.645 144.907 81.4 652.977 17.89 825.614-20.573 90.343-20.573 163.692-87.66 248.668-124.334 191.421-83.187 330.067-150.274 483.025-262.085 110.916-81.399 287.131-310.388 305.915-447.245l-151.169-33.991c-3.578 153.852-38.463 188.737-175.32 224.517-92.132 25.046-271.925 30.413-365.846 14.312-124.334-20.574-180.687-85.871-237.04-160.114-109.128-144.907 24.151-245.985-148.485-255.824-181.582 222.728-501.81 62.614-642.244 40.252-59.93 86.765-200.366 650.294-198.577 779.1 86.766-29.517 141.33 2.684 219.15 33.097 275.503 106.444 34.885 200.366-75.137 172.636-75.137-17.89-98.394-67.086-142.224-98.393m360.48-1285.383c111.81 21.468 211.1 67.982 305.915 115.39 154.747 76.926 182.476 66.192 196.788 173.53 1.789 19.68-1.789 30.413 54.564 48.303 94.816 29.518-54.564-23.257 199.471-22.362 151.169.894 497.337 61.72 609.148 132.384 46.513 29.519 37.568 67.087 194.999 62.615-1.79-185.16-50.986-461.557-123.44-631.51-88.554-205.733-205.733-237.04-444.561-313.966-139.54-44.725-549.217-93.922-676.235-15.207-118.967 74.243-141.33 162.798-252.246 318.439-32.202 45.619-43.83 80.504-64.403 132.384\"/><path d=\"M1720.14 1966.675c89.45 36.674-4.472 273.714-128.806 216.466-40.252-113.6 55.458-178.003 81.398-228.99-53.67-8.05-206.627-32.2-252.246-15.206-59.036 22.363-72.454 148.486-42.041 207.522 143.118 280.87 775.523 220.94 708.436 2.684-26.835-88.555-51.88-102.867-142.224-133.28-72.454-24.15-144.907-49.196-224.517-49.196m-1124.374-31.307c71.56 68.875 233.462 79.61 338.117 84.976 13.418-138.646 25.046-242.407 135.963-234.356 54.564 74.242 25.94 161.902-31.307 218.255 97.5-.894 153.852-74.242 139.54-180.687-82.293-59.036-331.856-177.109-457.084-194.104-34.885 37.569-120.756 243.301-125.229 305.916\"/></g><path d=\"M427.602 2820.913c59.036-5.367 212.889 39.357 225.412 89.449-95.71 11.628-217.361 2.683-225.412-89.45zm-52.775 50.986c43.83 31.307 67.087 80.504 142.224 98.393 110.022 27.73 350.64-66.192 75.137-172.636-77.82-30.413-132.384-62.614-219.15-33.096-1.789-128.807 138.646-692.336 198.577-779.101 140.435 22.362 460.662 182.476 642.244-40.252 172.636 9.84 39.357 110.917 148.485 255.824 56.353 74.243 112.706 139.54 237.04 160.114 93.921 16.1 273.714 10.734 365.846-14.312 136.857-35.78 171.742-70.665 175.32-224.517l151.17 33.99c-18.785 136.858-195 365.847-305.916 447.246-152.958 111.81-291.604 178.898-483.025 262.085-84.976 36.674-158.325 103.761-248.668 124.334-172.637 38.463-680.707 101.972-825.614 20.574-39.358-21.468-53.67-82.294-53.67-138.646M1626.22 2131.26c6.261-59.037 28.623-92.133 63.508-116.284 24.152 51.88-18.784 101.972-63.508 116.284m93.921-164.586c79.61 0 152.063 25.045 224.517 49.197 90.344 30.412 115.39 44.724 142.224 133.279 67.087 218.255-565.318 278.186-708.436-2.684-30.413-59.036-16.995-185.16 42.041-207.522 45.619-16.995 198.577 7.156 252.246 15.207-25.94 50.986-121.65 115.389-81.398 228.99 124.334 57.247 218.255-179.793 128.806-216.467m-730.798 10.734c.894-61.72-1.79-117.179 54.564-141.33 20.573 47.408-13.418 114.495-54.564 141.33m-393.576-42.041c4.473-62.615 90.344-268.347 125.229-305.916 125.228 16.995 374.791 135.068 457.084 194.104 14.312 106.445-42.04 179.793-139.54 180.687 57.247-56.353 85.87-144.013 31.307-218.255-110.917-8.05-122.545 95.71-135.963 234.356-104.655-5.367-266.558-16.1-338.117-84.976m-89.449-71.56c-33.096-91.238-33.096-233.462 107.339-245.09l-71.56 199.471c-18.783 42.936-18.783 33.096-35.779 45.62zm228.99-277.292c20.573-51.88 32.201-86.765 64.403-132.384 110.917-155.641 133.279-244.196 252.246-318.439 127.018-78.715 536.694-29.518 676.235 15.207 238.828 76.926 356.007 108.233 444.561 313.966 72.454 169.953 121.65 446.35 123.44 631.51-157.43 4.472-148.486-33.096-195-62.615-111.81-70.664-457.978-131.49-609.147-132.384-254.035-.895-104.655 51.88-199.471 22.362-56.353-17.89-52.775-28.624-54.564-48.302-14.312-107.34-42.041-96.605-196.788-173.531-94.816-47.408-194.104-93.922-305.915-115.39m1583.247-43.83c-16.995-56.352 14.312-52.775 68.876-91.238 31.307-22.362 56.353-45.619 94.816-67.086 144.013-80.504 412.36-93.922 526.854 1.789 46.514 38.463 122.545 113.6 110.917 211.994-24.151 195.893-158.325 303.232-268.347 392.68-111.811 91.239-297.865 185.16-490.18 122.546-16.101-39.358-3.578-288.92-22.363-381.053-16.995-82.293-8.05-91.238 39.358-140.435 139.54-144.907 441.878-250.457 613.62-126.123 72.454 53.67 51.88 74.243 89.449 115.39 46.513-50.092-40.252-218.256-360.48-207.522-217.36 7.156-311.282 177.109-402.52 169.058m-1302.377-508.964c4.472-124.335 118.967-381.948 233.461-471.397 138.646-107.338 283.554-208.416 496.442-87.66 52.775 29.519 50.092 44.725 55.459 118.073 4.472 70.665-1.79 96.605-19.679 153.852-141.33 456.19-259.402 194.105-712.014 302.338 16.995-148.485 145.802-280.87 217.361-349.746 122.545-118.967 211.1-195.893 395.365-170.847 50.986 84.976 56.352 138.646-5.367 237.934-82.293 132.385-102.867 124.334-90.344 214.678 64.403-16.101 84.082-78.715 113.6-141.33 179.793-375.686-81.398-421.305-241.512-352.429-107.339 45.62-298.76 256.719-361.374 383.736-12.523 25.046-25.94 57.248-37.568 84.977zm708.436 18.784c18.784-111.811 129.7-139.54 129.7-483.92 0-148.485-182.475-281.764-421.304-182.475-204.838 84.082-236.145 148.485-345.273 313.071-102.867 155.642-99.289 326.49-187.843 470.502-25.94 41.147-49.197 55.458-77.82 96.605-20.574 30.413-35.78 68.876-56.354 104.655-42.04 68.876-84.976 118.968-118.967 201.26-107.339 2.684-197.682 4.473-208.416 115.39-14.312 152.063 57.247 189.632 57.247 246.879-.894 61.72-251.351 684.285-181.581 1055.498 19.679 101.972 86.765 102.867 194.104 115.39 258.508 31.307 593.942 20.573 825.614-72.454l420.41-201.26c106.445-59.931 285.343-173.532 364.953-256.72 56.353-58.141 85.87-107.338 134.173-176.214 66.192-96.605 67.981-94.816 82.293-226.306 87.66 16.101 251.352 54.564 305.916 101.972-6.262 61.72-36.674 32.202-36.674 87.66 34.885.895 93.027-42.935 107.339-91.238-36.675-53.67-75.138-44.724-127.913-87.66 42.042-33.096 118.073-48.302 176.215-72.453 125.229-51.88 339.012-209.311 391.787-352.43 42.04-115.389 10.734-307.704-57.248-382.841-71.559-78.715-237.934-118.967-373.897-118.967-161.902 0-329.172 116.283-459.767 166.375-50.092-43.83-53.67-93.922-90.344-142.224-42.04-57.248-315.755-200.366-446.35-228.095\"/><path fill=\"#efebe9\" d=\"M2318.554 1542.686c91.238 8.05 185.16-161.902 402.52-169.058 320.228-10.734 406.993 157.43 360.48 207.521-37.569-41.146-16.995-61.72-89.45-115.389-171.741-124.334-474.079-18.784-613.62 126.123-47.407 49.197-56.352 58.142-39.357 140.435 18.785 92.133 6.262 341.695 22.362 381.053 192.316 62.614 378.37-31.307 490.181-122.545 110.022-89.45 244.196-196.788 268.347-392.681 11.628-98.394-64.403-173.531-110.917-211.994-114.494-95.71-382.841-82.293-526.854-1.79-38.463 21.468-63.51 44.725-94.816 67.087-54.564 38.464-85.871 34.886-68.876 91.238m-1302.377-508.964 43.83-77.821c11.628-27.73 25.045-59.93 37.568-84.977 62.614-127.017 254.035-338.117 361.374-383.736 160.114-68.876 421.305-23.257 241.512 352.43-29.518 62.614-49.197 125.228-113.6 141.329-12.523-90.344 8.05-82.293 90.344-214.678 61.72-99.288 56.353-152.958 5.367-237.934-184.265-25.046-272.82 51.88-395.365 170.847-71.56 68.876-200.366 201.26-217.361 349.746 452.612-108.233 570.685 153.852 712.014-302.338 17.89-57.247 24.151-83.187 19.679-153.852-5.367-73.348-2.684-88.554-55.459-118.073-212.888-120.756-357.796-19.678-496.442 87.66-114.494 89.45-228.989 347.062-233.461 471.397\"/><path fill=\"#eee\" d=\"M506.317 1863.808c16.996-12.523 16.996-2.683 35.78-45.619l71.559-199.47c-140.435 11.627-140.435 153.851-107.339 245.09z\"/><path fill=\"#efebe9\" d=\"M653.014 2910.362c-12.523-50.092-166.376-94.816-225.412-89.45 8.05 92.133 129.701 101.078 225.412 89.45\"/></svg>", Va = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#9575cd\" d=\"M12.173 22.681c-3.86 0-6.99-3.64-6.99-8.13 0-3.678 2.773-8.172 4.916-10.91 1.014-1.296 2.93-2.322 2.93-2.322s-.982 5.239 1.683 7.319c2.366 1.847 4.106 4.25 4.106 6.363 0 4.232-2.784 7.68-6.645 7.68\"/></svg>", Ha = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 323 323\"><path fill=\"#ffb300\" d=\"m106.716 99.763 54.785 54.782 54.779-54.782z\"/><path fill=\"#64dd17\" d=\"M96.881 89.93H216.83l-55.18-55.184H41.7zm131.546 11.593 59.705 59.704L228.16 221.2l-59.705-59.704z\"/><path fill=\"#00b8d4\" d=\"m175.552 34.746 112.703 112.695V34.746z\"/><path fill=\"#455a64\" d=\"m34.746 281.3 119.8-119.8-119.8-119.8z\"/><path fill=\"#ffb300\" d=\"m288.255 175.01-53.148 53.149 53.148 53.14z\"/><path fill=\"#00b8d4\" d=\"M281.3 288.254 161.5 168.455l-119.8 119.8z\"/></svg>", Ua = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 30 30\"><path fill=\"#f44336\" d=\"M5.207 4.33q-.072.075-.143.153Q1.5 8.476 1.5 15.33c0 4.418 1.155 7.862 3.459 10.34h19.415c2.553-1.152 4.127-3.43 4.127-3.43l-3.147-2.52L23.9 21.1c-.867.773-.845.931-2.315 1.78-1.495.674-3.04.966-4.634.966-2.515 0-4.423-.909-5.723-2.059-1.286-1.15-1.985-4.511-2.096-6.68l17.458.067-.183-1.472s-.847-7.129-2.541-9.372zm8.76.846c1.565 0 3.22.535 3.961 1.471.74.937.931 1.667.973 3.524H9.11c.112-1.955.436-2.81 1.373-3.698.936-.887 2.03-1.297 3.484-1.297\"/></svg>", Wa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#3f51b5\" d=\"M22.713 4H9.287a.5.5 0 0 0-.432.248l-6.708 11.5a.5.5 0 0 0 0 .504l6.708 11.5a.5.5 0 0 0 .432.248h13.426a.5.5 0 0 0 .432-.248l6.708-11.5a.5.5 0 0 0 0-.504l-6.708-11.5A.5.5 0 0 0 22.713 4m-6.937 20.888-7.5-3.75A.5.5 0 0 1 8 20.691v-9.382a.5.5 0 0 1 .276-.447l7.5-3.75a.5.5 0 0 1 .448 0l7.5 3.75a.5.5 0 0 1 .276.447v9.382a.5.5 0 0 1-.276.447l-7.5 3.75a.5.5 0 0 1-.448 0\"/><path fill=\"#7986cb\" d=\"M22 19.441v-6.882a.5.5 0 0 0-.276-.447l-5.5-2.75a.5.5 0 0 0-.448 0l-5.5 2.75a.5.5 0 0 0-.276.447v6.882a.5.5 0 0 0 .276.447l5.5 2.75a.5.5 0 0 0 .448 0l5.5-2.75a.5.5 0 0 0 .276-.447\"/></svg>", Ga = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M28 4H4a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 22H4V10h24Z\"/></svg>", Ka = "<svg viewBox=\"0 0 16 16\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"m8.668 6h3.6641l-3.6641-3.668v3.668m-4.668-4.668h5.332l4 4v8c0 0.73828-0.59375 1.3359-1.332 1.3359h-8c-0.73828 0-1.332-0.59766-1.332-1.3359v-10.664c0-0.74219 0.59375-1.3359 1.332-1.3359m3.332 1.3359h-3.332v10.664h8v-6h-4.668z\" fill=\"#90a4ae\" /></svg>", qa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M24 28h4L18 4h-4L4 28h4l8-19.422\"/><path fill=\"#f44336\" d=\"M8 20h16v4H8z\"/></svg>", Ja = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><path fill=\"#0288d1\" d=\"m236.249 36.066-213.94 213.94 213.94 213.94v-84.36l-129.7-129.7 129.7-129.7z\"/><path fill=\"#0288d1\" d=\"m236.249 156.017-93.622 93.62 93.622 93.622z\"/><path fill=\"#00b8d4\" d=\"m263.759 36.047 213.94 213.94-213.94 213.94v-84.36l129.7-129.7-129.7-129.7z\"/></svg>", Ya = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M13.172 2.828 11.78 4.22l1.91 1.91 2 2A2.986 2.986 0 0 1 20 10.81a3.25 3.25 0 0 1-.31 1.31l2.06 2a2.68 2.68 0 0 1 3.37.57 2.86 2.86 0 0 1 .88 2.117 3.02 3.02 0 0 1-.856 2.109A2.9 2.9 0 0 1 23 19.81a2.93 2.93 0 0 1-2.13-.87 2.694 2.694 0 0 1-.56-3.38l-2-2.06a3 3 0 0 1-.31.12V20a3 3 0 0 1 1.44 1.09 2.92 2.92 0 0 1 .56 1.72 2.88 2.88 0 0 1-.878 2.128 2.98 2.98 0 0 1-2.048.871 2.981 2.981 0 0 1-2.514-4.719A3 3 0 0 1 16 20v-6.38a2.96 2.96 0 0 1-1.44-1.09 2.9 2.9 0 0 1-.56-1.72 2.9 2.9 0 0 1 .31-1.31l-3.9-3.9-7.579 7.572a4 4 0 0 0-.001 5.658l10.342 10.342a4 4 0 0 0 5.656 0l10.344-10.344a4 4 0 0 0 0-5.656L18.828 2.828a4 4 0 0 0-5.656 0\"/></svg>", Xa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#78909c\" d=\"M26 18h-6a2 2 0 0 0-2 2v2h-6a2 2 0 0 1-2-2v-6h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2v6a4 4 0 0 0 4 4h6v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2M6.5 12a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5ZM26 25.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5Z\"/></svg>", Za = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"m29.532 13.083-.037-.105-3.811-10.322a1 1 0 0 0-.392-.49.985.985 0 0 0-1.39.316 1 1 0 0 0-.122.28L21.208 10H10.792L8.22 2.762a1.004 1.004 0 0 0-1.246-.721 1 1 0 0 0-.266.124 1 1 0 0 0-.392.491L2.507 12.98l-.04.103a7.52 7.52 0 0 0 2.348 8.491l.015.012.032.026 5.797 4.511 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257 5.838-4.537.016-.013a7.52 7.52 0 0 0 2.35-8.49Z\"/><path fill=\"#ef6c00\" d=\"m29.532 13.083-.037-.105a12.6 12.6 0 0 0-5.123 2.394l-8.367 6.57 5.327 4.181 5.839-4.537.016-.013a7.52 7.52 0 0 0 2.345-8.49\"/><path fill=\"#f9a825\" d=\"m10.659 26.123 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257L16 21.943Z\"/><path fill=\"#ef6c00\" d=\"M7.628 15.371a12.6 12.6 0 0 0-5.12-2.39l-.04.102a7.52 7.52 0 0 0 2.347 8.491l.015.012.032.026 5.797 4.511 5.331-4.18Z\"/></svg>", Qa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#ec407a\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", $a = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00acc1\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#00acc1\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", eo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M16 10v2h6c-2 0-3-2-6-2\"/><path fill=\"#0097a7\" d=\"M26 4h-2a4 4 0 0 0-4 4h4a1 1 0 0 1 2 0v4H16v-2h-5.317A2.683 2.683 0 0 0 8 12.683v2.634A2.683 2.683 0 0 0 10.683 18H16v2h-5.98A4.02 4.02 0 0 1 6 16v-2c-2 0-4 4-4 8 0 5 1 6 2 6h4v-4h4v4h4v-4h4v4h4v-6a2 2 0 0 0 2-2v-2a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4m-4 12h-2a2 2 0 0 1-2-2h6a2 2 0 0 1-2 2\"/></svg>", to = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M6 20h20v2H6z\"/><circle cx=\"7\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"27\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 10h20v2H6z\"/><circle cx=\"7\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"5\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 12h2v10H6zm18-2h2v12h-2z\"/><path fill=\"#ec407a\" d=\"m5.014 19.41 11.674 6.866L15.674 28 4 21.134z\"/><path fill=\"#ec407a\" d=\"M26.688 21.724 15.014 28.59 14 26.866 25.674 20zM5.124 10.382l11.415-7.29 1.077 1.686L6.2 12.068z\"/><path fill=\"#ec407a\" d=\"m25.798 12.067-11.415-7.29 1.077-1.685 11.415 7.29zM6.2 19.932l11.416 7.29-1.077 1.686-11.415-7.29z\"/><path fill=\"#ec407a\" d=\"m26.875 21.619-11.415 7.29-1.077-1.687 11.415-7.289zM5.877 22.6 16.04 3.686l1.762.946L7.638 23.546z\"/><path fill=\"#ec407a\" d=\"M24.361 23.545 14.197 4.633l1.761-.947 10.165 18.913z\"/></svg>", no = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26c6da\" d=\"M19.322 2a6.5 6.5 0 0 1 4.352 1.419 4.55 4.55 0 0 1 1.685 3.662 5.82 5.82 0 0 1-1.886 4.275 6.04 6.04 0 0 1-4.34 1.846 4.15 4.15 0 0 1-2.385-.649 1.91 1.91 0 0 1-.936-1.603 1.6 1.6 0 0 1 .356-1.024 1.1 1.1 0 0 1 .861-.447q.469 0 .468.504a.79.79 0 0 0 .358.693 1.43 1.43 0 0 0 .826.245 3.1 3.1 0 0 0 2.39-1.573 5.66 5.66 0 0 0 1.154-3.39 2.64 2.64 0 0 0-.891-2.064 3.28 3.28 0 0 0-2.293-.812 6.18 6.18 0 0 0-4.086 1.736 12.9 12.9 0 0 0-3.215 4.557 13.4 13.4 0 0 0-1.233 5.36 5.86 5.86 0 0 0 1.091 3.723 3.53 3.53 0 0 0 2.905 1.372q3.058 0 5.848-4.002l2.935-.388q.546-.07.545.246a8 8 0 0 1-.423 1.24q-.421 1.097-1.152 3.668A12.7 12.7 0 0 0 26 17.72v1.66a14.2 14.2 0 0 1-4.055 2.57 10.38 10.38 0 0 1-2.764 5.931 6.7 6.7 0 0 1-4.806 2.11 3.3 3.3 0 0 1-2.012-.55 1.8 1.8 0 0 1-.718-1.514q0-2.685 5.634-5.212.532-1.766 1.152-3.507a8.6 8.6 0 0 1-2.853 2.323 7.4 7.4 0 0 1-3.48 1.01 5.46 5.46 0 0 1-4.366-2.093A8.1 8.1 0 0 1 6 15.122a11.6 11.6 0 0 1 1.966-6.426 14.7 14.7 0 0 1 5.162-4.862A12.44 12.44 0 0 1 19.322 2m-2.407 22.17q-4.055 1.875-4.054 3.695a.87.87 0 0 0 .999.97q1.964 0 3.055-4.665\"/></svg>", ro = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M18.5 11a5.49 5.49 0 0 0-4.5 2.344V4H8v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", io = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"M12.023 12a4 4 0 0 0-3.94 3.182 1 1 0 0 1-.972.818H5.229C4.446 16 4 15.552 4 15v-1H3a1 1 0 0 0-1 1v1c0 3.866 3.134 6 7 6 3.425 0 6.275-1.675 6.881-4.745.545-2.764-1.041-5.24-3.858-5.255\"/><path fill=\"#ff7043\" d=\"M29 14h-1v1c0 .552-.446 1-1.229 1H24.89a1 1 0 0 1-.973-.818A4 4 0 0 0 19.977 12c-2.817.016-4.403 2.491-3.858 5.255C16.725 20.325 19.575 22 23 22c3.866 0 7-2.134 7-6v-1a1 1 0 0 0-1-1\"/></svg>", ao = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g stroke-width=\"2.422\"><path fill=\"#ef5350\" d=\"m23.928 240.5 59.94-89.852-59.94-89.855h44.955l59.94 89.855-59.94 89.852z\"/><path fill=\"#ffa726\" d=\"m83.869 240.5 59.94-89.852-59.94-89.855h44.955l119.88 179.71h-44.95l-37.46-56.156-37.468 56.156z\"/><path fill=\"#ffee58\" d=\"m228.72 188.08-19.98-29.953h69.93v29.956h-49.95zm-29.97-44.924-19.98-29.953h99.901v29.953z\"/></g></svg>", oo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#eceff1\" d=\"M18 1.2V14h-4v-4l-4 2v16.37l4 2.43V18h4v4l4-2V3.63z\"/><path fill=\"#eceff1\" d=\"M14 1.2 2 8.49v15.02l4 2.43v-15.2l8-4.86zm12 4.86v15.2l-8 4.86v4.68l12-7.29V8.49z\"/></svg>", so = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M4 8v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2m4 14V10h4v12Zm11.999-6L18 18.001 21 21l-3 3.001L19.999 26l3.003-3 3 2.999L28 24l-3-2.999 3-3L26.001 16l-3 3z\"/></svg>", co = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 6V2h-2v4h-6V2h-2v4h-4v2h4v4h2V8h6v4h2V8h4V6zm-15.5 5A5.49 5.49 0 0 0 8 13.344V4H2v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", lo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e65100\" d=\"m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z\"/></svg>", uo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#26a69a\" d=\"M8.5 6h4l-4-4zM3.875 1H9.5l4 4v8.6c0 .773-.616 1.4-1.375 1.4h-8.25c-.76 0-1.375-.627-1.375-1.4V2.4c0-.777.612-1.4 1.375-1.4M4 13.6h8V8l-2.625 2.8L8 9.4zm1.25-7.7c-.76 0-1.375.627-1.375 1.4s.616 1.4 1.375 1.4c.76 0 1.375-.627 1.375-1.4S6.009 5.9 5.25 5.9\"/></svg>", fo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M22 10h2v4h-2z\"/><path fill=\"#f44336\" d=\"M28 2H4a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2m-2 12a2 2 0 0 1-2 2h-2v4a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V8h18a2 2 0 0 1 2 2Z\"/></svg>", po = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", mo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#1e88e5\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", ho = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ffca28\" d=\"M2 2v12h12V2zm6 6h1v4a1.003 1.003 0 0 1-1 1H7a1.003 1.003 0 0 1-1-1v-1h1v1h1zm3 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", go = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path fill=\"#f9a825\" d=\"M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z\"/></svg>", _o = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 50 50\"><g transform=\"translate(.21 -247.01)\"><circle cx=\"13.497\" cy=\"281.63\" r=\"9.555\" fill=\"#c62828\"/><circle cx=\"36.081\" cy=\"281.63\" r=\"9.555\" fill=\"#7e57c2\"/><circle cx=\"24.722\" cy=\"262.39\" r=\"9.555\" fill=\"#388e3c\"/></g></svg>", vo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f57c00\" d=\"M6.2 18a22.7 22.7 0 0 0 9.8 2 22.7 22.7 0 0 0 9.8-2 10.002 10.002 0 0 1-19.6 0m19.6-4a22.7 22.7 0 0 0-9.8-2 22.7 22.7 0 0 0-9.8 2 10.002 10.002 0 0 1 19.6 0\"/><circle cx=\"27\" cy=\"5\" r=\"3\" fill=\"#757575\"/><circle cx=\"5\" cy=\"27\" r=\"3\" fill=\"#9e9e9e\"/><circle cx=\"5\" cy=\"5\" r=\"3\" fill=\"#616161\"/></svg>", yo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M30 14H17.738a8 8 0 1 0 0 4H24v4h4v-4h2Zm-20 5a3 3 0 1 1 3-3 3.003 3.003 0 0 1-3 3\"/></svg>", bo = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\"1.725\" x2=\"22.185\" y1=\"22.67\" y2=\"1.982\" gradientTransform=\"translate(1.306 1.129)scale(.89324)\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#7c4dff\"/><stop offset=\".5\" stop-color=\"#d500f9\"/><stop offset=\"1\" stop-color=\"#ef5350\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M2.975 2.976v18.048h18.05v-.03l-4.478-4.511-4.48-4.515 4.48-4.515 4.443-4.477z\"/></svg>", xo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#448aff\" d=\"M12.074 1.424a.638.638 0 0 0-.686.691v.173c.015.2.044.402.087.588.058.358.085.73.07 1.102a.65.65 0 0 1-.201.33l-.014.258a7 7 0 0 0-1.117.17 7.9 7.9 0 0 0-4.012 2.292l-.213-.157a.56.56 0 0 1-.374-.042 6 6 0 0 1-.829-.747c-.129-.143-.26-.299-.403-.428l-.128-.1a.8.8 0 0 0-.431-.171c-.2 0-.372.07-.501.212-.2.301-.127.675.16.904l.013.014c.03.029.087.072.115.1q.258.172.515.3c.33.186.631.403.918.647a.63.63 0 0 1 .114.358l.2.17a7.82 7.82 0 0 0-1.232 5.546l-.271.07a.84.84 0 0 1-.275.274c-.358.086-.73.17-1.102.17-.186 0-.387 0-.588.057l-.156.03h-.014v.015c-.043 0-.086.014-.115.014a.62.62 0 0 0-.4.789.625.625 0 0 0 .772.386 1 1 0 0 0 .188-.045c.186-.057.37-.127.528-.213a7.4 7.4 0 0 1 1.103-.316c.114 0 .244.057.33.129l.285-.042a8.04 8.04 0 0 0 3.54 4.426l-.1.258a.8.8 0 0 1 .044.358c-.143.344-.33.687-.56.987-.114.172-.215.33-.344.501 0 .043.001.117-.056.16-.014.043-.044.072-.059.114a.615.615 0 0 0 .372.787.62.62 0 0 0 .79-.372c.028-.043.055-.143.083-.143.072-.2.131-.387.174-.574a5.4 5.4 0 0 1 .473-1.102.5.5 0 0 1 .271-.129l.143-.257c1.82.702 3.84.701 5.688.014l.115.23a.53.53 0 0 1 .3.198c.186.33.301.674.43 1.032.043.187.102.373.174.588.028 0 .055.086.084.129.014.043.03.071.044.114a.61.61 0 0 0 .845.216.614.614 0 0 0 .213-.845c-.014-.057-.056-.13-.056-.174-.115-.157-.23-.329-.344-.486-.215-.316-.371-.63-.543-.974a.48.48 0 0 1 .042-.372 1.2 1.2 0 0 1-.1-.244c1.661-1.002 2.951-2.577 3.539-4.454.086.014.17.028.271.042.086-.115.201-.115.33-.115.387.057.73.16 1.103.302q.235.128.514.213c.058.014.116.03.202.03v.015c0 .014.058.013.1.028.344.043.617-.202.689-.532a.617.617 0 0 0-.532-.7c-.057-.014-.127-.03-.17-.072h-.588a7 7 0 0 1-1.102-.202.6.6 0 0 1-.274-.257l-.272-.07a7.8 7.8 0 0 0-1.262-5.531l.23-.2a.44.44 0 0 1 .114-.343c.273-.244.589-.46.918-.647a3.6 3.6 0 0 0 .5-.3 1 1 0 0 0 .13-.1c.043-.028.086-.058.086-.087.258-.243.273-.63 0-.859-.214-.257-.601-.257-.845 0-.043 0-.1.059-.142.087a11 11 0 0 0-.403.428c-.244.272-.53.532-.831.747a.55.55 0 0 1-.372.042l-.23.171a7.98 7.98 0 0 0-5.098-2.462l-.014-.274a.5.5 0 0 1-.201-.314 5.6 5.6 0 0 1 .07-1.102 4 4 0 0 0 .087-.588v-.316a.62.62 0 0 0-.546-.548m-.842 4.773-.174 3.223h-.014a.56.56 0 0 1-.114.302.543.543 0 0 1-.745.13h-.014L7.536 7.973a6.23 6.23 0 0 1 3.035-1.662c.23-.043.446-.086.66-.115zm1.544 0a6.38 6.38 0 0 1 3.682 1.777L13.837 9.85h-.014a.66.66 0 0 1-.3.073.535.535 0 0 1-.56-.518zm-6.2 2.938 2.406 2.19v.015c.086.071.157.16.157.274a.523.523 0 0 1-.372.657v.014l-3.095.89a6.4 6.4 0 0 1 .904-4.04m10.842.042c.73 1.189 1.032 2.595.932 3.984l-3.109-.89-.014-.014a.5.5 0 0 1-.257-.17.53.53 0 0 1 .056-.761l-.014-.042zm-5.915 2.322h.988l.615.758-.215.96-.887.431-.887-.43-.23-.96zm-2.308 2.65h.115c.243 0 .46.17.545.414 0 .1.001.23-.056.302v.042l-1.22 2.966a6.33 6.33 0 0 1-2.563-3.195zm5.274 0h.344l3.193.515a6.34 6.34 0 0 1-2.563 3.223l-1.234-3.022c-.115-.258.002-.558.26-.716m-2.521 1.298a.55.55 0 0 1 .529.277h.014l1.561 2.823a5 5 0 0 1-.615.171 6.4 6.4 0 0 1-3.481-.17l1.561-2.824h.014c.043-.1.115-.144.216-.215a.5.5 0 0 1 .201-.062\"/></svg>", So = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0277bd\" d=\"M8 3a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2H3v2h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2v-2H8v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V5h2V3m6 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3z\"/></svg>", Co = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M8 1a5.5 5.5 0 0 0-4 9.26V15l4-1.5 4 1.5v-4.74A5.49 5.49 0 0 0 8 1m0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4\"/></svg>", wo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffd54f\" d=\"M25 12h-3V8a6 6 0 0 0-12 0v4H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V13a1 1 0 0 0-1-1M14 8a2 2 0 0 1 4 0v4h-4Zm2 17a4 4 0 1 1 4-4 4 4 0 0 1-4 4\"/></svg>", To = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#afb42b\" d=\"M19 5v9h-5v5H5V5zm0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10l6-6V5c0-1.1-.9-2-2-2m-7 11H7v-2h5zm5-4H7V8h10z\"/></svg>", Eo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"M30 6a3.86 3.86 0 0 1-1.167 2.833 4.024 4.024 0 0 1-5.666 0A3.86 3.86 0 0 1 22 6a3.86 3.86 0 0 1 1.167-2.833 4.024 4.024 0 0 1 5.666 0A3.86 3.86 0 0 1 30 6m-9.208 5.208A10.6 10.6 0 0 0 13 8a10.6 10.6 0 0 0-7.792 3.208A10.6 10.6 0 0 0 2 19a10.6 10.6 0 0 0 3.208 7.792A10.6 10.6 0 0 0 13 30a10.6 10.6 0 0 0 7.792-3.208A10.6 10.6 0 0 0 24 19a10.6 10.6 0 0 0-3.208-7.792m-1.959 7.625a4.024 4.024 0 0 1-5.666 0 4.024 4.024 0 0 1 0-5.666 4.024 4.024 0 0 1 5.666 0 4.024 4.024 0 0 1 0 5.666\"/></svg>", Do = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"m29.5 24.02-1.6-.92a4.4 4.4 0 0 0 .09-.9A1.3 1.3 0 0 0 28 22a5.6 5.6 0 0 0-.1-1.1l1.6-.92a.493.493 0 0 0 .18-.68l-1.5-2.6a.45.45 0 0 0-.18-.18V6.01a2.006 2.006 0 0 0-2-2H4a2.006 2.006 0 0 0-2 2V22a2.006 2.006 0 0 0 2 2h10.53l-.03.02a.493.493 0 0 0-.18.68l1.5 2.6a.493.493 0 0 0 .68.18l1.6-.92a5.9 5.9 0 0 0 1.9 1.09v1.85a.495.495 0 0 0 .5.5h3a.495.495 0 0 0 .5-.5v-1.85a5.9 5.9 0 0 0 1.9-1.09l1.6.92a.493.493 0 0 0 .68-.18l1.5-2.6a.493.493 0 0 0-.18-.68M24 22.01a1.99 1.99 0 0 1-.88 1.65l-.18.11a2.04 2.04 0 0 1-1.88 0l-.18-.11a1.99 1.99 0 0 1-.88-1.65V22a2 2 0 0 1 .88-1.66l.18-.11a2.04 2.04 0 0 1 1.88 0l.18.11A2 2 0 0 1 24 22Zm2-4.63-.1.06a5.9 5.9 0 0 0-1.9-1.09V14.5a.495.495 0 0 0-.5-.5h-3a.495.495 0 0 0-.5.5v1.85a5.9 5.9 0 0 0-1.9 1.09l-1.6-.92a.493.493 0 0 0-.68.18l-1.5 2.6a.493.493 0 0 0 .18.68l1.6.92A5.6 5.6 0 0 0 16 22v.01L4 22V10.01h22Z\"/></svg>", Oo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", ko = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\".125\" x2=\"0\" y1=\"1\" y2=\"0\"><stop offset=\"0%\" stop-color=\"#ab47bc\"/><stop offset=\"37.5%\" stop-color=\"#ab47bc\"/><stop offset=\"37.501%\" stop-color=\"#d32f2f\"/><stop offset=\"54.25%\" stop-color=\"#d32f2f\"/><stop offset=\"54.251%\" stop-color=\"#ff7043\"/><stop offset=\"69.75%\" stop-color=\"#ff7043\"/><stop offset=\"69.751%\" stop-color=\"#ffa726\"/><stop offset=\"100%\" stop-color=\"#ffa726\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M22 2s-7.64-.37-13.66 7.88C3.72 16.21 2 22 2 22l1.94-1c1.44-2.5 2.19-3.53 3.6-5 2.53.74 5.17.65 7.46-2-2-.56-3.6-.43-5.96-.19C11.69 12 13.5 11.6 16 12l1-2c-1.8-.34-3-.37-4.78.04C14.19 8.65 15.56 7.87 18 8l1.11-1.73c-1.53-.06-2.4-.02-4.19.3 1.61-1.46 3.08-2.12 5.22-2.25 0 0 1.05-1.89 1.86-2.32\"/></svg>", Ao = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", jo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M16 0 2 8v16l14 8 14-8V8Zm8 23a1 1 0 0 1-1 1h-2.52a1 1 0 0 1-.78-.375L12 14v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2.52a1 1 0 0 1 .78.375L20 18V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1Z\"/></svg>", Mo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M6 24h20v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM30 6l-9 9-5-11-5 11-9-9 4 14h20z\"/></svg>", No = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><g stroke-width=\".395\"><path fill=\"#1976d2\" d=\"M133.347 451.499c0-.295-2.752-5.283-6.116-11.084s-6.116-10.776-6.116-11.055 9.514-16.889 21.143-36.912c11.629-20.022 21.323-36.798 21.542-37.279.346-.76-1.608-4.363-14.896-27.466-8.412-14.625-15.294-26.785-15.294-27.023 0-.5 24.46-43.501 25.206-44.31.414-.45.592-.384 1.078.395.32.513 16.876 29.256 36.791 63.87 62.62 108.85 74.852 130.01 75.41 130.46.3.242.544.554.544.694s-11.836.21-26.302.154c-23.023-.09-26.313-.175-26.393-.694-.11-.714-27.662-48.825-28.86-50.392-.746-.978-.906-1.035-1.426-.51-.688.696-28.954 49.323-29.49 50.733l-.364.96h-13.23c-10.895 0-13.228-.095-13.228-.538zm167.58-125.61c-.134-.216 1.189-2.863 2.939-5.882 6.924-11.944 84.29-145.75 96.49-166.88 7.143-12.371 13.143-22.465 13.334-22.433.362.062 25.86 43.105 25.86 43.655 0 .174-6.761 11.952-15.025 26.173-8.46 14.557-14.932 26.104-14.81 26.421.185.483 4.563.564 30.213.564h29.996l.957 1.48c.527.814 3.296 5.547 6.155 10.518s5.45 9.29 5.757 9.597c.705.705.703.724-.16 1.572-.396.388-3.36 5.323-6.588 10.965-3.228 5.643-6.056 10.387-6.285 10.543s-19.695.171-43.256.034l-42.84-.249-.803 1.15c-.442.632-7.505 12.736-15.696 26.897l-14.892 25.747h-15.486c-8.518 0-20.015.116-25.551.259-6.55.168-10.15.121-10.308-.135zm-133.75-157.86c-56.373-.055-102.5-.182-102.5-.282s5.617-10.132 12.481-22.294L89.64 123.34h30.332c27.113 0 30.332-.065 30.332-.611 0-.336-6.659-12.228-14.797-26.427s-14.797-25.917-14.797-26.04 2.682-4.853 5.96-10.51 6.003-10.578 6.056-10.934c.086-.586 1.375-.648 13.572-.648 7.412 0 13.463.143 13.446.317-.018.174.22.707.53 1.184.31.476 9.763 16.937 21.007 36.578 11.244 19.64 20.71 36.022 21.036 36.4.554.647 2.549.691 31.428.691h30.837l12.896 22.145c7.093 12.18 12.8 22.301 12.682 22.492-.117.19-4.776.303-10.352.249-5.575-.054-56.26-.143-112.63-.198z\"/><path fill=\"#64b5f6\" d=\"M23.046 238.939c-6.098 10.563-6.69 11.711-6.224 12.078.282.224 3.18 5.044 6.44 10.712s6.016 10.355 6.123 10.417c.106.061 13.585.153 29.95.204 16.367.052 29.994.23 30.285.399.473.273-1.08 3.094-14.637 26.574l-15.166 26.269 12.907 21.865c7.1 12.026 12.982 21.906 13.068 21.956s23.257-39.831 51.492-88.624c11.352-19.617 21.214-36.64 30.37-52.442 23.308-40.452 30.68-53.468 30.73-54.132-1.096-.11-6.141-.187-13.006-.216-3.945-.01-7.82-.02-12.75-.002l-25.341.092-15.42 26.706c-14.256 24.693-15.445 26.663-16.278 26.86l-.023.037c-.012.003-1.622-.001-1.826 0-4.29.062-20.453.063-40.226-.01-22.632-.082-41.615-.125-42.183-.096-.567.03-1.147-.03-1.29-.132-.141-.102-3.29 5.066-6.996 11.485zm205.16-190.3c-.123.149 5.62 10.392 12.761 22.763 12.2 21.131 89.393 155.03 96.276 167 1.503 2.613 2.92 4.803 3.443 5.348.9-1.249 3.532-5.63 7.954-13.219a1343 1343 0 0 1 10.05-17.76l6.606-11.443c.691-1.403.753-1.818.652-2.117-.161-.48-6.903-12.332-14.982-26.337-8.078-14.005-14.824-25.849-14.99-26.32a.73.73 0 0 1-.01-.366l-.426-.913 21.636-36.976c3.69-6.307 6.425-11.042 9.471-16.29 9.158-15.948 12.036-21.189 11.895-21.55-.126-.324-2.7-4.83-5.72-10.017-3.021-5.185-5.845-10.148-6.275-11.026-.483-.987-.734-1.364-1.1-1.456-.054.014-.083.018-.144.035-.42.112-5.455.195-11.19.185s-11.22.024-12.187.073l-1.76.089-14.998 25.978c-12.824 22.212-15.084 25.964-15.595 25.883-.024-.004-.15-.189-.235-.301-.109.066-.2.09-.271.05-.256-.148-7.144-11.902-15.306-26.119L279.4 48.817c-.116-.186-.444-.744-.458-.752-.476-.275-50.502.287-50.737.57zm-18.646 283.09c-.047.109-.026.262.043.48.328 1.05 25.338 43.735 25.772 43.985.206.119 14.178.239 31.05.266 26.65.044 30.749.152 31.234.832.307.43 9.987 17.214 21.513 37.296s21.152 36.627 21.394 36.767 5.926.243 12.633.23c6.705-.013 12.4.099 12.657.246.131.076.381-.141.851-.795l6.008-10.406c5.234-9.065 6.62-11.684 6.294-11.888-.575-.36-15.597-26.643-23.859-41.482-3.09-5.45-5.37-9.516-5.44-9.774-.196-.712-.066-.822 1.155-.98 1.956-.252 57.397-.057 58.071.205.237.092.79-.569 2.593-3.497 1.866-3.067 5.03-8.524 11.001-18.866 7.22-12.505 13.043-22.784 12.941-22.843s-.77-.051-1.489.016l-.046.001c-4.451.204-33.918.203-149.74.025-38.96-.06-69.786-.09-71.912-.072-1.12.01-2.095.076-2.66.172a.3.3 0 0 0-.062.083z\"/></g></svg>", Po = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#8bc34a\" d=\"M16 20.003v2h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2v-2h4v-2h-4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v2Z\"/><path fill=\"#8bc34a\" d=\"m16 3.003-12 7v14l4 2h6v-13.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v11.5H8l-2-1.034V11.15l10-5.833 10 5.833v11.703l-10 5.833-1.745-1.022L13 29.253l3 1.75 12-7v-14Z\"/></svg>", Fo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"M4 4v24h24V4Zm20 20h-4V12h-4v12H8V8h16Z\"/></svg>", Io = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", Lo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#ffab40\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", Ro = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"m12.019 15.021.003-.008c-.005-.021-.006-.026-.003.008\"/><path fill=\"#ff9800\" d=\"M4.51 3.273a2.523 2.523 0 0 0-2.524 2.523V11.3c.361-.13.88-.898 1.043-1.085.285-.327.337-.743.478-1.006C3.83 8.612 3.886 8.2 4.62 8.2c.342 0 .478.08.71.39.16.216.438.615.568.882.15.307.396.724.503.808q.122.095.233.137c.119.044.218-.037.297-.1.102-.082.145-.247.24-.467.135-.317.283-.697.367-.83.146-.23.195-.501.352-.633.232-.195.535-.208.618-.225.466-.092.677.225.907.43.15.133.355.403.5.765.114.283.26.544.32.707.059.158.203.41.289.713.077.275.286.486.365.616 0 0 .121.34.858.65.16.067.482.176.674.246.32.116.63.101 1.025.054.281 0 .434-.408.562-.734.075-.193.148-.745.197-.902.048-.153-.064-.27.031-.405.112-.156.178-.164.242-.368.138-.436.936-.458 1.384-.458.374 0 .327.363.96.239.364-.072.714.046 1.1.149.324.086.63.184.812.398.119.139.412.834.113.863.029.035.05.099.104.134-.067.262-.357.075-.518.041-.217-.045-.37.007-.583.101-.363.162-.894.143-1.21.407-.27.223-.269.721-.394 1 0 0-.348.895-1.106 1.443-.194.14-.574.477-1.4.605a5.3 5.3 0 0 1-1.1.043c-.186-.009-.362-.018-.549-.02-.11-.002-.48-.013-.461.022l-.041.103.024.138c.015.083.019.149.022.225.006.157-.013.32-.005.478.017.328.138.627.154.958.017.368.199.758.375 1.059.067.114.169.128.213.269.052.161.003.333.028.505.1.668.292 1.366.592 1.97l.008.014c.371-.062.743-.196 1.226-.267.885-.132 2.115-.064 2.906-.138 2-.188 3.085.82 4.882.407V5.796a2.523 2.523 0 0 0-2.523-2.523zm-.907 11.144q-.022 0-.046.003c-.159.025-.313.08-.412.24-.08.13-.108.355-.164.505-.064.175-.176.338-.274.505-.18.305-.504.581-.644.879-.028.06-.053.13-.076.2v3.402c.163.028.333.062.524.113 1.407.375 1.75.407 3.13.25l.13-.018c.105-.22.187-.968.255-1.2.054-.178.127-.32.155-.5.026-.173-.003-.337-.017-.493-.04-.393.285-.533.44-.87.14-.304.22-.651.336-.963.11-.298.284-.721.579-.872-.036-.041-.617-.06-.772-.076a5 5 0 0 1-.5-.07c-.314-.064-.656-.126-.965-.2a10 10 0 0 1-.947-.328c-.298-.138-.503-.497-.732-.507m5.737.83c-.74.149-.97.876-1.32 1.451-.192.319-.396.59-.548.928-.14.312-.128.657-.368.924a2.55 2.55 0 0 0-.528.922c-.023.067-.088.776-.158.943l1.101-.078c1.026.07.73.464 2.332.378l2.529-.078a7 7 0 0 0-.228-.588c-.07-.147-.16-.434-.218-.56a3.5 3.5 0 0 0-.309-.526c-.184-.215-.227-.23-.28-.503-.095-.473-.344-1.33-.637-1.923-.151-.306-.403-.562-.634-.784-.2-.195-.655-.522-.734-.505z\"/></svg>", zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ef5350\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z\"/></svg>", Bo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ba68c8\" d=\"M11.057 2.981c.537.735.028 1.653.141 2.472a3.42 3.42 0 0 1-1.03 2.415c-1.414 1.625-3.165 3.038-4.097 5.03a5.28 5.28 0 0 0 1.412 5.847c.706.735 1.54 1.342 2.472 1.738.17.805-1.088.184-1.455 0A6.7 6.7 0 0 1 4.361 16.4a5.44 5.44 0 0 1 .904-5.368c1.272-1.61 3.136-2.543 4.662-3.857.565-.55 1.003-1.3.932-2.119.156-.678-.254-1.469.212-2.09zm-.07 18.929c-.17.198-.467.325-.495.24-.042-.085.212-.127.381-.325.17-.183.127-.522.24-.522.1 0 .043.395-.14.607zm2.16 0c.17.198.453.31.495.24.028-.085-.212-.141-.395-.339-.156-.184-.113-.523-.24-.523-.085 0-.029.41.14.608zm-1.03.48c-.1 0-.071-.296-.071-.65 0-.367-.028-.663.07-.663.085 0 .057.296.057.663 0 .354.014.65-.057.65m-.495-20.765c.34.24.254 2.077.254 3.136 0 1.653.184 3.376-.805 4.916-.96 1.497-2.048 3.108-1.95 4.972.1 1.837.99 3.504 2.148 5.043.664.876-.353.509-.876.085a7.2 7.2 0 0 1-2.755-5.664c.142-1.907 1.597-3.348 2.628-4.803.805-1.13 1.186-1.879 1.215-3.645.028-1.412-.142-3.531.042-3.983.014-.043.07-.1.099-.057m.537 2.232c-.085 0-.043.396.028.72.424 2.26-.198 4.52-.749 6.682a12.77 12.77 0 0 0 .283 7.826c.607 1.568 1.71.791 2.161 1.568.34.593 1.272.198 1.978-.141 2.232-1.102 4.012-3.108 4.11-5.566.029-.494 0-.989-.07-1.497-.283-1.837-1.78-3.065-3.15-4.083-1.215-.89-2.74-1.483-3.659-2.613-.523-.65-.297-1.638-.381-2.458-.043-.452-.255-.042-.382-.268-.084-.127-.14-.17-.17-.17zm.72 3.616c.057 0 .17.071.325.226a20 20 0 0 0 2.161 1.921c1.272.961 2.43 2.091 2.967 3.504.339.875.339 1.836.226 2.74-.184 1.384-1.187 2.444-2.119 3.404-.339.354-1.06.791-1.074.678-.084-.367.763-1.172 1.159-1.695A5.93 5.93 0 0 0 16 10.962c-1.102-1.214-2.317-1.907-2.995-3.08-.14-.253-.183-.409-.113-.409z\"/></svg>", Vo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M12 18.08c-6.63 0-12-2.72-12-6.08s5.37-6.08 12-6.08S24 8.64 24 12s-5.37 6.08-12 6.08m-5.19-7.95c.54 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.58 1.09q-.42.33-1.29.33h-.87l.53-2.76zm-3.5 5.55h1.44l.34-1.75h1.23c.54 0 .98-.06 1.33-.17.35-.12.67-.31.96-.58.24-.22.43-.46.58-.73.15-.26.26-.56.31-.88.16-.78.05-1.39-.33-1.82-.39-.44-.99-.65-1.82-.65H4.59zm7.25-8.33-1.28 6.58h1.42l.74-3.77h1.14c.36 0 .6.06.71.18s.13.34.07.66l-.57 2.93h1.45l.59-3.07c.13-.62.03-1.07-.27-1.36-.3-.27-.85-.4-1.65-.4h-1.27L12 7.35zM18 10.13c.55 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.57 1.09-.29.22-.72.33-1.3.33h-.85l.5-2.76zm-3.5 5.55h1.44l.34-1.75h1.22c.55 0 1-.06 1.35-.17.35-.12.65-.31.95-.58.24-.22.44-.46.58-.73.15-.26.26-.56.32-.88.15-.78.04-1.39-.34-1.82-.36-.44-.99-.65-1.82-.65h-2.75z\"/></svg>", Ho = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e0e0e0\" d=\"M2 22h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zM12 12h8v8h-8z\"/><path fill=\"#ffb300\" d=\"M2 2h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zm0 10h8v8h-8z\"/></svg>", Uo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#e64a19\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM8 11v2h1v6H8v1h4v-1h-1v-2h2a3 3 0 0 0 3-3 3 3 0 0 0-3-3zm5 2a1 1 0 0 1 1 1 1 1 0 0 1-1 1h-2v-2z\"/></svg>", Wo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#03a9f4\" d=\"M29.07 6H7.677A1.535 1.535 0 0 0 6.24 7.113l-4.2 17.774A.852.852 0 0 0 2.93 26h21.393a1.535 1.535 0 0 0 1.436-1.113L29.96 7.112A.852.852 0 0 0 29.07 6M8.626 23.797a1.4 1.4 0 0 1-1.814-.31l-.007-.009a1.075 1.075 0 0 1 .315-1.599l9.6-6.061-6.102-5.852-.01-.01a1.068 1.068 0 0 1 .084-1.625l.037-.03a1.38 1.38 0 0 1 1.8.07l7.233 6.957a1.1 1.1 0 0 1 .236.739 1.08 1.08 0 0 1-.412.79c-.074.04-.146.119-10.951 6.935ZM24 22.94A1.135 1.135 0 0 1 22.803 24h-5.634a1.061 1.061 0 1 1 .001-2.112h5.633A1.134 1.134 0 0 1 24 22.938Z\"/></svg>", Go = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#f44336\" d=\"M2 8h4v1H2zm0 6h4v1H2zm9-10h3v1h-3zM2 2h3v1H2z\"/><path fill=\"#f9a825\" d=\"M9 2h3v1H9zm1 4h4v1h-4zm-5 6h1v1H5zm-3-2h6v1H2z\"/><path fill=\"#26a69a\" d=\"M2 12h3v1H2zm7-4h5v1H9zM2 4h4v1H2zm3-2h4v1H5z\"/><path fill=\"#ba68c8\" d=\"M2 6h3v1H2zm7-2h2v1H9zm-1 6h4v1H8z\"/></svg>", Ko = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"m27.777 22.617-.459-.946L18.43 3.26a2.25 2.25 0 0 0-1.914-1.256A2 2 0 0 0 16.379 2a2.23 2.23 0 0 0-1.891 1.042L4.348 19.056a2.2 2.2 0 0 0 .025 2.417l4.957 7.488A2.34 2.34 0 0 0 11.29 30a2.4 2.4 0 0 0 .655-.092l14.387-4.149a2.32 2.32 0 0 0 1.458-1.234 2.21 2.21 0 0 0-.013-1.908m-3.538.604-11.268 3.25 4.075-19.033 7.568 15.671-.376.098Z\"/></svg>", qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"M16 27 2 19v-5l14 8z\"/><path fill=\"#ffeb3b\" d=\"m30 14-14 8v5l14-8z\"/><path fill=\"#ff5722\" d=\"M16 6 2 14v5l14-8z\"/><path fill=\"#00e676\" d=\"m30 19-14-8V6l14 8z\"/><path fill=\"#03a9f4\" d=\"M16 27 2 19v-5l14 8z\"/></svg>", Jo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\"><g transform=\"translate(-.25 -1.71)\"><path fill=\"#ffe0b2\" d=\"M107.4 50.9c-.2-4.4.4-8.3-1.6-11.6-4.8-8.2-16.8-13-40.8-13v.7h-.5.5v-.7c-24 0-36.6 4.8-41.4 13.1-1.9 3.4-1.7 7.2-2 11.6-.2 3.5-1.8 7.2-1.1 11.2.8 5.2 1.1 10.4 1.9 15.2.6 3.9 6 7.2 6.5 10.9 1.4 10.2 12 14.9 36 14.9v.8h-.6.7v-.8c24 0 34.2-4.7 35.5-14.9.5-3.8 5.5-7 6.1-10.9.8-4.8 1.1-10 1.9-15.2.7-4-.9-7.8-1.1-11.3\"/><path fill=\"#ffe0b2\" d=\"M64.6 54.5c4.3.1 7.3 2.8 10.1 5.3 3.3 2.9 8.9 4.9 11.2 7.4s5.3 5 6.4 8.9 1.4 8.9 1.4 10.2.7 1 2.7 0c4.7-2.3 9.9-8.5 9.9-8.5-.6 3.9-5.7 7.4-6.2 11.1C98.9 99.1 89 104 64.5 104h-.1.6\"/><path fill=\"#ffe0b2\" d=\"M80.4 46.7c.9 3.1 4.1 13.6-2.1 10.1 0 0 2.6 1.5 4.2 7.2 1.7 5.7 5.8 6.4 5.8 6.4s6.7 1.3 11.7-3c4.2-3.6 4.9-10 3.1-14.9-1.8-4.8-5-6.3-9.7-7.3-4.7-1.1-14.1-2-13 1.5\"/><circle cx=\"92.3\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"90\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#ffe0b2\" d=\"M78.9 57.7s7.9 5.4 12.2 10.7 4.2 6.3 4.2 6.3l-3.1 1.4s-4.4-8.3-9.8-11.4c-5.5-3.1-6.1-5.7-6.1-5.7zm-14-3.2c-4.3.1-7.5 2.8-10.4 5.3-3.3 2.9-9.1 4.9-11.4 7.4s-5.4 5-6.5 8.9-1.5 8.9-1.5 10.2.2 1.4-2.7 0c-4.7-2.2-9.9-8.5-9.9-8.5.6 3.9 5.7 7.4 6.2 11.1C30.1 99.1 40 104 64.5 104h.5\"/><path fill=\"#4e342e\" d=\"M88.1 71.4C83.3 65.5 75.6 60 64.9 60h-.1c-10.7 0-18.4 5.5-23.2 11.4-5 6.1-4.6 8.5-4.6 14.3 0 21 7.4 15 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.7 12.3-17.3.1-5.8.4-8.4-4.6-14.5\"/><path fill=\"#3e2723\" d=\"M64.4 65.2s-.7 9.7-2.1 11.6l2.6-.6z\"/><path fill=\"#3e2723\" d=\"M65.1 65.2s.7 9.7 2.1 11.6l-2.6-.6z\"/><path fill=\"#4e342e\" d=\"M56.7 62.9c-1-2.3 2.6-6 8.3-6.1 5.7 0 9.3 3.7 8.3 6.1S68.7 66 65 66.1c-3.6-.1-7.3-.8-8.3-3.2\"/><path d=\"M65 65.2c0-.4 3.4-.5 5.2-1.7 0 0-3.7 1.2-4.5.7-.8-.4-1-1.6-1-1.6s-.3 1.2-.9 1.6c-.7.4-4.9-.7-4.9-.7s5.6 1.4 5.6 1.7-.1 1.3-.1 2c0 2.5 0 8.7.4 9.2.6.9.4-6.7.4-9.2-.1-.8-.1-1.6-.2-2\"/><path fill=\"#795548\" d=\"M65.2 78.6c1.7 0 4.7 1.2 7.4 3.1-2.6-2.9-5.7-4.9-7.4-4.9-1.8 0-5.6 2.2-8.3 5.4 2.8-2.2 6.4-3.6 8.3-3.6\"/><g fill=\"#3e2723\"><path d=\"M64.5 96.3c-3.8 0-7.5-1.2-10.9-2.1-.7-.2-1.4.3-2.1.1-6.3-2-11.4-5.4-14.5-9.7v1c0 21 7.4 15.1 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.6 12.3-17.4 0-.8 0-1.6.1-2.3-2.9 4.7-8.2 8.4-14.8 10.6-.6.2-2-.3-2.6-.2-3.6 1.2-6.8 2.5-10.9 2.5\"/><path d=\"M55 85s-2.5 7.5-.8 10.8l-2.3-1s1.7-7.6 3.1-9.8m19.8 0s2.5 7.5.8 10.8l2.3-1s-1.8-7.6-3.1-9.8\"/></g><path fill=\"#ffe0b2\" d=\"M48.6 46.7c-.9 3.1-4.1 13.6 2.1 10.1 0 0-2.6 1.5-4.2 7.2s-5.8 6.4-5.8 6.4-6.7 1.3-11.7-3c-4.2-3.6-4.9-10-3.1-14.9s5-6.3 9.7-7.3c4.7-1.1 14-2 13 1.5\"/><path d=\"M64.9 76.8c2.7 0 11.1 5.8 11.2 12.9v-.4c0-7.4-6.8-13.3-11.2-13.3s-11.2 6-11.2 13.3v.4c.1-7.1 8.5-12.9 11.2-12.9\"/><g fill=\"#3e2723\"><ellipse cx=\"66.7\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(-14.465 66.71 61.469)\"/><ellipse cx=\"62.4\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(17.235 62.372 61.463)\"/></g><circle cx=\"37.2\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"39.5\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#795548\" d=\"M67.5 58.2c0-.1-2.3 1-2.9 1.1-.6-.1-2.9-1.2-2.9-1.1z\"/><path fill=\"#ffe0b2\" d=\"M50 57.7s-7.9 5.4-12.2 10.7-4.2 6.3-4.2 6.3l3.1 1.4s4.4-8.3 9.8-11.4 6.1-5.7 6.1-5.7z\"/><path fill=\"#ffe0b2\" d=\"M32.7 41.7S30 49.1 24 52.2c0 0 9.4-1.1 8.7-10.5m63.1 0s2.7 7.4 8.7 10.5c0 0-9.4-1.1-8.7-10.5M78.7 55.5s-5.9-6.2-13.8-6.4h.2c-8 .2-13.8 6.4-13.8 6.4 6.9-4.8 12.8-4.7 13.8-4.7-.1 0 6.7-.1 13.6 4.7m-6.9-13s-3-4.2-7-4.3h.2c-3 .1-6.9 4.3-6.9 4.3 3.4-3.3 6.9-3.2 6.9-3.2s3.3-.1 6.8 3.2M37.2 73.2s-4.7 2.3-8.1.9H29c-3-1.7-4.5-6.8-4.5-6.8s3 9 12.7 5.9m54.8 0s4.7 2.3 8.1.9c4-1.7 4.6-6.8 4.6-6.8s-3 9-12.7 5.9\"/><path fill=\"#ffe0b2\" d=\"M42.6 41.2c2.6-.5 6.9-.6 10.3.5 4.3 1.5.8 7 1.7 7.3s2.1-3.8 10.1-3.4c8.1.4 9 4 10.1 3.4s-1.1-10 11-7.8c0 0-12.7-3.4-12.1 5.8 0 0-7.3-5.6-17.5-.6.1 0 2.7-8.6-13.6-5.2m44.3 0c.2 0 .3.1.4.1s-.1-.1-.4-.1M39.1 28.9S28.3 42.5 26.7 47.7c-1.6 5.3-2.8 27-4.2 30.1l-5-21.4 9.2-22.3zm50.8 0s10.8 13.6 12.4 18.8c1.6 5.3 2.8 27 4.2 30.1l5-21.4-9.2-22.3z\"/><path fill=\"#4e342e\" d=\"M89.4 28.9s11.6 9.7 15 20.9 2 24.8 4.6 26.5c3.7 2.4 7.9-11.9 9.3-13.4 2.2-2.4 9.5-8.5 10-9.6s-14.8-17.8-21.5-21.1c-8.1-3.8-18.1-4.1-17.4-3.3\"/><path fill=\"#3e2723\" d=\"M99.3 34.9s13.7 17.5 13.5 39.3l5.5-11.2c-.1 0-4.9-14.3-19-28.1\"/><path fill=\"#4e342e\" d=\"M39.1 28.9s-11.6 9.7-15 20.9-2 24.8-4.6 26.5c-3.7 2.4-7.9-11.9-9.3-13.4C8 60.5.7 54.4.2 53.3S15 35.5 21.7 32.2c8.1-3.8 18.1-4.1 17.4-3.3\"/><path fill=\"#3e2723\" d=\"M29.2 34.9S15.5 52.4 15.7 74.2L10.3 63s4.8-14.3 18.9-28.1\"/><path fill=\"#ffe0b2\" d=\"M21.8 74.6s1 5.4 2.6 7.1.5-1.3.5-1.3-1.7-.9-1.4-7.8-1.7 2-1.7 2m85.3 0s-1 5.4-2.6 7.1-.5-1.3-.5-1.3 1.7-.9 1.4-7.8 1.7 2 1.7 2\"/><g fill=\"#3e2723\"><circle cx=\"54.5\" cy=\"70.5\" r=\".8\"/><circle cx=\"49.9\" cy=\"75.3\" r=\".8\"/><circle cx=\"48.4\" cy=\"70.5\" r=\".8\"/></g><g fill=\"#3e2723\"><circle cx=\"74\" cy=\"70.5\" r=\".8\"/><circle cx=\"78.6\" cy=\"75.3\" r=\".8\"/><circle cx=\"80.1\" cy=\"70.5\" r=\".8\"/></g></g></svg>", Yo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M9.86 2A2.86 2.86 0 0 0 7 4.86v1.68h4.29c.39 0 .71.57.71.96H4.86A2.86 2.86 0 0 0 2 10.36v3.781a2.86 2.86 0 0 0 2.86 2.86h1.18v-2.68a2.85 2.85 0 0 1 2.85-2.86h5.25c1.58 0 2.86-1.271 2.86-2.851V4.86A2.86 2.86 0 0 0 14.14 2zm-.72 1.61c.4 0 .72.12.72.71s-.32.891-.72.891c-.39 0-.71-.3-.71-.89s.32-.711.71-.711\"/><path fill=\"#fdd835\" d=\"M17.959 7v2.68a2.85 2.85 0 0 1-2.85 2.859H9.86A2.85 2.85 0 0 0 7 15.389v3.75a2.86 2.86 0 0 0 2.86 2.86h4.28A2.86 2.86 0 0 0 17 19.14v-1.68h-4.291c-.39 0-.709-.57-.709-.96h7.14A2.86 2.86 0 0 0 22 13.64V9.86A2.86 2.86 0 0 0 19.14 7zM8.32 11.513l-.004.004.038-.004zm6.54 7.276c.39 0 .71.3.71.89a.71.71 0 0 1-.71.71c-.4 0-.72-.12-.72-.71s.32-.89.72-.89\"/></svg>", Xo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1976d2\" d=\"M11.956 4.05c-5.694 0-10.354 3.106-10.354 6.947 0 3.396 3.686 6.212 8.531 6.813v2.205h3.53V17.82c.88-.093 1.699-.259 2.475-.497l1.43 2.692h3.996l-2.402-4.048c1.936-1.263 3.147-3.034 3.147-4.97 0-3.841-4.659-6.947-10.354-6.947m1.584 2.712c4.349 0 7.558 1.45 7.558 4.753 0 1.77-.952 3.013-2.505 3.779a1 1 0 0 1-.228-.156c-.373-.165-.994-.352-.994-.352s3.085-.227 3.085-3.302-3.23-3.127-3.23-3.127h-7.092v7.413c-2.64-.766-4.462-2.392-4.462-4.255 0-2.63 3.52-4.753 7.868-4.753m.156 4.12h2.143s.983-.05.983.974c0 1.004-.983 1.004-.983 1.004h-2.143v-1.977m-.031 4.566h.952c.186 0 .28.052.445.207.135.103.28.3.404.476-.57.073-1.17.104-1.801.104z\"/></svg>", Zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bcd4\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#00bcd4\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#00bcd4\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#00bcd4\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", Qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#0288d1\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#0288d1\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#0288d1\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", $o = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 1C4.136 1 1 4.136 1 8s3.136 7 7 7 7-3.136 7-7-3.136-7-7-7m1 11H7V7.5h2zm0-6H7V4h2z\"/></svg>", es = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#f44336\" d=\"M18.041 3.177c2.24.382 2.879 1.919 2.843 3.527V6.67l-1.013 13.266-13.132.897h.008c-1.093-.044-3.518-.151-3.634-3.545l1.217-2.222 2.462 5.74 2.097-6.77-.045.009.018-.018 6.85 2.186L13.945 9.3l6.53-.409-5.144-4.212 2.71-1.51v.009M3.113 17.252v.017zM6.916 6.874c2.63-2.622 6.033-4.168 7.34-2.844 1.297 1.306-.072 4.523-2.702 7.135-2.666 2.613-6.015 4.248-7.322 2.933-1.306-1.324.036-4.612 2.675-7.224z\"/></svg>", ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"m30 12-4-2V6h-4l-2-4-4 2-4-2-2 4H6v4l-4 2 2 4-2 4 4 2v4h4l2 4 4-2 4 2 2-4h4v-4l4-2-2-4ZM6 16a9.9 9.9 0 0 1 .842-4H10v8H6.842A9.9 9.9 0 0 1 6 16m10 10a9.98 9.98 0 0 1-7.978-4H16v-2h-2v-2h4c.819.819.297 2.308 1.179 3.37a1.89 1.89 0 0 0 1.46.63h3.34A9.98 9.98 0 0 1 16 26m-2-12v-2h4a1 1 0 0 1 0 2Zm11.158 6H24a2.006 2.006 0 0 1-2-2 2 2 0 0 0-2-2 3 3 0 0 0 3-3q0-.08-.004-.161A3.115 3.115 0 0 0 19.83 10H8.022a9.986 9.986 0 0 1 17.136 10\"/></svg>", ns = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M27.837 5.673a4.33 4.33 0 0 0-2.293-2.701c-2.362-1.261-6.11-1.298-9.548-.092a26.3 26.3 0 0 0-8.76 4.966c-2.752 2.542-3.438 4.925-3.189 6.194.523 2.668 3.274 4.539 5.485 6.042.418.284.822.559 1.175.816-1.429.76-4.261 2.444-5.088 4.248a3.88 3.88 0 0 0-.118 3.332A2.37 2.37 0 0 0 6.869 29.8a5.6 5.6 0 0 0 1.49.2 6.35 6.35 0 0 0 5.19-2.856 6.74 6.74 0 0 0 .864-5.382 7.3 7.3 0 0 1 2.044-.03 3.92 3.92 0 0 1 2.816 1.311 1.82 1.82 0 0 1 .423 1.262 1.55 1.55 0 0 1-.772 1.05c-.234.14-.586.355-.504.803.036.194.198.633.894.512a2.93 2.93 0 0 0 2.145-2.651 4 4 0 0 0-1.197-2.904 5.94 5.94 0 0 0-4.396-1.626 10.6 10.6 0 0 0-2.672.304 20 20 0 0 0-2.203-1.846c-1.712-1.3-3.33-2.529-3.235-4.26.125-2.263 2.468-4.532 6.964-6.744 4.016-1.976 7.254-2.037 8.944-1.438a2 2 0 0 1 1.204.883 2.77 2.77 0 0 1-.36 2.47 9.71 9.71 0 0 1-7.425 4.304 3.86 3.86 0 0 1-3.238-.757c-.278-.302-.593-.645-1.074-.383q-.565.31-.225 1.189a3.9 3.9 0 0 0 2.407 1.92 11.7 11.7 0 0 0 7.128-.671c3.527-1.35 6.681-5.202 5.756-8.787M11.895 24.475a4 4 0 0 1-.192.468 4.5 4.5 0 0 1-.753 1.081 2.83 2.83 0 0 1-2.533 1.107c-.056-.032-.078-.146-.085-.193a3.28 3.28 0 0 1 1.076-2.284 11.3 11.3 0 0 1 2.644-1.933 3.85 3.85 0 0 1-.157 1.754\"/></svg>", rs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#0277bd\" d=\"M105.46 209.517c-7.875 0-13.452-7.521-13.452-15.37v-.327c0-7.848 5.578-13.735 13.452-13.735h164.05c1.476-4.905 2.625-11.446 3.281-17.986h-137.81c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h137.31c-.82-6.54-1.969-13.081-3.773-17.986h-104.01c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h91.87c-21.327-37.607-60.864-61.315-106.14-61.315-67.918 0-123.04 54.448-123.04 122.3 0 67.856 55.122 123.28 123.04 123.28 46.59 0 87.112-25.507 107.95-63.114h-152.73z\"/></svg>", is = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"m6.457 9.894 12.523 5.163-.456 1.211L6 11.105Zm7.02-3.091L26 11.966l-.457 1.21L13.02 8.015ZM6.465 18.885l12.524 5.163-.457 1.21L6.01 20.097Zm7.007-3.086 12.524 5.163-.456 1.21-12.524-5.162Z\"/><path fill=\"#f44336\" d=\"M6 24.07V30l19.997-3.106V20.96zM6 5.11v5.99l20-3.11V2zm0 9.96v5.03l20-3.11v-5.03z\"/></svg>", as = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.6.6 0 0 0-.18-.03c-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1q.09.03.18.03c.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64zm-1.98-1.71c.04.31.05.52.05.73s-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2\"/></svg>", os = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"#0288d1\"><path d=\"m5.747 14.046 6.254 8.61 6.252-8.61-6.254 3.807z\"/><path d=\"M11.999 1.343 5.747 11.83l6.252 3.807 6.253-3.807z\"/></g></svg>", ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff4081\" d=\"m24.95 28.948-18-.9a1 1 0 0 1-.95-1V6.906a1 1 0 0 1 .9-.995l18-1.905A1 1 0 0 1 26 5v22.949a1 1 0 0 1-1.05.998Z\"/><path fill=\"#fafafa\" d=\"m20 8.52.19-4.242 3.649-.275.16 4.37a.28.28 0 0 1-.276.283.3.3 0 0 1-.188-.063L22.123 7.52l-1.668 1.23a.29.29 0 0 1-.398-.055A.27.27 0 0 1 20 8.52m-2.128 6.647c0 .487 3.448.25 3.912-.094 0-3.324-1.87-5.073-5.298-5.073-3.421 0-5.345 1.774-5.345 4.436 0 4.642 6.561 4.735 6.561 7.266a1.022 1.022 0 0 1-1.164 1.13c-1.047 0-1.459-.512-1.413-2.242 0-.375-3.984-.494-4.101 0-.308 4.198 2.426 5.41 5.56 5.41C19.619 26 22 24.45 22 21.658c0-4.973-6.653-4.842-6.653-7.31a1.08 1.08 0 0 1 1.243-1.13c.478 0 1.354.08 1.282 1.949\"/></svg>", cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#c0ca33\" d=\"M127.22 155.91c14.639-17.51 16.362-35.594 5.023-69.178-7.176-21.241-19.089-37.603-10.334-50.807 9.33-14.065 29.135-.43 12.63 18.371l3.301 2.296c19.806 2.297 29.566-24.83 14.783-32.58-39.038-20.38-73.197 18.802-58.127 64.155 6.459 19.232 15.501 39.613 8.181 55.831-6.315 13.922-18.515 22.103-26.695 22.39-17.079.862-5.74-38.32 13.922-48.08 1.722-.86 4.162-2.009 1.866-4.88-24.255-2.726-38.464 8.468-46.645 24.113-23.825 45.497 45.21 62.289 82.096 18.37z\"/></svg>", ls = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#ff5722\" d=\"M175.94 24.328c-13.037.252-26.009 3.872-37.471 11.174L79.912 72.818a67.13 67.13 0 0 0-30.355 44.906 70.8 70.8 0 0 0 6.959 45.445 67.2 67.2 0 0 0-10.035 25.102 71.54 71.54 0 0 0 12.236 54.156c23.351 33.41 69.468 43.311 102.81 22.07l58.559-37.158a67.36 67.36 0 0 0 30.355-44.906 70.77 70.77 0 0 0-6.982-45.422 67.65 67.65 0 0 0 10.059-25.102 71.63 71.63 0 0 0-12.236-54.156v-.18c-15.324-21.925-40.453-33.727-65.342-33.246zm5.137 28.68a46.5 46.5 0 0 1 36.09 19.969 42.98 42.98 0 0 1 7.365 32.557 45 45 0 0 1-1.393 5.455l-1.123 3.37-2.986-2.247a75.9 75.9 0 0 0-22.902-11.45l-2.244-.651.201-2.246a13.16 13.16 0 0 0-2.379-8.711 13.99 13.99 0 0 0-14.953-5.412 12.8 12.8 0 0 0-3.594 1.572l-58.578 37.25a12.24 12.24 0 0 0-5.502 8.15 13.1 13.1 0 0 0 2.246 9.834 14.03 14.03 0 0 0 14.93 5.569 13.5 13.5 0 0 0 3.594-1.573l22.453-14.234a41.8 41.8 0 0 1 11.898-5.232 46.48 46.48 0 0 1 49.914 18.502 43.02 43.02 0 0 1 7.363 32.557 40.42 40.42 0 0 1-18.254 27.078l-58.58 37.316a43 43 0 0 1-11.898 5.23A46.545 46.545 0 0 1 82.81 227.14a42.98 42.98 0 0 1-7.341-32.557 38 38 0 0 1 1.39-5.41l1.102-3.37 3.008 2.246a75.9 75.9 0 0 0 22.836 11.361l2.244.65-.201 2.247a13.25 13.25 0 0 0 2.447 8.644 14.03 14.03 0 0 0 15.043 5.569 13.1 13.1 0 0 0 3.592-1.573l58.467-37.316a12.17 12.17 0 0 0 5.502-8.173 12.96 12.96 0 0 0-2.246-9.811 14.03 14.03 0 0 0-15.043-5.568 12.8 12.8 0 0 0-3.592 1.57l-22.453 14.258a42.9 42.9 0 0 1-11.877 5.209 46.52 46.52 0 0 1-49.846-18.5 43.02 43.02 0 0 1-7.297-32.557A40.42 40.42 0 0 1 96.798 96.98l58.646-37.316a42.8 42.8 0 0 1 11.811-5.21 46.5 46.5 0 0 1 13.822-1.444z\"/></svg>", us = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffb300\" d=\"M29.168 14.03a2.7 2.7 0 0 0-1.968-.83 2.51 2.51 0 0 0-1.929.8h-4.443l3.078-3.078a2.835 2.835 0 0 0 2.857-2.842 2.6 2.6 0 0 0-.831-1.969 2.82 2.82 0 0 0-2.014-.788 2.67 2.67 0 0 0-1.968.788 2.36 2.36 0 0 0-.812 1.922L18 11.17V6.726a2.51 2.51 0 0 0 .8-1.929 2.7 2.7 0 0 0-.832-1.968 2.745 2.745 0 0 0-3.936 0 2.7 2.7 0 0 0-.832 1.968 2.51 2.51 0 0 0 .8 1.93v4.443l-3.138-3.138a2.36 2.36 0 0 0-.812-1.922 2.66 2.66 0 0 0-1.968-.788 2.83 2.83 0 0 0-2.014.788 2.6 2.6 0 0 0-.831 1.969 2.74 2.74 0 0 0 .831 2.013 2.8 2.8 0 0 0 2.026.829l3.078 3.078H6.729a2.51 2.51 0 0 0-1.929-.8 2.7 2.7 0 0 0-1.968.831 2.745 2.745 0 0 0 0 3.937 2.7 2.7 0 0 0 1.968.832 2.51 2.51 0 0 0 1.929-.8h4.443l-3.078 3.077a2.835 2.835 0 0 0-2.857 2.842 2.6 2.6 0 0 0 .831 1.969 2.82 2.82 0 0 0 2.014.788 2.67 2.67 0 0 0 1.968-.788 2.36 2.36 0 0 0 .812-1.922L14 20.827v4.444a2.51 2.51 0 0 0-.8 1.929 2.784 2.784 0 0 0 4.768 1.968A2.7 2.7 0 0 0 18.8 27.2a2.51 2.51 0 0 0-.8-1.929v-4.444l3.138 3.138a2.36 2.36 0 0 0 .812 1.922 2.66 2.66 0 0 0 1.968.788 2.83 2.83 0 0 0 2.014-.788 2.6 2.6 0 0 0 .831-1.969 2.74 2.74 0 0 0-.831-2.013 2.8 2.8 0 0 0-2.026-.829L20.828 18h4.443a2.51 2.51 0 0 0 1.93.8 2.784 2.784 0 0 0 1.967-4.769Z\"/></svg>", ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff6e40\" d=\"M17.087 19.721c-2.36 1.36-5.59 1.5-8.86.1a13.8 13.8 0 0 1-6.23-5.32c.67.55 1.46 1 2.3 1.4 3.37 1.57 6.73 1.46 9.1 0-3.37-2.59-6.24-5.96-8.37-8.71-.45-.45-.78-1.01-1.12-1.51 8.28 6.05 7.92 7.59 2.41-1.01 4.89 4.94 9.43 7.74 9.43 7.74.16.09.25.16.36.22.1-.25.19-.51.26-.78.79-2.85-.11-6.12-2.08-8.81 4.55 2.75 7.25 7.91 6.12 12.24-.03.11-.06.22-.05.39 2.24 2.83 1.64 5.78 1.35 5.22-1.21-2.39-3.48-1.65-4.62-1.17\"/></svg>", fs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zm4 7.5h-4v2h1l-2 1.67L10 13h1v-2H7v2h1l3 2.5L8 18H7v2h4v-2h-1l2-1.67L14 18h-1v2h4v-2h-1l-3-2.5 3-2.5h1z\"/></svg>", ps = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#5c6bc0\" d=\"m2 10 8 4V6L2 2zm10 5 8 4v-8l-8-4zm0 11 8 4v-8l-8-4zm10-14v8l8-4V8z\"/></svg>", ms = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#ffca28\"/><path fill=\"#ffca28\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", hs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#0288d1\"/><path fill=\"#0288d1\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", gs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><path fill=\"#2196f3\" d=\"M80 192 64 320h32c16-80 16-96 63.242-96H176c8.837 0 16 7.163 16 16v352c0 8.837 0 16-32 16h-32v32h192v-32h-32c-32 0-32-7.163-32-16V240c0-8.837 7.163-16 16-16h16c48 0 48 16 64 96h32l-16-128zm560 0v32c16 0 45.713 0 52.57 16L776 434.666 708.57 592c-6.857 16-52.57 16-68.57 16v32h128v-32s-34.285 0-27.428-16L792 472l51.428 120c3.103 7.24-1.52 16-11.428 16v32h128v-32c-16 0-45.713 0-52.57-16L824 397.334 891.43 240c6.857-16 52.57-16 68.57-16v-32H832v32s34.285 0 27.428 16L808 360l-51.428-120c-3.103-7.24 1.52-16 11.428-16v-32zM320 384v32h32c32 0 32 7.163 32 16v352c0 8.837 0 16-32 16h-32v32h304l16-128h-32c-16 80-16 96-64 96h-64c-32 0-32-7.163-32-16V624h80c8.837 0 16 0 16 32v16h32V544h-32v16c0 32-7.163 32-16 32h-80V432c0-8.837 0-16 32-16h64c48 0 48 16 64 96h32l-16-128z\"/></svg>", _s = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7cb342\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m-1.667 22.143L6.92 16.73l3.293-3.293 4.12 4.107 7.455-7.44 3.294 3.293Z\"/></svg>", vs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#cfd8dc\" d=\"M4 6V4h8v2H9v7H7V6z\"/><path fill=\"#ef5350\" d=\"M4 1v1H2v12h2v1H1V1zm8 0v1h2v12h-2v1h3V1z\"/></svg>", ys = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#757575\" d=\"M15 2H6a2.006 2.006 0 0 0-2 2v22a2.006 2.006 0 0 0 2 2h6v-4H6v-2h6v-2H6v-2h6v-2H6v-2h6v-2h2V4l8 8h2v-1Z\" data-mit-no-recolor=\"true\"/><path fill=\"#0288d1\" d=\"M12 12v18h18V12Zm8 6h-2v8h-2v-8h-2v-2h6Zm8 0h-4v2h2a2.006 2.006 0 0 1 2 2v2a2.006 2.006 0 0 1-2 2h-4v-2h4v-2h-2a2.006 2.006 0 0 1-2-2v-2a2.006 2.006 0 0 1 2-2h4Z\"/></svg>", bs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#fbc02d\" d=\"M12 10h10v2H12z\"/><path fill=\"#fbc02d\" d=\"M16 4h2v8h-2zm4 18h10v2H20zm4 2h2v4h-2zm0-20h2v14h-2zM2 18h10v2H2z\"/><path fill=\"#fbc02d\" d=\"M6 18h2v10H6zM6 4h2v10H6zm10 12h2v12h-2z\"/></svg>", xs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><g fill=\"#0288d1\"><path d=\"M2 2v12h12V2zm1 1h10v10H3z\"/><path d=\"M5 7v1h1v4h1V8h1V7zm5 0a1.003 1.003 0 0 0-1 1v1a1.003 1.003 0 0 0 1 1h1v1H9v1h2a1.003 1.003 0 0 0 1-1v-1a1.003 1.003 0 0 0-1-1h-1V8h2V7z\"/></g></svg>", Ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" xml:space=\"preserve\" viewBox=\"0 0 16 16\"><path fill=\"#0288d1\" d=\"M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", Cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff9800\" d=\"m24 6 2 6h-4l-2-6h-3l2 6h-4l-2-6h-3l2 6H8L6 6H5a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3V6Z\"/></svg>", ws = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M22.19 4H16v4h2.19L12 14.19V8h2V4H2v4h2v20h4v-.01l.01.01L28 8V4z\"/></svg>", Ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ab47bc\" d=\"m22 11.8-5.7 4.584L22 20.8zM7.24 23.68 4 21.64v-10.8l3.6-1.2 5.16 3.996L23.2 4 28 7v18.6L22 28l-9.192-8.808zm.36-5.28 2.232-2.064L7.6 14.2Z\"/></svg>", Es = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#a0f\" d=\"M29.313 12h-6.664a1.427 1.427 0 0 1-1.1-2.24l4.398-6.676A.703.703 0 0 0 25.397 2H8.428a.62.62 0 0 0-.55.289l-5.77 8.627A.703.703 0 0 0 2.658 12h8.175a1.427 1.427 0 0 1 1.099 2.24l-4.48 6.676A.702.702 0 0 0 8 22l6.695.002A1.34 1.34 0 0 1 16 23.375v5.934a.652.652 0 0 0 1.168.433l12.694-16.586a.725.725 0 0 0-.55-1.156\"/></svg>", Ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#41b883\" d=\"M1.791 3.851 12 21.471 22.209 3.936V3.85H18.24l-6.18 10.616L5.906 3.851z\"/><path fill=\"#35495e\" d=\"m5.907 3.851 6.152 10.617L18.24 3.851h-3.723L12.084 8.03 9.66 3.85z\"/></svg>", Os = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M22 18h4v4h-4z\"/><path fill=\"#7c4dff\" d=\"M20 2a4 4 0 0 1-8 0H2v28h28V2Zm-2 24h-2v2h-4v-2h-2v2H6v-2H4V16h2v10h4V16h2v10h4V16h2Zm10 2h-2v-4h-4v4h-2V18h2v-2h4v2h2Z\"/></svg>", ks = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fafafa\" fill-opacity=\".785\" d=\"m19.376 15.988-7.708 4.45-7.709-4.45v-8.9l7.709-4.451 7.708 4.45z\"/><path fill=\"#90caf9\" d=\"M12.286 1.98c-.21 0-.41.059-.57.179l-7.9 4.44c-.32.17-.53.5-.53.88v9c0 .38.21.711.53.881l7.9 4.44c.16.12.36.18.57.18s.41-.06.57-.18l7.9-4.44c.32-.17.53-.5.53-.88v-9c0-.38-.21-.712-.53-.882l-7.9-4.44a.95.95 0 0 0-.57-.179zm0 2.15 7 3.94v2.103h-.016v5.177h.016v.54l-7 3.939-7-3.94V8.07zm0 2.08-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/><path fill=\"#0277bd\" d=\"m12.286 6.21-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/></svg>", As = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#01579b\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM7 13l1.5 7h2l1.5-3 1.5 3h2l1.5-7h1v-2h-4v2h1l-.9 4.2L13 15h-2l-1.1 2.2L9 13h1v-2H6v2z\"/></svg>", js = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m.12 13.5 3.74 3.74 1.42-1.41-2.33-2.33 2.33-2.33-1.42-1.41zm11.16 0-3.74-3.74-1.42 1.41 2.33 2.33-2.33 2.33 1.42 1.41z\"/></svg>", Ms = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff5252\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2m12 16v-2H9v2zm-4-4v-2H6v2z\"/></svg>", Ns = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M27.575 23.967a9.9 9.9 0 0 0-3.751 1.726 22.6 22.6 0 0 1-5.537 2.504 1.55 1.55 0 0 1-.931.52 59 59 0 0 1-6.11.548c-1.102.008-1.777-.282-1.965-.735a1.49 1.49 0 0 1 .82-1.965 3.6 3.6 0 0 1-.486-.359c-.163-.162-.334-.487-.385-.367-.213.52-.324 1.794-.897 2.366-.786.795-2.273.53-3.153.069-.965-.513.069-1.718.069-1.718a.69.69 0 0 1-.94-.324 4.6 4.6 0 0 1-.632-2.794 5.2 5.2 0 0 1 1.674-2.76 8.84 8.84 0 0 1 .624-4.17 9.9 9.9 0 0 1 3-3.469S7.136 11.015 7.82 9.177c.444-1.196.623-1.187.769-1.239a3.44 3.44 0 0 0 1.375-.811 4.99 4.99 0 0 1 4.178-1.607s1.094-3.357 2.12-2.7a17.4 17.4 0 0 1 1.452 2.735s1.213-.71 1.35-.445a10.74 10.74 0 0 1 .495 5.81 13.3 13.3 0 0 1-2.46 5.127c-.129.214 1.47.889 2.477 3.683.932 2.554.103 4.699.248 4.938.026.043.034.06.034.06s1.068.085 3.213-1.24a8.05 8.05 0 0 1 4.05-1.52 1.026 1.026 0 0 1 .453 2Z\"/></svg>", Ps = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f9a825\" d=\"M2 8h6v4H2zm8 0h12v4H10zm0 12h12v4H10zm14 0h2v4h-2zM8 20l-3 4H2V12h4v8zm14-8h-6l-6 8h6z\"/><path fill=\"#f9a825\" d=\"M16 20h-6l-6 8m12-16h6l6-8m2 4v16h-4V12h-2l3-4z\"/></svg>", Fs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#afb42b\" d=\"M14 17h-2v-2h-2v-2h2v2h2m0-6h-2v2h2v2h-2v-2h-2V9h2V7h-2V5h2v2h2m5-4H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2\"/></svg>", Is = "file", Ls = {
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
}, Rs = {
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
}, zs = new Map(Object.entries(/* @__PURE__ */ Object.assign({
	"./icons/asciidoc.svg": ya,
	"./icons/assembly.svg": ba,
	"./icons/astro.svg": xa,
	"./icons/audio.svg": Sa,
	"./icons/bicep.svg": Ca,
	"./icons/c.svg": wa,
	"./icons/cabal.svg": Ta,
	"./icons/certificate.svg": Ea,
	"./icons/clojure.svg": Da,
	"./icons/cmake.svg": Oa,
	"./icons/console.svg": ka,
	"./icons/cpp.svg": Aa,
	"./icons/crystal.svg": ja,
	"./icons/csharp.svg": Ma,
	"./icons/css.svg": Na,
	"./icons/dart.svg": Pa,
	"./icons/database.svg": Fa,
	"./icons/diff.svg": Ia,
	"./icons/dll.svg": La,
	"./icons/docker.svg": Ra,
	"./icons/document.svg": za,
	"./icons/editorconfig.svg": Ba,
	"./icons/elixir.svg": Va,
	"./icons/elm.svg": Ha,
	"./icons/erlang.svg": Ua,
	"./icons/eslint.svg": Wa,
	"./icons/exe.svg": Ga,
	"./icons/file.svg": Ka,
	"./icons/font.svg": qa,
	"./icons/fsharp.svg": Ja,
	"./icons/git.svg": Ya,
	"./icons/github-actions-workflow.svg": Xa,
	"./icons/gitlab.svg": Za,
	"./icons/go-mod.svg": Qa,
	"./icons/go.svg": $a,
	"./icons/gradle.svg": eo,
	"./icons/graphql.svg": to,
	"./icons/groovy.svg": no,
	"./icons/h.svg": ro,
	"./icons/handlebars.svg": io,
	"./icons/haskell.svg": ao,
	"./icons/hcl.svg": oo,
	"./icons/hex.svg": so,
	"./icons/hpp.svg": co,
	"./icons/html.svg": lo,
	"./icons/image.svg": uo,
	"./icons/jar.svg": fo,
	"./icons/java.svg": po,
	"./icons/javaclass.svg": mo,
	"./icons/javascript.svg": ho,
	"./icons/json.svg": go,
	"./icons/julia.svg": _o,
	"./icons/jupyter.svg": vo,
	"./icons/key.svg": yo,
	"./icons/kotlin.svg": bo,
	"./icons/kubernetes.svg": xo,
	"./icons/less.svg": So,
	"./icons/license.svg": Co,
	"./icons/lock.svg": wo,
	"./icons/log.svg": To,
	"./icons/lua.svg": Eo,
	"./icons/makefile.svg": Do,
	"./icons/markdown.svg": Oo,
	"./icons/maven.svg": ko,
	"./icons/mdx.svg": Ao,
	"./icons/nginx.svg": jo,
	"./icons/nim.svg": Mo,
	"./icons/nix.svg": No,
	"./icons/nodejs.svg": Po,
	"./icons/npm.svg": Fo,
	"./icons/objective-c.svg": Io,
	"./icons/objective-cpp.svg": Lo,
	"./icons/ocaml.svg": Ro,
	"./icons/pdf.svg": zo,
	"./icons/perl.svg": Bo,
	"./icons/php.svg": Vo,
	"./icons/pnpm.svg": Ho,
	"./icons/powerpoint.svg": Uo,
	"./icons/powershell.svg": Wo,
	"./icons/prettier.svg": Go,
	"./icons/prisma.svg": Ko,
	"./icons/proto.svg": qo,
	"./icons/pug.svg": Jo,
	"./icons/python.svg": Yo,
	"./icons/r.svg": Xo,
	"./icons/react.svg": Zo,
	"./icons/react_ts.svg": Qo,
	"./icons/readme.svg": $o,
	"./icons/ruby.svg": es,
	"./icons/rust.svg": ts,
	"./icons/sass.svg": ns,
	"./icons/sbt.svg": rs,
	"./icons/scala.svg": is,
	"./icons/settings.svg": as,
	"./icons/solidity.svg": os,
	"./icons/storybook.svg": ss,
	"./icons/stylus.svg": cs,
	"./icons/svelte.svg": ls,
	"./icons/svg.svg": us,
	"./icons/swift.svg": ds,
	"./icons/table.svg": fs,
	"./icons/terraform.svg": ps,
	"./icons/test-js.svg": ms,
	"./icons/test-ts.svg": hs,
	"./icons/tex.svg": gs,
	"./icons/todo.svg": _s,
	"./icons/toml.svg": vs,
	"./icons/tsconfig.svg": ys,
	"./icons/tune.svg": bs,
	"./icons/typescript-def.svg": xs,
	"./icons/typescript.svg": Ss,
	"./icons/video.svg": Cs,
	"./icons/vim.svg": ws,
	"./icons/visualstudio.svg": Ts,
	"./icons/vite.svg": Es,
	"./icons/vue.svg": Ds,
	"./icons/webassembly.svg": Os,
	"./icons/webpack.svg": ks,
	"./icons/word.svg": As,
	"./icons/xml.svg": js,
	"./icons/yaml.svg": Ms,
	"./icons/yarn.svg": Ns,
	"./icons/zig.svg": Ps,
	"./icons/zip.svg": Fs
})).map(([e, t]) => [e.slice(8, -4), t]));
function Bs(e) {
	let t = e.slice(e.lastIndexOf("/") + 1).toLowerCase(), n = Ls[t];
	if (n) return n;
	let r = t.split(".");
	for (let e = 1; e < r.length; e++) {
		let t = Rs[r.slice(e).join(".")];
		if (t) return t;
	}
	return Is;
}
var Vs = /* @__PURE__ */ new Map(), Hs = (e) => {
	let t = Vs.get(e);
	if (t) return t;
	let n = zs.get(e) ?? zs.get("file") ?? "", r = `data:image/svg+xml,${encodeURIComponent(n)}`;
	return Vs.set(e, r), r;
};
function Us({ path: e, size: t = 16, className: n }) {
	return /* @__PURE__ */ J("img", {
		src: Hs(Bs(e)),
		alt: "",
		"aria-hidden": !0,
		width: t,
		height: t,
		className: V("shrink-0", n)
	});
}
//#endregion
//#region src/app/atoms/fork-session-item/index.tsx
function Ws(e) {
	return e.replace(/-/g, "").slice(0, 12);
}
var Gs = ({ sessionId: e, title: t, deleted: n = !1, onOpen: r, onDismiss: i }) => {
	let a = n ? "No fork found" : t?.trim() || "Fork", o = `ID: ${Ws(e)}`;
	return n ? /* @__PURE__ */ J("div", {
		className: V("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] max-w-[540px]", "border-l-2 border-tertiary bg-elevation-sublevel-variant-A text-basic-tertiary"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ J(M, {
						iconName: L.Scheme,
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
							iconName: L.Close,
							size: 20
						})
					}) : /* @__PURE__ */ J(M, {
						iconName: L.Close,
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
		className: V("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] text-left max-w-[540px]", "border-l-2 border-accent-primary bg-btn-ghost-accent-highlighted text-btn-accent", "hover:bg-btn-ghost-accent-highlighted-hovered", "active:bg-btn-ghost-accent-highlighted-pressed"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ J(M, {
						iconName: L.Scheme,
						size: 20,
						className: "shrink-0"
					}),
					/* @__PURE__ */ J("span", {
						className: "header-micro",
						children: a
					}),
					/* @__PURE__ */ J(M, {
						iconName: L.Right,
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
}, Ks = ({ icon: e, title: t, description: n, onClick: r, className: i = "" }) => /* @__PURE__ */ Y("button", {
	type: "button",
	onClick: r,
	className: V("group relative flex h-[100px] w-full flex-col items-start overflow-hidden", "rounded-[4px] bg-elevation-level-1 text-left shadow-convex", "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--blue-500)]", i),
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
}({}), qs = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Js = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Ys = {
	"input-small": F.Small,
	"input-medium": F.Medium,
	"input-large": F.Large
}, Xs = {
	"input-small": 16,
	"input-medium": 20,
	"input-large": 24
}, Zs = {
	"input-small": "pl-1",
	"input-medium": "pl-2",
	"input-large": "pl-3"
}, Qs = {
	"input-small": "pr-1",
	"input-medium": "pr-2",
	"input-large": "pr-3"
}, $s = {
	"input-small": "pl-6",
	"input-medium": "pl-9",
	"input-large": "pl-12"
}, ec = {
	"input-small": "pr-7",
	"input-medium": "pr-11",
	"input-large": "pr-14"
}, tc = {
	"input-small": "top-1 left-1",
	"input-medium": "top-2 left-2",
	"input-large": "top-3 left-3"
}, nc = {
	"input-small": "top-1 right-1",
	"input-medium": "top-2 right-2",
	"input-large": "top-3 right-3"
}, Z = ({ inputSize: e = "input-large", leading: t = "none", leadingOnClick: n, leadingSlot: r, trailing: i = "none", trailingOnClick: a, leadingIconName: o = L.Add, trailingIconName: c = L.Search, inputClassName: l = "", label: u = "", required: d = !1, rounded: f = !1, placeholder: p = "", isDisabled: m = !1, validation: h = !1, validationText: g = "", hintText: _, className: v = "", ref: y, ...b }) => {
	let x = V("w-full input font-normal", e, l, f ? "rounded-full" : "rounded-[4px]", t === "none" && !r ? Zs[e] : $s[e], i === "none" ? Qs[e] : ec[e], m && "input-disabled", h && "input-validation"), S = m ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)";
	return /* @__PURE__ */ J(da, {
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
					className: V("absolute flex items-center justify-center", tc[e]),
					style: {
						width: Xs[e],
						height: Xs[e]
					},
					children: r
				}) : null,
				!r && t === "icon" ? /* @__PURE__ */ J(M, {
					iconName: o,
					size: Xs[e],
					className: V("absolute", tc[e]),
					color: S
				}) : null,
				!r && t === "button" ? /* @__PURE__ */ J(s, {
					size: Ys[e],
					variant: I.Ghost,
					content: R.Icon,
					onClick: n,
					className: V("input-btn-leading", !f && "rounded-lg"),
					children: /* @__PURE__ */ J(M, { iconName: o })
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
					size: Xs[e],
					className: V("absolute", nc[e]),
					color: S
				}) : null,
				i === "button" ? /* @__PURE__ */ J(s, {
					size: Ys[e],
					variant: I.Ghost,
					content: R.Icon,
					onClick: a,
					className: V("input-btn-trailing", !f && "rounded-lg"),
					children: /* @__PURE__ */ J(M, { iconName: c })
				}) : null
			]
		})
	});
};
Z.Size = X, Z.Leading = qs, Z.Trailing = Js;
//#endregion
//#region src/app/atoms/input/StickyInput.tsx
var rc = /* @__PURE__ */ function(e) {
	return e.Default = "default", e.Search = "search", e;
}({}), ic = ({ variant: e = "default", leading: t = qs.None, leadingOnClick: n, trailing: r = Js.None, trailingOnClick: i, leadingIconName: a = L.Add, trailingIconName: o = L.Search, inputClassName: c = "", className: l = "", rounded: u = !0, isDisabled: d = !1, validation: f = !1, onClear: p, value: m, ref: h, ...g }) => {
	let _ = e === "search", v = m != null && String(m).length > 0, y = _ ? qs.Icon : t, b = _ ? L.Search : a, x = _ ? v ? Js.Button : Js.None : r, S = _ ? L.Close : o, C = _ ? p : i, w = l.includes("flex-grow") || l.includes("flex-1"), T = u ? "rounded-full" : "rounded-[4px]", E = d ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)", D = {
		[qs.None]: "pl-3",
		[qs.Icon]: "pl-10",
		[qs.Button]: "pl-12"
	}[y], O = {
		[Js.None]: "pr-3",
		[Js.Icon]: "pr-10",
		[Js.Button]: "pr-12"
	}[x];
	return /* @__PURE__ */ J("div", {
		className: V("bg-elevation-level-3 shadow-2xl overflow-hidden h-10", w ? "flex w-full" : "inline-flex w-fit", T, l),
		children: /* @__PURE__ */ Y("div", {
			className: "input-wrapper relative w-full h-full",
			children: [
				y === qs.Icon ? /* @__PURE__ */ J(M, {
					iconName: b,
					size: 24,
					className: "absolute top-2 left-2",
					color: E
				}) : null,
				y === qs.Button ? /* @__PURE__ */ J(s, {
					size: F.Large,
					variant: I.Ghost,
					content: R.Icon,
					onClick: n,
					className: "btn-sticky input-btn-leading",
					children: /* @__PURE__ */ J(M, { iconName: b })
				}) : null,
				/* @__PURE__ */ J("input", {
					ref: h,
					className: V("w-full input input-sticky font-normal", T, D, O, d && "input-disabled", f && "input-validation", c),
					disabled: d,
					value: m,
					...g
				}),
				x === Js.Icon ? /* @__PURE__ */ J(M, {
					iconName: S,
					size: 24,
					className: "absolute top-2 right-2",
					color: E
				}) : null,
				x === Js.Button ? /* @__PURE__ */ J(s, {
					size: F.Large,
					variant: I.Ghost,
					content: R.Icon,
					onClick: C,
					"aria-label": _ ? "Clear search" : void 0,
					className: "btn-sticky input-btn-trailing",
					children: /* @__PURE__ */ J(M, { iconName: S })
				}) : null
			]
		})
	});
};
ic.Variant = rc, ic.Leading = qs, ic.Trailing = Js;
//#endregion
//#region src/app/atoms/input/TextArea.tsx
var ac = /* @__PURE__ */ function(e) {
	return e.Small = "p-2 text-micro", e.Medium = "p-3 text-small", e.Large = "p-4 text-medium", e;
}({}), oc = ({ textAreaSize: e = "p-3 text-small", label: t = "", required: n = !1, isDisabled: r = !1, validation: i = !1, validationText: a = "", hintText: o, className: s = "", textAreaClassName: c = "", ref: l, ...u }) => /* @__PURE__ */ J(da, {
	label: t,
	required: n,
	validation: i,
	validationText: a,
	hintText: o,
	className: s,
	children: /* @__PURE__ */ J("textarea", {
		ref: l,
		className: V("w-full input font-normal rounded-[4px]", e, r && "input-disabled", i && "input-validation", c),
		disabled: r,
		...u
	})
});
oc.Size = ac;
//#endregion
//#region src/app/atoms/loader/CircularLoader.tsx
var sc = /* @__PURE__ */ function(e) {
	return e.Brand = "stroke-[var(--color-fill-accent-primary)]", e.Neutral = "stroke-[var(--color-fill-basic-primary)]", e.Destructive = "stroke-[var(--color-fill-error-primary)]", e;
}({}), cc = ({ size: e = A.Medium, variant: t = "stroke-[var(--color-fill-basic-primary)]", strokeWidth: n = 2, className: r = "", ...i }) => {
	let a = Zr().replace(/:/g, ""), o = `circular-loader-mask-${a}`, s = `circular-loader-gradient-${a}`, c = 12 - n / 2;
	return /* @__PURE__ */ J("div", {
		className: V("inline-flex w-fit h-fit animate-spin", r),
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
cc.Size = A, cc.Variant = sc;
//#endregion
//#region src/app/atoms/loader/ProgressLoader.tsx
var lc = ({ active: e = !1, className: t = "" }) => /* @__PURE__ */ J("div", {
	className: V("h-px w-full overflow-hidden transition-opacity duration-150", e ? "opacity-100" : "opacity-0", t),
	children: /* @__PURE__ */ J("div", { className: "h-full w-full rounded-full bg-accent-inverse animate-progress" })
}), uc = "M121.021 9.70276e-06C121.635 0.00562721 122.201 0.336563 122.507 0.870577L135.925 24.2549C136.063 24.7077 136.011 25.2039 135.77 25.6245C123.798 46.5422 95.5972 95.432 95.5972 95.432C95.2748 95.7673 94.8263 95.9633 94.35 95.9633C94.35 95.9633 41.4186 95.9998 14.9471 96C14.327 96 13.7541 95.6678 13.4452 95.1289L0.251482 72.1142C-0.109585 71.4843 -0.0743152 70.5531 0.308855 69.8878C0.308855 69.8878 26.8205 24.1272 39.9734 1.1421C40.3239 0.529539 40.9631 0.0326747 41.6869 0.0326651C41.6869 0.0331171 121.021 9.70276e-06 121.021 9.70276e-06ZM17.9867 92.5287H38.3062L28.0888 74.8628L17.9867 92.5287ZM71.4405 92.4921H91.3571L81.3833 75.1488L71.4405 92.4921ZM44.4776 92.3253H64.8395L54.7068 74.6392L44.4776 92.3253ZM94.3943 90.7219L104.699 72.9047H84.1208L94.3943 90.7219ZM31.4008 73.0222L41.4435 90.5842L51.4972 73.0222H31.4008ZM84.704 69.3835H104.622L94.6593 51.9934L84.704 69.3835ZM31.5361 69.3112H51.9053L41.7633 51.595L31.5361 69.3112ZM107.678 67.7382L117.965 49.7693H97.3917L107.678 67.7382ZM98.0384 46.2393H117.945L107.94 28.9421L98.0384 46.2393ZM120.957 44.5242L131.277 26.4965H110.637L120.957 44.5242ZM68.3422 44.1304L78.6021 26.3231H58.0823L68.3422 44.1304ZM110.648 23.0128H131.258L120.976 5.23426L110.648 23.0128ZM58.1921 22.8519H78.4107L68.3014 5.46138L58.1921 22.8519ZM55.0653 21.3342L65.4303 3.50386H44.7004L55.0653 21.3342ZM81.5178 21.3003L91.8827 3.46996H71.1528L81.5178 21.3003Z", dc = "M153.045 9.30753e-05C153.475 0 153.734 0.165348 153.935 0.513892C156.659 5.22122 159.463 9.99634 162.212 14.7289L170.478 0.496114C170.663 0.188622 170.997 1.01676e-06 171.357 0C189.161 0.00012553 206.964 0.0226173 224.768 0.0226173C225.263 0.0226173 225.641 0.126836 225.863 0.498976L234.863 16.1296C235.046 16.4462 235.045 16.8479 234.863 17.1649L208.298 63.4387C208.131 63.7127 207.797 64 207.444 64C207.444 64 171.362 63.9773 153.308 63.9774C152.95 63.9774 152.567 63.7127 152.417 63.4632L144.303 49.3669L136.244 63.3367C136.08 63.5817 135.817 63.9484 135.411 63.9484C135.411 63.9484 96.8361 63.9773 81.4848 63.9773C81.4838 63.9773 81.4828 63.9773 81.4819 63.9773C81.479 63.9773 81.4762 63.9774 81.4734 63.9774C81.1058 63.9774 80.7662 63.7813 80.5831 63.4632L72.7738 49.8976L64.8804 63.4892C64.6968 63.8053 64.3583 64 63.9921 64C63.9921 64 27.959 63.9802 9.97191 63.9803C9.6043 63.9803 9.26474 63.7841 9.08163 63.4661L0.136438 47.9273C-0.0460772 47.6102 -0.0454374 47.2201 0.138117 46.9037C0.13793 46.9037 26.9095 0.698576 26.9095 0.698576C27.1378 0.308359 27.4681 0.0248531 27.9419 0.0248511C45.8728 0.0248511 81.7347 0 81.7347 0C82.1599 1.62705e-08 82.6177 0.296445 82.8391 0.692247L90.6841 14.2006L98.6433 0.496114C98.8288 0.188622 99.1624 1.01676e-06 99.5229 0C117.363 0.000125786 135.204 2.31608e-05 153.045 9.30753e-05ZM48.0609 61.9748H61.9268L54.9897 49.9265L48.0609 61.9748ZM191.465 61.9508H205.669L198.567 49.6279L191.465 61.9508ZM11.7777 61.9311H26.0793L18.9273 49.4798L11.7777 61.9311ZM83.2587 61.9282H97.5671L90.4129 49.5006L83.2587 61.9282ZM101.147 61.9282H115.448L108.296 49.4771L101.147 61.9282ZM29.906 61.7949H43.9006L36.9004 49.6222L29.906 61.7949ZM119.275 61.7921H133.27L126.269 49.6193L119.275 61.7921ZM63.9921 60.9321L71.1556 48.5974H56.8286L63.9921 60.9321ZM99.3581 60.8662L106.512 48.4386H92.2039L99.3581 60.8662ZM135.263 60.8448L142.361 48.5974H128.218L135.263 60.8448ZM27.8172 60.7005L34.7728 48.6002H20.7913L27.8172 60.7005ZM207.524 60.6894L214.566 48.4386H200.481L207.524 60.6894ZM20.8834 46.3924H35.0459L27.9937 34.1242L20.8834 46.3924ZM182.087 46.3895H196.249L189.197 34.1219L182.087 46.3895ZM164.037 46.3895H178.359L171.198 34.0343L164.037 46.3895ZM57.0693 46.2307H70.9708L64.0186 34.1364L57.0693 46.2307ZM128.29 46.2307H142.191L135.239 34.1364L128.29 46.2307ZM200.484 46.1626H214.258L207.38 34.1969L200.484 46.1626ZM180.223 45.5056L187.395 33.0359H173.05L180.223 45.5056ZM198.194 45.3711L205.285 33.0359H191.041L198.194 45.3711ZM216.337 45.3669L223.425 33.0359H209.23L216.337 45.3669ZM144.355 45.1453L151.299 33.0359H137.389L144.355 45.1453ZM72.8971 44.7322L79.6799 33.0359H66.1684L72.8971 44.7322ZM65.8535 30.9867H79.973L72.9494 18.7682L65.8535 30.9867ZM101.228 30.9867H115.536L108.378 18.7232L101.228 30.9867ZM137.09 30.9867H151.194L144.196 18.813L137.09 30.9867ZM173.063 30.9867H187.369L180.212 18.7239L173.063 30.9867ZM191.078 30.9867H205.279L198.165 18.6904L191.078 30.9867ZM209.219 30.9867H223.294L216.257 18.7753L209.219 30.9867ZM45.8569 29.9615L52.9107 17.7693H38.8302L45.8569 29.9615ZM207.059 29.9591L214.112 17.7693H200.034L207.059 29.9591ZM153.161 29.9309L160.23 17.6333H146.019L153.161 29.9309ZM117.363 29.9065L124.388 17.7693H110.287L117.363 29.9065ZM189.197 29.9058L196.222 17.7693H182.121L189.197 29.9058ZM225.16 29.8901L232.198 17.6787H218.122L225.16 29.8901ZM81.7234 29.5569L88.6482 17.6333H74.7987L81.7234 29.5569ZM38.6257 15.587H52.7652L45.7468 3.38717L38.6257 15.587ZM74.7873 15.5841H89.1142L81.9508 3.24932L74.7873 15.5841ZM146.008 15.5841H160.335L153.171 3.24932L146.008 15.5841ZM217.88 15.4026H232.084L224.982 3.0797L217.88 15.4026ZM164.21 15.3754L174.931 9.22166L171.357 3.06792L164.21 15.3754ZM92.4047 15.3247L103.071 9.17803L99.5229 3.06792L92.4047 15.3247ZM215.969 14.4006L223.101 2.07176H208.836L215.969 14.4006ZM54.7173 14.3916L61.9217 2.04914H47.5129L54.7173 14.3916ZM144.055 14.3915L151.259 2.04905H136.85L144.055 14.3915ZM36.917 14.3898L43.9936 2.07399H29.7281L36.917 14.3898ZM176.746 8.2023L187.531 2.04914H173.155L176.746 8.2023ZM104.85 8.15332L115.695 2.0491H101.305L104.85 8.15332Z", fc = ({ height: e = 20, markOnly: t = !1, className: n = "" }) => t ? /* @__PURE__ */ J("svg", {
	height: e,
	viewBox: "0 0 136 96",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	className: n,
	role: "img",
	"aria-label": "NAC",
	children: /* @__PURE__ */ J("path", {
		fill: "currentColor",
		d: uc
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
		d: dc
	})
}), pc = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), mc = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), hc = {
	info: "bg-info-primary text-info-primary border-info-primary",
	error: "bg-error-primary text-error-primary border-error-primary",
	danger: "bg-danger-primary text-danger-primary border-danger-primary",
	success: "bg-success-primary text-success-primary border-success-primary"
}, gc = {
	info: L.Info,
	error: L.Danger,
	danger: L.Danger,
	success: L.CheckCircle
}, _c = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, vc = {
	small: "p-2 gap-2",
	medium: "p-3 gap-2",
	large: "p-4 gap-3"
}, yc = {
	small: "label-micro",
	medium: "label-small",
	large: "label-medium"
}, bc = {
	small: "text-micro",
	medium: "text-small",
	large: "text-medium"
}, xc = {
	small: 16,
	medium: 20,
	large: 24
}, Sc = ({ title: e, variant: t = "info", size: n = "small", className: r = "", children: i, ...a }) => /* @__PURE__ */ Y("div", {
	className: V("flex rounded-[4px] border", hc[t], vc[n], r),
	...a,
	children: [/* @__PURE__ */ J(M, {
		iconName: gc[t],
		size: xc[n],
		color: _c[t],
		className: "shrink-0"
	}), /* @__PURE__ */ Y("div", {
		className: "flex-1 min-w-0 flex flex-col gap-1",
		children: [e ? /* @__PURE__ */ J("div", {
			className: yc[n],
			children: e
		}) : null, i ? /* @__PURE__ */ J("div", {
			className: V("opacity-80", bc[n]),
			children: i
		}) : null]
	})]
});
Sc.Variant = pc, Sc.Size = mc;
//#endregion
//#region src/app/atoms/model-pill/index.tsx
var Cc = /* @__PURE__ */ function(e) {
	return e[e.Small = 24] = "Small", e[e.Medium = 32] = "Medium", e;
}({}), wc = {
	32: 16,
	24: 18
}, Tc = {
	32: A.Large,
	24: A.Small
}, Ec = ({ size: e = 32, active: t = !1, className: n = "", ...r }) => /* @__PURE__ */ Y("div", {
	className: V("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full", "border", t ? "border-transparent" : "border-secondary", n),
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
			iconName: L.Brain,
			size: wc[e],
			color: "var(--color-fill-basic-primary)",
			className: "relative"
		}),
		t ? /* @__PURE__ */ J(cc, {
			size: Tc[e],
			className: "absolute inset-0 m-auto"
		}) : null
	]
});
Ec.Size = Cc;
//#endregion
//#region src/app/atoms/number-input/index.tsx
var Dc = {
	[X.Small]: F.Small,
	[X.Medium]: F.Medium,
	[X.Large]: F.Large
}, Oc = (e, t, n) => Math.min(Math.max(e, t), n), kc = ({ value: e, onChange: t, min: n = 0, max: r = 2 ** 53 - 1, step: i = 1, size: a = X.Medium, disabled: o = !1, className: c = "", "aria-label": l }) => {
	let [u, d] = K(String(e)), [f, p] = K(e);
	f !== e && (p(e), d(String(e)));
	let m = () => {
		let i = Number(u);
		if (u.trim() === "" || Number.isNaN(i)) {
			d(String(e));
			return;
		}
		let a = Oc(i, n, r);
		d(String(a)), a !== e && t(a);
	}, h = (i) => {
		let a = Oc(e + i, n, r);
		a !== e && t(a);
	};
	return /* @__PURE__ */ Y("div", {
		className: V("flex items-center gap-2 w-fit", c),
		children: [
			/* @__PURE__ */ J(s, {
				variant: I.Secondary,
				size: Dc[a],
				content: R.Icon,
				disabled: o || e <= n,
				"aria-label": "Decrease",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => h(-i),
				children: /* @__PURE__ */ J(M, { iconName: L.Remove })
			}),
			/* @__PURE__ */ J("input", {
				type: "text",
				inputMode: "numeric",
				role: "spinbutton",
				"aria-label": l,
				"aria-valuenow": e,
				"aria-valuemin": n,
				"aria-valuemax": r,
				className: V("input rounded-[4px] text-center w-16 px-1 font-normal", a, o && "input-disabled"),
				value: u,
				disabled: o,
				onChange: (e) => d(e.target.value),
				onBlur: m,
				onKeyDown: (e) => {
					e.key === "Enter" && (e.preventDefault(), m()), e.key === "ArrowUp" && (e.preventDefault(), h(i)), e.key === "ArrowDown" && (e.preventDefault(), h(-i));
				}
			}),
			/* @__PURE__ */ J(s, {
				variant: I.Secondary,
				size: Dc[a],
				content: R.Icon,
				disabled: o || e >= r,
				"aria-label": "Increase",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => h(i),
				children: /* @__PURE__ */ J(M, { iconName: L.Add })
			})
		]
	});
}, Ac = ({ page: e, pageSize: t, totalItems: n, onPageChange: r, itemLabel: i = "items", className: a = "" }) => {
	let o = g(), c = Math.max(1, Math.ceil(n / t)), l = n === 0 ? 0 : (e - 1) * t + 1, u = Math.min(e * t, n);
	return /* @__PURE__ */ Y("div", {
		className: V("flex items-center w-full gap-4 px-4 py-3", o ? "justify-center" : "justify-between", a),
		children: [o ? null : /* @__PURE__ */ Y("div", {
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
				/* @__PURE__ */ J(s, {
					variant: I.Tertiary,
					size: F.Small,
					content: R.Icon,
					disabled: e <= 1,
					"aria-label": "Previous page",
					onClick: () => r(e - 1),
					children: /* @__PURE__ */ J(M, { iconName: L.Left })
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
				/* @__PURE__ */ J(s, {
					variant: I.Tertiary,
					size: F.Small,
					content: R.Icon,
					disabled: e >= c,
					"aria-label": "Next page",
					onClick: () => r(e + 1),
					children: /* @__PURE__ */ J(M, { iconName: L.Right })
				})
			]
		})]
	});
}, jc = 6, Mc = 36;
function Nc(e) {
	let t = String(e ?? ""), n = 2166136261;
	for (let e = 0; e < t.length; e += 1) n ^= t.charCodeAt(e), n = Math.imul(n, 16777619) >>> 0;
	return n >>> 0;
}
function Pc(e) {
	let t = e >>> 0 || 2654435769;
	return () => (t = (t ^ t << 13) >>> 0, t = (t ^ t >>> 17) >>> 0, t = (t ^ t << 5) >>> 0, t);
}
function Fc(e) {
	return `hsl(${Nc(e) % 360} 75% 50%)`;
}
function Ic(e) {
	let t = e % jc, n = (e - t) / jc, r = [];
	return n > 0 && r.push(e - jc), n < 5 && r.push(e + jc), t > 0 && r.push(e - 1), t < 5 && r.push(e + 1), r;
}
function Lc(e) {
	let t = Array.from({ length: Mc }, () => !1), n = [];
	for (let e = 0; e < Mc; e += 1) {
		let t = e % jc, r = (e - t) / jc;
		(r === 0 || t === 0 || r === 5 || t === 5) && n.push(e);
	}
	let r = 4 + e() % 5, i = 0;
	for (; i < r && n.length > 0;) {
		let r = e() % 2 == 0 ? n.length - 1 : e() % n.length, a = n.splice(r, 1)[0];
		if (!t[a]) {
			t[a] = !0, i += 1;
			for (let e of Ic(a)) !t[e] && !n.includes(e) && n.push(e);
		}
	}
	return t;
}
function Rc(e) {
	let t = Pc(Nc(e)), n = Lc(t), r = [];
	for (let e = 0; e < Mc; e += 1) r.push(n[e] ? 0 : t() % 7 < 4 ? 1 : 2);
	return r;
}
var zc = 40, Bc = 1.5;
function Vc(e) {
	let t = Math.max(1, Bc * e / zc);
	return t * jc / (e - t);
}
var Hc = ({ id: e, size: t = 40, isRunning: n = !1, className: r = "", ...i }) => {
	let a = Fc(e), o = Rc(e), s = Vc(t), c = s / 2;
	return /* @__PURE__ */ J("svg", {
		className: V("block shrink-0", n && "pulse-dim", r),
		width: t,
		height: t,
		viewBox: `${-c} ${-c} ${jc + s} ${jc + s}`,
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		"aria-hidden": "true",
		...i,
		children: o.map((e, t) => e === 0 ? null : /* @__PURE__ */ J("rect", {
			x: t % jc,
			y: Math.floor(t / jc),
			width: "1",
			height: "1",
			fill: e === 2 ? a : "none",
			stroke: a,
			strokeWidth: s
		}, t))
	});
}, Uc = /* @__PURE__ */ function(e) {
	return e.Project = "project", e.Orphan = "orphan", e;
}({}), Wc = ({ entityId: e, name: t, variant: n = "project", active: r = !1, running: i = !1, trailing: a, isMobile: o = !1, actions: s, className: c = "", type: l = "button", ...u }) => /* @__PURE__ */ Y("div", {
	className: V("group flex items-center min-w-0 rounded-[4px] hover:bg-btn-ghost-hovered", o ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1", r && "bg-btn-ghost-highlighted", c),
	children: [
		/* @__PURE__ */ Y("button", {
			type: l,
			className: V("flex flex-1 items-center min-w-0 text-left", o ? "gap-3" : "gap-1.5"),
			...u,
			children: [n === "orphan" ? /* @__PURE__ */ J(Ii, {
				size: 24,
				isRunning: i
			}) : /* @__PURE__ */ J(Hc, {
				id: e,
				size: 24,
				isRunning: i,
				className: "rounded-[2px]"
			}), /* @__PURE__ */ J("span", {
				className: V("flex-1 truncate", o ? "text-medium" : "label-small", i ? "text-shimmer-basic" : "text-basic-primary"),
				children: t
			})]
		}),
		a ? /* @__PURE__ */ J("span", {
			className: V("shrink-0 label-micro text-basic-muted", s && !o && "group-hover:hidden group-has-[:focus-visible]:hidden"),
			children: a
		}) : null,
		s ? /* @__PURE__ */ J("div", {
			className: V("items-center shrink-0", o ? "flex gap-3" : "hidden gap-1.5 group-hover:flex group-has-[:focus-visible]:flex"),
			children: s
		}) : null
	]
});
Wc.Variant = Uc;
//#endregion
//#region src/app/atoms/radio/index.tsx
var Gc = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ Y("label", {
	className: V("flex items-start gap-2 w-fit", n ? "cursor-not-allowed opacity-60" : "", i),
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
			className: V("flex items-center justify-center shrink-0 mt-[1px] w-4 h-4 rounded-full border transition-colors duration-150", "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-primary", n ? "bg-btn-secondary-disabled border-muted" : "bg-btn-secondary border-secondary hover:bg-btn-secondary-hovered hover:border-tertiary"),
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
}), Kc = 8, qc = (e, t, n) => Math.min(Math.max(e, t), n), Jc = ({ min: e, max: t, value: n, onChange: r, step: i = 1, disabled: a = !1, label: o, className: s = "" }) => {
	let c = G(null), l = H((a) => {
		let o = qc(Math.round(a / i) * i, e, t), s = Number(o.toFixed(4));
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
		let a = qc((n - i.left) / i.width, 0, 1);
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
	}, m = t === e ? 0 : (n - e) / (t - e) * 100, h = Kc * (1 - 2 * m / 100);
	return /* @__PURE__ */ Y("div", {
		ref: c,
		role: "slider",
		tabIndex: a ? -1 : 0,
		"aria-label": o ?? "Range",
		"aria-valuemin": e,
		"aria-valuemax": t,
		"aria-valuenow": n,
		"aria-disabled": a,
		className: V("group relative h-1 w-full rounded-full outline-none touch-none select-none", a ? "bg-input-progress-bar-disabled cursor-not-allowed" : "bg-input-progress-bar cursor-auto", s),
		onPointerDown: d,
		onPointerMove: f,
		onKeyDown: p,
		children: [/* @__PURE__ */ J("div", {
			className: V("absolute inset-y-0 left-0 rounded-full", a ? "bg-input-progress-disabled" : "bg-input-progress"),
			style: { width: `${m}%` }
		}), /* @__PURE__ */ J("div", {
			className: V("absolute top-1/2 w-4 h-4 rounded-full shadow-md -translate-y-1/2 -translate-x-1/2", a ? "bg-input-knob-disabled" : "bg-input-knob group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-accent-primary"),
			style: { left: `calc(${m}% + ${h}px)` }
		})]
	});
}, Yc = /* @__PURE__ */ function(e) {
	return e.Large = "btn-large", e.Medium = "btn-medium", e.Small = "btn-small", e;
}({}), Xc = /* @__PURE__ */ function(e) {
	return e.Regular = "btn-ghost", e.Accent = "btn-ghost-accent", e.Destructive = "btn-ghost-destructive", e;
}({}), Zc = ({ size: e = "btn-medium", variant: t = "btn-ghost", active: n = !1, disabled: r, className: i = "", children: a, hoverHint: o, trailing: s, ...c }) => {
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
				children: /* @__PURE__ */ J(oa, {
					title: o.title,
					description: o.description,
					muted: o.muted,
					position: z.CenterRight
				})
			}) : null
		]
	});
};
Zc.Size = Yc, Zc.Variant = Xc;
//#endregion
//#region src/app/atoms/select/index.tsx
var Qc = {
	[F.Small]: Yc.Small,
	[F.Medium]: Yc.Medium,
	[F.Large]: Yc.Large
}, $c = ({ items: e = [], value: t, onValueChange: n, size: r = F.Medium, itemSize: i, variant: a = I.Secondary, placement: o = z.BottomRight, placeholder: c = "Select...", disabled: l = !1, sticky: u = !1, className: d = "", trailingIcon: f = L.Down, triggerClassName: p = "", panelClassName: m = "", onOpenChange: h }) => {
	let [g, _] = K(!1), v = e.find((e) => e.id === t), y = i ?? Qc[r], b = (e) => {
		_(e), h?.(e);
	}, x = (e) => {
		n?.(e), b(!1);
	};
	return /* @__PURE__ */ J(Ln, {
		open: g,
		onClose: () => b(!1),
		placement: o,
		size: u ? hn.Fit : "min-w-full",
		sticky: u,
		className: d,
		panelClassName: m,
		content: /* @__PURE__ */ J("div", {
			className: "flex flex-col gap-1 px-2 md:px-0",
			children: e.map((e) => /* @__PURE__ */ Y(Zc, {
				size: y,
				variant: Xc.Regular,
				active: e.id === t,
				hoverHint: e.hoverHint,
				onClick: () => x(e.id),
				children: [e.icon ? /* @__PURE__ */ J(M, { iconName: e.icon }) : null, /* @__PURE__ */ J("span", {
					className: "text-left flex-grow",
					children: e.label
				})]
			}, e.id))
		}),
		children: /* @__PURE__ */ Y(s, {
			variant: a,
			size: r,
			disabled: l,
			content: R.IconRight,
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
					className: V(f === L.Down && "transition-transform duration-150 ease-out", f === L.Down && (g ? "rotate-180" : "rotate-0"))
				})
			]
		})
	});
}, el = "M95 64.7797H79.5544V78.0484H95V96H0V31.2203H61.7894V0H95V64.7797ZM33.2129 93.6586H46.3415V80.3898H33.2129V93.6586ZM48.6585 93.6586H61.7894V80.3898H48.6585V93.6586ZM79.5544 93.6586H92.6829V80.3898H79.5544V93.6586ZM2.31707 78.0484H15.4479V64.7797H2.31707V78.0484ZM17.765 78.0484H30.8936V49.1718H17.765V78.0484ZM33.2106 78.0484H46.3415V64.7797H33.2106V78.0484ZM2.31707 62.4383H15.4479V49.1718H2.31707V62.4383ZM48.6585 62.4383H61.7894V49.1718H48.6585V62.4383ZM64.1064 62.4383H77.235V49.1718H64.1064V62.4383ZM79.5544 62.4383H92.6829V49.1718H79.5544V62.4383ZM17.765 46.8304H30.8936V33.5617H17.765V46.8304ZM33.2129 46.8282H46.3415V33.5617H33.2129V46.8282ZM79.5544 46.8282H92.6829V33.5617H79.5544V46.8282ZM64.1064 31.2203H77.235V17.9516H64.1064V31.2203ZM64.1064 15.6101H77.235V2.34141H64.1064V15.6101ZM79.5544 15.6101H92.6829V2.34141H79.5544V15.6101Z", tl = "M48.6585 17.9516H0V0H48.6585V17.9516ZM2.31707 15.6101H15.4479V2.34141H2.31707V15.6101ZM17.765 15.6101H30.8936V2.34141H17.765V15.6101Z", nl = ({ className: e = "" }) => /* @__PURE__ */ Y("svg", {
	width: 95,
	height: 96,
	viewBox: "0 0 95 96",
	xmlns: "http://www.w3.org/2000/svg",
	className: V("fill-basic-muted", e),
	"aria-hidden": !0,
	children: [/* @__PURE__ */ J("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: el
	}), /* @__PURE__ */ J("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: tl
	})]
}), rl = /* @__PURE__ */ function(e) {
	return e.Muted = "muted", e.Tertiary = "tertiary", e.Secondary = "secondary", e.Primary = "primary", e;
}({}), il = /* @__PURE__ */ function(e) {
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
Q.Variant = rl, Q.Orientation = il;
//#endregion
//#region src/app/atoms/switch/index.tsx
var al = /* @__PURE__ */ function(e) {
	return e.Medium = "medium", e.Large = "large", e;
}({}), ol = {
	medium: "w-9 h-5",
	large: "w-11 h-6"
}, sl = {
	medium: "w-4 h-4",
	large: "w-5 h-5"
}, cl = {
	medium: "translate-x-4",
	large: "translate-x-5"
}, ll = ({ checked: e = !1, disabled: t = !1, onChange: n, size: r = "medium", className: i = "", ...a }) => /* @__PURE__ */ J("button", {
	type: "button",
	role: "switch",
	"aria-checked": e,
	disabled: t,
	onClick: () => !t && n?.(!e),
	className: V("relative shrink-0 rounded-full transition-colors duration-150", ol[r], t ? "bg-input-switcher-disabled cursor-not-allowed" : e ? "bg-input-switcher-active cursor-auto" : "bg-input-switcher cursor-auto", i),
	...a,
	children: /* @__PURE__ */ J("span", { className: V("absolute top-0.5 left-0.5 rounded-full transition-transform duration-150", sl[r], t ? "bg-input-knob-disabled" : "bg-input-knob", e ? cl[r] : "translate-x-0") })
}), ul = ({ tags: e, selected: t, onChange: n, disabled: r = !1, className: i = "" }) => {
	let a = (e) => {
		n(t.includes(e) ? t.filter((t) => t !== e) : [...t, e]);
	};
	return /* @__PURE__ */ J("div", {
		className: V("flex flex-wrap gap-2", i),
		children: e.map((e) => {
			let n = t.includes(e);
			return /* @__PURE__ */ J(s, {
				size: F.Small,
				variant: n ? I.SecondaryAccent : I.Secondary,
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
function dl({ title: e, pinned: t = !1, onPin: n, onRename: r, onDelete: i }) {
	return /* @__PURE__ */ Y(q, { children: [
		n ? /* @__PURE__ */ J(s, {
			variant: I.Ghost,
			size: F.Small,
			content: R.Icon,
			title: t ? "Unpin chat" : "Pin chat",
			"aria-label": `${t ? "Unpin" : "Pin"} ${e}`,
			onClick: n,
			children: /* @__PURE__ */ J(M, { iconName: t ? L.Unpin : L.Pin })
		}) : null,
		r ? /* @__PURE__ */ J(s, {
			variant: I.Ghost,
			size: F.Small,
			content: R.Icon,
			title: "Rename chat",
			"aria-label": `Rename ${e}`,
			onClick: r,
			children: /* @__PURE__ */ J(M, { iconName: L.Edit })
		}) : null,
		i ? /* @__PURE__ */ J(s, {
			variant: I.GhostDestructive,
			size: F.Small,
			content: R.Icon,
			title: "Delete chat",
			"aria-label": `Delete ${e}`,
			onClick: i,
			children: /* @__PURE__ */ J(M, { iconName: L.Trash })
		}) : null
	] });
}
//#endregion
//#region src/app/components/projects/GroupLabel.tsx
function fl({ children: e, className: t }) {
	return /* @__PURE__ */ Y("div", {
		className: V("flex items-baseline gap-2", t),
		children: [/* @__PURE__ */ J("span", {
			className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
			children: e
		}), /* @__PURE__ */ J(Q, { className: "shrink" })]
	});
}
//#endregion
//#region node_modules/effect/dist/esm/Layer.js
var pl = _e;
//#endregion
//#region src/app/hooks/useSessionTitle.ts
function ml() {
	let { data: e = [] } = Xt(), t = Cr(e);
	return (e) => qe(e, t);
}
//#endregion
//#region src/app/lib/projects.ts
function hl(e) {
	return e.filter((e) => e.lineage == null);
}
function gl(e, t) {
	let n = t;
	for (let t of hl(e)) Rr(t.summary.updated_at) > Rr(n) && (n = t.summary.updated_at);
	return n;
}
function _l(e, t) {
	return Rr(t.summary.updated_at) - Rr(e.summary.updated_at);
}
function vl(e, t) {
	return hl(e).filter((e) => e.summary.project_id === t).sort(_l)[0] ?? null;
}
function yl(e, t) {
	return hl(e).filter((e) => e.summary.project_id === t).sort((e, t) => Rr(t.summary.created_at) - Rr(e.summary.created_at))[0] ?? null;
}
function bl(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let e of hl(t)) {
		let t = e.summary.project_id;
		if (!t) continue;
		let r = n.get(t);
		r ? r.push(e) : n.set(t, [e]);
	}
	return e.map((e) => {
		let t = (n.get(e.project_id) ?? []).sort(_l);
		return {
			project: e,
			sessions: t,
			running: t.filter((e) => Dt(e.active_run)).length,
			totalCostMicros: t.reduce((e, t) => e + (t.summary.total_cost_micros ?? 0), 0),
			updatedAt: gl(t, e.updated_at)
		};
	});
}
function xl(e) {
	return e.filter((e) => e.lineage == null && !e.summary.project_id).sort((e, t) => x(e.summary, t.summary));
}
function Sl(e) {
	return e.kind === "project" ? e.entry.project.project_id : e.session.summary.session_id;
}
function Cl(e, t) {
	return [...bl(e, t).map((e) => ({
		kind: "project",
		entry: e
	})), ...xl(t).map((e) => ({
		kind: "orphan",
		session: e
	}))];
}
function wl(e, t) {
	return t ? e.find((e) => e.project_id === t) ?? null : null;
}
function Tl(e, t) {
	return e.cwd === t.cwd && (e.ssh_host ?? null) === (t.ssh_host ?? null) && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function El(e) {
	return {
		cwd: e.cwd,
		ssh_host: e.ssh_host ?? null,
		ssh_port: e.ssh_port ?? null,
		ssh_identity_file: e.ssh_identity_file ?? null
	};
}
function Dl(e, t) {
	return t ? e.find((e) => Tl(e, t)) ?? null : null;
}
var Ol = [
	"Pinned",
	"Today",
	"Yesterday",
	"This week",
	"This month",
	"Older"
];
function kl(e) {
	let t = new Date(e);
	return t.setHours(0, 0, 0, 0), t;
}
function Al(e, t) {
	let n = new Date(e);
	return n.setDate(n.getDate() - t), n.getTime();
}
function jl(e, t) {
	let n = Rr(e);
	if (!Number.isFinite(n)) return "Older";
	let r = kl(t);
	return n >= r.getTime() ? "Today" : n >= Al(r, 1) ? "Yesterday" : n >= Al(r, 7) ? "This week" : n >= Al(r, 30) ? "This month" : "Older";
}
function Ml(e, t, n) {
	let r = /* @__PURE__ */ new Map();
	for (let i of e) {
		let { updatedAt: e, pinned: a } = t(i), o = a ? "Pinned" : jl(e, n), s = r.get(o);
		s ? s.push(i) : r.set(o, [i]);
	}
	return Ol.flatMap((e) => {
		let t = r.get(e);
		return t && t.length > 0 ? [{
			label: e,
			items: t
		}] : [];
	});
}
//#endregion
//#region src/app/lib/sessionBehavior.ts
var Nl = [
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
function Pl(e) {
	return Nl.find((t) => t.id === e) ?? Nl[0];
}
function Fl(e) {
	switch (e) {
		case "direct": return L.Plane;
		case "direct-with-orchestrator": return L.PlaneAdd;
		default: return L.Orchestrator;
	}
}
var Il = {
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
}, Ll = {
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
}, Rl = {
	widePanels: ["files"],
	mobilePanels: ["files", "history"],
	defaultPanel: "files",
	readOnly: !0
}, zl = {
	...Il,
	readOnly: !0
};
function Bl(e, t) {
	return t === "traditional-child" ? Rl : t === "managed-orchestrator" ? zl : Pl(e).id === "orchestrator" ? Il : Ll;
}
//#endregion
//#region src/app/components/projects/ChatSessionList.tsx
var Vl = 6e4;
function Hl({ sessions: e, activeSessionId: t = null, onOpen: n, onRename: r, onDelete: i, onPin: a, isMobile: o = !1, emptyLabel: s = "No chats" }) {
	let c = ct(), l = rr(Vl), u = ml(), d = W(() => Ml(e, (e) => ({
		updatedAt: e.summary.updated_at,
		pinned: !!e.summary.pinned
	}), l), [e, l]);
	return e.length === 0 ? /* @__PURE__ */ J("div", {
		className: "label-small text-basic-muted px-2 py-1",
		children: s
	}) : /* @__PURE__ */ J("div", {
		className: "flex flex-col gap-8",
		children: d.map((e) => /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ J(fl, {
				className: "px-2",
				children: e.label
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let s = u(e.summary), l = Pl(e.summary.behavior);
					return /* @__PURE__ */ J(Oi, {
						title: s,
						icon: Fl(e.summary.behavior),
						badge: c.orchestrationEnabled ? l.navigationLabel : void 0,
						badgeLabel: c.orchestrationEnabled ? l.label : void 0,
						active: e.summary.session_id === t,
						running: Dt(e.active_run),
						forkedFromTitle: e.summary.forked_from?.title,
						isMobile: o,
						onClick: () => n(e),
						actions: a || r || i ? /* @__PURE__ */ J(dl, {
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
var Ul = 6e4;
function Wl({ items: e, activeId: t = null, onOpenProject: n, onOpenSession: r, isMobile: i = !1, renderActions: a, emptyLabel: o = "No projects" }) {
	let s = rr(Ul), c = ml(), l = W(() => Ml(e, (e) => e.kind === "project" ? {
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
			children: [/* @__PURE__ */ J(fl, {
				className: i ? "px-3" : "px-2",
				children: e.label
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let o = Sl(e), s = a?.(e);
					return e.kind === "project" ? /* @__PURE__ */ J(Wc, {
						entityId: o,
						name: e.entry.project.name,
						active: o === t,
						running: e.entry.running > 0,
						trailing: String(e.entry.sessions.length),
						isMobile: i,
						actions: s,
						onClick: () => n(o)
					}, o) : /* @__PURE__ */ J(Wc, {
						entityId: o,
						name: c(e.session.summary),
						variant: Uc.Orphan,
						active: o === t,
						running: Dt(e.session.active_run),
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
function Gl(e) {
	return Object(e) === e && !Array.isArray(e);
}
//#endregion
//#region src/app/lib/providerError.ts
function $(e) {
	return e instanceof Error || e == null || P(e) ? e : Object(e) === e ? { status: e.status } : String(e);
}
var Kl = "/api/wallet", ql = "/admin/workspace/workspace-settings", Jl = "platform.arcee.ai";
function Yl(e) {
	return e instanceof Error ? e.message : String(e);
}
function Xl(e, t) {
	let n = e.match(/https:\/\/[^\s"'),]+/), r = Jl;
	if (n) try {
		let { hostname: e } = new URL(n[0]);
		e.endsWith(".arcee.ai") && /^api\d*\./.test(e) && (r = e.replace(/^api(\d*)\./, "platform$1."));
	} catch {}
	return `https://${r}${t}`;
}
function Zl(e, t) {
	let n = /* @__PURE__ */ new Set();
	for (let t of [
		/HTTP (\d{3})/g,
		/\((\d{3}) [A-Z]/g,
		/"code":\s*(\d{3})/g,
		/status[ _]code["']?[:=]\s*(\d{3})/gi
	]) for (let r of e.matchAll(t)) n.add(Number(r[1]));
	return t !== null && n.add(t), n;
}
function Ql(e) {
	let t = e.indexOf("{");
	if (t === -1) return e;
	let n = e.slice(t), r = $l(n) ?? eu(n);
	if (r === null) return e;
	let i = e.slice(0, t).trim().replace(/:$/, "");
	return i ? `${i} — ${r}` : r;
}
function $l(e) {
	try {
		return tu(JSON.parse(e));
	} catch {
		return null;
	}
}
function eu(e) {
	let t = e.match(/"(?:message|detail|error_description)"\s*:\s*"((?:[^"\\]|\\.)*)/);
	if (!t) return null;
	try {
		return JSON.parse(`"${t[1]}"`);
	} catch {
		return t[1];
	}
}
function tu(e) {
	if (P(e)) return e;
	if (!Gl(e)) return null;
	for (let t of [
		"message",
		"detail",
		"error",
		"error_description"
	]) {
		let n = tu(e[t]);
		if (n !== null) return n;
	}
	return null;
}
var nu = {
	title: "There was a problem with authentication",
	description: "Please sign back in to continue using the API.",
	fix: {
		kind: "login",
		label: "Sign in again"
	}
};
function ru(e, t) {
	let n = Yl(e), r = su(e) ? e.status : null, i = n.toLowerCase(), a = (...e) => e.some((e) => i.includes(e)), o = Zl(n, r), s = n.match(/invalid model configuration:\s*(.+)/is);
	if (s) return {
		title: "Configuration needs repair",
		description: au(s[1]),
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
			url: Xl(n, ql)
		}
	};
	if (a("insufficient_credits", "insufficient credits", "insufficient_quota", "top up your wallet") || o.has(402)) return {
		title: "Not enough credits for this request",
		description: "The provider reserved more than the remaining balance allows. The wallet can still show a balance. Top up, or retry.",
		fix: {
			kind: "link",
			label: "Open wallet",
			url: Xl(n, Kl)
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
	} : nu : a("permission_error") || o.has(403) ? {
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
	} : { title: au(Ql(n)) };
}
function iu(e, t) {
	let { title: n, description: r } = ru(e, t);
	return r ? `${n}. ${r}` : n;
}
function au(e) {
	let t = e.trim();
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function ou(e) {
	return e != null && !(e instanceof Error) && !P(e);
}
function su(e) {
	return ou(e) ? Number.isFinite(e.status) : !1;
}
//#endregion
//#region src/app/components/modals/AssignToProjectModal.tsx
function cu({ open: e, onClose: t, summary: n }) {
	let r = _n(), i = g(), a = ml(), { data: o } = ot(), c = be(), l = Ue(), [u, d] = K(""), [f, p] = K(null), m = W(() => Dl(o?.projects ?? [], n), [o, n]), h = c.isPending || l.isPending;
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: t,
		title: "Assign to Project",
		size: Wt.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(s, {
			variant: I.Tertiary,
			content: R.Text,
			onClick: t,
			disabled: h,
			children: "Cancel"
		}), /* @__PURE__ */ J(s, {
			variant: I.Primary,
			content: R.Text,
			onClick: async () => {
				if (!(!n || h)) {
					p(null);
					try {
						let e = m ?? await l.mutateAsync({
							name: u.trim() || null,
							...El(n)
						});
						await c.mutateAsync({
							projectId: e.project_id,
							sessionId: n.session_id
						}), r.success(`Assigned to ${e.name}`), t();
					} catch (e) {
						p(iu($(e)));
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
					children: [/* @__PURE__ */ J(Hc, {
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
var lu = "w-full md:w-[280px]";
function uu({ label: e, hint: t, required: n = !1, invalid: r = !1 }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-1 w-full",
		children: [/* @__PURE__ */ Y("div", {
			className: V("label-small", r ? "text-error-primary" : "text-basic-primary"),
			children: [e, n ? "*" : ""]
		}), t ? /* @__PURE__ */ J(oa, {
			title: t,
			position: z.TopCenter
		}) : null]
	});
}
function du({ label: e, hint: t, required: n = !1, invalid: r = !1, secondary: i = !1, muted: a = !1, verticalOnMobile: o = !1, labelClassName: s = "", control: c }) {
	return /* @__PURE__ */ Y("div", {
		className: V("flex w-full min-h-9 md:flex-row items-center md:justify-between md:min-h-5", o ? "flex-col items-stretch justify-center gap-1" : "flex-row items-center justify-between"),
		children: [/* @__PURE__ */ Y("div", {
			className: V("flex items-center gap-1 min-w-0 md:flex-1 md:max-w-[220px]", o ? "max-w-none" : "flex-1 max-w-[220px]", s),
			children: [/* @__PURE__ */ Y("div", {
				className: V(o ? "md:truncate" : "truncate", i ? "text-small" : "label-small", r ? "text-error-primary" : a ? "text-basic-muted" : i ? "text-basic-secondary" : "text-basic-primary"),
				children: [e, n ? "*" : ""]
			}), t ? /* @__PURE__ */ J(oa, {
				title: t,
				position: z.TopCenter
			}) : null]
		}), /* @__PURE__ */ J("div", {
			className: V("shrink-0", o && "w-full md:w-auto"),
			children: c
		})]
	});
}
//#endregion
//#region src/app/lib/catalog.ts
function fu(e) {
	return e.connection?.base_url ?? e.managed_base_url ?? e.default_base_url ?? "";
}
var pu = "deepseek/deepseek-v4-flash-latest", mu = ["arcee-auth", "arcee-api"];
function hu(e) {
	let t = mu.flatMap((t) => {
		let n = vu(e, t);
		if (!n) return [];
		let r = fu(n);
		return r ? [{
			provider: n,
			baseUrl: r
		}] : [];
	}), n = t.find((e) => e.provider.auth_status === "ready") ?? t[0];
	return n ? {
		backend: n.provider.id,
		model: pu,
		baseUrl: n.baseUrl
	} : null;
}
var gu = {
	provider: null,
	model: null,
	contextWindow: null,
	supportedEfforts: [],
	estimated: !1
};
function _u(e) {
	let t = e.lastIndexOf("-");
	if (t <= 0) return null;
	let n = e.slice(t + 1);
	return n.length === 8 && /^\d{8}$/.test(n) ? e.slice(0, t) : null;
}
function vu(e, t) {
	return e?.providers?.find((e) => e.id === t) ?? null;
}
function yu(e, t) {
	let n = e.models.find((e) => e.id === t);
	if (n) return n;
	let r = _u(t);
	return r ? e.models.find((e) => e.id === r) ?? null : null;
}
function bu(e, t, n) {
	let r = (n ?? "").trim(), i = vu(e, (t ?? "").trim());
	if (!i || !r) return gu;
	let a = yu(i, r);
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
function xu(e, t) {
	let n = t.trim();
	if (!n) return null;
	let r = (e?.providers ?? []).filter((e) => e.models.some((e) => e.id === n));
	if (r.length === 0) return null;
	let i = r.find((e) => e.id === "openai-responses"), a = r.find((e) => e.managed_base_url === null);
	return (i ?? a ?? r[0]).id;
}
//#endregion
//#region src/app/components/modals/catalogModelOverlay.ts
var Su = {
	input: 0,
	output: 0,
	cache_read: 0,
	cache_write: 0
};
function Cu(e, t) {
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
			cost: Su,
			reasoning: !1,
			supported_efforts: e.default_limits.supported_efforts,
			source: "fallback"
		};
	});
}
//#endregion
//#region src/app/components/modals/CatalogModelPicker.tsx
function wu(e, t, n) {
	let r = t.trim().toLowerCase(), i = [...e?.providers ?? []].sort((e, t) => {
		let n = e.auth_status === "ready" ? 0 : 1, r = t.auth_status === "ready" ? 0 : 1;
		return n === r ? pr(e.id) - pr(t.id) : n - r;
	}), a = [];
	for (let e of i) for (let t of Cu(e, n.get(e.id))) r && !`${t.id} ${t.display_name ?? ""} ${e.id}`.toLowerCase().includes(r) || a.push({
		provider: e,
		model: t
	});
	return a;
}
function Tu(e) {
	return Number.isFinite(e) && e > 0 ? `$${Number(e.toFixed(2))}` : null;
}
function Eu(e) {
	let t = Tu(e.input), n = Tu(e.output);
	return t && n ? `${t}/${n} per 1M` : "pricing unknown";
}
function Du(e) {
	return [e.context_window > 0 ? `${pn(e.context_window)} ctx` : "", Eu(e.cost)].filter(Boolean).join(" · ");
}
var Ou = (e) => e.display_name || e.id;
function ku({ provider: e }) {
	return e.auth_status === "ready" ? /* @__PURE__ */ J(Si, {
		text: "available",
		color: xi.Green,
		className: "shrink-0 whitespace-nowrap"
	}) : /* @__PURE__ */ J(Si, {
		text: e.managed_base_url ? "login required" : "no credential detected",
		color: xi.Yellow,
		className: "shrink-0 whitespace-nowrap"
	});
}
function Au({ catalog: e, loading: t, failed: n, disabled: r = !1, compact: i = !1, liveByBackend: a, value: o, onSelect: c }) {
	let l = g(), [u, d] = K(!1), [f, p] = K(""), [m, h] = K(null), [_, v] = K(null), y = G(null), b = l ? Yc.Large : Yc.Medium, x = W(() => wu(e, f, a), [
		e,
		f,
		a
	]), S = m === null ? null : Math.min(m, Math.max(x.length - 1, 0)), C = _ !== null && _ < x.length ? _ : S, w = (e) => {
		p(e), h(null), v(null);
	};
	U(() => {
		!u || S === null || y.current?.querySelector(`[data-row="${S}"]`)?.scrollIntoView({ block: "nearest" });
	}, [u, S]);
	let T = x.find((e) => e.provider.id === o?.backend && e.model.id === o?.model), E = () => {
		d(!1), h(null), v(null);
	}, D = (e) => {
		c({
			backend: e.provider.id,
			model: e.model.id,
			baseUrl: fu(e.provider)
		}), d(!1), w("");
	}, O = (e) => {
		if (e.key === "ArrowDown" || e.key === "ArrowUp") {
			if (e.preventDefault(), !x.length) return;
			let t = e.key === "ArrowDown" ? 1 : -1;
			h(((C ?? (t === 1 ? -1 : 0)) + t + x.length) % x.length), v(null);
			return;
		}
		if (e.key === "Enter") {
			e.preventDefault();
			let t = x[C ?? 0];
			t && D(t);
		}
	}, k = o ? T ? Ou(T.model) : o.model : t ? "Loading models…" : n ? "Model catalog unavailable" : "Select a model";
	return /* @__PURE__ */ J(Ln, {
		open: u,
		onClose: E,
		placement: i ? z.TopRight : z.BottomLeft,
		size: "w-[520px]",
		sticky: !0,
		className: V(i ? "min-w-0" : "shrink-0", l && "w-full"),
		panelClassName: "p-2 overflow-hidden",
		sheetClassName: "h-[70dvh] max-h-[70dvh] min-h-[70dvh] overflow-hidden [&>*]:min-h-0 [&>*]:h-full [&>*]:flex [&>*]:flex-col",
		content: /* @__PURE__ */ Y("div", {
			className: V("flex flex-col min-h-0", l ? "h-full" : "h-[340px]"),
			children: [/* @__PURE__ */ J("div", {
				className: "shrink-0 p-4 pt-0 md:p-0 md:pb-2",
				children: /* @__PURE__ */ J(Z, {
					inputSize: l ? X.Large : X.Medium,
					leading: qs.Icon,
					leadingIconName: L.Search,
					placeholder: "Search models…",
					autoFocus: !0,
					autoComplete: "off",
					spellCheck: !1,
					value: f,
					onChange: (e) => w(e.target.value),
					onKeyDown: O
				})
			}), /* @__PURE__ */ J("div", {
				ref: y,
				className: "flex flex-col flex-1 gap-1 min-h-0 overflow-auto [&>*]:shrink-0",
				children: x.length === 0 ? /* @__PURE__ */ J("p", {
					className: "px-4 md:px-2 py-3 text-micro text-basic-muted",
					children: t ? "Reading the catalog…" : n ? "The model catalog could not be read." : `No model matches "${f.trim()}".`
				}) : x.map((e, t) => {
					let n = t === 0 || x[t - 1].provider.id !== e.provider.id, r = e.provider.id === o?.backend && e.model.id === o?.model;
					return /* @__PURE__ */ Y("div", {
						className: "px-2 md:px-0",
						children: [n ? /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2 px-2 pt-6 pb-2",
							children: [
								/* @__PURE__ */ J("span", {
									className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
									children: Zt(e.provider.id)
								}),
								/* @__PURE__ */ J(Q, { className: "shrink" }),
								/* @__PURE__ */ J(ku, { provider: e.provider })
							]
						}) : null, /* @__PURE__ */ Y(Zc, {
							size: b,
							variant: Xc.Regular,
							active: r,
							"data-row": t,
							onMouseEnter: () => v(t),
							onMouseLeave: () => v((e) => e === t ? null : e),
							onClick: () => D(e),
							children: [
								/* @__PURE__ */ J("span", {
									className: "flex-1 min-w-0 text-left truncate",
									children: Ou(e.model)
								}),
								l ? null : /* @__PURE__ */ J("span", {
									className: "code-small text-basic-muted truncate md:max-w-[180px]",
									children: e.model.id
								}),
								/* @__PURE__ */ J("span", {
									className: "text-micro text-basic-muted shrink-0",
									children: Du(e.model)
								})
							]
						})]
					}, `${e.provider.id}/${e.model.id}`);
				})
			})]
		}),
		children: /* @__PURE__ */ Y(s, {
			variant: i ? I.Ghost : I.Secondary,
			size: i ? F.Small : l ? F.Large : F.Medium,
			content: i ? R.IconLeft : R.IconRight,
			disabled: !e || r,
			onClick: () => u ? E() : d(!0),
			"aria-expanded": u,
			"aria-label": i ? "Model" : void 0,
			className: i ? "min-w-0 max-w-full !gap-1.5 !pr-3" : "w-full md:w-[280px]",
			children: [
				i ? /* @__PURE__ */ J(M, { iconName: L.Brain }) : null,
				/* @__PURE__ */ J("span", {
					className: V("min-w-0 text-left truncate", i ? "label-micro max-w-[96px]" : "flex-1"),
					children: k
				}),
				o && Zt(o.backend) !== k ? /* @__PURE__ */ J("span", {
					className: V("truncate", i ? "label-micro max-w-[72px] text-basic-tertiary" : "text-micro text-basic-muted max-w-[110px]"),
					children: Zt(o.backend)
				}) : null,
				i ? null : /* @__PURE__ */ J(M, {
					iconName: L.Down,
					className: V("transition-transform duration-150 ease-out", u ? "rotate-180" : "rotate-0")
				})
			]
		})
	});
}
//#endregion
//#region src/app/components/modals/KeyStatus.tsx
function ju({ status: e }) {
	return e === "validating" ? /* @__PURE__ */ J(Le, { size: A.Micro }) : e === "ready" ? /* @__PURE__ */ J(M, {
		iconName: L.CheckCircle,
		size: 16,
		className: "text-success-primary"
	}) : /* @__PURE__ */ J(M, {
		iconName: e === "error" ? L.Danger : L.Key,
		size: 16,
		className: V(e === "error" ? "text-error-primary" : "text-basic-muted")
	});
}
//#endregion
//#region src/app/features/setup/lifetime.ts
function Mu() {
	let e = Ur(ht()), t = new AbortController(), n = !0;
	return Ur(er(e, oe(() => {
		n = !1, t.abort();
	}))), {
		signal: t.signal,
		current: () => n,
		close: () => Ur(me(e, hr))
	};
}
function Nu(e = !0) {
	let t = G(null);
	return U(() => {
		let n = Mu();
		return t.current = n, e || n.close(), n.close;
	}, [e]), t;
}
//#endregion
//#region src/app/features/managed/controller/deviceLoginOperation.ts
var Pu = (e) => ["provider-device-login-attempt", e];
async function Fu(e, t) {
	let { api: n } = gt(e), r = Pu(t), i = e.getQueryData(r);
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
		let i = await b(w({ command: () => n.startManagedLogin(t) }));
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
		], l = new ti(e, {
			queryKey: c,
			queryFn: async ({ signal: r }) => {
				let a = await n.pollManagedLogin(t, i.login_id, r);
				return a.state === "complete" && o() && await mr(e), a;
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
				message: nr($(e.error))
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
			message: nr($(e))
		}), {
			attempt: a,
			fresh: !1
		};
	}
}
async function Iu(e, t) {
	let { api: n } = gt(e), r = Pu(t), i = e.getQueryData(r);
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
function Lu(e, t) {
	let n = ai(), r = Nu(), [i, a] = K(t ?? null), [o, s] = K(null), c = t ?? i, l = G(c);
	Qr(() => {
		l.current = c;
	}, [c]);
	let u = Pu(c), d = ii({
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
		let i = await Fu(n, e);
		!t.current() || l.current !== e || n.getQueryData(Pu(e))?.attempt !== i.attempt || (s({
			attempt: i.attempt,
			current: t.current
		}), i.fresh && i.attempt.prompt && !i.attempt.cancelled && window.open(i.attempt.prompt.verification_uri, "_blank", "noopener,noreferrer"));
	}, [n, r]), h = H(async () => {
		c && await Iu(n, c);
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
function Ru(e) {
	let t = n(e), { data: r } = Pn(!!t);
	return {
		provider: t,
		signedIn: !!(t && r?.providers.find((e) => e.provider === t)?.signed_in)
	};
}
//#endregion
//#region src/app/features/managed/presentation/ManagedAuthCallout.tsx
var zu = {
	arcee: L.Arcee,
	codex: L.ChatGpt
};
function Bu({ backend: e, className: t = "" }) {
	let { provider: n, signedIn: r } = Ru(e), { state: i, start: a, cancel: o } = Lu(void 0, n), c = Tt(), l = Et(e, !!n && r);
	if (!n) return null;
	let u = Ve(n), d = i.status === "failed", f = r && l.isError, p = d || f, m = i.status === "waiting", h = r && !p, g = m ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2",
		children: [
			/* @__PURE__ */ J(Le, { size: A.Micro }),
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
			/* @__PURE__ */ J(s, {
				variant: I.Ghost,
				size: F.Medium,
				content: R.Text,
				onClick: () => void o(),
				children: "Cancel"
			})
		]
	}) : h ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
			children: [/* @__PURE__ */ J(M, {
				iconName: L.CheckCircle,
				className: "text-success-primary"
			}), /* @__PURE__ */ J("span", {
				className: "label-small text-success-primary",
				children: "Signed in"
			})]
		}), /* @__PURE__ */ J(s, {
			variant: I.Ghost,
			size: F.Medium,
			content: R.Text,
			loading: c.isPending,
			onClick: () => void c.mutateAsync(n).catch(() => {}),
			children: "Sign out"
		})]
	}) : /* @__PURE__ */ Y(s, {
		variant: I.Primary,
		size: F.Medium,
		content: R.IconRight,
		loading: i.status === "starting",
		onClick: () => void a(n),
		children: [/* @__PURE__ */ Y("span", { children: ["Sign in with ", u] }), /* @__PURE__ */ J(M, { iconName: L.External })]
	}), _ = m ? `Approve the request in the ${u} tab NAC opened.` : h ? "NAC holds this login and every session on this provider uses it." : `This provider authenticates with ${u} in your browser instead of with an API key.`;
	return /* @__PURE__ */ Y("div", {
		className: V("flex flex-col gap-3 rounded-[8px] border bg-elevation-level-2 p-3 md:flex-row md:items-center md:justify-between md:gap-4", p ? "border-error-primary" : "border-muted", t),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-start gap-2 min-w-0",
			children: [/* @__PURE__ */ J(M, {
				iconName: zu[n],
				className: V("shrink-0", p ? "text-error-primary" : "text-basic-secondary")
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-0.5 min-w-0",
				children: [/* @__PURE__ */ Y("span", {
					className: V("label-small", p ? "text-error-primary" : "text-basic-primary"),
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
				children: iu(d ? i.message : l.error, e)
			}) : null]
		})]
	});
}
//#endregion
//#region src/app/lib/modelConfig.ts
function Vu(e, t, n, r = null) {
	return {
		...e,
		api_key_env: e.backend === t && (!e.api_key_env || e.api_key_env === r) ? n : e.api_key_env
	};
}
function Hu(e, t) {
	return {
		...e,
		api_key_env: t !== null && e.api_key_env === t ? null : e.api_key_env
	};
}
function Uu(e, t) {
	return e === t ? !0 : !e || !t ? !1 : e.model === t.model && (e.backend ?? null) === (t.backend ?? null) && (e.base_url ?? null) === (t.base_url ?? null) && (e.api_key_env ?? null) === (t.api_key_env ?? null) && (e.reasoning_effort ?? null) === (t.reasoning_effort ?? null);
}
var Wu = {
	"arcee-auth": "https://api.arcee.ai/api/v1",
	"chatgpt-codex-responses": "https://chatgpt.com/backend-api"
}, Gu = "__clear__";
function Ku(e) {
	return Wu[(e ?? "").trim()] ?? null;
}
function qu(e) {
	return e === "arcee-auth" || e === "chatgpt-codex-responses";
}
function Ju(e) {
	return (e ?? "").trim() || null;
}
function Yu(e) {
	return (e ?? "").split(",").map((e) => e.trim()).filter(Boolean);
}
function Xu(e, t) {
	if (e !== "inherit") {
		if (e === "none") return null;
		if (e !== "variable") throw Error("Choose how credentials are selected");
		if (!t) throw Error("API key environment variable is required when Environment variable is selected");
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) throw Error("API key environment variable must match [A-Za-z_][A-Za-z0-9_]* exactly (no whitespace)");
		return t;
	}
}
function Zu(e, t) {
	if (!e) return;
	let n = qu(e);
	if (n && t !== "none") throw Error(`${e} uses ${e === "arcee-auth" ? "stored Arcee login" : "stored Codex OAuth"} and does not accept an API key environment variable`);
	if (!n && t !== "variable") throw Error(`${e} requires an API key environment variable; explicitly select Environment variable`);
}
function Qu(e, t) {
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
	for (let [e, t] of Object.entries(i)) if (!P(t)) throw Error(`Extra Headers value for "${e}" must be a string`);
	return i;
}
function $u(e, t) {
	let n = e.trim();
	if (!n) throw Error(`${t} is required and cannot be cleared`);
	return n;
}
function ed(e, t) {
	let n = Object.keys(e).sort(), r = Object.keys(t).sort();
	return n.length === r.length && n.every((n, i) => n === r[i] && e[n] === t[n]);
}
function td(e, t, n = !1) {
	let r = $u(e.backend, "Backend"), i = Ku(r), a, o;
	if (i) a = Ju(e.base_url) ?? i, o = null;
	else {
		a = $u(e.base_url, "Base URL");
		let t = Xu(e.credential_mode, e.api_key_env);
		if (t === void 0) throw Error("Select an API key environment variable or explicitly choose none");
		o = t, n && e.credential_mode === "none" || Zu(r, e.credential_mode);
	}
	let s = {
		model: $u(e.model, "Model"),
		base_url: a,
		allow_insecure_http: e.allow_insecure_http,
		backend: r,
		reasoning_effort: e.reasoning_effort === "__clear__" ? null : e.reasoning_effort || null,
		api_key_env: o
	}, c = {};
	s.model !== t.model && (c.model = s.model), s.base_url !== t.base_url && (c.base_url = s.base_url), s.allow_insecure_http !== t.allow_insecure_http && (c.allow_insecure_http = s.allow_insecure_http), s.backend !== t.backend && (c.backend = s.backend), s.reasoning_effort !== t.reasoning_effort && (c.reasoning_effort = s.reasoning_effort), s.api_key_env !== t.api_key_env && (c.api_key_env = s.api_key_env);
	let l = Qu(e.extra_headers, {});
	(t.extra_headers_invalid || !ed(l, t.extra_headers)) && (c.extra_headers = l);
	let u = e.orchestrator_compaction_threshold.trim();
	if (u !== "" && !/^\d+$/.test(u)) throw Error("Context Limit must be a non-negative integer");
	let d = u === "" ? null : Number(u);
	return d !== t.orchestrator_compaction_threshold && (c.orchestrator_compaction_threshold = d), c;
}
[...wt.map((e) => ({
	id: e,
	label: Zt(e)
}))];
var nd = wt.map((e) => ({
	id: e,
	label: Zt(e)
})), rd = [
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
], id = [
	{
		id: "",
		label: "Inherit config"
	},
	{
		id: Gu,
		label: "Clear configured effort"
	},
	...rd
], ad = /* @__PURE__ */ new Set(["", Gu]);
function od(e, t, n = id) {
	if (e.length === 0) return n;
	let r = new Set(e);
	return n.filter((e) => ad.has(String(e.id)) || r.has(String(e.id)) || e.id === t);
}
//#endregion
//#region src/app/hooks/useExitTransition.ts
var sd = 300;
function cd(e, t = sd) {
	let [n, r] = K(e);
	return e && !n && r(!0), U(() => {
		if (e) return;
		let n = setTimeout(() => r(!1), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
//#endregion
//#region src/app/components/modals/PathPickerModal.tsx
function ld({ open: e, ssh: t, ...n }) {
	return cd(e) ? /* @__PURE__ */ J(ud, {
		open: e,
		ssh: t ?? null,
		...n
	}) : null;
}
function ud({ open: e, kind: t, initialPath: n, ssh: r, title: i, showHidden: a = !1, clearLabel: o, onClear: c, onClose: l, onSelect: u }) {
	let d = t !== "directory", f = g(), [p, m] = K(n.trim()), [h, _] = K(n.trim()), [v, y] = K(null), [b, x] = K(a), S = Vn(p || null, t, b, !r), C = zr(r ?? null, p || null, b, !!r), { data: w, error: T, isFetching: E } = r ? C : S, D = (e) => {
		m(e), _(e), y(null);
	}, O = d ? v : w?.path ?? p;
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: l,
		title: i ?? (t === "toml" ? "Select Config File" : t === "file" ? "Select File" : r ? `Select Working Folder on ${r.ssh_host}` : "Select Working Folder"),
		size: Wt.Wide,
		flush: !0,
		className: "h-[560px]",
		footer: /* @__PURE__ */ Y(q, { children: [
			c ? f ? /* @__PURE__ */ J(wi, {
				variant: I.Secondary,
				content: R.Text,
				onClick: c,
				children: o ?? "Clear"
			}) : /* @__PURE__ */ J(s, {
				variant: I.Ghost,
				size: F.Large,
				content: R.Text,
				className: "mr-auto",
				onClick: c,
				children: o ?? "Clear"
			}) : null,
			f ? /* @__PURE__ */ J(wi, {
				variant: I.Secondary,
				content: R.Text,
				onClick: l,
				children: "Cancel"
			}) : /* @__PURE__ */ J(s, {
				variant: I.Secondary,
				size: F.Large,
				content: R.Text,
				onClick: l,
				children: "Cancel"
			}),
			f ? /* @__PURE__ */ J(wi, {
				variant: I.Primary,
				content: R.Text,
				disabled: !O,
				onClick: () => {
					O && u(O);
				},
				children: "Select"
			}) : /* @__PURE__ */ J(s, {
				variant: I.Primary,
				size: F.Large,
				content: R.Text,
				disabled: !O,
				onClick: () => {
					O && u(O);
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
						/* @__PURE__ */ J(s, {
							variant: I.Secondary,
							size: F.Medium,
							content: R.Icon,
							disabled: !w?.parent,
							onClick: () => w?.parent && D(w.parent),
							"aria-label": "Parent directory",
							children: /* @__PURE__ */ J(M, { iconName: L.Top })
						}),
						/* @__PURE__ */ J(s, {
							variant: I.Secondary,
							size: F.Medium,
							content: R.Icon,
							disabled: !w?.home,
							onClick: () => w?.home && D(w.home),
							"aria-label": "Home directory",
							children: /* @__PURE__ */ J(M, { iconName: L.Home })
						}),
						/* @__PURE__ */ J(Z, {
							inputSize: X.Medium,
							className: "flex-1 min-w-0",
							placeholder: r ? "~/path/on/the/host" : "/path/to/directory",
							value: h,
							onChange: (e) => _(e.target.value),
							onKeyDown: (e) => {
								e.key === "Enter" && D(h.trim());
							}
						}),
						/* @__PURE__ */ J(s, {
							variant: b ? I.SecondaryHighlighted : I.Secondary,
							size: F.Medium,
							content: R.Icon,
							onClick: () => x((e) => !e),
							"aria-pressed": b,
							title: b ? "Hide dot-prefixed entries" : "Show hidden entries",
							"aria-label": b ? "Hide dot-prefixed entries" : "Show hidden entries",
							children: /* @__PURE__ */ J(M, { iconName: b ? L.Eye : L.EyeStrikethrough })
						})
					]
				}),
				T ? /* @__PURE__ */ J("p", {
					className: "label-micro text-error-primary shrink-0",
					children: nr(T)
				}) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex-1 min-h-0 overflow-auto rounded-[4px] bg-input shadow-concave p-1 flex flex-col [&>*]:shrink-0",
					children: [
						E && !w ? /* @__PURE__ */ J("div", {
							className: "flex items-center justify-center py-6",
							children: /* @__PURE__ */ J(Le, { size: A.Small })
						}) : null,
						w?.entries.length === 0 ? /* @__PURE__ */ Y("p", {
							className: "text-micro text-basic-muted px-2 py-3",
							children: [t === "toml" ? "No directories or .toml files here." : t === "file" ? "Nothing here." : "No subdirectories here.", b ? "" : " Hidden entries are not listed."]
						}) : null,
						w?.entries.map((e) => /* @__PURE__ */ Y("button", {
							type: "button",
							className: V("flex items-center gap-3 md:gap-2 w-full px-2 md:px-2 py-3 md:py-1.5 rounded-[4px] text-left", "hover:bg-elevation-sublevel-variant-A", v === e.path && "bg-elevation-sublevel-variant-A"),
							onClick: () => e.is_directory ? D(e.path) : y(e.path),
							onDoubleClick: () => {
								e.is_directory || u(e.path);
							},
							children: [/* @__PURE__ */ J(M, {
								iconName: e.is_directory ? L.Folder : L.File,
								size: f ? 20 : 16,
								className: "shrink-0 text-basic-muted"
							}), /* @__PURE__ */ J("span", {
								className: V("text-basic-primary truncate", f ? "text-small" : "text-small "),
								children: e.name
							})]
						}, e.path)),
						w?.truncated ? /* @__PURE__ */ J("p", {
							className: "text-micro text-basic-muted px-2 py-2",
							children: "Only the first entries are listed; type a path to go deeper."
						}) : null
					]
				}),
				/* @__PURE__ */ J("p", {
					className: "text-micro text-basic-muted shrink-0 truncate",
					children: O ? `Selected: ${O}` : "Nothing selected yet."
				})
			]
		})
	});
}
//#endregion
//#region src/app/components/modals/SmallSelect.tsx
function dd({ items: e, value: t, onValueChange: n, placeholder: r, disabled: i = !1, size: a = F.Medium, trailingIcon: o, triggerClassName: s, placement: c = z.CenterLeft, onOpenChange: l }) {
	let u = g();
	return /* @__PURE__ */ J($c, {
		items: e,
		value: t,
		onValueChange: n,
		placeholder: r,
		disabled: i,
		size: a,
		trailingIcon: o,
		triggerClassName: s,
		itemSize: u ? Yc.Large : Yc.Medium,
		variant: I.Ghost,
		placement: c,
		onOpenChange: l,
		sticky: !0,
		panelClassName: "max-h-[200px] overflow-auto min-w-[220px] max-w-[calc(100vw-16px)]"
	});
}
//#endregion
//#region src/app/lib/apiKey.ts
var fd = "*".repeat(32);
function pd(e) {
	return e.map((e) => ({
		id: e.id,
		label: e.display_name ?? e.id
	}));
}
//#endregion
//#region src/app/components/modals/ResolvedRows.tsx
function md({ resolving: e, resolved: t, backend: n, onBackend: r, baseUrl: i, onBaseUrl: a, model: o, onModel: s, failed: c }) {
	if (e) return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 py-1",
		children: [/* @__PURE__ */ J(Le, { size: A.Micro }), /* @__PURE__ */ J("span", {
			className: "text-micro text-basic-muted",
			children: "Checking the key and reading the model list…"
		})]
	});
	if (!t || !n) return c ? null : /* @__PURE__ */ J("p", {
		className: "text-micro text-basic-muted py-1",
		children: "Pick a configuration to see its provider and models."
	});
	let l = Bn(n), u = t.models.length > 0, d = !!t.models_error, f = u ? pd(t.models) : o ? [{
		id: o,
		label: o
	}] : [];
	return /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ J(du, {
			label: "Model Provider",
			required: !0,
			hint: "Service that provides the models for this session.",
			control: /* @__PURE__ */ J(dd, {
				items: nd,
				value: n,
				onValueChange: (e) => r(e)
			})
		}),
		l ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(du, {
			label: "API Key",
			required: !0,
			hint: "Held by NAC for this configuration; save a new setup to use a different key.",
			control: /* @__PURE__ */ J(Z, {
				inputSize: X.Medium,
				className: lu,
				value: fd,
				isDisabled: !0,
				readOnly: !0,
				leadingSlot: /* @__PURE__ */ J(ju, { status: "ready" })
			})
		})] }) : null,
		/* @__PURE__ */ J(Q, {}),
		u || d ? /* @__PURE__ */ J(du, {
			label: "Default Model",
			invalid: d,
			hint: "The NAC session will start with this default and may switch to another.",
			control: /* @__PURE__ */ J(dd, {
				items: d ? [] : f,
				value: d ? "" : o,
				onValueChange: s,
				disabled: d,
				placeholder: "–"
			})
		}) : /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(du, {
				label: "Model",
				required: !0,
				hint: "Model identifier the endpoint expects.",
				control: /* @__PURE__ */ J(Z, {
					inputSize: X.Medium,
					className: lu,
					placeholder: "gpt-5.5",
					value: o,
					onChange: (e) => s(e.target.value)
				})
			}),
			/* @__PURE__ */ J(Q, {}),
			/* @__PURE__ */ J(du, {
				label: "Base URL",
				required: !0,
				hint: "Endpoint the session sends its requests to.",
				control: /* @__PURE__ */ J(Z, {
					inputSize: X.Medium,
					className: lu,
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
function hd({ label: e, configurations: t, activeId: n, source: r, onSelect: i, onDelete: a }) {
	let o = g(), [c, l] = K(!1), u = o ? Yc.Large : Yc.Medium, d = o ? F.Large : F.Medium, f = (e) => {
		i(e), l(!1);
	}, p = /* @__PURE__ */ Y("div", {
		className: V("flex flex-col min-h-0", o ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col shrink-0 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ Y(Zc, {
					size: u,
					variant: Xc.Regular,
					active: r === "catalog",
					onClick: () => f({ kind: "catalog" }),
					children: [/* @__PURE__ */ J(M, { iconName: L.Search }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Browse Models"
					})]
				}),
				/* @__PURE__ */ Y(Zc, {
					size: u,
					variant: Xc.Regular,
					active: r === "new",
					onClick: () => f({ kind: "new" }),
					children: [/* @__PURE__ */ J(M, { iconName: L.Add }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Create New"
					})]
				}),
				/* @__PURE__ */ Y(Zc, {
					size: u,
					variant: Xc.Regular,
					active: r === "file",
					onClick: () => f({ kind: "file" }),
					children: [/* @__PURE__ */ J(M, { iconName: L.File }), /* @__PURE__ */ J("span", {
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
					children: [/* @__PURE__ */ Y(Zc, {
						size: u,
						variant: Xc.Regular,
						active: n === e.id,
						className: "flex-1 min-w-0",
						onClick: () => f({
							kind: "saved",
							configId: e.id
						}),
						children: [/* @__PURE__ */ J(M, { iconName: L.Gear }), /* @__PURE__ */ J("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						})]
					}), /* @__PURE__ */ J(s, {
						variant: I.TertiaryDestructive,
						size: d,
						content: R.Icon,
						"aria-label": `Remove ${e.name}`,
						onClick: () => a(e.id, e.name),
						children: /* @__PURE__ */ J(M, { iconName: L.Trash })
					})]
				}, e.id))
			})]
		}) : null]
	});
	return /* @__PURE__ */ J(Ln, {
		open: c,
		onClose: () => l(!1),
		placement: z.BottomLeft,
		size: "w-auto",
		className: "shrink-0",
		panelClassName: "max-h-72 overflow-hidden",
		sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
		content: p,
		children: /* @__PURE__ */ Y(s, {
			variant: I.Secondary,
			size: F.Medium,
			content: R.IconRight,
			onClick: () => l((e) => !e),
			"aria-expanded": c,
			children: [/* @__PURE__ */ J("span", {
				className: "text-left flex-grow truncate max-w-[96px] md:max-w-[220px]",
				children: e
			}), /* @__PURE__ */ J(M, {
				iconName: L.Down,
				className: V("transition-transform duration-150 ease-out", c ? "rotate-180" : "rotate-0")
			})]
		})
	});
}
//#endregion
//#region src/app/hooks/useDebouncedValue.ts
function gd(e, t) {
	let [n, r] = K(e);
	return U(() => {
		let n = setTimeout(() => r(e), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
//#endregion
//#region src/app/features/managed/controller/useManagedModelProfile.ts
function _d() {
	let e = sn(), t = e.data ?? null, n = W(() => Te(t), [t]), r = H((e) => D(t, e), [t]);
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
function vd({ ready: e }) {
	return /* @__PURE__ */ J(du, {
		label: "Credential",
		verticalOnMobile: !0,
		hint: "This managed host supplies the credential securely; it is not stored in this configuration or exposed to commands.",
		control: /* @__PURE__ */ Y("div", {
			className: V("flex items-center gap-1.5 rounded-[4px] py-2 pl-2 pr-4", e ? "bg-success-secondary" : "bg-error-tertiary"),
			children: [/* @__PURE__ */ J(M, {
				iconName: e ? L.CheckCircle : L.Repair,
				className: e ? "text-success-primary" : "text-error-primary"
			}), /* @__PURE__ */ J("span", {
				className: V("label-small", e ? "text-success-primary" : "text-error-primary"),
				children: e ? "Detected" : "Host needs attention"
			})]
		})
	});
}
//#endregion
//#region src/app/components/modals/ConfigurationsPanel.tsx
var yd = "custom", bd = [...wt.map((e) => ({
	id: e,
	label: Zt(e)
})), {
	id: yd,
	label: "Custom"
}], xd = 400;
function Sd(e, t) {
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => e[n] === t[n]);
}
function Cd({ invalid: e, errorText: t, onChange: n, initial: r, children: i }) {
	let a = _n(), o = _d(), { data: c, isPending: l } = In(), u = Xn(), d = Mr(u.data), f = lr(), p = W(() => c?.configurations ?? [], [c]), [m, h] = K(null), [_, v] = K(null), y = r?.backend ?? "arcee-api", [b, x] = K(wt.includes(y) ? y : yd), [S, C] = K(y), [w, T] = K(null), [E, D] = K(""), [O, k] = K(r?.model ?? ""), [A, ee] = K(r?.base_url ?? ""), [te, ne] = K(r?.allow_insecure_http ?? !1), [re, ie] = K(r?.model ?? ""), [ae, oe] = K(""), [se, ce] = K(!1), [le, ue] = K(null), [de, fe] = K(null), [pe, me] = K(null), j = o.defaultPick, he = j ? d.get(j.backend) : void 0, ge = o.configured && o.credentialReady && u.isPending, _e = he === null, ve = m === null && _ === null && (l || o.initializing || ge || _e), ye = W(() => j ? he === void 0 ? j : he === null ? null : he.some((e) => e.id === j.model) ? j : null : null, [j, he]), be = r ? p.find((e) => (!r.config_id || e.config_id === r.config_id) && r.orchestrator_compaction_threshold !== void 0 && r.light_model !== void 0 && e.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && Uu(e.light_model ?? null, r.light_model) && e.backend === r.backend && e.model === r.model && e.base_url === r.base_url && e.allow_insecure_http === (r.allow_insecure_http ?? !1) && e.api_key_env === r.api_key_env && (e.reasoning_effort ?? null) === r.reasoning_effort && Sd(e.extra_headers, r.extra_headers)) : null, xe = p.at(-1), N = m ?? (r ? be ? {
		kind: "saved",
		configId: be.config_id
	} : { kind: "new" } : xe ? {
		kind: "saved",
		configId: xe.config_id
	} : { kind: "catalog" }), Se = W(() => N.kind === "catalog" && !ve ? o.configured ? ye : hu(u.data) : null, [
		N.kind,
		u.data,
		o.configured,
		ye,
		ve
	]), P = _ ?? Se, Ce = N.kind === "catalog" && P ? P.backend : b === yd ? S : b, we = Bn(Ce), Te = b !== yd && we, Ee = W(() => {
		let e = N.kind === "catalog" ? P?.backend ?? "catalog" : b === yd ? "custom" : b, t = new Set(p.map((e) => e.name));
		for (let n = 1;; n += 1) {
			let r = `${e}-config-${n}`;
			if (!t.has(r)) return r;
		}
	}, [
		N.kind,
		P,
		b,
		p
	]), De = w ?? Ee, Oe = gd(E.trim(), 600), ke = gd(ae.trim(), xd), Ae = N.kind === "saved" ? N.configId : null, je = N.kind === "file" ? ke : "", Me = g(), { signedIn: Ne } = Ru(Ce), Pe = u.data?.providers.find((e) => e.id === Ce) ?? null, Fe = N.kind === "catalog" && o.matches(P), Ie = Fe ? o.credentialReady : we ? Pe?.auth_status === "ready" : Ne, Le = N.kind === "catalog" && !!P && we && !Fe && !Ie, Re = N.kind === "new" && Te || Le, ze = mn(Ce, Oe, null, Re), Be = Et(Ce, N.kind === "new" && b !== yd && !we && Ne), Ve = ln(Ae, je), He = Re && Oe ? ze.isFetching ? { status: "validating" } : ze.error ? {
		status: "error",
		message: iu(ze.error, Ce)
	} : ze.data ? {
		status: "ready",
		models: ze.data.models,
		baseUrl: ze.data.base_url
	} : { status: "validating" } : { status: "idle" }, Ue = He.status === "ready", We = ze.data?.base_url ?? "", Ge = !!(Ae ?? je), Ke = Ge && Ve.isFetching, qe = Ge && !Ve.error ? Ve.data ?? null : null, Je = Ge && Ve.error ? iu(Ve.error, Ce) : "", Ye = le ?? qe?.backend ?? null, Xe = de ?? qe?.base_url ?? "", Ze = N.kind === "new" ? (we ? ze.data?.models : Be.data?.models) ?? [] : qe?.models ?? [], Qe = N.kind === "new" ? "" : qe?.model ?? "", $e = N.kind === "new" ? Ze.some((e) => e.id === re) ? re : Ze[0]?.id ?? pe ?? re : re || pe || Qe || Ze[0]?.id || "", et = (e) => {
		h(e), D(""), ie(""), ue(null), fe(null), me(null), e?.kind !== "file" && oe(""), e?.kind !== "catalog" && v(null), e?.kind !== "new" && e?.kind !== "catalog" && T(null);
	}, tt = Ae ? p.find((e) => e.config_id === Ae) ?? null : null, nt = !!(r && m === null && N.kind === "new" && Ce === r.backend && A.trim() === r.base_url && te === (r.allow_insecure_http ?? !1) && !E.trim()), rt = W(() => {
		if (ve) return null;
		if (r && nt) {
			let e = b === yd ? O.trim() : $e;
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
		if (N.kind === "catalog") {
			if (!P || !P.baseUrl || Fe && !Ie) return null;
			if (Ie) return {
				kind: "resolved",
				backend: P.backend,
				model: P.model,
				base_url: P.baseUrl,
				allow_insecure_http: !1,
				api_key_env: we ? Pe?.connection?.api_key_env ?? null : null,
				reasoning_effort: null,
				extra_headers: null,
				light_model: void 0
			};
			if (!we) return null;
			let e = De.trim();
			return !e || !Ue ? null : {
				kind: "save",
				request: {
					name: e,
					backend: P.backend,
					model: P.model,
					base_url: We || P.baseUrl,
					allow_insecure_http: !1,
					api_key: E.trim()
				}
			};
		}
		if (N.kind === "new") {
			let e = De.trim();
			if (!e) return null;
			let t = E.trim();
			if (we && !t) return null;
			if (b === yd) {
				let n = A.trim(), r = O.trim();
				return !n || !r ? null : {
					kind: "save",
					request: {
						name: e,
						backend: Ce,
						model: r,
						base_url: n,
						allow_insecure_http: te,
						api_key: we ? t : null
					}
				};
			}
			return we ? !Ue || !$e || !We ? null : {
				kind: "save",
				request: {
					name: e,
					backend: Ce,
					model: $e,
					base_url: We,
					allow_insecure_http: !1,
					api_key: t
				}
			} : !Ne || !$e ? null : {
				kind: "save",
				request: {
					name: e,
					backend: Ce,
					model: $e
				}
			};
		}
		if (!qe || !Ye) return null;
		let e = $e || qe.model || "", t = Xe.trim();
		return !e || !t ? null : {
			kind: "resolved",
			backend: Ye,
			model: e,
			base_url: t,
			allow_insecure_http: qe.allow_insecure_http,
			api_key_env: qe.api_key_env,
			reasoning_effort: qe.reasoning_effort,
			extra_headers: tt?.extra_headers ?? null,
			orchestrator_compaction_threshold: r && m === null ? r.orchestrator_compaction_threshold : tt ? tt.orchestrator_compaction_threshold ?? null : void 0,
			light_model: r && m === null ? r.light_model : tt ? tt.light_model ?? null : void 0,
			config_id: r && m === null ? r.config_id ?? tt?.config_id ?? null : tt?.config_id ?? null
		};
	}, [
		N.kind,
		ve,
		r,
		nt,
		P,
		Ie,
		Fe,
		Pe,
		De,
		E,
		we,
		b,
		Ce,
		A,
		te,
		O,
		Ne,
		Ue,
		We,
		$e,
		qe,
		Ye,
		Xe,
		tt,
		m
	]);
	U(() => {
		n(rt);
	}, [rt, n]);
	let it = async (e, t) => {
		try {
			await f.mutateAsync(e), Ae === e && et(null), a.success(`Configuration ${t} removed`);
		} catch (e) {
			a.error(`Failed to remove the configuration: ${iu($(e))}`);
		}
	}, at = nt ? !0 : N.kind === "catalog" ? !!P && (Ie || Ue) : N.kind === "new" ? b === yd ? !!(A.trim() && O.trim()) : we ? Ue : Ne : !!qe, ot = He.status === "error", st = Be.isError ? iu(Be.error, Ce) : qe?.models_error ?? "", ct = e || ot || !!Je || !!st, lt = Be.isError || !!(qe && !Bn(qe.backend) && qe.models_error), ut = t ?? (ot ? He.message : Je || (lt ? "" : st)), dt = Je || qe?.models_error && Bn(qe.backend) ? Ve.refetch : null, ft = N.kind === "catalog" ? P && !we ? Ce : null : N.kind === "new" ? b !== yd && !we ? Ce : null : Ye && !Bn(Ye) ? Ye : null, pt = N.kind === "catalog" ? "Browse Models" : N.kind === "new" ? "Create New" : N.kind === "file" ? "From a .toml file" : tt?.name ?? "Configuration";
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1",
		children: [
			/* @__PURE__ */ Y("div", {
				className: V("flex flex-col rounded-[8px] bg-elevation-level-2 border border-muted overflow-visible", ct && "border border-error-primary"),
				children: [
					/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-4 px-3 py-2 bg-elevation-level-3 rounded-t-[8px] border-b border-muted",
						children: [/* @__PURE__ */ J("div", {
							className: V("flex-1 min-w-0 truncate", Me ? "label-medium" : "label-small", ct ? "text-error-primary" : "text-basic-primary"),
							children: "Configurations"
						}), /* @__PURE__ */ J(hd, {
							label: pt,
							configurations: p.map((e) => ({
								id: e.config_id,
								name: e.name
							})),
							activeId: Ae,
							source: N.kind,
							onSelect: et,
							onDelete: (e, t) => void it(e, t)
						})]
					}),
					/* @__PURE__ */ J(Q, {}),
					/* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-4 md:gap-2 p-3",
						children: [
							N.kind === "catalog" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(du, {
								label: "Model",
								required: !0,
								verticalOnMobile: !0,
								hint: "Every model this build knows about; picking one names its provider.",
								control: /* @__PURE__ */ J(Au, {
									catalog: u.data,
									loading: u.isLoading,
									failed: u.isError,
									disabled: ve,
									liveByBackend: d,
									value: P,
									onSelect: (e) => {
										h({ kind: "catalog" }), v(e), D(""), T(null);
									}
								})
							}), P ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(du, {
									label: "Base URL",
									hint: "Endpoint the catalog names for this provider.",
									verticalOnMobile: !0,
									control: /* @__PURE__ */ J(Z, {
										inputSize: Me ? X.Large : X.Medium,
										className: lu,
										value: P.baseUrl,
										isDisabled: !0,
										readOnly: !0
									})
								}),
								we ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), Fe ? /* @__PURE__ */ J(vd, { ready: Ie }) : Ie ? /* @__PURE__ */ J(du, {
									label: "Credential",
									verticalOnMobile: !0,
									hint: "This provider's conventional environment variable is set on the server; the session reuses it.",
									control: /* @__PURE__ */ Y("div", {
										className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
										children: [/* @__PURE__ */ J(M, {
											iconName: L.CheckCircle,
											className: "text-success-primary"
										}), /* @__PURE__ */ J("span", {
											className: "label-small text-success-primary",
											children: "Detected"
										})]
									})
								}) : /* @__PURE__ */ Y(q, { children: [
									/* @__PURE__ */ J(du, {
										label: "Name",
										required: !0,
										verticalOnMobile: !0,
										hint: "How this setup is listed the next time a session is created.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: Me ? X.Large : X.Medium,
											className: lu,
											value: De,
											onChange: (e) => T(e.target.value)
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "API Key",
										required: !0,
										verticalOnMobile: !0,
										invalid: ot,
										hint: Pe?.auth_hint ? `Stored in NAC once the setup is saved, or set ${Pe.auth_hint} on the server instead.` : "Stored in NAC under a generated name once the setup is saved.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: Me ? X.Large : X.Medium,
											className: lu,
											type: "password",
											autoComplete: "off",
											placeholder: "Paste the provider key",
											leadingSlot: /* @__PURE__ */ J(ju, { status: He.status }),
											validation: ot,
											value: E,
											onChange: (e) => D(e.target.value)
										})
									})
								] })] }) : null
							] }) : null] }) : null,
							N.kind === "file" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(du, {
								label: "Config File",
								required: !0,
								hint: "A config.toml on this machine; its [model] section is read.",
								invalid: !!Je,
								verticalOnMobile: !0,
								control: /* @__PURE__ */ J(Z, {
									inputSize: Me ? X.Large : X.Medium,
									className: lu,
									placeholder: "Select Config File",
									trailing: Js.Button,
									trailingIconName: L.Folder,
									trailingOnClick: () => ce(!0),
									value: ae,
									onChange: (e) => oe(e.target.value)
								})
							}), ae.trim() ? /* @__PURE__ */ J(Q, {}) : null] }) : null,
							N.kind === "new" ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(du, {
									label: "Model Provider",
									required: !0,
									hint: "Service that provides the models for this session.",
									control: /* @__PURE__ */ J(dd, {
										items: bd,
										value: b,
										onValueChange: (e) => {
											x(e), D(""), ie("");
										}
									})
								}),
								/* @__PURE__ */ J(Q, {}),
								b === yd ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(du, {
									label: "Protocol",
									required: !0,
									hint: "Wire format the endpoint speaks; a URL alone cannot say.",
									control: /* @__PURE__ */ J(dd, {
										items: nd,
										value: S,
										onValueChange: (e) => C(e)
									})
								}), /* @__PURE__ */ J(Q, {})] }) : null,
								/* @__PURE__ */ J(du, {
									label: "Name",
									required: !0,
									hint: "How this setup is listed the next time a session is created.",
									control: /* @__PURE__ */ J(Z, {
										inputSize: X.Medium,
										className: lu,
										value: De,
										onChange: (e) => T(e.target.value)
									})
								}),
								we ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(du, {
									label: "API Key",
									required: !0,
									invalid: ot,
									hint: "Stored in NAC under a generated name once the setup is saved.",
									control: /* @__PURE__ */ J(Z, {
										inputSize: X.Medium,
										className: lu,
										type: "password",
										autoComplete: "off",
										placeholder: "Paste the provider key",
										leadingSlot: /* @__PURE__ */ J(ju, { status: He.status }),
										validation: ot,
										value: E,
										onChange: (e) => D(e.target.value)
									})
								})] }) : null,
								b === yd ? /* @__PURE__ */ Y(q, { children: [
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "Model",
										required: !0,
										hint: "Model identifier the endpoint expects.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: lu,
											placeholder: "gpt-5.5",
											value: O,
											onChange: (e) => k(e.target.value)
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "Base URL",
										required: !0,
										hint: "Endpoint the session sends its requests to.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: lu,
											placeholder: "https://api.openai.com/v1",
											value: A,
											onChange: (e) => ee(e.target.value)
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "Allow insecure HTTP",
										control: /* @__PURE__ */ Y("div", {
											className: `${lu} flex flex-col items-start gap-1`,
											children: [/* @__PURE__ */ J(ll, {
												"aria-label": "Allow insecure HTTP",
												checked: te,
												onChange: ne
											}), /* @__PURE__ */ J("p", {
												className: "body-small text-basic-secondary",
												children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
											})]
										})
									})
								] }) : we ? He.status === "ready" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(du, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									control: /* @__PURE__ */ J(dd, {
										items: pd(He.models),
										value: $e,
										onValueChange: ie,
										placeholder: "No models offered"
									})
								})] }) : null : Ne ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(du, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									invalid: !!st,
									control: /* @__PURE__ */ J(dd, {
										items: st ? [] : pd(Ze),
										value: st ? "" : $e,
										onValueChange: ie,
										disabled: !!st,
										placeholder: Be.isFetching ? "Reading the model list…" : st ? "–" : "No models offered"
									})
								})] }) : null
							] }) : null,
							N.kind === "saved" || N.kind === "file" ? /* @__PURE__ */ J(md, {
								resolving: Ke,
								resolved: qe,
								backend: Ye,
								onBackend: ue,
								baseUrl: Xe,
								onBaseUrl: fe,
								model: $e,
								onModel: (e) => qe?.models.length ? ie(e) : me(e),
								failed: !!Je
							}) : null,
							i && at ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), i] }) : null
						]
					})
				]
			}),
			ft ? /* @__PURE__ */ J(Bu, {
				backend: ft,
				className: "mt-1"
			}) : null,
			ut ? /* @__PURE__ */ Y("div", {
				className: "flex items-start gap-2",
				children: [/* @__PURE__ */ J("p", {
					className: "label-micro text-error-primary flex-1 min-w-0",
					children: ut
				}), dt ? /* @__PURE__ */ J(s, {
					variant: I.Ghost,
					size: F.Medium,
					content: R.Text,
					onClick: () => void dt(),
					children: "Try again"
				}) : null]
			}) : null,
			/* @__PURE__ */ J("p", {
				className: "text-micro text-basic-muted",
				children: "* Required fields"
			}),
			/* @__PURE__ */ J(ld, {
				open: se,
				kind: "toml",
				initialPath: ae.trim(),
				onClose: () => ce(!1),
				onSelect: (e) => {
					oe(e), ce(!1);
				}
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/LightModelSection.tsx
var wd = [{
	id: "",
	label: "Model default"
}, ...rd];
function Td(e, t) {
	if (!e?.model) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let n = e.backend ?? xu(t, e.model);
	if (!n) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let r = t?.providers?.find((e) => e.id === n), i = e.base_url ?? (r ? fu(r) : "");
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
function Ed(e) {
	return e.pick ? {
		model: e.pick.model,
		backend: e.pick.backend,
		base_url: e.pick.baseUrl || null,
		api_key_env: e.apiKeyEnv,
		reasoning_effort: e.effort || null
	} : null;
}
function Dd({ initial: e, onChange: t, behavior: n = "orchestrator" }) {
	let r = Xn(), i = Mr(r.data), [a, o] = K(e ? "dual" : "single"), [c, l] = K(() => Td(e, r.data)), u = W(() => {
		if (c.pick) return c;
		let t = Td(e, r.data);
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
		light: Ed(u)
	}, [a, u]);
	U(() => {
		t(d);
	}, [d, t]);
	let f = od(bu(r.data, u.pick?.backend, u.pick?.model).supportedEfforts, u.effort, wd), p = n === "direct" ? {
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
			children: [/* @__PURE__ */ J(uu, {
				label: p.label,
				hint: p.hint
			}), /* @__PURE__ */ J("div", {
				className: "flex items-center gap-2",
				children: ["single", "dual"].map((e) => /* @__PURE__ */ J(s, {
					variant: a === e ? I.Primary : I.Secondary,
					size: F.Medium,
					content: R.Text,
					onClick: () => o(e),
					"aria-pressed": a === e,
					children: e === "single" ? "Single" : "Dual"
				}, e))
			})]
		}), a === "dual" ? /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
			children: [/* @__PURE__ */ J(du, {
				label: "Light model",
				required: !0,
				verticalOnMobile: !0,
				hint: p.modelHint,
				control: /* @__PURE__ */ J(Au, {
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
			}), /* @__PURE__ */ J(du, {
				label: "Light effort",
				secondary: !0,
				hint: "Reasoning effort the light model runs with.",
				control: /* @__PURE__ */ J($c, {
					items: f,
					value: u.effort,
					onValueChange: (e) => l({
						...u,
						effort: e
					}),
					disabled: !u.pick,
					size: F.Medium,
					variant: I.Ghost,
					placement: z.BottomLeft,
					panelClassName: "max-h-64 overflow-auto"
				})
			})]
		}) : null]
	});
}
//#endregion
//#region src/app/components/modals/SshConnectionBox.tsx
var Od = "__new__", kd = ".ssh/config";
function Ad(e) {
	let t = e.trim();
	return t ? t.replace(/\/[^/]*$/, "") || "/" : "~/.ssh";
}
function jd(e) {
	let t = e.trim();
	if (!t) return null;
	let n = Number(t);
	return !Number.isInteger(n) || n < 1 || n > 65535 ? "Port must be an integer between 1 and 65535." : null;
}
function Md(e) {
	return e.trim() || null;
}
function Nd(e, t, n) {
	let r = Md(e);
	if (!r) return { error: "An SSH host is required." };
	let i = jd(t);
	return i ? { error: i } : {
		ssh_host: r,
		ssh_port: Md(t) ? Number(t.trim()) : null,
		ssh_identity_file: Md(n)
	};
}
function Pd(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function Fd(e, t) {
	return e.ssh_host === t.ssh_host && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function Id({ mode: e, connection: t, onConnectionChange: n, seedTarget: r = null, name: i, onNameChange: a, host: o, onHostChange: c, port: l, onPortChange: u, identityFile: d, onIdentityFileChange: f, onTest: p, testing: m = !1, locked: h = !1, className: _ }) {
	let { markSshDisconnected: v, markSshConnected: y } = B().stores.sshConnectionStore, b = _n(), { data: x } = Rt(), S = W(() => x?.configurations ?? [], [x]), C = Nt(), w = Pr(), T = e === "manage", E = W(() => T || !r?.ssh_host.trim() ? null : S.find((e) => Fd(r, e))?.config_id ?? null, [
		T,
		r,
		S
	]), [D, O] = K(null), k = D ?? E ?? Od, [ee, te] = K(!1), [ne, re] = K(() => Pd(S)), [ie, ae] = K(r?.ssh_host ?? ""), [oe, se] = K(r?.ssh_port ? String(r.ssh_port) : ""), [ce, le] = K(r?.ssh_identity_file ?? ""), [ue, de] = K(null), [fe, pe] = K(!1), me = g(), j = !!t, he = w.isPending || C.isPending || m, ge = h || j || he, _e = k === Od ? null : S.find((e) => e.config_id === k) ?? null, ve = T ? i ?? "" : ne, ye = T ? o ?? "" : j ? t?.ssh_host ?? "" : ie, be = T ? l ?? "" : j ? t?.ssh_port ? String(t.ssh_port) : "" : oe, xe = T ? d ?? "" : j ? t?.ssh_identity_file ?? "" : ce, N = (e) => {
		T ? a?.(e) : re(e);
	}, Se = (e) => {
		T ? c?.(e) : ae(e);
	}, P = (e) => {
		T ? u?.(e) : se(e);
	}, Ce = (e) => {
		T ? f?.(e) : le(e);
	}, we = k === Od ? "Create New" : _e?.name ?? "SSH config", Te = (e) => {
		if (O(e), te(!1), de(null), e === Od) {
			re(Pd(S)), ae(r?.ssh_host ?? ""), se(r?.ssh_port ? String(r.ssh_port) : ""), le(r?.ssh_identity_file ?? "");
			return;
		}
		let t = S.find((t) => t.config_id === e);
		t && (re(t.name), ae(t.ssh_host), se(t.ssh_port ? String(t.ssh_port) : ""), le(t.ssh_identity_file ?? ""));
	}, Ee = async () => {
		de(null);
		let e = Nd(ye, be, xe);
		if ("error" in e) {
			de(e.error);
			return;
		}
		if (k === Od && !Md(ve)) {
			de("An SSH config name is required.");
			return;
		}
		try {
			let t = await w.mutateAsync(e);
			if (y(e), k === Od) {
				let t = await C.mutateAsync({
					name: ve.trim(),
					ssh_host: e.ssh_host,
					ssh_port: e.ssh_port ?? null,
					ssh_identity_file: e.ssh_identity_file ?? null
				});
				O(t.config_id);
			}
			n(e, t.path);
		} catch (t) {
			v(e);
			let n = nr($(t));
			de(n), b.error(`SSH connect failed: ${n}`);
		}
	}, De = () => {
		t && v(t), n(null), de(null);
	}, Oe = async () => {
		if (p) {
			de(null);
			try {
				await p();
			} catch (e) {
				let t = nr($(e));
				de(t);
			}
		}
	}, ke = T || !j && k === Od, Ae = !T;
	return /* @__PURE__ */ Y("div", {
		className: V("relative flex flex-col rounded-[8px] overflow-hidden shadow-convex", j ? "bg-info-primary" : "bg-elevation-sublevel-variant-A", _),
		children: [
			Ae ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-4 h-12 pl-3 pr-1.5 py-1 border-b border-muted bg-elevation-sublevel-variant-A",
				children: [
					/* @__PURE__ */ J("p", {
						className: "label-small text-basic-primary flex-1 min-w-0",
						children: "SSH config"
					}),
					j ? /* @__PURE__ */ J(Si, {
						text: "Connected",
						color: xi.Blue,
						className: "!py-0.5 !px-1"
					}) : null,
					/* @__PURE__ */ J(Ln, {
						open: ee && !ge,
						onClose: () => te(!1),
						placement: z.BottomLeft,
						size: "w-auto",
						className: "shrink-0",
						panelClassName: "max-h-72 overflow-hidden",
						sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
						content: /* @__PURE__ */ Y("div", {
							className: V("flex flex-col min-h-0", me ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
							children: [/* @__PURE__ */ J("div", {
								className: "flex flex-col shrink-0 [&>*]:shrink-0",
								children: /* @__PURE__ */ Y(Zc, {
									size: me ? Yc.Large : Yc.Medium,
									variant: k === Od ? Xc.Accent : Xc.Regular,
									active: k === Od,
									onClick: () => Te(Od),
									children: [/* @__PURE__ */ J(M, { iconName: L.Add }), /* @__PURE__ */ J("span", {
										className: "text-left flex-grow",
										children: "Create New"
									})]
								})
							}), S.length > 0 ? /* @__PURE__ */ Y("div", {
								className: "flex flex-col flex-1 min-h-0 min-w-0",
								children: [/* @__PURE__ */ J("div", { className: "h-px w-full bg-divider-muted my-1 shrink-0" }), /* @__PURE__ */ J("div", {
									className: "flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
									children: S.map((e) => /* @__PURE__ */ Y(Zc, {
										size: me ? Yc.Large : Yc.Medium,
										variant: k === e.config_id ? Xc.Accent : Xc.Regular,
										active: k === e.config_id,
										onClick: () => Te(e.config_id),
										children: [/* @__PURE__ */ J(M, { iconName: L.Globe }), /* @__PURE__ */ J("span", {
											className: "text-left flex-grow truncate",
											children: e.name
										})]
									}, e.config_id))
								})]
							}) : null]
						}),
						children: /* @__PURE__ */ Y(s, {
							size: F.Medium,
							variant: I.Secondary,
							disabled: ge,
							onClick: () => te((e) => !e),
							"aria-expanded": ee,
							children: [/* @__PURE__ */ J("span", {
								className: "truncate max-w-[140px]",
								children: we
							}), /* @__PURE__ */ J(M, {
								iconName: L.Down,
								className: V("shrink-0 transition-transform duration-150 ease-out", ee ? "rotate-180" : "rotate-0")
							})]
						})
					})
				]
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-4 p-3",
				children: [
					ke ? /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 w-full",
						children: [/* @__PURE__ */ J(uu, {
							label: "SSH config name",
							required: !0
						}), /* @__PURE__ */ J(Z, {
							inputSize: me ? X.Large : X.Medium,
							value: ve,
							isDisabled: ge,
							onChange: (e) => N(e.target.value),
							placeholder: "SSH-config-1"
						})]
					}) : null,
					/* @__PURE__ */ Y("div", {
						className: "flex flex-col md:flex-row gap-4 items-start w-full",
						children: [/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 w-full md:flex-1 min-w-0",
							children: [/* @__PURE__ */ J(uu, {
								label: "SSH Host",
								required: !0,
								hint: "user@host, a host alias from ~/.ssh/config, or an IP."
							}), /* @__PURE__ */ J(Z, {
								inputSize: me ? X.Large : X.Medium,
								value: ye,
								isDisabled: ge,
								onChange: (e) => Se(e.target.value),
								placeholder: "example@192.0.2.10 or build-box"
							})]
						}), /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 w-full md:w-[98px] shrink-0",
							children: [/* @__PURE__ */ J(uu, {
								label: "Port",
								hint: "Blank uses OpenSSH's default (usually 22)."
							}), /* @__PURE__ */ J(Z, {
								inputSize: me ? X.Large : X.Medium,
								value: be,
								isDisabled: ge,
								onChange: (e) => P(e.target.value),
								placeholder: "22"
							})]
						})]
					}),
					/* @__PURE__ */ Y("div", {
						className: "flex gap-4 items-end w-full",
						children: [/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 flex-1 min-w-0",
							children: [/* @__PURE__ */ J(uu, {
								label: "Private Key",
								hint: "A key file on this machine. The default leaves the choice to your ~/.ssh/config and ssh agent."
							}), /* @__PURE__ */ Y(s, {
								size: F.Medium,
								variant: I.Secondary,
								className: "w-full",
								disabled: ge,
								onClick: () => pe(!0),
								children: [/* @__PURE__ */ J("span", {
									className: "flex-1 min-w-0 truncate text-left",
									children: xe.trim() || kd
								}), /* @__PURE__ */ J(M, {
									iconName: L.FolderOpen,
									size: 20
								})]
							})]
						}), /* @__PURE__ */ J("div", {
							className: "md:w-[128px] shrink-0 relative",
							children: T ? /* @__PURE__ */ Y(s, {
								size: F.Medium,
								variant: I.Secondary,
								className: "w-full",
								disabled: he,
								onClick: () => void Oe(),
								children: [m ? /* @__PURE__ */ J(Le, { size: A.Small }) : /* @__PURE__ */ J(M, {
									iconName: L.Bolt,
									size: 20
								}), "Test"]
							}) : j ? /* @__PURE__ */ J(s, {
								size: F.Medium,
								variant: I.Ghost,
								className: "w-full",
								onClick: De,
								children: "Disconnect"
							}) : /* @__PURE__ */ Y(s, {
								size: F.Medium,
								variant: I.Primary,
								className: "w-full",
								disabled: he,
								onClick: () => void Ee(),
								children: [he ? /* @__PURE__ */ J(Le, { size: A.Small }) : null, "Connect"]
							})
						})]
					}),
					ue ? /* @__PURE__ */ J("p", {
						className: "text-micro text-error-primary",
						children: ue
					}) : null
				]
			}),
			/* @__PURE__ */ J(ld, {
				open: fe,
				kind: "file",
				title: "Select Private Key",
				showHidden: !0,
				initialPath: Ad(xe),
				clearLabel: `Use ${kd}`,
				onClear: () => {
					Ce(""), pe(!1);
				},
				onClose: () => pe(!1),
				onSelect: (e) => {
					Ce(e), pe(!1);
				}
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/SessionBehaviorPicker.tsx
function Ld({ value: e, onChange: t, disabled: n = !1 }) {
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
				children: Nl.map((r, i) => {
					let a = r.id === e;
					return /* @__PURE__ */ Y("button", {
						type: "button",
						role: "radio",
						"aria-checked": a,
						tabIndex: a ? 0 : -1,
						disabled: n,
						className: V("flex min-h-[196px] cursor-pointer flex-col gap-2 rounded-[6px] border p-3 text-left transition-colors", a ? "border-accent-primary bg-accent-secondary" : "border-border-primary bg-elevation-level-1 hover:bg-elevation-level-2", n && "cursor-not-allowed opacity-60"),
						onClick: () => t(r.id),
						onKeyDown: (e) => {
							let n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0, r = e.key === "Home" ? 0 : e.key === "End" ? Nl.length - 1 : n ? (i + n + Nl.length) % Nl.length : null;
							r != null && (e.preventDefault(), t(Nl[r].id), (e.currentTarget.parentElement?.querySelectorAll("[role=\"radio\"]"))?.[r]?.focus());
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
function Rd(e) {
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
function zd(e, t) {
	if (e === t) return !0;
	if (e == null || t == null) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Object.hasOwn(t, n) && e[n] === t[n]);
}
function Bd(e, t) {
	return e === void 0 || t === void 0 ? e === t : Uu(e ?? null, t ?? null);
}
function Vd(e, t) {
	if (e === t) return !0;
	if (!e || !t) return !1;
	if (e.kind === "resolved" && t.kind === "resolved") return e.backend === t.backend && e.model === t.model && e.base_url === t.base_url && e.allow_insecure_http === t.allow_insecure_http && e.api_key_env === t.api_key_env && e.reasoning_effort === t.reasoning_effort && zd(e.extra_headers, t.extra_headers) && e.orchestrator_compaction_threshold === t.orchestrator_compaction_threshold && Bd(e.light_model, t.light_model);
	if (e.kind !== "save" || t.kind !== "save") return !1;
	let n = e.request, r = t.request;
	return n.name === r.name && n.backend === r.backend && n.model === r.model && n.base_url === r.base_url && n.allow_insecure_http === r.allow_insecure_http && n.api_key === r.api_key && n.reasoning_effort === r.reasoning_effort && n.initial_prompt === r.initial_prompt && zd(n.extra_headers, r.extra_headers) && n.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && Bd(n.light_model, r.light_model);
}
//#endregion
//#region src/app/components/modals/PrimaryModelSection.tsx
var Hd = [{
	id: "",
	label: "Model default"
}, ...rd];
function Ud({ initial: e, inheritSavedDefault: t = !1, existingSession: n = !1, onChange: r }) {
	let i = Xn(), a = _d(), o = Mr(i.data), [s, c] = K(null), l = In(t && !e), u = t && !e ? l.data?.configurations.at(-1) : void 0, d = W(() => e ?? (u ? {
		...Rd(u),
		extra_headers: u.extra_headers
	} : void 0), [e, u]), f = ln(u && !s ? u.config_id : null, ""), p = t && !e && !s && (l.isPending || u && !f.data), m = W(() => d ? {
		pick: {
			backend: d.backend,
			model: d.model,
			baseUrl: d.base_url
		},
		effort: d.reasoning_effort ?? ""
	} : null, [d]), h = a.defaultPick ? o.get(a.defaultPick.backend) : void 0, g = a.configured && a.credentialReady && (i.isPending || h === null), _ = h === void 0 || a.defaultPick && h?.some((e) => e.id === a.defaultPick?.model) ? a.defaultPick : null, v = W(() => hu(i.data), [i.data]), y = W(() => s ?? m ?? (a.configured ? _ ? {
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
	]), b = i.data?.providers.find((e) => e.id === y?.pick.backend), x = !!(d && y && y.pick.backend === d.backend), S = !!(b?.auth_status === "ready" || y && a.matches(y.pick) && a.credentialReady), C = y ? a.matches(y.pick) : !1, w = C && y ? o.get(y.pick.backend) : void 0, T = W(() => {
		if (p || !y || !y.pick.baseUrl) return null;
		let e = !!(n && d && x && y.pick.model === d.model);
		if (!e && (a.initializing || g)) return null;
		if (!e && C) {
			let e = w;
			if (!a.credentialReady || e === null || e && !e.some((e) => e.id === y.pick.model)) return null;
		}
		return !e && !Bn(y.pick.backend) && !S ? null : x && d ? {
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
	U(() => r(T), [r, T]);
	let E = od(bu(i.data, y?.pick.backend, y?.pick.model).supportedEfforts, y?.effort ?? "", Hd);
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
		children: [
			/* @__PURE__ */ J(uu, {
				label: "Primary model",
				hint: "Search one catalog across every connected provider. Provider accounts and advanced presets are managed separately below."
			}),
			/* @__PURE__ */ J(du, {
				label: "Model",
				required: !0,
				verticalOnMobile: !0,
				control: /* @__PURE__ */ J(Au, {
					catalog: i.data,
					loading: i.isLoading,
					failed: i.isError,
					liveByBackend: o,
					value: y?.pick ?? null,
					onSelect: (e) => {
						let t = bu(i.data, e.backend, e.model).supportedEfforts, n = y?.effort ?? "";
						c({
							pick: e,
							effort: n && !t.includes(n) ? "" : n
						});
					}
				})
			}),
			/* @__PURE__ */ J(du, {
				label: "Reasoning",
				hint: "Stored with this chat and switchable independently of provider setup.",
				control: /* @__PURE__ */ J(dd, {
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
			u && f.isError ? /* @__PURE__ */ J("p", {
				role: "alert",
				className: "text-micro text-error-primary",
				children: "The saved project setup could not be resolved. Review it in Advanced or choose another model."
			}) : null,
			y && !x && !S ? /* @__PURE__ */ Y("p", {
				className: "text-micro text-error-primary",
				role: "alert",
				children: [
					"Connect ",
					Zt(y.pick.backend),
					" in Provider connections or Advanced before selecting this model."
				]
			}) : null
		]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ProviderConnections.tsx
function Wd() {
	return /* @__PURE__ */ Y("section", {
		"aria-label": "Provider connections",
		className: "flex flex-col gap-3",
		children: [
			/* @__PURE__ */ J("p", {
				className: "text-micro text-basic-muted",
				children: "Connect another account without changing this chat or signing out of your current provider. API keys and custom endpoints are available in Advanced provider setup."
			}),
			/* @__PURE__ */ J(Bu, { backend: "arcee-auth" }),
			/* @__PURE__ */ J(Bu, { backend: "chatgpt-codex-responses" })
		]
	});
}
//#endregion
//#region src/app/features/setup/ModelSetupSection.tsx
function Gd({ initial: e, onChange: t, invalid: n, errorText: r, children: i, simple: a = !0, inheritSavedDefault: o = !1, existingSession: c = !1 }) {
	let [l, u] = K(!a), [d, f] = K(!1), [p, m] = K(!1), h = G(null), [g, _] = K(e), v = H((e) => {
		h.current = e, m(e?.kind === "save"), t(e, "preset");
	}, [t]), y = H((e) => {
		let n = h.current;
		if (e?.kind === "resolved" && n?.kind === "resolved") {
			let t = e.backend === n.backend && e.model === n.model && e.base_url === n.base_url && e.allow_insecure_http === n.allow_insecure_http && e.api_key_env === n.api_key_env && e.reasoning_effort === n.reasoning_effort && JSON.stringify(e.extra_headers) === JSON.stringify(n.extra_headers);
			e = {
				...e,
				light_model: n.light_model,
				orchestrator_compaction_threshold: n.orchestrator_compaction_threshold,
				config_id: t ? n.config_id : void 0
			};
		}
		h.current = e, m(e?.kind === "save"), t(e, "primary");
	}, [t]);
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-3",
		children: [
			l ? /* @__PURE__ */ J(Cd, {
				initial: g,
				invalid: n,
				onChange: v,
				children: i
			}) : /* @__PURE__ */ J(Ud, {
				inheritSavedDefault: o,
				existingSession: c,
				initial: g,
				onChange: y
			}),
			/* @__PURE__ */ J(s, {
				variant: I.Secondary,
				"aria-expanded": d,
				onClick: () => f((e) => !e),
				children: "Provider connections"
			}),
			d ? /* @__PURE__ */ J(Wd, {}) : null,
			/* @__PURE__ */ J(s, {
				variant: I.Secondary,
				"aria-expanded": l,
				onClick: () => {
					let e = h.current;
					e?.kind === "resolved" && _({
						...e,
						extra_headers: e.extra_headers ?? {}
					}), !(e?.kind === "save" && l) && u((e) => !e);
				},
				disabled: l && p,
				children: l ? "Back to unified models" : "Advanced presets and provider setup"
			}),
			!l && i ? /* @__PURE__ */ Y("details", {
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
var Kd = class extends ne("SetupFailure") {};
function qd(e) {
	return e instanceof Kd && (e.kind === "unknown" || e.kind === "conflict" || e.completed.length > 0);
}
function Jd(e, t) {
	return st(() => {
		let n = [];
		return t((t, r, i = !0) => De(function* () {
			if (!e.current()) return yield* Ce(new Kd({
				phase: t,
				kind: "cancelled",
				cause: null,
				completed: [...n]
			}));
			let a = yield* dt({
				try: r,
				catch: (r) => {
					let i = e.classify(r, t);
					return new Kd({
						phase: t,
						kind: t === "read" && i === "unknown" ? "rejected" : i,
						cause: r,
						completed: [...n]
					});
				}
			}).pipe(rt(() => i ? k(() => e.reconcile(t)) : je));
			return i && (n.push(t), yield* k(() => e.reconcile(t))), a;
		}));
	});
}
function Yd(e) {
	return Jd(e, (t) => De(function* () {
		let n = yield* t("preset", e.model, e.persistsModel ?? !0), r = yield* t("project", () => e.project(n));
		return {
			model: n,
			project: r,
			chat: yield* t("chat", () => e.chat(n, r))
		};
	}));
}
function Xd(e) {
	return Jd(e, (t) => De(function* () {
		if (e.existing) {
			let n = yield* t("read", e.existing, !1);
			if (n !== null) return n;
		}
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("chat", () => e.chat(n));
	}));
}
function Zd(e) {
	return Jd(e, (t) => De(function* () {
		yield* t("read", e.check, !1);
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("configuration", () => e.configuration(n), e.configurationSaved ?? !0), e.title && (yield* t("title", e.title)), e.projectDefault && (yield* t("default", () => e.projectDefault(n))), n;
	}));
}
async function Qd(e) {
	let t = await We(e);
	if ($t(t)) return t.value;
	let n = Ct(t.cause);
	throw ar(n) ? n.value : Be(t.cause);
}
//#endregion
//#region src/app/features/setup/useSetupAction.ts
function $d(e = !0) {
	let t = Nu(e), n = G(!1), r = G(!1), [i, a] = K(!1), [o, s] = K(!1);
	return {
		busy: i,
		needsReview: o,
		run: async (e) => {
			let i = t.current;
			if (!(!i?.current() || n.current || r.current)) {
				n.current = !0, a(!0);
				try {
					let t = await Qd(e(i));
					return i.current() ? t : void 0;
				} catch (e) {
					if (!i.current()) return;
					throw qd(e) && (r.current = !0, s(!0)), e;
				} finally {
					n.current = !1, i.current() && a(!1);
				}
			}
		}
	};
}
//#endregion
//#region src/app/features/setup/browserAdapters.ts
var ef = class extends Error {}, tf = class extends Error {
	constructor() {
		super("This chat's settings changed. Reopen settings to review the current values before saving.");
	}
};
function nf(e, t) {
	return e instanceof ef ? "rejected" : e instanceof tf ? "conflict" : e instanceof O ? t === "project" && e.status === 409 ? "rejected" : e.status === 409 ? "conflict" : e.status >= 500 ? "unknown" : "rejected" : "unknown";
}
function rf(e) {
	if (!(e instanceof Kd)) return iu($(e));
	if (e.kind === "cancelled") return "This setup view was closed.";
	let t = e.completed.includes("configuration") ? "Chat settings were saved. " : e.completed.includes("project") ? "The project was saved. " : e.completed.includes("preset") ? "The preset was saved. " : "";
	return e.kind === "unknown" ? `${t}The ${e.phase} save outcome is unknown. Refresh and review the saved values before trying again.` : e.kind === "conflict" ? `${t}The ${e.phase} changed or is busy. Refresh and review before saving again. ${iu($(e.cause))}` : `${t}${iu($(e.cause))}${e.completed.length ? " Reopen setup to review the saved values before continuing." : ""}`;
}
function af(e, t) {
	return async (n) => {
		let r = n === "preset" ? [
			bn.modelConfigs,
			bn.modelCatalog,
			bn.credentials
		] : n === "project" || n === "default" ? [bn.projects] : t ? [
			bn.sessionConfig(t),
			bn.sessionSnapshot(t),
			bn.sessionsAll
		] : [bn.sessionsAll];
		await Promise.all(r.map((t) => e.invalidateQueries({ queryKey: t })));
	};
}
//#endregion
//#region src/app/features/setup/projectLaunch.ts
function of(e) {
	let { selected: t, policy: n, light: r, sandbox: i } = e, a = {
		project_id: e.projectId,
		behavior: se(n, e.behavior),
		first_chat: !0,
		first_chat_same_behavior: !n.orchestrationEnabled,
		backend: t.backend,
		model: t.model,
		base_url: t.base_url,
		allow_insecure_http: t.allow_insecure_http,
		api_key_env: t.api_key_env,
		reasoning_effort: e.reasoning === "__clear__" ? null : e.reasoning || t.reasoning_effort || null,
		light_model: n.orchestrationEnabled ? r.mode === "dual" && r.light ? Vu(r.light, t.backend, t.api_key_env) : null : e.savedLight ?? null
	}, o = e.headers ?? t.extra_headers ?? void 0;
	return o !== void 0 && (a.extra_headers = o), e.presetCompaction && t.orchestrator_compaction_threshold !== void 0 ? a.orchestrator_compaction_threshold = t.orchestrator_compaction_threshold : Ju(e.compaction) !== null && (a.orchestrator_compaction_threshold = Number(e.compaction)), e.execution !== "ssh" && (a.sandbox = {
		enabled: e.execution === "sandbox",
		no_mount_cwd: i.noMount,
		image: Ju(i.image),
		gpus: Yu(i.gpu),
		workdir: Ju(i.workdir),
		shm_size: Ju(i.shm),
		mounts: Yu(i.mounts),
		mounts_ro: [],
		activity_key: e.activityKey
	}), a;
}
//#endregion
//#region src/app/components/modals/CreateProjectModal.tsx
var sf = [
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
], cf = id.map((e) => e.id === "" ? {
	...e,
	label: "From configuration"
} : e), lf = { paddingInline: "8px" }, uf = {
	noMount: !1,
	image: "",
	gpu: "",
	workdir: "",
	shm: "",
	mounts: ""
};
function df({ open: e, onClose: t }) {
	let { data: n } = Qt();
	return cd(e) ? /* @__PURE__ */ J(ff, {
		open: e,
		defaultCwd: n?.root_cwd ?? "",
		onClose: t
	}, e ? "open" : "closing") : null;
}
function ff({ open: e, defaultCwd: t, onClose: n }) {
	let { loadLastLight: i, storeLastLight: a } = B().stores.lastLight, o = fi(), c = _n(), l = $d(e), u = ai(), d = Ue(), f = en(), p = yn(), [m, h] = K("local"), _ = ct(), [v, y] = K(_.orchestrationEnabled ? "orchestrator" : "direct"), [b, x] = K(t), [S, C] = K(""), [w, T] = K(""), [E, D] = K(""), [O, k] = K(""), [A, ee] = K(uf), [te, ne] = K(!1), [re, ie] = K(!1), [ae, oe] = K(!1), [se, ce] = K(null), [le, ue] = K({
		mode: "single",
		light: null
	}), [de, fe] = K(null), [pe, me] = K(""), [j, he] = K(null), ge = G(""), _e = G(!0), ve = G(!1), ye = Xn(), be = se?.kind === "save" ? se.request : se ?? null, xe = od(bu(ye.data, be?.backend, be?.model).supportedEfforts, w, cf), N = g(), Se = m === "ssh", P = r(m === "sandbox").data, Ce = Se ? j : null, we = !Se || Ce !== null, Te = l.busy, [Ee, De] = K(null), Oe = f.isPending && m === "sandbox", ke = He(Oe, Ee).data, Ae = ke?.since_epoch_ms, [je, Me] = K(0);
	U(() => {
		if (!Oe) return;
		let e = setInterval(() => {
			Me(Ae ? Math.max(0, Math.floor((Date.now() - Ae) / 1e3)) : 0);
		}, 1e3);
		return () => clearInterval(e);
	}, [Oe, Ae]);
	let Ne = (e) => (t) => {
		fe(null), e(t);
	}, Pe = (e) => {
		fe(null), ee((t) => ({
			...t,
			...e
		}));
	}, Fe = G(null), Ie = H((e, t) => {
		if (ce(e), !e || Vd(Fe.current, e)) return;
		let n = Fe.current;
		if (Fe.current = e, t === "primary" && n?.kind === "resolved") {
			fe((e) => e?.field === "config" ? null : e);
			return;
		}
		if (e?.kind === "resolved" && e.orchestrator_compaction_threshold !== void 0) {
			let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
			ve.current = !0, _e.current = !1, ge.current = n, D(n);
		} else {
			let e = ve.current;
			ve.current = !1, e && (_e.current = !0, ge.current = "", D(""));
		}
		fe((e) => e?.field === "config" ? null : e);
	}, []), Le = H((e) => {
		ue(e), fe((e) => e?.field === "config" ? null : e);
	}, []), Re = W(() => i(), [i]), ze = se?.kind === "resolved" && se.light_model !== void 0 ? se.light_model : Re, Be = JSON.stringify(ze), Ve = W(() => {
		let e = bu(ye.data, be?.backend, be?.model).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		ye.data,
		be?.backend,
		be?.model
	]);
	U(() => {
		!ve.current && Ve !== "auto" && (ge.current === "" || _e.current) && (_e.current = !0, ge.current = Ve, D(Ve));
	}, [Ve, se]);
	let We = (e) => {
		fe(null), ve.current = !1, _e.current = !1, ge.current = e, D(e);
	}, Ge = (e) => {
		e !== m && (fe(null), h(e), he(null), x(e === "ssh" ? "" : t));
	}, Ke = (e, t) => {
		fe(null), he(e), e ? t && x(t) : x("");
	}, qe = async () => {
		if (l.needsReview || Te) return;
		if (Se && !Ce) {
			fe({
				field: "ssh",
				message: "Connect to the SSH host before creating a project."
			});
			return;
		}
		if (!Ju(b)) {
			fe({
				field: "cwd",
				message: "A working folder is required."
			});
			return;
		}
		if (!se) {
			fe({
				field: "config",
				message: "Complete the provider configuration before creating a project."
			});
			return;
		}
		if (_.orchestrationEnabled && le.mode === "dual" && !le.light) {
			fe({
				field: "config",
				message: "Pick the light model before creating a project."
			});
			return;
		}
		let e;
		try {
			e = Qu(O, void 0);
		} catch (e) {
			fe({
				field: "config",
				message: nr($(e))
			});
			return;
		}
		let t = null;
		try {
			let r = await l.run((n) => Yd({
				current: n.current,
				classify: nf,
				reconcile: af(u),
				persistsModel: se.kind === "save",
				model: async () => {
					if (se.kind === "save") {
						let e = le.mode === "dual" && le.light ? {
							...se.request,
							light_model: le.light
						} : se.request, t = Rd(await p.mutateAsync(e));
						return n.current() && ce(t), t;
					}
					return se;
				},
				project: async (e) => {
					let n = await d.mutateAsync({
						name: Ju(S),
						cwd: b,
						ssh_host: Ce?.ssh_host ?? null,
						ssh_port: Ce?.ssh_port ?? null,
						ssh_identity_file: Ce?.ssh_identity_file ?? null,
						default_model_config_id: e.config_id ?? null
					});
					return t = n.project_id, n;
				},
				chat: async (t, r) => {
					let i = m === "sandbox" ? crypto.randomUUID() : null;
					n.current() && De(i);
					let a = of({
						selected: t,
						projectId: r.project_id,
						policy: _,
						behavior: v,
						reasoning: w,
						headers: e,
						compaction: E,
						presetCompaction: ve.current,
						savedLight: ze,
						light: le,
						execution: Ce ? "ssh" : m,
						sandbox: A,
						activityKey: i
					});
					return {
						snapshot: await f.mutateAsync(a),
						launchLight: a.light_model ?? null,
						apiKeyEnv: t.api_key_env
					};
				}
			}));
			if (!r) return;
			let { snapshot: i, launchLight: s, apiKeyEnv: h } = r.chat;
			a(s && Hu(s, h)), c.success("Project created"), o(i.metadata.session_id ? _r.session(i.metadata.session_id) : _r.project(r.project.project_id)), n();
		} catch (e) {
			if (t && e instanceof Kd && e.kind !== "unknown") c.error(`Project created, but the first chat failed: ${rf(e)}`), o(_r.project(t)), n();
			else {
				let t = rf(e);
				qd(e) && me(t), fe({
					field: e instanceof Kd && e.phase === "project" && e.kind === "rejected" ? "cwd" : "config",
					message: t
				});
			}
		}
	}, Je = (e) => de?.field === e;
	return /* @__PURE__ */ Y(ur, {
		open: e,
		onClose: n,
		title: "New Project",
		size: Wt.Wide,
		flush: !0,
		className: "h-[680px]",
		footer: N ? /* @__PURE__ */ J(wi, {
			variant: I.Primary,
			content: R.Text,
			onClick: qe,
			loading: Te,
			disabled: Te || l.needsReview || !!de || !se || !we,
			children: "Create Project"
		}) : /* @__PURE__ */ J(s, {
			variant: I.Primary,
			size: F.Large,
			content: R.Text,
			onClick: qe,
			loading: Te,
			disabled: Te || l.needsReview || !!de || !se || !we,
			children: "Create Project"
		}),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-8 md:gap-6 [&>*]:shrink-0",
			children: [
				_.orchestrationEnabled ? /* @__PURE__ */ J(Ld, {
					value: v,
					onChange: y,
					disabled: Te
				}) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: [
						/* @__PURE__ */ J(uu, {
							label: "Environment",
							hint: "Where NAC runs commands and accesses files."
						}),
						/* @__PURE__ */ J("div", {
							className: "flex items-start gap-3",
							children: sf.map((e) => /* @__PURE__ */ J(s, {
								variant: m === e.id ? I.Primary : I.Secondary,
								size: F.Medium,
								content: R.Text,
								onClick: () => Ge(e.id),
								"aria-pressed": m === e.id,
								className: `${N ? "!rounded-full" : ""}`,
								children: e.label
							}, e.id))
						}),
						/* @__PURE__ */ J("p", {
							className: "pt-1 text-micro text-basic-muted",
							children: sf.find((e) => e.id === m)?.description
						}),
						m === "sandbox" && P && P.status !== "ready" ? /* @__PURE__ */ Y("div", {
							className: "pt-1",
							children: [/* @__PURE__ */ J("p", {
								className: "text-error-primary text-micro",
								children: P.status === "missing" ? "Sandbox mode runs sessions in a podman container, and podman is not installed on this machine." : `Sandbox mode needs podman, which is not responding${P.detail ? `: ${P.detail}` : "."}`
							}), P.guidance ? /* @__PURE__ */ J("pre", {
								className: "pt-1 whitespace-pre-wrap font-mono text-micro text-basic-muted",
								children: P.guidance
							}) : null]
						}) : null
					]
				}),
				Se ? /* @__PURE__ */ J(Id, {
					mode: "launch",
					connection: j,
					onConnectionChange: Ke
				}) : null,
				we ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col md:flex-row items-start gap-6 md:gap-4",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 flex-1 min-w-0 w-full",
						children: [
							/* @__PURE__ */ J(uu, {
								label: "Working Folder",
								hint: Se ? "The project folder NAC works within on the SSH host." : "The project folder NAC works within.",
								required: !0,
								invalid: Je("cwd")
							}),
							/* @__PURE__ */ Y(s, {
								variant: I.Secondary,
								size: N ? F.Large : F.Medium,
								content: R.IconRight,
								className: V("w-full", Je("cwd") && "input-validation"),
								style: lf,
								onClick: () => oe(!0),
								children: [/* @__PURE__ */ J("span", {
									className: V("flex-1 min-w-0 truncate text-left font-normal", b ? "text-basic-primary" : "text-basic-muted"),
									children: b || "/path/to/project"
								}), /* @__PURE__ */ J(M, {
									iconName: L.Folder,
									className: "shrink-0"
								})]
							}),
							Je("cwd") ? /* @__PURE__ */ J("p", {
								className: "pt-1 text-error-primary text-micro",
								children: de?.message
							}) : null
						]
					}), /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 flex-1 min-w-0 w-full",
						children: [/* @__PURE__ */ J(uu, { label: "Project name" }), /* @__PURE__ */ J(Z, {
							inputSize: N ? X.Large : X.Medium,
							placeholder: "Taken from the git remote",
							value: S,
							onChange: (e) => Ne(C)(e.target.value),
							className: `${N ? "w-full" : ""}`
						})]
					})]
				}) : null,
				we ? /* @__PURE__ */ J(Gd, {
					simple: !_.orchestrationEnabled,
					inheritSavedDefault: !0,
					invalid: Je("config"),
					errorText: pe || (Je("config") ? de?.message : void 0),
					onChange: Ie,
					children: /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-2",
						children: [
							_.orchestrationEnabled ? /* @__PURE__ */ J(Dd, {
								initial: ze,
								behavior: v,
								onChange: Le
							}, Be) : null,
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ J(du, {
								label: "Reasoning Effort",
								hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
								control: ((e, t, n, r = !1) => /* @__PURE__ */ J($c, {
									items: e,
									value: t,
									onValueChange: n,
									disabled: r,
									size: F.Medium,
									variant: I.Ghost,
									placement: z.BottomLeft,
									sticky: !0,
									panelClassName: "max-h-64 overflow-auto min-w-[220px]"
								}))(xe, w, Ne(T))
							}),
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ J(du, {
								label: "Context Limit",
								hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
								control: /* @__PURE__ */ Y("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ J(Z, {
										inputSize: N ? X.Large : X.Medium,
										className: "w-full md:w-[120px]",
										inputClassName: "md:text-right",
										placeholder: Ve,
										inputMode: "numeric",
										value: E,
										onChange: (e) => We(e.target.value)
									}), /* @__PURE__ */ J("span", {
										className: "shrink-0 text-micro text-basic-muted",
										children: "tokens"
									})]
								})
							}),
							m === "sandbox" ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(du, {
									label: "Sandbox options",
									hint: "The container the session runs in: image, GPUs, workdir, shared memory and mounts.",
									control: /* @__PURE__ */ J(ll, {
										checked: re,
										onChange: ie,
										"aria-label": "Sandbox options"
									})
								}),
								re ? /* @__PURE__ */ Y(q, { children: [
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "Container image",
										hint: "Image the sandbox runs; empty uses the configured default.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "python:3.13-bookworm",
											value: A.image,
											onChange: (e) => Pe({ image: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "GPUs",
										hint: "Comma-separated GPU list, e.g. all.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "all",
											value: A.gpu,
											onChange: (e) => Pe({ gpu: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "Container workdir",
										hint: "Working directory inside the container.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "/workspace",
											value: A.workdir,
											onChange: (e) => Pe({ workdir: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "Shared memory size",
										hint: "Container /dev/shm size, e.g. 1g.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "0",
											value: A.shm,
											onChange: (e) => Pe({ shm: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "Mounts (HOST:GUEST)",
										hint: "Comma-separated bind mounts.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "/data:/data",
											value: A.mounts,
											onChange: (e) => Pe({ mounts: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(du, {
										label: "Don't mount the working folder",
										secondary: !0,
										control: /* @__PURE__ */ J(ll, {
											checked: A.noMount,
											onChange: (e) => Pe({ noMount: e }),
											"aria-label": "Don't mount the working folder",
											size: N ? al.Large : al.Medium
										})
									})
								] }) : null
							] }) : null,
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ J(du, {
								label: "Custom HTTP headers",
								hint: "Turn this on only if you need to send additional request metadata.",
								control: /* @__PURE__ */ J(ll, {
									checked: te,
									onChange: ne,
									"aria-label": "Custom HTTP headers"
								})
							}),
							te ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(oc, {
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
		}), /* @__PURE__ */ J(ld, {
			open: ae,
			kind: "directory",
			initialPath: b.trim(),
			ssh: Ce,
			onClose: () => oe(!1),
			onSelect: (e) => {
				Ne(x)(e), oe(!1);
			}
		})]
	});
}
//#endregion
//#region src/app/components/modals/NewChatModal.tsx
function pf(e) {
	if (!e) return {};
	try {
		let t = JSON.parse(e);
		return Object(t) !== t || Array.isArray(t) ? {} : t;
	} catch {
		return {};
	}
}
function mf(e) {
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
function hf(e, t) {
	return {
		initial: {
			backend: e.backend ?? t,
			model: e.model,
			base_url: e.base_url,
			allow_insecure_http: e.allow_insecure_http,
			api_key_env: e.api_key_env ?? null,
			reasoning_effort: e.reasoning_effort ?? null,
			extra_headers: pf(e.extra_headers_json),
			orchestrator_compaction_threshold: e.orchestrator_compaction_threshold,
			light_model: e.light_model ?? null
		},
		light: e.light_model ?? null
	};
}
function gf({ projectId: e, firstChat: t = !1, onClose: n }) {
	return !cd(e !== null) || e === null ? null : /* @__PURE__ */ J(_f, {
		projectId: e,
		firstChat: t,
		onClose: n
	}, e);
}
function _f({ projectId: e, firstChat: t, onClose: n }) {
	let { api: r } = B(), i = fi(), a = $d(), o = ai(), c = en(), l = yn(), u = ot(), d = Xt(), f = In(), p = ct(), [m, h] = K(p.orchestrationEnabled ? "orchestrator" : "direct"), [g, _] = K(null), [v, y] = K({
		mode: "single",
		light: null
	}), [b, x] = K(""), S = u.data?.projects.find((t) => t.project_id === e) ?? null, C = yl(d.data ?? [], e), w = S?.default_model_config_id ? f.data?.configurations.find((e) => e.config_id === S.default_model_config_id) ?? null : null, T = Gt(S?.default_model_config_id ? null : C?.summary.session_id ?? null), E = W(() => w ? mf(w) : T.data && C ? hf(T.data, C.summary.backend) : null, [
		w,
		T.data,
		C
	]), D = u.isPending || d.isPending || f.isPending || !!C && !S?.default_model_config_id && T.isPending, O = u.error || d.error || T.error || S?.default_model_config_id && (f.error || !f.isPending && !w ? /* @__PURE__ */ Error("The project default is unavailable. Review the project settings before creating a chat.") : null), k = a.busy, ee = H((e) => {
		_(e), x((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), te = H((e) => {
		y(e), x((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), ne = g?.kind === "resolved" && g.light_model !== void 0 ? g.light_model : E?.light, ie = JSON.stringify(ne), ae = async () => {
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
				let s = await a.run((n) => Xd({
					current: n.current,
					classify: nf,
					reconcile: af(o),
					existing: t ? async () => {
						let [t, i] = await Promise.all([r.listProjects(n.signal), r.listSessions({ projectId: e }, n.signal)]);
						if (!t.projects.some((t) => t.project_id === e)) return _r.list();
						let a = vl(re(p, i), e);
						return a ? _r.session(a.summary.session_id) : null;
					} : void 0,
					persistsModel: g.kind === "save",
					model: async () => {
						let e;
						if (g.kind === "save") {
							let t = await l.mutateAsync({
								...g.request,
								light_model: p.orchestrationEnabled ? v.mode === "dual" ? v.light : null : ne ?? null
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
						let r = p.orchestrationEnabled ? v.mode === "dual" && v.light ? Vu(v.light, n.backend, n.api_key_env) : null : ne ?? null, i = {
							project_id: e,
							behavior: se(p, m),
							first_chat: t && it(p, d.data ?? [], e),
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
						let a = await c.mutateAsync(i);
						return a.metadata.session_id ? _r.session(a.metadata.session_id) : _r.project(e);
					}
				}));
				s && (n(), i(s, { replace: t }));
			} catch (e) {
				x(rf(e));
			}
		}
	};
	return /* @__PURE__ */ Y(ur, {
		open: !0,
		onClose: n,
		size: Wt.Wide,
		flush: !0,
		className: "h-[700px]",
		title: "New Chat",
		subheader: p.orchestrationEnabled ? "Choose this chat's behavior and models. These settings apply to this chat without changing the project default." : "Choose this chat's model. These settings apply to this chat without changing the project default.",
		footer: /* @__PURE__ */ J(s, {
			variant: I.Primary,
			loading: k,
			disabled: k || a.needsReview || D || !!O || !g,
			onClick: () => void ae(),
			children: "Create chat"
		}),
		children: [p.orchestrationEnabled ? /* @__PURE__ */ J(Ld, {
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
			children: [/* @__PURE__ */ J(Le, { size: A.Micro }), "Loading the project's model settings…"]
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
				/* @__PURE__ */ J(Gd, {
					initial: E?.initial,
					onChange: ee,
					invalid: !!b,
					errorText: b || void 0
				}),
				p.orchestrationEnabled ? /* @__PURE__ */ J(Dd, {
					initial: ne,
					behavior: m,
					onChange: te
				}, ie) : null
			]
		})]
	});
}
//#endregion
//#region src/app/components/modals/DeleteProjectModal.tsx
var vf = (e) => e === 1 ? "chat" : "chats";
function yf({ open: e, onClose: t, project: n }) {
	let r = _n(), i = fi(), a = di(), o = Hr(), c = g(), l = async (e) => {
		if (!(!n || o.isPending)) try {
			let s = await o.mutateAsync({
				projectId: n.project_id,
				sessions: e
			}), c = s?.deleted_session_ids ?? [], l = Kt(a.pathname);
			(a.pathname.startsWith(`/project/${encodeURIComponent(n.project_id)}`) || l && c.includes(l)) && i(_r.list(), { replace: !0 });
			let u = s?.released_session_ids?.length ?? 0, d = c.length;
			r.success(d > 0 ? `Project and ${d} ${vf(d)} removed` : u > 0 ? `Project removed; ${u} ${vf(u)} kept` : "Project removed"), t();
		} catch (e) {
			r.error(`Failed to delete: ${nr($(e))}`);
		}
	};
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: t,
		title: "Remove Project?",
		size: Wt.Medium,
		footer: /* @__PURE__ */ Y(q, { children: [
			!c && /* @__PURE__ */ J(s, {
				variant: I.Tertiary,
				content: R.Text,
				onClick: t,
				disabled: o.isPending,
				children: "Cancel"
			}),
			/* @__PURE__ */ J(s, {
				variant: I.Secondary,
				content: R.Text,
				onClick: () => void l("keep"),
				disabled: o.isPending,
				children: "Keep Sessions"
			}),
			/* @__PURE__ */ J(s, {
				variant: I.SecondaryDestructive,
				content: R.Text,
				onClick: () => void l("delete"),
				loading: o.isPending,
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
function bf({ open: e, onClose: t, project: n }) {
	return !cd(e) || !n ? null : /* @__PURE__ */ J(xf, {
		open: e,
		project: n,
		onClose: t
	}, n.project_id);
}
function xf({ open: e, project: t, onClose: n }) {
	let r = _n(), i = nt(), [a, o] = K(t.name), [c, l] = K(t.description ?? ""), u = async () => {
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
			let t = e instanceof O && e.status === 409;
			r.error(t ? "Version conflict — the project changed in the meantime" : `Error: ${nr($(e))}`);
		}
	};
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: n,
		title: "Rename project",
		size: Wt.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(s, {
			variant: I.Tertiary,
			content: R.Text,
			onClick: n,
			disabled: i.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(s, {
			variant: I.Primary,
			content: R.Text,
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
				onChange: (e) => o(e.target.value),
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
var Sf = /* @__PURE__ */ new Set([
	"INPUT",
	"TEXTAREA",
	"SELECT"
]);
function Cf(e) {
	return e instanceof HTMLElement ? Sf.has(e.tagName) || e.isContentEditable : !1;
}
function wf(e) {
	let { getStackLength: t } = Me(), n = T(), r = G(e);
	U(() => {
		r.current = e;
	}), U(() => {
		let e = (e) => {
			if (!(e.repeat || !n(e.target))) {
				for (let n of r.current) if (n.enabled !== !1 && Fr(e, n.keys)) {
					if (t() > 0 || !zt(n.keys) && Cf(e.target)) return;
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
var Tf = qr(null);
function Ef({ children: e }) {
	let { pruneSessionNavigation: t } = B().stores.sessionNavigationStore, { pruneChatTabs: n } = B().stores.chatTabsStore, r = _n(), { pathname: i } = di(), a = fi(), o = Xt(), s = ct(), c = o.isSuccess, l = W(() => re(s, o.data ?? []), [o.data, s]), { data: u } = ot(), d = ae(), f = be(), [p, m] = K(null), [h, g] = K(null), [_, v] = K(null), [y, b] = K(null), [x, S] = K(!1), C = d.toggle, w = f.mutateAsync, T = H(async (e, t) => {
		try {
			await w({
				projectId: e.project_id,
				sessionId: t.session_id
			}), r.success(`Assigned to ${e.name}`);
		} catch (e) {
			r.error(`Failed to assign the chat: ${iu($(e))}`);
		}
	}, [w, r]), E = H(async (e, t = !1) => {
		S(t), b(e);
	}, []), D = W(() => ({
		create: () => m("create"),
		assign: (e) => {
			let t = Dl(u?.projects ?? [], e);
			if (t) {
				T(t, e);
				return;
			}
			v(e), m("assign");
		},
		rename: (e) => {
			g(e), m("rename");
		},
		remove: (e) => {
			g(e), m("delete");
		},
		togglePin: async (e) => {
			try {
				await C(e);
			} catch (e) {
				r.error(`Failed to update pin: ${nr($(e))}`);
			}
		},
		newChat: E
	}), [
		C,
		E,
		r,
		T,
		u
	]);
	U(() => {
		let e = o.data;
		!c || !e || !u || (n(e.map((e) => e.summary.session_id), u.projects.map((e) => e.project_id)), t(hl(e).map((e) => e.summary.session_id)));
	}, [
		c,
		o.data,
		u,
		n,
		t
	]);
	let O = Kt(i), k = kn(i) ?? o.data?.find((e) => e.summary.session_id === O)?.summary.project_id ?? null;
	wf([{
		keys: Tr,
		enabled: k != null,
		onTrigger: () => {
			k && E(k);
		}
	}, {
		keys: Br,
		enabled: k == null,
		onTrigger: () => m("create")
	}]);
	let A = () => m(null);
	return /* @__PURE__ */ Y(Tf.Provider, {
		value: D,
		children: [
			e,
			/* @__PURE__ */ J(df, {
				open: p === "create",
				onClose: A
			}),
			/* @__PURE__ */ J(gf, {
				projectId: y,
				firstChat: x,
				onClose: () => {
					let e = y;
					b(null), S(!1), e && kn(i) === e && !hl(l).some((t) => t.summary.project_id === e) && a(_r.list(), { replace: !0 });
				}
			}),
			/* @__PURE__ */ J(cu, {
				open: p === "assign",
				onClose: A,
				summary: _
			}),
			/* @__PURE__ */ J(bf, {
				open: p === "rename",
				onClose: A,
				project: h
			}),
			/* @__PURE__ */ J(yf, {
				open: p === "delete",
				onClose: A,
				project: h
			})
		]
	});
}
function Df() {
	let e = Xr(Tf);
	if (!e) throw Error("useProjectActions must be used within ProjectActionsProvider");
	return e;
}
//#endregion
//#region src/app/components/modals/DeleteModal.tsx
function Of(e, t) {
	let n = e.project_id?.trim();
	if (!n) return _r.list();
	let r = t.filter((t) => t.summary.project_id === n && t.summary.session_id !== e.session_id);
	r.sort((e, t) => Rr(t.summary.updated_at) - Rr(e.summary.updated_at));
	let i = r[0];
	return i ? _r.session(i.summary.session_id) : _r.project(n);
}
function kf({ open: e, onClose: t, summary: n }) {
	let r = _n(), i = ml(), a = fi(), o = di(), c = gr(), { data: l = [] } = Xt();
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: t,
		title: "Delete session",
		size: Wt.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(s, {
			variant: I.Tertiary,
			content: R.Text,
			onClick: t,
			disabled: c.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(s, {
			variant: I.SecondaryDestructive,
			content: R.Text,
			onClick: async () => {
				if (!n || c.isPending) return;
				let e = n.session_id, i = o.pathname, s = Kt(i) === e ? Of(n, l) : null;
				try {
					s && mi(() => {
						a(s, { replace: !0 });
					}), await c.mutateAsync(e), r.success("Session deleted"), t();
				} catch (e) {
					s && a(i, { replace: !0 }), r.error(`Failed to delete: ${nr($(e))}`);
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
					m(n?.session_id),
					")"
				]
			}),
			"? This action cannot be undone."
		] })
	});
}
//#endregion
//#region src/app/components/modals/RenameModal.tsx
function Af({ open: e, onClose: t, summary: n }) {
	return !cd(e) || !n ? null : /* @__PURE__ */ J(jf, {
		open: e,
		summary: n,
		onClose: t
	}, n.session_id);
}
function jf({ open: e, summary: t, onClose: n }) {
	let r = _n(), i = ml(), a = Vr(), [o, c] = K(t.title ?? ""), [l, u] = K(!!t.pinned), d = !!t.project_id, f = async () => {
		if (!a.isPending) try {
			await a.mutateAsync({
				id: t.session_id,
				title: o.trim(),
				pinned: d ? l : !1,
				expectedVersion: t.presentation_version ?? 0
			}), r.success("Session presentation saved"), n();
		} catch (e) {
			let t = e instanceof O && e.status === 409;
			r.error(t ? "Version conflict — the session changed in the meantime" : `Error: ${nr($(e))}`);
		}
	};
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: n,
		title: "Rename session",
		size: Wt.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(s, {
			variant: I.Tertiary,
			content: R.Text,
			onClick: n,
			disabled: a.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(s, {
			variant: I.Primary,
			content: R.Text,
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
				value: o,
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
function Mf({ state: e, onReconnect: t, className: n }) {
	let r = e !== "connected";
	return /* @__PURE__ */ Y("div", {
		className: V("flex items-center h-4 shrink-0", r ? "gap-1" : null, n),
		children: [
			r ? /* @__PURE__ */ J(M, {
				iconName: L.Danger,
				size: 16,
				className: "text-error-primary"
			}) : null,
			/* @__PURE__ */ J("span", {
				className: V("tag-label uppercase", r ? "text-error-primary" : "text-info-primary"),
				children: "SSH"
			}),
			e === "reconnect" && t ? /* @__PURE__ */ J(Zn, {
				title: "Reconnect SSH",
				position: z.TopCenter,
				children: /* @__PURE__ */ J(s, {
					size: F.Small,
					variant: I.Ghost,
					content: R.Icon,
					"aria-label": "Reconnect SSH",
					onClick: (e) => {
						e.stopPropagation(), t();
					},
					children: /* @__PURE__ */ J(M, {
						iconName: L.Refresh,
						size: 16
					})
				})
			}) : null
		]
	});
}
//#endregion
//#region src/app/components/modals/SettingsModal.tsx
function Nf(e) {
	return Object.keys(e).length === 0 ? "" : JSON.stringify(e, null, 2);
}
function Pf(e) {
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
function Ff(e) {
	let t = Pf(e.extra_headers_json);
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
function If({ open: e, onClose: t, footer: n, titleExtra: r, children: i }) {
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: t,
		title: r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-4",
			children: [/* @__PURE__ */ J("span", {
				className: "flex-1 min-w-0",
				children: "Session settings"
			}), r]
		}) : "Session settings",
		size: Wt.Wide,
		flush: !0,
		className: "h-[700px]",
		footer: n,
		children: i
	});
}
function Lf({ open: e, id: t, onClose: n }) {
	let r = cd(e), { data: i, isLoading: a } = xr(r ? t : null), { data: o, isLoading: s } = Gt(r ? t : null);
	if (!r || !t) return null;
	let c = o ? Ff(o) : null;
	return !c || !i || s ? /* @__PURE__ */ J(If, {
		open: e,
		onClose: n,
		children: /* @__PURE__ */ J("p", {
			className: "text-basic-muted text-micro",
			children: s || a ? "Loading session configuration…" : "Session configuration unavailable."
		})
	}) : /* @__PURE__ */ J(Rf, {
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
function Rf({ open: e, id: t, initial: n, initialLight: r, initialVersion: i, summary: a, diagnostics: o, onClose: c }) {
	let { useSshConnectionStatus: l, sshTargetFromSummary: u } = B().stores.sshConnectionStore, { api: d } = B(), f = g(), p = _n(), m = ai(), h = $d(e), _ = ml(), v = Er(), y = nt(), [b, x] = K(!1), S = sn(), C = S.data ?? null, w = yn(), T = ct(), [E] = K(a), [O] = K(i), k = Vr(), A = E.title ?? "", [ee, te] = K(A), [ne, re] = K(n.model), [ie, ae] = K(n.backend), [oe, se] = K(n.reasoning_effort ?? ""), [, ce] = K(n.base_url), [le, ue] = K(Nf(n.extra_headers)), [de, fe] = K(n.orchestrator_compaction_threshold == null ? "" : String(n.orchestrator_compaction_threshold)), pe = G(n.orchestrator_compaction_threshold == null ? "" : String(n.orchestrator_compaction_threshold)), me = G(!1), j = G(!1), [he, ge] = K(""), [_e, ve] = K(null), [ye, be] = K({
		mode: r ? "dual" : "single",
		light: r
	}), [xe, N] = K(r), [Se, P] = K(!1), [Ce, we] = K(!1), Te = o.some((e) => e.startsWith("malformed stored light model")), Ee = G(null), De = H((e, t) => {
		if (ve(e), !e || Vd(Ee.current, e)) return;
		let n = Ee.current;
		Ee.current = e;
		let r = e.kind === "resolved" ? e : e.request;
		if (ae(r.backend), re(r.model), ce(r.base_url ?? Ku(r.backend) ?? ""), e.kind === "resolved") {
			se(e.reasoning_effort ?? "");
			let r = t === "primary" && n?.kind === "resolved";
			if (r && n.backend === e.backend && n.base_url === e.base_url && n.api_key_env === e.api_key_env && n.allow_insecure_http === e.allow_insecure_http || ue(Nf(e.extra_headers ?? {})), r) return;
			if (e.orchestrator_compaction_threshold !== void 0) {
				let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
				j.current = !0, me.current = !1, pe.current = n, fe(n);
			} else {
				let e = j.current;
				j.current = !1, e && (me.current = !0, pe.current = "", fe(""));
			}
			e.light_model !== void 0 && (N(e.light_model), be({
				mode: e.light_model ? "dual" : "single",
				light: e.light_model
			}));
		}
	}, []), Oe = Xn(), ke = od(bu(Oe.data, ie, ne).supportedEfforts, oe), Ae = W(() => {
		let e = bu(Oe.data, ie, ne).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		Oe.data,
		ie,
		ne
	]);
	U(() => {
		!j.current && Ae !== "auto" && me.current && (me.current = !0, pe.current = Ae, fe(Ae));
	}, [Ae, _e]);
	let je = !_e || h.needsReview || h.busy, Me = h.busy || S.isPending || v.isPending || k.isPending || w.isPending, Ne = u(E), Pe = l(Ne), [Fe, Ie] = K(void 0), Le = Fe === void 0 ? Pe === "connected" ? Ne : null : Fe, Re = (e) => {
		Ie(e);
	}, ze = () => k.mutateAsync({
		id: t,
		title: ee.trim(),
		pinned: !!E.pinned,
		expectedVersion: E.presentation_version ?? 0
	}), Be = (e) => {
		let t;
		try {
			let r = !!(C?.model_ready && D(C, {
				backend: e.backend,
				model: e.model,
				baseUrl: e.base_url
			}));
			t = td({
				model: e.model,
				backend: e.backend,
				base_url: e.base_url,
				allow_insecure_http: e.allow_insecure_http,
				reasoning_effort: oe,
				credential_mode: e.api_key_env ? "variable" : "none",
				api_key_env: e.api_key_env ?? "",
				extra_headers: le,
				orchestrator_compaction_threshold: de
			}, n, r);
		} catch (e) {
			throw new ef(e instanceof Error ? e.message : String(e));
		}
		if (T.orchestrationEnabled) if (ye.mode === "dual") {
			if (!ye.light) throw new ef("Pick the light model before saving.");
			let i = Vu(ye.light, e.backend, e.api_key_env, n.api_key_env);
			(Te || !Uu(i, r)) && (t.light_model = i);
		} else (r || Te) && (t.light_model = null);
		else Ce ? t.light_model = null : Uu(ye.light, r) || (t.light_model = ye.light);
		return t;
	}, Ve = async () => {
		if (Me || h.needsReview || !_e) return;
		if (b && _e.kind === "resolved" && !_e.config_id) {
			ge("Choose a saved preset in Advanced before updating the project default.");
			return;
		}
		if (T.orchestrationEnabled && ye.mode === "dual" && !ye.light) {
			ge("Pick the light model before saving.");
			return;
		}
		let e = !1;
		try {
			let t = _e.kind === "save" ? _e.request : _e, n = Be({
				...t,
				base_url: t.base_url ?? Ku(t.backend) ?? "",
				allow_insecure_http: t.allow_insecure_http ?? !1,
				api_key_env: _e.kind === "resolved" ? _e.api_key_env : _e.request.api_key ? "PENDING_SAVED_CREDENTIAL" : null
			});
			e = _e.kind === "save" || Object.keys(n).length > 0;
		} catch (e) {
			ge(rf(e));
			return;
		}
		try {
			if (!await h.run((n) => Zd({
				current: n.current,
				classify: nf,
				reconcile: af(m, t),
				check: async () => {
					let e = await d.getConfig(t, n.signal);
					if (O !== void 0 && e.config_version !== O) throw new tf();
				},
				persistsModel: _e.kind === "save",
				model: async () => {
					if (_e.kind === "save") {
						let e = Rd(await w.mutateAsync({
							..._e.request,
							light_model: ye.mode === "dual" ? ye.light : null
						}));
						return n.current() && ve(e), e;
					}
					return _e;
				},
				configurationSaved: e,
				configuration: async (e) => {
					let n = Be(e);
					Object.keys(n).length > 0 && await v.mutateAsync({
						id: t,
						patch: n
					});
				},
				title: ee.trim() === A.trim() ? void 0 : ze,
				projectDefault: b && E.project_id ? (e) => {
					if (!e.config_id) throw new ef("Choose a saved preset before updating the project default.");
					return y.mutateAsync({
						projectId: E.project_id,
						payload: { default_model_config_id: e.config_id }
					});
				} : void 0
			}))) return;
			p.success("Session settings saved"), c();
		} catch (e) {
			ge(rf(e));
		}
	}, He = /* @__PURE__ */ Y(q, { children: [f ? /* @__PURE__ */ J(wi, {
		variant: I.Tertiary,
		content: R.Text,
		onClick: c,
		disabled: Me,
		children: "Cancel"
	}) : /* @__PURE__ */ J(s, {
		variant: I.Tertiary,
		size: F.Large,
		content: R.Text,
		onClick: c,
		disabled: Me,
		children: "Cancel"
	}), f ? /* @__PURE__ */ J(wi, {
		variant: I.Primary,
		"aria-label": "Save",
		content: R.Text,
		onClick: Ve,
		disabled: je,
		loading: Me,
		children: "Save"
	}) : /* @__PURE__ */ J(s, {
		variant: I.Primary,
		"aria-label": "Save",
		size: F.Large,
		content: R.Text,
		onClick: Ve,
		disabled: je,
		loading: Me,
		children: "Save"
	})] });
	return /* @__PURE__ */ J(If, {
		open: e,
		onClose: c,
		footer: He,
		titleExtra: Ne ? /* @__PURE__ */ J(Mf, { state: Pe === "connected" ? "connected" : "disconnected" }) : null,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-6 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ J("p", {
					className: "text-micro text-basic-muted",
					children: "Changes apply to this inactive primary chat. Project defaults and existing children keep their settings."
				}),
				o.length > 0 ? /* @__PURE__ */ Y("div", {
					className: "rounded-[4px] border border-error-muted bg-error-tertiary p-3 text-micro text-error-primary",
					children: [/* @__PURE__ */ J("div", {
						className: "label-small mb-1",
						children: "Repair required"
					}), o.map((e) => /* @__PURE__ */ Y("div", { children: ["• ", e] }, e))]
				}) : null,
				Ne ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Id, {
					mode: "settings",
					connection: Le,
					seedTarget: Ne,
					onConnectionChange: Re
				}), /* @__PURE__ */ J(Q, {})] }) : null,
				/* @__PURE__ */ J(Z, {
					label: "Session title",
					"aria-label": "Session title",
					inputSize: f ? X.Large : X.Medium,
					placeholder: _(E) || "Session name",
					hintText: "Leave empty to restore the automatic title (the last prompt).",
					value: ee,
					onChange: (e) => te(e.target.value)
				}),
				/* @__PURE__ */ J(Gd, {
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
							T.orchestrationEnabled ? /* @__PURE__ */ J(Dd, {
								initial: ye.light,
								behavior: E.behavior ?? "orchestrator",
								onChange: be
							}, JSON.stringify(xe)) : null,
							E.project_id ? /* @__PURE__ */ Y("label", {
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
								"aria-expanded": Se,
								onClick: () => P((e) => !e),
								children: [
									/* @__PURE__ */ J(M, {
										iconName: L.Gear,
										size: 20
									}),
									/* @__PURE__ */ J("span", {
										className: "label-small flex-1 text-left",
										children: "Advanced Configurations"
									}),
									/* @__PURE__ */ J(M, {
										iconName: Se ? L.Down : L.Right,
										size: 20
									})
								]
							}),
							Se ? /* @__PURE__ */ Y(q, { children: [
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
								/* @__PURE__ */ J(du, {
									label: "Reasoning Effort",
									hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
									control: /* @__PURE__ */ J(dd, {
										items: ke,
										value: oe,
										onValueChange: se
									})
								}),
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(du, {
									label: "Context Limit",
									hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
									control: /* @__PURE__ */ Y("div", {
										className: "flex items-center gap-2",
										children: [/* @__PURE__ */ J(Z, {
											inputSize: f ? X.Large : X.Medium,
											className: lu,
											inputClassName: "md:text-right",
											"aria-label": "Context limit",
											placeholder: Ae,
											inputMode: "numeric",
											value: de,
											onChange: (e) => {
												j.current = !1, me.current = !1, pe.current = e.target.value, fe(e.target.value);
											}
										}), /* @__PURE__ */ J("span", {
											className: "shrink-0 text-micro text-basic-muted",
											children: "tokens"
										})]
									})
								}),
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(oc, {
									label: "Extra headers (JSON object)",
									textAreaSize: f ? ac.Large : ac.Medium,
									hintText: "Blank sends none; header values must be strings.",
									placeholder: "{ \"X-Title\": \"NAC\" }",
									value: le,
									onChange: (e) => ue(e.target.value),
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
var zf = qr(null);
function Bf({ children: e }) {
	let { pushLocalEvent: t, captureRuntimeActivation: n } = B().stores.runtimeStore, r = _n(), i = At(), a = ze(), [o, s] = K(null), [c, l] = K(null), [u, d] = K(null), f = H((e) => (t) => {
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
				r.error(`Failed to update pin: ${nr($(e))}`);
			}
		},
		stopRun: async (e) => {
			let i = n(e);
			try {
				await a.mutateAsync(e), i() && t("run", "■ run cancellation requested"), r.success("Run cancellation requested");
			} catch (e) {
				r.error(`Failed to stop run: ${nr($(e))}`);
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
	return /* @__PURE__ */ Y(zf.Provider, {
		value: m,
		children: [
			e,
			/* @__PURE__ */ J(Af, {
				open: o === "rename",
				onClose: h,
				summary: c
			}),
			/* @__PURE__ */ J(kf, {
				open: o === "delete",
				onClose: h,
				summary: c
			}),
			/* @__PURE__ */ J(Lf, {
				open: o === "settings",
				id: u,
				onClose: h
			})
		]
	});
}
function Vf() {
	let e = Xr(zf);
	if (!e) throw Error("useSessionActions must be used within SessionActionsProvider");
	return e;
}
//#endregion
//#region src/app/components/modals/MobileProjectSessionModal.tsx
function Hf(e, t, n) {
	return e.kind === "project" ? `${e.entry.project.name} ${e.entry.project.cwd}`.toLowerCase().includes(t) : `${n(e.session.summary)} ${e.session.summary.cwd}`.toLowerCase().includes(t);
}
function Uf({ open: e, onClose: t, projectId: n, sessions: r, activeSessionId: i, summary: a }) {
	let o = fi(), s = Df(), c = Vf(), l = ml(), { data: u } = ot(), { data: d = [] } = Bt(), f = a != null && !n, p = wl(u?.projects ?? [], n), [m, h] = K(n || a ? "chats" : "projects"), [g, _] = K(""), v = G(e);
	U(() => {
		e && !v.current && (h(n || a ? "chats" : "projects"), _("")), v.current = e;
	}, [
		e,
		n,
		a
	]);
	let y = a ? l(a) : p?.name ?? "Projects", b = a ? p?.name ?? "Not assigned" : null, x = n ? r : xl(d), S = W(() => {
		let e = g.trim().toLowerCase();
		return e ? x.filter((t) => l(t.summary).toLowerCase().includes(e)) : x;
	}, [
		x,
		g,
		l
	]), C = W(() => Cl(u?.projects ?? [], d), [u, d]), w = W(() => {
		let e = g.trim().toLowerCase();
		return e ? C.filter((t) => Hf(t, e, l)) : C;
	}, [
		C,
		g,
		l
	]), T = (e) => {
		h(e), _("");
	}, E = (e) => {
		t(), e();
	};
	return /* @__PURE__ */ Y(ur, {
		open: e,
		onClose: t,
		title: /* @__PURE__ */ Y("div", {
			className: "flex flex-col min-w-0 justify-center",
			children: [/* @__PURE__ */ J("span", {
				className: "truncate",
				children: y
			}), b ? /* @__PURE__ */ J("span", {
				className: V("text-micro font-normal truncate", f ? "text-danger-primary" : "text-basic-muted"),
				children: b
			}) : null]
		}),
		bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
		children: [
			m === "assign" ? null : /* @__PURE__ */ Y("div", {
				className: "absolute inset-x-0 top-0 z-10 flex items-start gap-3 px-2 py-4",
				children: [
					/* @__PURE__ */ J(ic, {
						className: "flex-1 min-w-0",
						variant: rc.Search,
						placeholder: m === "chats" ? "Search Sessions..." : "Search projects...",
						value: g,
						onChange: (e) => _(e.target.value),
						onClear: () => _(""),
						"aria-label": m === "chats" ? "Search Sessions" : "Search projects"
					}),
					m === "chats" && n ? /* @__PURE__ */ J(wi, {
						variant: I.Secondary,
						content: R.Icon,
						"aria-label": "New Session",
						onClick: () => E(() => void s.newChat(n)),
						children: /* @__PURE__ */ J(M, { iconName: L.Add })
					}) : null,
					m === "projects" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(wi, {
						variant: I.Secondary,
						content: R.Icon,
						"aria-label": "New project",
						onClick: () => E(s.create),
						children: /* @__PURE__ */ J(M, { iconName: L.Add })
					}), /* @__PURE__ */ J(wi, {
						variant: I.Secondary,
						content: R.Icon,
						"aria-label": "All projects",
						onClick: () => E(() => o(_r.list())),
						children: /* @__PURE__ */ J(M, { iconName: L.Grid })
					})] }) : null
				]
			}),
			/* @__PURE__ */ J("div", {
				className: V("flex-1 min-h-0 overflow-auto [&>*]:shrink-0", m === "assign" ? "px-4 py-4" : "px-2 pt-[72px] pb-[96px]"),
				children: m === "assign" && a ? /* @__PURE__ */ J(Kf, {
					summary: a,
					onAssigned: t
				}) : m === "chats" ? /* @__PURE__ */ J(Hl, {
					sessions: S,
					activeSessionId: i,
					isMobile: !0,
					emptyLabel: g.trim() ? "No matching chats" : "No chats yet",
					onOpen: (e) => E(() => o(_r.session(e.summary.session_id))),
					onPin: (e) => void c.togglePin(e.summary),
					onRename: (e) => E(() => c.rename(e.summary)),
					onDelete: (e) => E(() => c.remove(e.summary))
				}) : /* @__PURE__ */ J(Wl, {
					items: w,
					activeId: n ?? i,
					isMobile: !0,
					emptyLabel: g.trim() ? "No matching projects" : "No projects yet",
					onOpenProject: (e) => E(() => o(_r.project(e))),
					onOpenSession: (e) => E(() => o(_r.session(e))),
					renderActions: (e) => {
						if (e.kind === "project") {
							let { project: t } = e.entry;
							return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Gf, {
								label: `Rename ${t.name}`,
								icon: L.Edit,
								onClick: () => E(() => s.rename(t))
							}), /* @__PURE__ */ J(Gf, {
								label: `Delete ${t.name}`,
								icon: L.Trash,
								variant: I.GhostDestructive,
								onClick: () => E(() => s.remove(t))
							})] });
						}
						let { summary: t } = e.session, n = l(t);
						return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Gf, {
							label: `Rename ${n}`,
							icon: L.Edit,
							onClick: () => E(() => c.rename(t))
						}), /* @__PURE__ */ J(Gf, {
							label: `Delete ${n}`,
							icon: L.Trash,
							variant: I.GhostDestructive,
							onClick: () => E(() => c.remove(t))
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
						f ? /* @__PURE__ */ J(Wf, {
							active: m === "assign",
							icon: L.FolderOpen,
							label: "Assign",
							onClick: () => T("assign")
						}) : null,
						/* @__PURE__ */ J(Wf, {
							active: m === "chats",
							icon: L.Chat,
							label: "Sessions",
							onClick: () => T("chats")
						}),
						/* @__PURE__ */ J(Wf, {
							active: m === "projects",
							icon: L.Folder,
							label: "Projects",
							onClick: () => T("projects")
						})
					]
				})
			})
		]
	});
}
function Wf({ active: e, icon: t, label: n, onClick: r }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		role: "tab",
		"aria-selected": e,
		className: V("flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]", e ? "btn-primary" : "btn-ghost"),
		onClick: r,
		children: [/* @__PURE__ */ J(M, {
			iconName: t,
			size: 28
		}), /* @__PURE__ */ J("span", {
			className: V("label-micro font-bold truncate max-w-full", e ? null : "text-basic-primary"),
			children: n
		})]
	});
}
function Gf({ label: e, icon: t, onClick: n, variant: r = I.Ghost }) {
	return /* @__PURE__ */ J(s, {
		variant: r,
		size: F.Small,
		content: R.Icon,
		title: e,
		"aria-label": e,
		onClick: n,
		children: /* @__PURE__ */ J(M, { iconName: t })
	});
}
function Kf({ summary: e, onAssigned: t }) {
	let n = _n(), { data: r } = ot(), i = be(), a = Ue(), [o, c] = K(""), [l, u] = K(null), d = W(() => Dl(r?.projects ?? [], e), [r, e]), f = i.isPending || a.isPending, p = async () => {
		if (!f) {
			u(null);
			try {
				let r = d ?? await a.mutateAsync({
					name: o.trim() || null,
					...El(e)
				});
				await i.mutateAsync({
					projectId: r.project_id,
					sessionId: e.session_id
				}), n.success(`Assigned to ${r.name}`), t();
			} catch (e) {
				u(iu($(e)));
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
				children: [/* @__PURE__ */ J(Hc, {
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
				value: o,
				onChange: (e) => {
					u(null), c(e.target.value);
				}
			}),
			l ? /* @__PURE__ */ J("p", {
				className: "text-error-primary text-micro",
				children: l
			}) : null,
			/* @__PURE__ */ J(s, {
				variant: I.Primary,
				size: F.Large,
				content: R.Text,
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
function qf({ tooltip: e, label: t, icon: n, onClick: r, variant: i = I.Ghost }) {
	return /* @__PURE__ */ J(s, {
		variant: i,
		size: F.Small,
		content: R.Icon,
		title: e,
		"aria-label": t,
		onClick: r,
		children: /* @__PURE__ */ J(M, { iconName: n })
	});
}
function Jf(e, t, n) {
	return (e.kind === "project" ? `${e.entry.project.name} ${e.entry.project.cwd}` : `${n(e.session.summary)} ${e.session.summary.cwd}`).toLowerCase().includes(t);
}
function Yf({ activeId: e, onClose: t }) {
	let n = fi(), r = Df(), i = Vf(), a = ml(), o = g(), [s, c] = K(""), { data: l } = ot(), { data: u = [] } = Bt(), d = W(() => Cl(l?.projects ?? [], u), [l, u]), f = W(() => {
		let e = s.trim().toLowerCase();
		return e ? d.filter((t) => Jf(t, e, a)) : d;
	}, [
		d,
		s,
		a
	]);
	return /* @__PURE__ */ Y("div", {
		className: V("flex flex-col", o ? "h-[calc(70dvh)]" : "max-h-[520px]"),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 shrink-0",
			children: [/* @__PURE__ */ J(Z, {
				inputSize: o ? X.Large : X.Medium,
				leading: qs.Icon,
				leadingIconName: L.Search,
				placeholder: "Search Projects",
				"aria-label": "Search projects",
				value: s,
				onChange: (e) => c(e.target.value)
			}), /* @__PURE__ */ J(Q, {})]
		}), /* @__PURE__ */ J("div", {
			className: "flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
			children: /* @__PURE__ */ J(Wl, {
				items: f,
				activeId: e,
				isMobile: o,
				emptyLabel: s.trim() ? "No matching projects" : "No projects yet",
				onOpenProject: (e) => {
					t(), n(_r.project(e));
				},
				onOpenSession: (e) => {
					t(), n(_r.session(e));
				},
				renderActions: (e) => {
					if (e.kind === "project") {
						let { project: n } = e.entry;
						return /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ J(qf, {
								tooltip: n.pinned ? "Unpin project" : "Pin project",
								label: `${n.pinned ? "Unpin" : "Pin"} ${n.name}`,
								icon: n.pinned ? L.Unpin : L.Pin,
								onClick: () => void r.togglePin(n)
							}),
							/* @__PURE__ */ J(qf, {
								tooltip: "Rename project",
								label: `Rename ${n.name}`,
								icon: L.Edit,
								onClick: () => {
									t(), r.rename(n);
								}
							}),
							/* @__PURE__ */ J(qf, {
								tooltip: "Remove project",
								label: `Remove ${n.name}`,
								icon: L.Trash,
								variant: I.GhostDestructive,
								onClick: () => {
									t(), r.remove(n);
								}
							})
						] });
					}
					let { summary: n } = e.session, o = a(n);
					return /* @__PURE__ */ Y(q, { children: [
						/* @__PURE__ */ J(qf, {
							tooltip: "Rename chat",
							label: `Rename ${o}`,
							icon: L.Edit,
							onClick: () => {
								t(), i.rename(n);
							}
						}),
						/* @__PURE__ */ J(qf, {
							tooltip: "Delete chat",
							label: `Delete ${o}`,
							icon: L.Trash,
							variant: I.GhostDestructive,
							onClick: () => {
								t(), i.remove(n);
							}
						}),
						/* @__PURE__ */ J(qf, {
							tooltip: "Assign to a project",
							label: `Assign ${o} to a project`,
							icon: L.Folders,
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
function Xf() {
	let { pathname: e } = di(), t = Kt(e), n = kn(e), r = fi(), i = Df(), a = g(), o = ml(), { data: c } = ot(), { data: l = [] } = Bt(), [u, d] = K(!1), f = t ? l.find((e) => e.summary.session_id === t) : void 0, p = n ?? f?.summary.project_id ?? null, m = wl(c?.projects ?? [], p), h = p ? hl(l).filter((e) => e.summary.project_id === p).sort((e, t) => Rr(t.summary.updated_at) - Rr(e.summary.updated_at)) : [], _ = !!(p || t), v = m?.name ?? o(f?.summary) ?? t ?? "", y = f ? o(f.summary) : null, b = m?.project_id ?? t ?? "", x = p ? h.some((e) => Dt(e.active_run)) : Dt(f?.active_run), S = !a || !_;
	return /* @__PURE__ */ Y("nav", {
		className: V("flex items-center min-w-0 gap-1", a && _ && "flex-1"),
		"aria-label": "Breadcrumb",
		children: [S ? a ? /* @__PURE__ */ J("button", {
			type: "button",
			className: "label-medium text-btn-secondary rounded-[8px] truncate",
			onClick: () => r(_r.list()),
			"aria-current": _ ? void 0 : "page",
			children: "All Projects"
		}) : /* @__PURE__ */ J(s, {
			variant: I.Ghost,
			size: F.Medium,
			content: R.Text,
			onClick: () => r(_r.list()),
			"aria-current": _ ? void 0 : "page",
			children: "All Projects"
		}) : null, _ ? /* @__PURE__ */ Y(q, { children: [
			S ? /* @__PURE__ */ J(M, {
				iconName: L.Right,
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
						className: V("label-medium truncate !leading-[20px]", x ? "text-shimmer-basic" : "text-basic-primary"),
						children: y ?? v
					}), y ? /* @__PURE__ */ J("span", {
						className: V("text-micro truncate", m ? "text-basic-muted" : "text-danger-primary"),
						children: m?.name ?? "Not assigned"
					}) : null]
				}), /* @__PURE__ */ J(M, {
					iconName: L.Right,
					size: 24,
					className: "shrink-0"
				})]
			}), /* @__PURE__ */ J(Uf, {
				open: u,
				onClose: () => d(!1),
				projectId: p,
				sessions: h,
				activeSessionId: t,
				summary: f?.summary ?? null
			})] }) : /* @__PURE__ */ J(Ln, {
				open: u,
				onClose: () => d(!1),
				placement: z.BottomRight,
				size: hn.Medium,
				className: "min-w-0",
				content: /* @__PURE__ */ J(Yf, {
					activeId: p ?? t,
					onClose: () => d(!1)
				}),
				children: /* @__PURE__ */ Y(s, {
					variant: I.Ghost,
					size: F.Medium,
					content: R.Text,
					className: "!px-2 max-w-[320px]",
					onClick: () => d((e) => !e),
					"aria-expanded": u,
					"aria-label": "Switch project",
					children: [
						m ? /* @__PURE__ */ J(Hc, {
							id: b,
							size: 24,
							isRunning: x,
							className: "rounded-[2px]"
						}) : /* @__PURE__ */ J(Ii, {
							size: 24,
							isRunning: x
						}),
						/* @__PURE__ */ J("span", {
							className: V("truncate max-w-[120px]", x && "text-shimmer-basic"),
							children: v
						}),
						/* @__PURE__ */ J(M, {
							iconName: L.Down,
							className: V("transition-transform", u ? "rotate-180" : void 0)
						})
					]
				})
			}),
			a ? null : /* @__PURE__ */ J(Zn, {
				title: "New project",
				keyboardShortcuts: m ? void 0 : Br,
				position: Zn.Position.BottomCenter,
				children: /* @__PURE__ */ J(s, {
					variant: I.Ghost,
					size: F.Small,
					content: R.Icon,
					"aria-label": "New project",
					onClick: i.create,
					children: /* @__PURE__ */ J(M, { iconName: L.AddCircle })
				})
			})
		] }) : null]
	});
}
//#endregion
//#region src/app/components/HeaderMenu.tsx
var Zf = "https://github.com/arcee-ai/nac", Qf = "https://github.com/arcee-ai/nac#readme";
function $f({ onConfigurations: e, onSshConfigs: t, onManagedHost: n }) {
	let [r, i] = K(!1), a = g(), { data: o } = Qt(), c = o?.store_path ?? "store path pending", l = a ? Yc.Large : Yc.Medium, u = (e) => () => {
		i(!1), e();
	}, d = (e) => u(() => window.open(e, "_blank", "noopener"));
	return /* @__PURE__ */ J(Ln, {
		open: r,
		onClose: () => i(!1),
		placement: z.BottomLeft,
		size: "w-[280px]",
		panelClassName: "p-1",
		sheetClassName: "px-2",
		content: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2",
			children: [
				/* @__PURE__ */ Y("div", {
					className: V("flex items-center", a ? "h-16 gap-2 pl-4 pr-2" : "h-9 gap-1 pl-2"),
					children: [
						/* @__PURE__ */ J("span", {
							className: V("text-basic-primary shrink-0", a ? "label-medium" : "label-small"),
							children: "Store:"
						}),
						/* @__PURE__ */ J("span", {
							className: V("code text-info-primary flex-1 min-w-0 truncate", a ? "code-medium" : "code-small"),
							title: c,
							children: c
						}),
						/* @__PURE__ */ J(an, {
							value: c,
							size: F.Medium,
							variant: I.Ghost,
							title: "Copy the store path"
						})
					]
				}),
				/* @__PURE__ */ J(Q, {}),
				/* @__PURE__ */ Y(Zc, {
					size: l,
					onClick: u(e),
					children: [/* @__PURE__ */ J(M, { iconName: L.Gear }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Configurations"
					})]
				}),
				/* @__PURE__ */ Y(Zc, {
					size: l,
					onClick: u(t),
					children: [/* @__PURE__ */ J(M, { iconName: L.Globe }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "SSH configs"
					})]
				}),
				n ? /* @__PURE__ */ Y(Zc, {
					size: l,
					onClick: u(n),
					children: [/* @__PURE__ */ J(M, { iconName: L.Server }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Managed host"
					})]
				}) : null,
				/* @__PURE__ */ J(Q, {}),
				/* @__PURE__ */ Y(Zc, {
					size: l,
					onClick: d(Qf),
					children: [
						/* @__PURE__ */ J(M, { iconName: L.Book }),
						/* @__PURE__ */ J("span", {
							className: "text-left flex-grow",
							children: "See docs"
						}),
						/* @__PURE__ */ J(M, { iconName: L.External })
					]
				}),
				/* @__PURE__ */ Y(Zc, {
					size: l,
					onClick: d(Zf),
					children: [
						/* @__PURE__ */ J(M, { iconName: L.Github }),
						/* @__PURE__ */ J("span", {
							className: "text-left flex-grow",
							children: "See Github"
						}),
						/* @__PURE__ */ J(M, { iconName: L.External })
					]
				})
			]
		}),
		children: /* @__PURE__ */ J(s, {
			variant: I.Ghost,
			size: F.Medium,
			content: R.Icon,
			className: V(a && "btn-round"),
			onClick: () => i((e) => !e),
			"aria-expanded": r,
			"aria-label": r ? "Close the menu" : "Open the menu",
			children: /* @__PURE__ */ J(M, { iconName: r ? L.Close : L.Hamburger })
		})
	});
}
//#endregion
//#region src/app/components/McpServersButton.tsx
function ep({ onOpen: e }) {
	let t = g(), { data: n } = rn(), r = n?.servers.filter((e) => e.enabled).length ?? 0, i = r ? `MCP servers, ${r} active` : "MCP servers";
	return /* @__PURE__ */ Y("div", {
		className: "relative shrink-0",
		children: [t ? /* @__PURE__ */ J(wi, {
			variant: I.Ghost,
			content: R.Icon,
			"aria-label": i,
			onClick: e,
			children: /* @__PURE__ */ J(M, { iconName: L.Toolbox })
		}) : /* @__PURE__ */ Y(s, {
			variant: I.Secondary,
			size: F.Medium,
			content: R.IconLeft,
			"aria-label": i,
			onClick: e,
			children: [/* @__PURE__ */ J(M, { iconName: L.Toolbox }), "MCP"]
		}), r ? /* @__PURE__ */ J("span", {
			"aria-hidden": !0,
			className: "label-micro pointer-events-none absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 bg-btn-primary text-btn-primary",
			children: r
		}) : null]
	});
}
//#endregion
//#region src/app/components/SessionHeaderActions.tsx
function tp() {
	let { toggleSidePanelExpanded: e } = B().stores.sessionLayoutStore, { pathname: t } = di(), n = Kt(t);
	return !g() || !n ? null : /* @__PURE__ */ J(s, {
		variant: I.Ghost,
		size: F.Medium,
		content: R.Icon,
		className: "btn-round",
		"aria-label": "Open panel",
		onClick: e,
		children: /* @__PURE__ */ J(M, { iconName: L.OpenMobileModal })
	});
}
//#endregion
//#region src/app/components/modals/ConfigListNav.tsx
function np({ draftLabel: e, draftSelected: t, onSelectDraft: n, entries: r, selectedId: i, onSelect: a, isLoading: o = !1 }) {
	let c = g(), [l, u] = K(!1), d = t ? e : r.find((e) => e.id === i)?.name ?? e, f = () => {
		n(), u(!1);
	}, p = (e) => {
		a(e), u(!1);
	}, m = /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ Y(Zc, {
			size: c ? Yc.Large : Yc.Medium,
			variant: Xc.Regular,
			active: t,
			onClick: f,
			children: [/* @__PURE__ */ J(M, { iconName: L.Add }), /* @__PURE__ */ J("span", {
				className: "text-left flex-grow truncate",
				children: e
			})]
		}),
		r.length ? /* @__PURE__ */ J(Q, {}) : null,
		r.map((e) => /* @__PURE__ */ J(Zc, {
			size: c ? Yc.Large : Yc.Medium,
			active: i === e.id,
			onClick: () => p(e.id),
			children: /* @__PURE__ */ J("span", {
				className: "text-left flex-grow truncate",
				children: e.name
			})
		}, e.id)),
		o ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 px-2 py-1",
			children: [/* @__PURE__ */ J(Le, { size: A.Micro }), /* @__PURE__ */ J("span", {
				className: "text-micro text-basic-muted",
				children: "Loading…"
			})]
		}) : null
	] });
	return c ? /* @__PURE__ */ J("div", {
		className: "shrink-0 border-b border-muted px-2 py-2",
		children: /* @__PURE__ */ J(Ln, {
			open: l,
			onClose: () => u(!1),
			placement: z.BottomLeft,
			size: "min-w-full",
			className: "w-full",
			panelClassName: "max-h-[50dvh] overflow-auto",
			content: /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1 px-2",
				children: m
			}),
			children: /* @__PURE__ */ Y(s, {
				variant: I.Ghost,
				size: F.Large,
				content: R.Icon,
				className: "w-full",
				"aria-expanded": l,
				"aria-label": "Choose configuration",
				onClick: () => u((e) => !e),
				children: [
					t ? /* @__PURE__ */ J(M, {
						iconName: L.Add,
						className: "shrink-0"
					}) : null,
					/* @__PURE__ */ J("span", {
						className: "text-left flex-grow truncate",
						children: d
					}),
					/* @__PURE__ */ J(M, {
						iconName: L.Down,
						className: V("shrink-0 transition-transform duration-150 ease-out", l ? "rotate-180" : "rotate-0")
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
var rp = wt.map((e) => ({
	id: e,
	label: Zt(e)
})), ip = id.filter((e) => e.id !== Gu).map((e) => e.id === "" ? {
	...e,
	label: "Not set"
} : e), ap = "__new__";
function op({ open: e, onClose: t }) {
	return cd(e) ? /* @__PURE__ */ J(sp, {
		open: e,
		onClose: t
	}) : null;
}
function sp({ open: e, onClose: t }) {
	let n = g(), { data: r, isLoading: i } = In(), a = W(() => r?.configurations ?? [], [r]), [o, s] = K(null), [c, l] = K(null), u = c ?? a.at(-1)?.config_id ?? ap, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: t,
		title: "Configurations",
		size: Wt.Large,
		flush: !0,
		className: "max-w-[820px] md:h-[720px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: o,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ J(np, {
				draftLabel: "New configuration",
				draftSelected: u === ap,
				onSelectDraft: () => l(ap),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: l,
				isLoading: i
			}), /* @__PURE__ */ J(cp, {
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
function cp({ record: e, takenNames: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: o }) {
	let c = _n(), l = yn(), u = kr(), d = lr(), f = e?.backend, [p, m] = K(f ?? "openai-responses"), [h, g] = K(e?.name ?? null), [_, v] = K(e?.base_url ?? ""), [y, b] = K(e?.allow_insecure_http ?? !1), [x, S] = K(""), [C, w] = K(e?.model ?? ""), [T, E] = K(e?.reasoning_effort ?? ""), [D, O] = K(e?.orchestrator_compaction_threshold?.toString() ?? ""), k = G(e?.orchestrator_compaction_threshold?.toString() ?? ""), A = G(e?.orchestrator_compaction_threshold == null), [ee, te] = K(() => e && Object.keys(e.extra_headers).length ? JSON.stringify(e.extra_headers, null, 2) : ""), [ne, re] = K(e?.initial_prompt ?? ""), [ie, ae] = K({
		mode: e?.light_model ? "dual" : "single",
		light: e?.light_model ?? null
	}), [oe, se] = K(""), ce = h ?? lp(p, t), le = Bn(p), ue = Xn(), de = od(bu(ue.data, p, C).supportedEfforts, T, ip), fe = W(() => {
		let e = bu(ue.data, p, C).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		ue.data,
		p,
		C
	]);
	U(() => {
		fe !== "auto" && (k.current === "" || A.current) && (A.current = !0, k.current = fe, O(fe));
	}, [fe]);
	let { signedIn: pe } = Ru(p), me = gd(x.trim(), 600), j = mn(p, me, null, le && !!me), he = Et(p, !le && pe), ge = ln(e && p === f ? e.config_id : null, ""), _e = le && me ? j.isFetching ? { status: "validating" } : j.error ? {
		status: "error",
		message: iu(j.error, p)
	} : j.data ? {
		status: "ready",
		models: j.data.models,
		baseUrl: j.data.base_url
	} : { status: "validating" } : { status: "idle" }, ve = j.data?.models ?? he.data?.models ?? ge.data?.models ?? [], ye = ve.some((e) => e.id === C) ? C : C ?? "", be = _e.status === "idle" ? e?.api_key_env ? "ready" : "idle" : _e.status, xe = l.isPending || u.isPending || d.isPending, N = (e) => (t) => {
		se(""), e(t);
	}, Se = async () => {
		if (xe) return;
		if (!ce.trim()) {
			se("A name is required.");
			return;
		}
		if (!ye.trim()) {
			se("A model is required.");
			return;
		}
		let t;
		try {
			t = Qu(ee, {});
		} catch (e) {
			se(nr($(e)));
			return;
		}
		let n = D.trim() ? Number(D.trim()) : 0, i = T || null;
		if (!Number.isSafeInteger(n) || n < 0) {
			se("The compaction threshold must be a whole number, or 0 to disable it.");
			return;
		}
		if (ie.mode === "dual" && !ie.light) {
			se("Pick the light model before saving.");
			return;
		}
		let a = ie.mode === "dual" ? ie.light : null;
		try {
			if (e) {
				let o = {
					name: ce.trim(),
					backend: p,
					model: ye.trim(),
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
					name: ce.trim(),
					backend: p,
					model: ye.trim(),
					base_url: _.trim() || null,
					allow_insecure_http: y,
					api_key: le ? x.trim() : null,
					reasoning_effort: i,
					extra_headers: t,
					orchestrator_compaction_threshold: n,
					initial_prompt: ne.trim() || null,
					light_model: a
				});
				r(e.config_id), c.success(`Configuration ${e.name} created`);
			}
		} catch (e) {
			se(iu($(e), p));
		}
	}, P = async () => {
		if (!(!e || xe)) try {
			await d.mutateAsync(e.config_id), i(), c.success(`Configuration ${e.name} removed`);
		} catch (e) {
			se(iu($(e)));
		}
	}, Ce = G(Se), we = G(P);
	return Qr(() => {
		Ce.current = Se, we.current = P;
	}), Qr(() => {
		let t = l.isPending || u.isPending;
		return a(/* @__PURE__ */ Y(q, { children: [
			e ? o ? /* @__PURE__ */ J(wi, {
				variant: I.SecondaryDestructive,
				content: R.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: xe,
				loading: d.isPending,
				onClick: () => void we.current(),
				children: /* @__PURE__ */ J(M, { iconName: L.Trash })
			}) : /* @__PURE__ */ J(s, {
				variant: I.SecondaryDestructive,
				size: F.Large,
				content: R.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: xe,
				loading: d.isPending,
				onClick: () => void we.current(),
				children: /* @__PURE__ */ J(M, { iconName: L.Trash })
			}) : null,
			o ? /* @__PURE__ */ J(wi, {
				variant: I.Secondary,
				content: R.Text,
				onClick: n,
				children: "Cancel"
			}) : /* @__PURE__ */ J(s, {
				variant: I.Ghost,
				size: F.Large,
				content: R.Text,
				onClick: n,
				children: "Cancel"
			}),
			o ? /* @__PURE__ */ J(wi, {
				variant: I.Primary,
				content: R.Text,
				disabled: xe,
				loading: t,
				onClick: () => void Ce.current(),
				children: "Save"
			}) : /* @__PURE__ */ J(s, {
				variant: I.Primary,
				size: F.Large,
				content: R.Text,
				disabled: xe,
				loading: t,
				onClick: () => void Ce.current(),
				children: "Save"
			})
		] })), () => a(null);
	}, [
		xe,
		l.isPending,
		d.isPending,
		o,
		n,
		e,
		a,
		u.isPending
	]), /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: /* @__PURE__ */ Y("div", {
			className: V("flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", o && "pb-[88px]"),
			children: [
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col md:rounded-[8px] md:bg-elevation-level-2 md:border md:border-muted md:p-3 gap-4 md:gap-2",
					children: [
						/* @__PURE__ */ J(du, {
							label: "Model Provider",
							required: !0,
							hint: "Service that provides the models for this session.",
							control: /* @__PURE__ */ J(dd, {
								items: rp,
								value: p,
								onValueChange: (e) => {
									N(m)(e), S(""), w("");
								}
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(du, {
							label: "Name",
							required: !0,
							hint: "How this setup is listed the next time a session is created.",
							verticalOnMobile: !0,
							control: /* @__PURE__ */ J(Z, {
								inputSize: o ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								"aria-label": "Configuration name",
								value: ce,
								onChange: (e) => N(g)(e.target.value)
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						le ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(du, {
							label: "API Key",
							required: !0,
							invalid: _e.status === "error",
							verticalOnMobile: !0,
							hint: e ? "Held by NAC for this configuration; type a new key to replace it." : "Stored in NAC under a generated name once the setup is saved.",
							control: /* @__PURE__ */ J(Z, {
								inputSize: o ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								type: "password",
								autoComplete: "off",
								placeholder: e?.api_key_env ? fd : "Paste the provider key",
								leadingSlot: /* @__PURE__ */ J(ju, { status: be }),
								validation: _e.status === "error",
								value: x,
								onChange: (e) => N(S)(e.target.value)
							})
						}), /* @__PURE__ */ J(Q, {})] }) : null,
						/* @__PURE__ */ J(du, {
							label: "Base URL",
							hint: "Endpoint the session sends its requests to; blank uses the provider's own.",
							control: /* @__PURE__ */ J(Z, {
								inputSize: o ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "https://api.openai.com/v1",
								value: _,
								onChange: (e) => N(v)(e.target.value)
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(du, {
							label: "Allow insecure HTTP",
							control: /* @__PURE__ */ Y("div", {
								className: "w-full md:w-[280px] flex flex-col items-start gap-1",
								children: [/* @__PURE__ */ J(ll, {
									"aria-label": "Allow insecure HTTP",
									checked: y,
									onChange: N(b)
								}), /* @__PURE__ */ J("p", {
									className: "body-small text-basic-secondary",
									children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
								})]
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(du, {
							label: "Default Model",
							required: !0,
							hint: "Sessions started from this setup begin with this default and may switch to another.",
							verticalOnMobile: !ve.length,
							control: ve.length ? /* @__PURE__ */ J(dd, {
								items: pd(ve),
								value: ye,
								onValueChange: N(w),
								placeholder: "No models offered"
							}) : /* @__PURE__ */ J(Z, {
								inputSize: o ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "gpt-5.5",
								value: C,
								onChange: (e) => N(w)(e.target.value)
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(du, {
							label: "Reasoning Effort",
							hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
							control: /* @__PURE__ */ J(dd, {
								items: de,
								value: T,
								onValueChange: N(E)
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(du, {
							label: "Context Limit",
							verticalOnMobile: !0,
							labelClassName: "max-w-none",
							hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
							control: /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ J(Z, {
									inputSize: o ? X.Large : X.Medium,
									className: "w-full md:w-[105px]",
									inputClassName: "text-right",
									placeholder: fe,
									inputMode: "numeric",
									value: D,
									onChange: (e) => {
										se(""), A.current = !1, k.current = e.target.value, O(e.target.value);
									}
								}), /* @__PURE__ */ J("span", {
									className: "shrink-0 text-micro text-basic-muted",
									children: "tokens"
								})]
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(Dd, {
							initial: e?.light_model ?? null,
							onChange: ae
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(oc, {
							label: "Extra headers (JSON object)",
							hintText: "Blank sends none; header values must be strings.",
							placeholder: "{\"X-Title\": \"NAC\"}",
							value: ee,
							onChange: (e) => N(te)(e.target.value),
							textAreaClassName: "h-[108px] resize-none"
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(oc, {
							label: "Initial prompt",
							hintText: "Pre-fills the first message of a session started from this setup.",
							placeholder: "Send a message",
							value: ne,
							onChange: (e) => N(re)(e.target.value),
							textAreaClassName: "h-[92px] resize-none"
						})
					]
				}),
				/* @__PURE__ */ J(Bu, {
					backend: p,
					className: "mt-2"
				}),
				oe ? /* @__PURE__ */ J("p", {
					className: "label-micro text-error-primary pt-2",
					children: oe
				}) : null,
				/* @__PURE__ */ J("p", {
					className: "text-micro text-basic-muted pt-2",
					children: "* Required fields"
				})
			]
		})
	});
}
function lp(e, t) {
	let n = new Set(t);
	for (let t = 1;; t += 1) {
		let r = `${e}-config-${t}`;
		if (!n.has(r)) return r;
	}
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpEntryDetails.tsx
function up({ entry: e }) {
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
function dp({ entry: e }) {
	let [t, n] = K(!1), [r, i] = K(!1), a = G(null), o = e.description.replace(/\bDocs:\s*https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
	return Qr(() => {
		let e = a.current;
		e && i(e.scrollHeight > e.clientHeight);
	}, [o]), /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2 rounded-lg border border-muted p-3 bg-elevation-sublevel-variant-A",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 min-w-0",
			children: [
				/* @__PURE__ */ J(up, { entry: e }),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col min-w-0 flex-grow",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-2 min-w-0",
						children: [/* @__PURE__ */ J("span", {
							className: "header-small text-basic-primary truncate",
							children: e.name
						}), e.auth === "required_header" ? /* @__PURE__ */ J(Si, {
							text: "Key required",
							color: xi.Yellow
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
					children: [/* @__PURE__ */ J(M, { iconName: L.BookOpen }), "Docs"]
				})
			]
		}), o ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
			ref: a,
			className: V("text-small text-basic-muted", !t && "line-clamp-3"),
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
function fp({ isMobile: e, variant: t, content: n, className: r, disabled: i, onClick: a, children: o, ariaLabel: c }) {
	return e ? /* @__PURE__ */ J(wi, {
		variant: t,
		content: n ?? R.Text,
		className: r,
		disabled: i,
		"aria-label": c,
		onClick: a,
		children: o
	}) : /* @__PURE__ */ J(s, {
		size: F.Large,
		variant: t === I.Secondary ? I.Ghost : t,
		content: n,
		className: r,
		disabled: i,
		"aria-label": c,
		onClick: a,
		children: o
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpLibraryPicker.tsx
function pp({ onPick: e, onCustom: t, onClose: n, setFooter: r }) {
	let i = g(), { data: a } = jn(), { data: o } = rn(), [c, l] = K(""), [u, d] = K(null), f = W(() => {
		let e = [];
		for (let t of a?.entries ?? []) e.includes(t.category) || e.push(t.category);
		return e;
	}, [a]), p = W(() => {
		let e = /* @__PURE__ */ new Set(), t = /* @__PURE__ */ new Set();
		for (let n of o?.servers ?? []) n.library_id && e.add(n.library_id), t.add(n.name);
		return (n) => e.has(n.id) || t.has(n.name);
	}, [o]), m = W(() => {
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
	return Qr(() => {
		if (!(!n || !r)) return r(/* @__PURE__ */ J(fp, {
			isMobile: i,
			variant: I.Secondary,
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
					leading: qs.Icon,
					leadingIconName: L.Search,
					placeholder: "Search the library",
					value: c,
					onChange: (e) => l(e.target.value)
				}), /* @__PURE__ */ J(s, {
					size: F.Medium,
					variant: I.Secondary,
					content: R.Text,
					className: "shrink-0",
					onClick: t,
					children: i ? "Custom" : "Custom server"
				})]
			}), f.length > 1 ? /* @__PURE__ */ J("div", {
				className: "overflow-x-auto scrollbar-none [&>*]:shrink-0",
				children: /* @__PURE__ */ J("div", {
					className: "flex gap-1.5 px-4 py-2",
					children: [null, ...f].map((e) => /* @__PURE__ */ J(s, {
						size: i ? F.Medium : F.Small,
						variant: u === e ? I.Primary : I.Secondary,
						content: R.Text,
						"aria-pressed": u === e,
						onClick: () => d(e),
						className: i ? "!rounded-full" : "",
						children: e ?? "All"
					}, e ?? "all"))
				})
			}) : null]
		}), /* @__PURE__ */ J("div", {
			className: V("flex-1 overflow-auto px-4 pb-4 flex flex-col gap-2 [&>*]:shrink-0", i && n && "pb-[88px]"),
			children: m.map((t) => /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-2 [&>*]:shrink-0",
				children: [t.category === null ? null : /* @__PURE__ */ J("span", {
					className: "tag-label text-basic-muted pt-6 px-1",
					children: t.category
				}), t.entries.map((t) => {
					let n = p(t);
					return /* @__PURE__ */ Y(Zc, {
						size: Yc.Large,
						disabled: n,
						className: V(n && "opacity-50", "!px-2"),
						onClick: () => e(t),
						children: [
							/* @__PURE__ */ J(up, { entry: t }),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col items-start text-left min-w-0 flex-grow py-1",
								children: [/* @__PURE__ */ Y("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ J("span", {
										className: "label-small text-basic-primary",
										children: t.name
									}), n ? /* @__PURE__ */ J(Si, {
										text: "Added",
										color: xi.Green
									}) : t.auth === "required_header" ? /* @__PURE__ */ J(Si, {
										text: "Key required",
										color: xi.Yellow
									}) : null]
								}), /* @__PURE__ */ J("span", {
									className: "text-micro text-basic-muted truncate w-full",
									children: t.description
								})]
							}),
							n ? null : /* @__PURE__ */ J(M, {
								iconName: L.Right,
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
function mp({ label: e, hint: t, keyPlaceholder: n, rows: r, onChange: i }) {
	let a = g(), o = (e, t) => {
		i(r.map((n, r) => r === e ? {
			...n,
			...t
		} : n));
	};
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-4 md:gap-2",
		children: [
			/* @__PURE__ */ J(uu, {
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
						onChange: (e) => o(t, { key: e.target.value })
					}),
					/* @__PURE__ */ J(Z, {
						inputSize: a ? X.Large : X.Medium,
						className: "flex-1 min-w-0",
						placeholder: e.placeholder ?? "value",
						value: e.value,
						onChange: (e) => o(t, { value: e.target.value })
					}),
					/* @__PURE__ */ Y(s, {
						size: F.Medium,
						variant: I.GhostDestructive,
						content: a ? R.IconLeft : R.Icon,
						"aria-label": "Remove entry",
						onClick: () => i(r.filter((e, n) => n !== t)),
						className: a ? "self-end" : "",
						children: [a ? "Remove" : null, /* @__PURE__ */ J(M, { iconName: L.Trash })]
					})
				]
			}, t)),
			/* @__PURE__ */ Y(Zc, {
				size: a ? Yc.Large : Yc.Medium,
				className: "!border !border-tertiary !border-dashed",
				onClick: () => i([...r, {
					key: "",
					value: ""
				}]),
				children: [/* @__PURE__ */ J(M, { iconName: L.Add }), "Add entry"]
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpOAuthPanel.tsx
function hp(e) {
	switch (e) {
		case "connected": return "Connected";
		case "connecting": return "Waiting for authorization";
		case "failed": return "Authorization failed";
		case "needs_authorization": return "Ready to connect";
		case "needs_configuration": return "Not configured";
		default: return "Checking…";
	}
}
function gp({ serverName: e }) {
	let { api: t } = B(), n = g(), [r, i] = K(null), [a, o] = K(null), [c, l] = K(!1), [u, d] = K(null), [f, p] = K(!1), [m, h] = K(""), [_, v] = K(""), [y, b] = K("pre_registered"), [x, S] = K(""), [C, w] = K("NAC MCP Client"), [T, E] = K("channels:history\nchat:write"), [D, O] = K(""), k = H(async (n = !1) => {
		try {
			let n = await t.getMcpOAuthStatus(e);
			i(n.status), o(n.message ?? null), d(n.authorization_url ?? null);
		} catch {
			n || i("failed"), o(n ? "OAuth status is temporarily unavailable. Retrying…" : "OAuth status is unavailable.");
		}
	}, [t, e]);
	U(() => {
		let e = window.setTimeout(() => void k(), 0);
		return () => window.clearTimeout(e);
	}, [k]), U(() => {
		if (r !== "connecting" && r !== "connected") return;
		let e = !1, t, n = async () => {
			await k(!0), e || (t = window.setTimeout(() => void n(), 1e3));
		};
		return t = window.setTimeout(() => void n(), 1e3), () => {
			e = !0, t !== void 0 && window.clearTimeout(t);
		};
	}, [k, r]);
	let A = async () => {
		if (y === "pre_registered" && !m.trim()) {
			o("A protected client ID credential name is required.");
			return;
		}
		if (y === "client_metadata" && !x.trim()) {
			o("A client metadata document URL is required.");
			return;
		}
		let n;
		try {
			n = D.trim() ? JSON.parse(D) : void 0;
		} catch {
			o("The authorization metadata override must be valid JSON.");
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
		l(!0), o(null);
		try {
			let a = await t.configureMcpOAuth(e, {
				registration: r,
				scopes: T.split("\n").map((e) => e.trim()).filter(Boolean),
				authorization_metadata: n
			});
			i(a.status), d(a.authorization_url ?? null), p(!1), h(""), v("");
		} catch {
			o("OAuth configuration was rejected. Check the protected credential names.");
		} finally {
			l(!1);
		}
	}, ee = async () => {
		l(!0), o(null), d(null);
		try {
			let n = await t.authenticateMcpOAuth(e);
			i(n.status), d(n.authorization_url);
		} catch {
			i("failed"), o("OAuth authentication could not start.");
		} finally {
			l(!1);
		}
	}, te = async () => {
		l(!0), o(null), d(null);
		try {
			let n = await t.logoutMcpOAuth(e);
			i(n.status);
		} catch {
			o("OAuth logout could not complete.");
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
					children: hp(r)
				})]
			}),
			r === "needs_configuration" || f ? /* @__PURE__ */ Y(q, { children: [
				/* @__PURE__ */ Y("div", {
					className: "grid md:grid-cols-2 gap-3",
					children: [
						/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ J(uu, {
								label: "Client registration",
								required: !0
							}), /* @__PURE__ */ Y("select", {
								className: "h-10 rounded-md border border-border-subtle bg-elevation-surface px-3 text-small text-basic-primary",
								value: y,
								onChange: (e) => b(e.target.value),
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
						y === "pre_registered" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ J(uu, {
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
							children: [/* @__PURE__ */ J(uu, {
								label: "Client secret credential",
								hint: "Optional for public clients."
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: _,
								placeholder: "SLACK_MCP_CLIENT_SECRET",
								onChange: (e) => v(e.target.value)
							})]
						})] }) : null,
						y === "client_metadata" ? /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ J(uu, {
								label: "Client metadata URL",
								required: !0
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: x,
								placeholder: "https://nac.example.com/.well-known/oauth-client.json",
								onChange: (e) => S(e.target.value)
							})]
						}) : null,
						y === "dynamic" ? /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ J(uu, {
								label: "Client name",
								hint: "Sent to the authorization server."
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: C,
								onChange: (e) => w(e.target.value)
							})]
						}) : null
					]
				}),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ J(uu, {
						label: "Scopes",
						hint: "One scope per line."
					}), /* @__PURE__ */ J(oc, {
						textAreaClassName: "min-h-[64px] font-mono text-small",
						value: T,
						onChange: (e) => E(e.target.value)
					})]
				}),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ J(uu, {
						label: "Authorization metadata override",
						hint: "Optional JSON for servers without discovery metadata."
					}), /* @__PURE__ */ J(oc, {
						textAreaClassName: "min-h-[72px] font-mono text-small",
						value: D,
						placeholder: y === "client_metadata" ? "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\",\"client_id_metadata_document_supported\":true}" : "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\"}",
						onChange: (e) => O(e.target.value)
					})]
				}),
				/* @__PURE__ */ J("div", {
					className: "flex justify-end",
					children: /* @__PURE__ */ J(s, {
						size: F.Medium,
						variant: I.Secondary,
						content: R.Text,
						disabled: c,
						onClick: () => void A(),
						children: "Configure OAuth"
					})
				})
			] }) : null,
			r && r !== "needs_configuration" && r !== "connecting" && !f ? /* @__PURE__ */ J("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ J(s, {
					size: F.Medium,
					variant: I.Ghost,
					content: R.Text,
					disabled: c,
					onClick: () => p(!0),
					children: "Edit OAuth configuration"
				})
			}) : null,
			r === "needs_authorization" || r === "failed" ? /* @__PURE__ */ J("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ J(s, {
					size: F.Medium,
					variant: I.Secondary,
					content: R.Text,
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
				children: /* @__PURE__ */ J(s, {
					size: F.Medium,
					variant: I.SecondaryDestructive,
					content: R.Text,
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
function _p(e) {
	return Object.entries(e).map(([e, t]) => ({
		key: e,
		value: "",
		storedKey: e,
		placeholder: t
	}));
}
function vp(e) {
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
function yp(e) {
	let t = {};
	for (let [n, r] of Object.entries(e)) r !== null && (t[n] = r);
	return t;
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpServerForm.tsx
var bp = [{
	id: "streamable_http",
	label: "Streamable HTTP"
}, {
	id: "stdio",
	label: "Stdio"
}], xp = [
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
function Sp(e) {
	return e.split("\n").map((e) => e.trim()).filter(Boolean);
}
function Cp(e) {
	return e === "stdio" || e === "streamable_http" ? e : "streamable_http";
}
function wp(e) {
	return e.trim() ? Number(e) : null;
}
function Tp({ record: e, template: t, libraryEntry: n, onBack: r, onClose: i, onSaved: a, onDeleted: o, setFooter: c }) {
	let l = g(), u = _n(), d = ir(), f = h(), p = Kn(), m = Je(), _ = Jt(), v = yr(), [y, b] = K(e?.name ?? t?.name ?? ""), [x, S] = K(e?.enabled ?? !0), [C, w] = K(e?.required ?? !1), [T, E] = K(e?.protocol ?? "legacy"), [D, O] = K(() => Cp(e?.transport ?? t?.transport)), [k, A] = K(e?.url ?? t?.url ?? ""), [ee, te] = K(e?.command ?? ""), [ne, re] = K(e?.args.join("\n") ?? ""), [ie, ae] = K(e?.cwd ?? ""), [oe, se] = K(e?.env_vars.join("\n") ?? ""), [ce, le] = K(e?.startup_timeout_ms?.toString() ?? ""), [ue, de] = K(e?.catalog_timeout_ms?.toString() ?? ""), [fe, pe] = K(e?.execution_timeout_ms?.toString() ?? ""), [me, j] = K(() => e ? _p(e.headers) : t?.auth_header ? [{
		key: t.auth_header,
		value: "",
		placeholder: t.auth_hint ?? void 0
	}] : []), [he, ge] = K(e ? _p(e.env) : []), [_e, ve] = K(() => Object.entries(e?.env_headers ?? {}).map(([e, t]) => ({
		key: e,
		value: t
	}))), [ye, be] = K(e?.bearer_token_env_var ?? ""), [xe, N] = K(e?.header_helper?.command ?? ""), [Se, P] = K(e?.header_helper?.args?.join("\n") ?? ""), [Ce, we] = K(e?.header_helper?.cwd ?? ""), [Te, Ee] = K(() => e?.header_helper ? _p(e.header_helper.env ?? {}) : []), [De, Oe] = K(e?.header_helper?.env_vars?.join("\n") ?? ""), [ke, Ae] = K(e?.header_helper?.timeout_ms?.toString() ?? ""), [je, Me] = K(null), Ne = _.data?.servers.find((t) => t.name === e?.name), Pe = d.isPending || f.isPending || p.isPending || m.isPending || v.isPending, Fe = () => y.trim() ? D === "streamable_http" && !k.trim() ? "A URL is required." : D === "stdio" && !ee.trim() ? "A command is required." : null : "A name is required.", Ie = async () => {
		let n = Fe();
		if (n) {
			u.error(n);
			return;
		}
		let r = vp(me), i = vp(he), o = xe.trim() ? {
			command: xe.trim(),
			args: Sp(Se),
			cwd: Ce.trim() || null,
			env: vp(Te),
			env_vars: Sp(De),
			timeout_ms: wp(ke)
		} : null;
		try {
			e ? (a((await f.mutateAsync({
				serverName: e.name,
				payload: {
					name: y.trim(),
					enabled: x,
					required: C,
					startup_timeout_ms: wp(ce),
					catalog_timeout_ms: wp(ue),
					execution_timeout_ms: wp(fe),
					protocol: T,
					transport: D,
					command: D === "stdio" ? ee.trim() : null,
					args: D === "stdio" ? Sp(ne) : [],
					env: D === "stdio" ? i : {},
					env_vars: D === "stdio" ? Sp(oe) : [],
					cwd: D === "stdio" && ie.trim() || null,
					url: D === "streamable_http" ? k.trim() : null,
					headers: D === "streamable_http" ? r : {},
					env_headers: D === "streamable_http" ? yp(vp(_e)) : {},
					bearer_token_env_var: D === "streamable_http" && ye.trim() || null,
					header_helper: D === "streamable_http" ? o : null
				}
			})).name), u.success("MCP server updated.")) : (a((await d.mutateAsync({
				name: y.trim(),
				enabled: x,
				required: C,
				startup_timeout_ms: wp(ce),
				catalog_timeout_ms: wp(ue),
				execution_timeout_ms: wp(fe),
				protocol: T,
				transport: D,
				command: D === "stdio" ? ee.trim() : null,
				args: D === "stdio" ? Sp(ne) : [],
				env: D === "stdio" ? yp(i) : {},
				env_vars: D === "stdio" ? Sp(oe) : [],
				cwd: D === "stdio" && ie.trim() || null,
				url: D === "streamable_http" ? k.trim() : null,
				headers: D === "streamable_http" ? yp(r) : {},
				env_headers: D === "streamable_http" ? yp(vp(_e)) : {},
				bearer_token_env_var: D === "streamable_http" && ye.trim() || null,
				header_helper: D === "streamable_http" && o ? {
					...o,
					env: yp(o.env)
				} : null,
				library_id: t?.id ?? null
			})).name), u.success("MCP server saved."));
		} catch (e) {
			u.error(`Save failed: ${nr($(e))}`);
		}
	}, Le = async () => {
		if (e) try {
			await p.mutateAsync(e.name), o(), u.success("MCP server deleted.");
		} catch (e) {
			u.error(`Delete failed: ${nr($(e))}`);
		}
	}, Re = async (t) => {
		if (e) try {
			let n = await v.mutateAsync({
				serverName: e.name,
				action: t
			});
			n.state === "failed" ? u.error(n.error ?? "MCP runtime operation failed.") : u.success(`MCP server is ${n.state}.`);
		} catch (e) {
			u.error(`Runtime operation failed: ${nr($(e))}`);
		}
	}, ze = async () => {
		let t = D === "streamable_http" && !k.trim() ? "A URL is required to test." : D === "stdio" && !ee.trim() ? "A command is required to test." : null;
		if (t) {
			u.error(t);
			return;
		}
		Me(null);
		try {
			let t = await m.mutateAsync({
				stored_name: e?.name ?? null,
				name: y.trim() || null,
				transport: D,
				command: D === "stdio" ? ee.trim() : null,
				args: D === "stdio" ? Sp(ne) : [],
				env: D === "stdio" ? vp(he) : {},
				env_vars: D === "stdio" ? Sp(oe) : [],
				cwd: D === "stdio" && ie.trim() || null,
				url: D === "streamable_http" ? k.trim() : null,
				headers: D === "streamable_http" ? vp(me) : {},
				env_headers: D === "streamable_http" ? yp(vp(_e)) : {},
				bearer_token_env_var: D === "streamable_http" && ye.trim() || null,
				header_helper: D === "streamable_http" && xe.trim() ? {
					command: xe.trim(),
					args: Sp(Se),
					cwd: Ce.trim() || null,
					env: vp(Te),
					env_vars: Sp(De),
					timeout_ms: wp(ke)
				} : null,
				startup_timeout_ms: wp(ce),
				catalog_timeout_ms: wp(ue),
				execution_timeout_ms: wp(fe),
				protocol: T
			});
			if (!t.connected) {
				u.error(`Test failed: ${t.error ?? "connection failed"}`);
				return;
			}
			Me(t.tools), u.success(`Connection succeeded: ${t.tools.length} tool${t.tools.length === 1 ? "" : "s"} found.`);
		} catch (e) {
			u.error(`Test failed: ${nr($(e))}`);
		}
	}, Be = G(Ie), Ve = G(Le), He = G(i);
	return Qr(() => {
		Be.current = Ie, Ve.current = Le, He.current = i;
	}), Qr(() => (c(/* @__PURE__ */ Y(q, { children: [
		e ? /* @__PURE__ */ J(fp, {
			isMobile: l,
			variant: I.SecondaryDestructive,
			content: R.Icon,
			className: "mr-auto",
			ariaLabel: "Delete server",
			disabled: Pe,
			onClick: () => void Ve.current(),
			children: /* @__PURE__ */ J(M, { iconName: L.Trash })
		}) : null,
		/* @__PURE__ */ J(fp, {
			isMobile: l,
			variant: I.Secondary,
			onClick: () => He.current(),
			children: "Cancel"
		}),
		/* @__PURE__ */ J(fp, {
			isMobile: l,
			variant: I.Primary,
			disabled: Pe,
			onClick: () => void Be.current(),
			children: "Save"
		})
	] })), () => c(null)), [
		l,
		Pe,
		e,
		c
	]), /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: [r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-1 shrink-0 border-b border-muted px-2 py-2",
			children: [/* @__PURE__ */ J(s, {
				size: F.Medium,
				variant: I.Ghost,
				content: R.Icon,
				"aria-label": "Back to library",
				onClick: r,
				children: /* @__PURE__ */ J(M, { iconName: L.Left })
			}), /* @__PURE__ */ J("span", {
				className: "text-medium text-basic-primary truncate",
				children: y.trim() || "Custom server"
			})]
		}) : null, /* @__PURE__ */ Y("div", {
			className: V("flex-1 overflow-auto p-4 flex flex-col gap-4 [&>*]:shrink-0", l && "pb-[88px]"),
			children: [
				n ? /* @__PURE__ */ J(dp, { entry: n }) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col md:flex-row gap-4",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 flex-grow",
						children: [/* @__PURE__ */ J(uu, {
							label: "Name",
							required: !0
						}), /* @__PURE__ */ J(Z, {
							inputSize: l ? X.Large : X.Medium,
							placeholder: "my_server",
							value: y,
							onChange: (e) => b(e.target.value)
						})]
					}), /* @__PURE__ */ J("div", {
						className: "md:pt-6",
						children: /* @__PURE__ */ Y("div", {
							className: "flex gap-4 items-center px-4 py-2 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
							children: [
								/* @__PURE__ */ J(uu, {
									label: "Enabled",
									hint: "Disabled servers are kept but not connected when a session starts."
								}),
								/* @__PURE__ */ J(ll, {
									checked: x,
									size: l ? al.Large : al.Medium,
									onChange: S
								}),
								/* @__PURE__ */ J(uu, {
									label: "Required",
									hint: "Fail session admission when this enabled server cannot start."
								}),
								/* @__PURE__ */ J(ll, {
									checked: C,
									size: l ? al.Large : al.Medium,
									onChange: w
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
							children: [/* @__PURE__ */ J(uu, { label: "Transport" }), /* @__PURE__ */ J("div", {
								className: "flex gap-2",
								children: bp.map((e) => /* @__PURE__ */ J(s, {
									size: l ? F.Medium : F.Small,
									variant: D === e.id ? I.Primary : I.Secondary,
									content: R.Text,
									"aria-pressed": D === e.id,
									onClick: () => O(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ J(uu, {
								label: "Protocol",
								hint: xp.find((e) => e.id === T)?.hint
							}), /* @__PURE__ */ J("div", {
								className: "flex flex-wrap gap-2",
								children: xp.map((e) => /* @__PURE__ */ J(s, {
									size: l ? F.Medium : F.Small,
									variant: T === e.id ? I.Primary : I.Secondary,
									content: R.Text,
									"aria-pressed": T === e.id,
									onClick: () => E(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						D === "streamable_http" ? /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(uu, {
									label: "URL",
									required: !0
								}), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									placeholder: "https://example.com/mcp",
									value: k,
									onChange: (e) => A(e.target.value)
								})]
							}),
							/* @__PURE__ */ J(mp, {
								label: "Headers",
								hint: "Sent with every request. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "Authorization",
								rows: me,
								onChange: j
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(uu, {
									label: "Bearer token environment variable",
									hint: "The variable value is sent as a Bearer token without persisting it."
								}), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									placeholder: "MCP_TOKEN",
									value: ye,
									onChange: (e) => be(e.target.value)
								})]
							}),
							/* @__PURE__ */ J(mp, {
								label: "Environment-backed headers",
								hint: "Map each HTTP header name to the environment variable that supplies its value.",
								keyPlaceholder: "X-API-Key",
								rows: _e,
								onChange: ve
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(uu, {
									label: "Header helper command",
									hint: "Optional bounded command that prints a JSON object of same-origin request headers."
								}), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									placeholder: "./refresh-mcp-headers",
									value: xe,
									onChange: (e) => N(e.target.value)
								})]
							}),
							xe.trim() ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(uu, {
										label: "Header helper arguments",
										hint: "One argument per line."
									}), /* @__PURE__ */ J(oc, {
										textAreaClassName: "min-h-[64px] font-mono",
										value: Se,
										onChange: (e) => P(e.target.value)
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(uu, { label: "Header helper working directory" }), /* @__PURE__ */ J(Z, {
										inputSize: l ? X.Large : X.Medium,
										value: Ce,
										onChange: (e) => we(e.target.value)
									})]
								}),
								/* @__PURE__ */ J(mp, {
									label: "Header helper environment",
									hint: "Stored literals remain write-only.",
									keyPlaceholder: "TOKEN",
									rows: Te,
									onChange: Ee
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(uu, {
										label: "Header helper forwarded environment",
										hint: "One variable name per line."
									}), /* @__PURE__ */ J(oc, {
										textAreaClassName: "min-h-[64px] font-mono",
										value: De,
										onChange: (e) => Oe(e.target.value)
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(uu, { label: "Header helper timeout (ms)" }), /* @__PURE__ */ J(Z, {
										inputSize: l ? X.Large : X.Medium,
										type: "number",
										min: 100,
										max: 6e5,
										value: ke,
										onChange: (e) => Ae(e.target.value)
									})]
								})
							] }) : null
						] }) : /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(uu, {
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
								children: [/* @__PURE__ */ J(uu, {
									label: "Arguments",
									hint: "One argument per line."
								}), /* @__PURE__ */ J(oc, {
									textAreaClassName: V("min-h-[72px] font-mono", l ? "text-medium" : "text-small"),
									placeholder: "-y\nsome-mcp-server",
									value: ne,
									onChange: (e) => re(e.target.value)
								})]
							}),
							/* @__PURE__ */ J(mp, {
								label: "Environment",
								hint: "Set for the server process. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "API_KEY",
								rows: he,
								onChange: ge
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(uu, {
									label: "Working directory",
									hint: "Relative paths resolve from the workspace."
								}), /* @__PURE__ */ J(Z, {
									inputSize: l ? X.Large : X.Medium,
									placeholder: "packages/server",
									value: ie,
									onChange: (e) => ae(e.target.value)
								})]
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(uu, {
									label: "Forward environment variables",
									hint: "One existing host variable name per line."
								}), /* @__PURE__ */ J(oc, {
									textAreaClassName: "min-h-[64px] font-mono",
									value: oe,
									onChange: (e) => se(e.target.value)
								})]
							})
						] }),
						/* @__PURE__ */ J("div", {
							className: "grid grid-cols-1 md:grid-cols-3 gap-3",
							children: [
								[
									"Startup timeout (ms)",
									ce,
									le
								],
								[
									"Catalog timeout (ms)",
									ue,
									de
								],
								[
									"Execution timeout (ms)",
									fe,
									pe
								]
							].map(([e, t, n]) => /* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(uu, { label: e }), /* @__PURE__ */ J(Z, {
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
									Ne?.state ?? "disconnected",
									Ne?.error ? ` — ${Ne.error}` : ""
								]
							}), [
								"connect",
								"disconnect",
								"reload"
							].map((e) => /* @__PURE__ */ J(s, {
								size: F.Small,
								variant: I.Secondary,
								disabled: Pe,
								onClick: () => void Re(e),
								children: e[0].toUpperCase() + e.slice(1)
							}, e))]
						}) : null,
						/* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2 justify-end",
							children: [/* @__PURE__ */ Y(s, {
								size: F.Medium,
								variant: I.Secondary,
								disabled: Pe,
								onClick: () => void ze(),
								content: R.IconLeft,
								children: [/* @__PURE__ */ J(M, { iconName: L.Bolt }), m.isPending ? "Testing…" : "Test connection"]
							}), je ? /* @__PURE__ */ Y("span", {
								className: "text-small text-basic-muted",
								children: [
									je.length,
									" tool",
									je.length === 1 ? "" : "s",
									" found"
								]
							}) : null]
						})
					]
				}),
				e && D === "streamable_http" ? /* @__PURE__ */ J(gp, { serverName: e.name }) : null,
				je && je.length ? /* @__PURE__ */ J("div", {
					className: "flex flex-col gap-1",
					children: je.map((e) => /* @__PURE__ */ Y("div", {
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
function Ep({ error: e, retrying: t, onRetry: n }) {
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
			/* @__PURE__ */ J(s, {
				variant: I.Secondary,
				size: F.Small,
				content: R.Text,
				loading: t,
				onClick: n,
				children: "Try again"
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpServersMobile.tsx
function Dp({ open: e, onClose: t }) {
	let { data: n } = jn(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = rn(), l = r?.servers ?? [], [u, d] = K(!1), [f, p] = K(null), [m, h] = K(null), [g, _] = K(null), v = l.find((e) => e.name === m) ?? null, y = f?.template ?? null, b = y ?? (v ? n?.entries.find((e) => e.id === v.library_id || e.name === v.name) ?? null : null), x = () => {
		p(null), h(null), d(!1);
	}, S = () => {
		p(null), h(null);
	};
	return /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ J(ur, {
			open: e,
			onClose: t,
			title: "MCP servers",
			children: a ? /* @__PURE__ */ J(Ep, {
				error: i,
				retrying: o,
				onRetry: () => {
					c();
				}
			}) : /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1 [&>*]:shrink-0",
				children: [
					/* @__PURE__ */ Y(Zc, {
						size: Yc.Large,
						onClick: () => d(!0),
						children: [
							/* @__PURE__ */ J(M, { iconName: L.Add }),
							/* @__PURE__ */ J("span", {
								className: "text-left flex-grow truncate",
								children: "Add server"
							}),
							/* @__PURE__ */ J(M, {
								iconName: L.Right,
								className: "shrink-0"
							})
						]
					}),
					l.length ? /* @__PURE__ */ J(Q, {}) : null,
					l.map((e) => /* @__PURE__ */ Y(Zc, {
						size: Yc.Large,
						onClick: () => h(e.name),
						children: [/* @__PURE__ */ J("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						}), /* @__PURE__ */ J(M, {
							iconName: L.Right,
							className: "shrink-0"
						})]
					}, e.name)),
					s ? /* @__PURE__ */ Y("div", {
						className: "flex items-center gap-2 px-2 py-1",
						children: [/* @__PURE__ */ J(Le, { size: A.Micro }), /* @__PURE__ */ J("span", {
							className: "text-micro text-basic-muted",
							children: "Loading…"
						})]
					}) : null
				]
			})
		}),
		/* @__PURE__ */ J(ur, {
			open: u,
			onClose: () => d(!1),
			title: "Add server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			children: /* @__PURE__ */ J(pp, {
				onPick: (e) => p({ template: e }),
				onCustom: () => p({ template: null })
			})
		}),
		/* @__PURE__ */ J(ur, {
			open: f !== null || m !== null,
			onClose: S,
			title: v?.name ?? y?.name ?? "Custom server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			footer: g,
			children: /* @__PURE__ */ J(Tp, {
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
var Op = "__new__";
function kp({ open: e, onClose: t }) {
	let n = cd(e), r = g();
	return n ? J(r ? Dp : Ap, {
		open: e,
		onClose: t
	}) : null;
}
function Ap({ open: e, onClose: t }) {
	let { data: n } = jn(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = rn(), l = W(() => r?.servers ?? [], [r]), [u, d] = K(null), [f, p] = K(null), [m, h] = K(!1), [g, _] = K(null), v = u ?? l.at(-1)?.name ?? Op, y = l.find((e) => e.name === v) ?? null, b = v === Op, x = (e) => {
		d(e), p(null), h(!1);
	}, S = f ?? (y ? n?.entries.find((e) => e.id === y.library_id || e.name === y.name) ?? null : null);
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: t,
		title: "MCP servers",
		size: Wt.Large,
		flush: !0,
		className: "md:h-[740px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: g,
		children: a ? /* @__PURE__ */ J(Ep, {
			error: i,
			retrying: o,
			onRetry: () => {
				c();
			}
		}) : /* @__PURE__ */ Y("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ J(np, {
				draftLabel: "Add server",
				draftSelected: b,
				onSelectDraft: () => x(Op),
				entries: l.map((e) => ({
					id: e.name,
					name: e.name
				})),
				selectedId: v,
				onSelect: x,
				isLoading: s
			}), b && !f && !m ? /* @__PURE__ */ J(pp, {
				onPick: (e) => p(e),
				onCustom: () => h(!0),
				onClose: t,
				setFooter: _
			}) : /* @__PURE__ */ J(Tp, {
				record: y,
				template: f,
				libraryEntry: S,
				onBack: () => {
					d(Op), p(null), h(!1);
				},
				onClose: t,
				onSaved: x,
				onDeleted: () => x(Op),
				setFooter: _
			}, y ? y.name : f?.id ?? "custom")]
		})
	});
}
//#endregion
//#region src/app/components/modals/SshConfigsModal.tsx
var jp = "__new__";
function Mp(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function Np({ open: e, onClose: t }) {
	return cd(e) ? /* @__PURE__ */ J(Pp, {
		open: e,
		onClose: t
	}) : null;
}
function Pp({ open: e, onClose: t }) {
	let n = g(), { data: r, isLoading: i } = Rt(), a = W(() => r?.configurations ?? [], [r]), [o, s] = K(null), [c, l] = K(null), u = o ?? a.at(-1)?.config_id ?? jp, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: t,
		title: "SSH configs",
		size: Wt.Large,
		flush: !0,
		className: "max-w-[780px] md:h-[480px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: c,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ J(np, {
				draftLabel: "Create New",
				draftSelected: u === jp,
				onSelectDraft: () => s(jp),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: s,
				isLoading: i
			}), /* @__PURE__ */ J(Fp, {
				record: d,
				defaultName: Mp(a),
				onClose: t,
				onSaved: s,
				onDeleted: () => s(jp),
				setFooter: l,
				isMobile: n
			}, u)]
		})
	});
}
function Fp({ record: e, defaultName: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: o }) {
	let c = _n(), l = Nt(), u = $e(), d = Ut(), f = Pr(), [p, m] = K(e?.name ?? t), [h, g] = K(e?.ssh_host ?? ""), [_, v] = K(e?.ssh_port ? String(e.ssh_port) : ""), [y, b] = K(e?.ssh_identity_file ?? ""), x = l.isPending || u.isPending || d.isPending || f.isPending, S = async () => {
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
			c.error(`Save failed: ${nr($(e))}`);
		}
	}, C = async () => {
		if (e) try {
			await d.mutateAsync(e.config_id), i(), c.success("SSH config deleted.");
		} catch (e) {
			c.error(`Delete failed: ${nr($(e))}`);
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
	return Qr(() => {
		T.current = S, E.current = C;
	}), Qr(() => (a(/* @__PURE__ */ Y(q, { children: [
		e ? o ? /* @__PURE__ */ J(wi, {
			variant: I.SecondaryDestructive,
			content: R.Icon,
			className: "mr-auto",
			disabled: x,
			onClick: () => void E.current(),
			children: /* @__PURE__ */ J(M, { iconName: L.Trash })
		}) : /* @__PURE__ */ J(s, {
			size: F.Large,
			variant: I.SecondaryDestructive,
			content: R.Icon,
			className: "mr-auto",
			disabled: x,
			onClick: () => void E.current(),
			children: /* @__PURE__ */ J(M, { iconName: L.Trash })
		}) : null,
		o ? /* @__PURE__ */ J(wi, {
			variant: I.Secondary,
			content: R.Text,
			onClick: n,
			children: "Cancel"
		}) : /* @__PURE__ */ J(s, {
			size: F.Large,
			variant: I.Ghost,
			onClick: n,
			children: "Cancel"
		}),
		o ? /* @__PURE__ */ J(wi, {
			variant: I.Primary,
			content: R.Text,
			disabled: x,
			onClick: () => void T.current(),
			children: "Save"
		}) : /* @__PURE__ */ J(s, {
			size: F.Large,
			variant: I.Primary,
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
	]), /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: /* @__PURE__ */ J("div", {
			className: V("flex-1 overflow-auto p-4 [&>*]:shrink-0", o && "pb-[88px]"),
			children: /* @__PURE__ */ J(Id, {
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
var Ip = qr(null);
function Lp() {
	let e = Xr(Ip);
	if (!e) throw Error("useManagedHost must be used within ManagedHostProvider");
	return e;
}
//#endregion
//#region src/app/components/TopBar.tsx
var Rp = "linear-gradient(to bottom, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))", zp = { backgroundImage: `${Rp}, ${Rp}` };
function Bp() {
	let { useSidebarOffset: e } = B().stores.sidebarLayoutStore, [t, n] = K(!1), [r, i] = K(!1), [a, o] = K(!1), c = g(), l = Ar(), { pathname: u } = di(), d = Df(), f = Lp(), p = e(), m = Kt(u) !== null || kn(u) !== null;
	return !c && (Kt(u) !== null || u === _r.list()) ? null : /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ Y("header", {
			className: V("fixed top-0 right-0 z-10 flex items-center justify-between py-2 shrink-0", "transition-[left] duration-500 ease-in-out", c ? "h-16 px-3 gap-4" : l ? "h-[52px] px-3" : "h-[52px] px-4"),
			style: { left: p },
			children: [
				/* @__PURE__ */ J("div", {
					className: V("absolute inset-x-0 top-0 pointer-events-none", c ? "-bottom-[76px]" : "-bottom-[8px]"),
					style: zp
				}),
				/* @__PURE__ */ Y("div", {
					className: V("relative flex items-center", c ? "flex-1 min-w-0 gap-4" : l ? "shrink-0 gap-4" : "shrink-0 gap-8"),
					children: [p > 0 ? null : /* @__PURE__ */ J(oi, {
						to: _r.list(),
						className: "shrink-0",
						"aria-label": "All projects",
						children: /* @__PURE__ */ J(fc, {
							height: 36,
							markOnly: c || l,
							className: "text-basic-primary"
						})
					}), /* @__PURE__ */ J(Xf, {})]
				}),
				/* @__PURE__ */ Y("div", {
					className: "relative flex items-center shrink-0 gap-2",
					children: [
						c && !m ? /* @__PURE__ */ J(s, {
							variant: I.Primary,
							size: F.Medium,
							content: R.Icon,
							className: "btn-round",
							"aria-label": f.isManaged ? "Add repository" : "New project",
							onClick: f.isManaged ? f.addRepository : d.create,
							children: /* @__PURE__ */ J(M, { iconName: L.Add })
						}) : null,
						/* @__PURE__ */ J(tp, {}),
						/* @__PURE__ */ J(ep, { onOpen: () => o(!0) }),
						/* @__PURE__ */ J($f, {
							onConfigurations: () => n(!0),
							onSshConfigs: () => i(!0),
							onManagedHost: f.isManaged ? f.openSettings : void 0
						})
					]
				})
			]
		}),
		/* @__PURE__ */ J(op, {
			open: t,
			onClose: () => n(!1)
		}),
		/* @__PURE__ */ J(Np, {
			open: r,
			onClose: () => i(!1)
		}),
		/* @__PURE__ */ J(kp, {
			open: a,
			onClose: () => o(!1)
		})
	] });
}
//#endregion
//#region src/app/components/AppShell.tsx
function Vp() {
	return /* @__PURE__ */ Y("div", {
		className: "h-full flex flex-col bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ J(Bp, {}), /* @__PURE__ */ J("main", {
			className: "flex-1 min-h-0",
			children: /* @__PURE__ */ J(ci, {})
		})]
	});
}
//#endregion
//#region src/app/components/sessions/SessionFilters.tsx
var Hp = { paddingInline: "12px" };
function Up() {
	return /* @__PURE__ */ J("div", { className: "h-px w-full bg-divider-muted shrink-0" });
}
function Wp({ children: e, gap: t }) {
	return /* @__PURE__ */ J("div", {
		className: V("flex flex-col px-4 py-6", t),
		children: e
	});
}
function Gp({ label: e, items: t, value: n, onValueChange: r, stacked: i, sidebar: a = !1 }) {
	return /* @__PURE__ */ Y("div", {
		className: V(i ? "flex flex-col gap-1" : a ? "flex items-center gap-1" : "flex items-center justify-between gap-3"),
		children: [/* @__PURE__ */ J("div", {
			className: V(i ? "label-medium text-basic-primary" : "label-small shrink-0", a || i ? "text-basic-primary" : "text-basic-secondary", a && "flex-1 min-w-0"),
			children: e
		}), /* @__PURE__ */ J($c, {
			items: t,
			value: n,
			onValueChange: r,
			size: i ? F.Large : F.Small,
			variant: I.Secondary,
			placement: z.BottomLeft,
			sticky: a,
			className: i ? "w-full" : "min-w-0",
			triggerClassName: i ? "w-full btn-field" : a ? "!gap-1.5 !pl-3" : ""
		})]
	});
}
function Kp({ label: e, options: t, selected: n, onToggle: r, labelOf: i = (e) => e, touch: a, sidebar: o = !1 }) {
	return /* @__PURE__ */ Y("div", {
		className: V("flex flex-col", o ? "gap-2" : "gap-3"),
		children: [/* @__PURE__ */ J("div", {
			className: V(a ? "label-medium text-basic-primary" : "label-small", o || a ? "text-basic-primary" : "text-basic-secondary"),
			children: e
		}), /* @__PURE__ */ J("div", {
			className: "flex flex-wrap gap-2",
			children: t.map((e) => /* @__PURE__ */ J(s, {
				size: a ? F.Medium : F.Small,
				content: R.Text,
				variant: n.includes(e) ? I.Primary : I.Secondary,
				onClick: () => r(e),
				"aria-pressed": n.includes(e),
				style: a ? void 0 : Hp,
				children: i(e)
			}, e))
		})]
	});
}
function qp({ sessions: e, showSearch: t = !0, mobile: n = !1, sidebar: r = !1, onChange: i }) {
	let { useSort: a, useSessionProviders: o, useSessionEnvs: s, useSelectedProviders: c, useSelectedEnvs: l, useModifiedRange: u, useFilterQuery: d, useCreatedRange: f, toggleProvider: p, toggleEnv: m, setSort: h, setQuery: g, setModifiedRange: _, setCreatedRange: v, pruneUnavailableFacets: y, SORT_ITEMS: b, RANGE_ITEMS: x } = B().stores.sessionFiltersStore, S = d(), C = a(), w = f(), T = u(), E = l(), D = c(), O = s(e), k = o(e);
	U(() => {
		y(O, k);
	}, [
		O,
		k,
		y
	]);
	let A = (e) => (t) => {
		e(t), i?.();
	}, ee = /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ J(Gp, {
			label: "Sort by",
			items: b,
			value: C,
			onValueChange: A((e) => h(e)),
			stacked: n,
			sidebar: r
		}),
		/* @__PURE__ */ J(Gp, {
			label: "Creation date",
			items: x,
			value: w,
			onValueChange: A((e) => v(e)),
			stacked: n,
			sidebar: r
		}),
		/* @__PURE__ */ J(Gp, {
			label: "Modification date",
			items: x,
			value: T,
			onValueChange: A((e) => _(e)),
			stacked: n,
			sidebar: r
		})
	] });
	return r ? /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ J("div", {
				className: "flex flex-col gap-6 py-2",
				children: ee
			}),
			O.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Up, {}), /* @__PURE__ */ J("div", {
				className: "py-2",
				children: /* @__PURE__ */ J(Kp, {
					label: "Environment",
					options: O,
					selected: E,
					onToggle: A(m),
					touch: !1,
					sidebar: !0
				})
			})] }) : null,
			k.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Up, {}), /* @__PURE__ */ J("div", {
				className: "py-2",
				children: /* @__PURE__ */ J(Kp, {
					label: "Provider",
					options: k,
					selected: D,
					onToggle: A(p),
					labelOf: Zt,
					touch: !1,
					sidebar: !0
				})
			})] }) : null
		]
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col",
		children: [
			t ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Wp, {
				gap: "gap-4",
				children: /* @__PURE__ */ J(Z, {
					inputSize: X.Medium,
					leading: qs.Icon,
					leadingIconName: L.Search,
					placeholder: "Search projects",
					value: S,
					onChange: (e) => g(e.target.value),
					"aria-label": "Search projects"
				})
			}), /* @__PURE__ */ J(Up, {})] }) : null,
			/* @__PURE__ */ J(Wp, {
				gap: n ? "gap-6" : "gap-4",
				children: ee
			}),
			O.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Up, {}), /* @__PURE__ */ J(Wp, {
				gap: "gap-4",
				children: /* @__PURE__ */ J(Kp, {
					label: "Environment",
					options: O,
					selected: E,
					onToggle: A(m),
					touch: n
				})
			})] }) : null,
			k.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Up, {}), /* @__PURE__ */ J(Wp, {
				gap: "gap-4",
				children: /* @__PURE__ */ J(Kp, {
					label: "Provider",
					options: k,
					selected: D,
					onToggle: A(p),
					labelOf: Zt,
					touch: n
				})
			})] }) : null
		]
	});
}
//#endregion
//#region src/app/components/LeftSidebar/NewSessionPopover.tsx
var Jp = [
	{
		behavior: "direct",
		label: "Agent Session",
		icon: L.Plane
	},
	{
		behavior: "direct-with-orchestrator",
		label: "Agent + Orchestrator Session",
		icon: L.PlaneAdd
	},
	{
		behavior: "orchestrator",
		label: "Orchestrator Session",
		icon: L.Orchestrator
	}
];
function Yp(e) {
	let t = Pl(e);
	return [
		t.topLevel,
		t.editing,
		t.delegation,
		t.inspection
	].join(" ");
}
function Xp({ projectId: e, onUnavailable: t, className: n, children: r }) {
	let i = ct(), [a, o] = K(!1), s = fi(), c = _n(), l = en(), u = () => {
		if (!e) {
			t();
			return;
		}
		if (!i.orchestrationEnabled) {
			d("direct");
			return;
		}
		o((e) => !e);
	}, d = async (t) => {
		if (!(!e || l.isPending)) try {
			let n = (await l.mutateAsync({
				project_id: e,
				behavior: se(i, t)
			})).metadata.session_id;
			o(!1), n && s(_r.session(n));
		} catch (e) {
			c.error(`Failed to start a chat: ${iu($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Ln, {
		open: a,
		onClose: () => o(!1),
		sticky: !0,
		placement: z.RightTop,
		size: hn.Medium,
		panelClassName: "gap-2",
		className: n,
		content: /* @__PURE__ */ J(q, { children: Jp.map((e) => {
			let t = Pl(e.behavior);
			return /* @__PURE__ */ Y(Zc, {
				disabled: l.isPending,
				hoverHint: {
					title: t.label,
					description: Yp(e.behavior),
					muted: !0
				},
				onClick: () => void d(e.behavior),
				children: [/* @__PURE__ */ J(M, { iconName: e.icon }), /* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: e.label
				})]
			}, e.behavior);
		}) }),
		children: r(u)
	});
}
//#endregion
//#region src/app/components/LeftSidebar/SidebarProjectList.tsx
var Zp = 6e4, Qp = 4;
function $p({ projects: e, sessions: t, query: n, activeSessionId: r, activeProjectId: i }) {
	let a = fi(), o = ml(), s = rr(Zp), [c, l] = K(() => /* @__PURE__ */ new Set()), [u, d] = K(() => /* @__PURE__ */ new Map()), [f, p] = K(() => /* @__PURE__ */ new Set()), m = n.trim().toLowerCase(), h = W(() => bl(e, t), [e, t]), g = W(() => t.filter((e) => e.lineage == null && !e.summary.project_id), [t]), _ = (e) => m ? !0 : u.get(e) === r ? !1 : c.has(e) || e === i, v = (e) => {
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
					children: /* @__PURE__ */ J(Wc, {
						entityId: t,
						name: e.project.name,
						running: e.running > 0,
						"aria-expanded": n,
						onClick: () => v(t)
					})
				}), /* @__PURE__ */ J(ga, {
					isOpen: n,
					inert: !n,
					"aria-hidden": !n,
					className: "w-full duration-500 ease-in-out",
					children: /* @__PURE__ */ J(nm, {
						sessions: c,
						activeSessionId: r,
						revealed: m.length > 0 || f.has(t),
						onReveal: () => p((e) => {
							let n = new Set(e);
							return n.add(t), n;
						}),
						now: s,
						onOpen: (e) => a(_r.session(e))
					})
				})]
			}, t);
		}), b.length > 0 ? /* @__PURE__ */ J("section", {
			className: "flex flex-col px-2 py-1",
			children: b.map((e) => /* @__PURE__ */ J(Wc, {
				entityId: e.summary.session_id,
				name: o(e.summary),
				variant: Uc.Orphan,
				active: e.summary.session_id === r,
				running: Dt(e.active_run),
				onClick: () => a(_r.session(e.summary.session_id))
			}, e.summary.session_id))
		}) : null]
	});
}
function em(e, t, n) {
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
function tm(e, t) {
	if (t) return e;
	let n = Qp, r = [];
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
function nm({ sessions: e, activeSessionId: t, revealed: n, onReveal: r, now: i, onOpen: a }) {
	let o = ml(), s = ct(), c = Vf(), l = W(() => Ml(e, (e) => ({
		updatedAt: e.summary.updated_at,
		pinned: !!e.summary.pinned
	}), i), [e, i]);
	if (e.length === 0) return /* @__PURE__ */ J("p", {
		className: "label-small text-basic-muted px-4 pb-3",
		children: "No chats yet"
	});
	let u = em(tm(l, n), l, t), d = u.reduce((e, t) => e + t.items.length, 0), f = Math.max(0, e.length - d);
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1 px-2 pb-2",
		children: [u.map((e) => /* @__PURE__ */ Y("div", {
			className: "flex flex-col",
			children: [/* @__PURE__ */ J("p", {
				className: "tag-label text-basic-tertiary uppercase px-2 pt-4 pb-4",
				children: e.label
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-0.5",
				children: e.items.map((e) => {
					let n = o(e.summary), r = Pl(e.summary.behavior);
					return /* @__PURE__ */ J(Oi, {
						title: n,
						icon: Fl(e.summary.behavior),
						"aria-label": s.orchestrationEnabled ? `${n}, ${r.navigationLabel}` : n,
						active: e.summary.session_id === t,
						running: Dt(e.active_run),
						forkedFromTitle: e.summary.forked_from?.title,
						onClick: () => a(e.summary.session_id),
						actions: /* @__PURE__ */ J(dl, {
							title: n,
							pinned: e.summary.pinned,
							onPin: () => void c.togglePin(e.summary),
							onRename: () => c.rename(e.summary),
							onDelete: () => c.remove(e.summary)
						})
					}, e.summary.session_id);
				})
			})]
		}, e.label)), f > 0 ? /* @__PURE__ */ Y(Zc, {
			onClick: r,
			children: [/* @__PURE__ */ J(M, { iconName: L.MenuHorizontal }), /* @__PURE__ */ Y("span", {
				className: "text-left flex-grow",
				children: [
					"See ",
					f,
					" more"
				]
			})]
		}) : null]
	});
}
//#endregion
//#region src/app/components/LeftSidebar/LeftSidebarPanel.tsx
function rm({ isOpen: e, onToggle: t, toggleKeys: n, commands: r, variant: i }) {
	let { useFilterQuery: a, setQuery: o } = B().stores.sessionFiltersStore, c = i === "projects", [l, u] = K(""), d = a(), { data: f = [] } = Bt(), { data: p } = ot(), { data: m } = Qt(), h = m?.store_path ?? "", g = p?.projects ?? [];
	return /* @__PURE__ */ Y("div", {
		className: "flex h-full flex-col bg-elevation-level-2 border-r border-muted",
		style: { boxShadow: "var(--left-sidebar-open)" },
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex items-center justify-between px-4 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ J(fc, {
					height: 28,
					className: "text-basic-primary"
				}), /* @__PURE__ */ J(Zn, {
					title: "Hide sidebar",
					keyboardShortcuts: n,
					position: z.CenterLeft,
					sticky: !0,
					disabled: !e,
					children: /* @__PURE__ */ J(s, {
						variant: I.Ghost,
						content: R.Icon,
						"aria-label": "Hide sidebar",
						onClick: t,
						children: /* @__PURE__ */ J(M, { iconName: L.SidebarChevronLeft })
					})
				})]
			}),
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-3 px-2 py-3 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ J("div", {
					className: "px-1",
					children: /* @__PURE__ */ J(Z, {
						inputSize: X.Medium,
						leading: qs.Icon,
						leadingIconName: L.Search,
						placeholder: c ? "Search Projects" : "Search Sessions",
						value: c ? d : l,
						"aria-label": c ? "Search projects" : "Search sessions",
						onChange: (e) => c ? o(e.target.value) : u(e.target.value)
					})
				}), /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-0.5",
					children: [
						c ? /* @__PURE__ */ Y(Zc, {
							onClick: r.newProject,
							children: [/* @__PURE__ */ J(M, { iconName: L.Add }), /* @__PURE__ */ J("span", {
								className: "text-left flex-grow",
								children: r.createLabel
							})]
						}) : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Xp, {
							projectId: r.projectId,
							onUnavailable: r.newSession,
							className: "w-full",
							children: (e) => /* @__PURE__ */ Y(Zc, {
								onClick: e,
								children: [
									/* @__PURE__ */ J(M, { iconName: L.Add }),
									/* @__PURE__ */ J("span", {
										className: "text-left flex-grow",
										children: "New Session"
									}),
									/* @__PURE__ */ J(M, { iconName: L.Right })
								]
							})
						}), /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ Y(Zc, {
								className: "flex-1 !w-auto",
								onClick: r.openProjects,
								children: [/* @__PURE__ */ J(M, { iconName: L.Folders }), /* @__PURE__ */ J("span", {
									className: "text-left flex-grow truncate",
									children: "All projects"
								})]
							}), /* @__PURE__ */ J(Zn, {
								title: "Create a new project",
								position: z.CenterRight,
								sticky: !0,
								children: /* @__PURE__ */ J(s, {
									variant: I.Ghost,
									content: R.Icon,
									"aria-label": "New project",
									onClick: r.newProject,
									children: /* @__PURE__ */ J(M, { iconName: L.AddCircle })
								})
							})]
						})] }),
						/* @__PURE__ */ Y(Zc, {
							onClick: r.openMcp,
							"aria-label": r.mcpLabel,
							children: [
								/* @__PURE__ */ J(M, { iconName: L.Toolbox }),
								/* @__PURE__ */ J("span", {
									className: "text-left flex-grow",
									children: "MCP"
								}),
								r.activeMcp > 0 ? /* @__PURE__ */ J(Si, {
									text: `${r.activeMcp} ACTIVE`,
									color: xi.Blue
								}) : null
							]
						}),
						/* @__PURE__ */ Y(Zc, {
							onClick: r.openSsh,
							children: [
								/* @__PURE__ */ J(M, { iconName: L.Globe }),
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
				children: /* @__PURE__ */ J(qp, {
					sessions: f,
					showSearch: !1,
					sidebar: !0
				})
			}) : /* @__PURE__ */ J("div", {
				className: "flex-1 min-h-0 overflow-y-auto",
				children: /* @__PURE__ */ J($p, {
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
						children: [/* @__PURE__ */ Y(Zc, {
							onClick: r.openConfigurations,
							children: [/* @__PURE__ */ J(M, { iconName: L.Gear }), /* @__PURE__ */ J("span", {
								className: "text-left flex-grow",
								children: "Configurations"
							})]
						}), /* @__PURE__ */ Y(Zc, {
							onClick: r.openManaged,
							children: [/* @__PURE__ */ J(M, { iconName: L.Server }), /* @__PURE__ */ J("span", {
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
							/* @__PURE__ */ J(an, {
								value: h,
								size: F.Small,
								variant: I.Tertiary,
								title: "Copy the store path",
								disabled: !h,
								position: z.TopLeft,
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
function im({ commands: e, onToggle: t, toggleKeys: n, variant: r }) {
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
					children: /* @__PURE__ */ J(fc, {
						markOnly: !0,
						height: 25
					})
				}),
				/* @__PURE__ */ J(am, {
					label: "Show sidebar",
					keys: n,
					onClick: t,
					children: /* @__PURE__ */ J(M, { iconName: L.SidebarChevronRight })
				}),
				i ? null : /* @__PURE__ */ J(am, {
					label: "All projects",
					onClick: e.openProjects,
					children: /* @__PURE__ */ J(M, { iconName: L.Folders })
				}),
				i ? /* @__PURE__ */ J(am, {
					label: e.createLabel,
					onClick: e.newProject,
					children: /* @__PURE__ */ J(M, { iconName: L.Add })
				}) : /* @__PURE__ */ J(Xp, {
					projectId: e.projectId,
					onUnavailable: e.newSession,
					children: (e) => /* @__PURE__ */ J(am, {
						label: "New session",
						onClick: e,
						children: /* @__PURE__ */ J(M, { iconName: L.Add })
					})
				}),
				/* @__PURE__ */ J(am, {
					label: e.mcpLabel,
					onClick: e.openMcp,
					children: /* @__PURE__ */ J(M, { iconName: L.Toolbox })
				}),
				/* @__PURE__ */ J(am, {
					label: "SSH",
					onClick: e.openSsh,
					children: /* @__PURE__ */ J(M, { iconName: L.Globe })
				})
			]
		}), /* @__PURE__ */ Y("div", {
			className: "flex flex-col items-center gap-1 [&>*]:shrink-0",
			children: [/* @__PURE__ */ J(am, {
				label: "Configurations",
				onClick: e.openConfigurations,
				children: /* @__PURE__ */ J(M, { iconName: L.Gear })
			}), /* @__PURE__ */ J(am, {
				label: "Managed host",
				onClick: e.openManaged,
				children: /* @__PURE__ */ J(M, { iconName: L.Server })
			})]
		})]
	});
}
function am({ label: e, keys: t, onClick: n, children: r }) {
	return /* @__PURE__ */ J(Zn, {
		title: e,
		keyboardShortcuts: t,
		position: z.CenterRight,
		sticky: !0,
		children: /* @__PURE__ */ J(s, {
			variant: I.Ghost,
			content: R.Icon,
			"aria-label": e,
			onClick: n,
			children: r
		})
	});
}
//#endregion
//#region src/app/components/LeftSidebar/useSidebarCommands.tsx
function om() {
	let [e, t] = K(!1), [n, r] = K(!1), [i, a] = K(!1), { pathname: o } = di(), s = fi(), c = Df(), l = Lp(), { data: u = [] } = Xt(), { data: d } = rn(), { data: f } = Rt(), p = Kt(o), m = p != null && u.some((e) => e.summary.session_id === p), h = kn(o) ?? u.find((e) => e.summary.session_id === p)?.summary.project_id ?? null, g = d?.servers.filter((e) => e.enabled).length ?? 0;
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
		openProjects: () => s(_r.list()),
		openMcp: () => a(!0),
		openSsh: () => r(!0),
		openConfigurations: () => t(!0),
		openManaged: l.openSettings,
		modals: /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(op, {
				open: e,
				onClose: () => t(!1)
			}),
			/* @__PURE__ */ J(Np, {
				open: n,
				onClose: () => r(!1)
			}),
			/* @__PURE__ */ J(kp, {
				open: i,
				onClose: () => a(!1)
			})
		] })
	};
}
var sm = [kt, "h"];
function cm({ variant: e = "session" }) {
	let { setSidebarOffset: t, storedOpen: n, storeOpen: r } = B().stores.sidebarLayoutStore, i = g(), a = Ye(), [o, s] = K(null), c = o ?? n() ?? a, l = H(() => {
		s((e) => {
			let t = !(e ?? n() ?? a);
			return r(t), t;
		});
	}, [
		a,
		n,
		r
	]), u = om();
	return Qr(() => {
		t(i ? 0 : c ? 320 : 52);
	}, [
		i,
		c,
		t
	]), Qr(() => () => t(0), [t]), wf([{
		keys: sm,
		onTrigger: l,
		enabled: !i
	}]), i ? null : /* @__PURE__ */ Y("div", {
		"data-sidebar": "true",
		className: V("relative h-full shrink-0 transition-[width] duration-500 ease-in-out", c ? "w-[320px]" : "w-[52px]"),
		children: [
			c ? null : /* @__PURE__ */ J("div", {
				className: "absolute inset-y-0 left-0 w-[52px]",
				children: /* @__PURE__ */ J(im, {
					commands: u,
					onToggle: l,
					toggleKeys: sm,
					variant: e
				})
			}),
			/* @__PURE__ */ J("div", {
				className: V("absolute inset-y-0 z-[1] h-full w-[320px] transition-[left] duration-500 ease-in-out", c ? "left-0" : "left-[-320px]"),
				"aria-hidden": !c,
				inert: !c,
				children: /* @__PURE__ */ J(rm, {
					isOpen: c,
					commands: u,
					onToggle: l,
					toggleKeys: sm,
					variant: e
				})
			}),
			u.modals
		]
	});
}
//#endregion
//#region src/app/components/pages/DesignPreviewPage.tsx
var lm = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
], um = [
	{
		id: "sonnet",
		label: "Claude Sonnet",
		icon: L.Brain
	},
	{
		id: "opus",
		label: "Claude Opus",
		icon: L.Brain
	},
	{
		id: "gpt",
		label: "GPT",
		icon: L.Ai
	}
], dm = "pub enum AgentEvent {\n    RunStarted { thread_name: Option<String> },\n    AssistantMessage {\n        thread_name: Option<String>,\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { thread_name: Option<String> },\n}";
function fm() {
	let [e, t] = K("sonnet"), [n, r] = K(!0), [i, a] = K(!1), [o, c] = K(!1), [l, u] = K(!0), [d, f] = K("first"), [p, m] = K("Port the ArceeFM atoms"), [h, g] = K(4), [_, v] = K(.7), [y, b] = K(["local"]), [x, S] = K(1), [C, w] = K(null), [T, E] = K({
		from: null,
		to: null
	});
	return /* @__PURE__ */ Y("div", {
		className: "min-h-full bg-elevation-ground text-basic-primary",
		children: [
			/* @__PURE__ */ Y("header", {
				className: "flex items-center gap-4 h-14 px-6 border-b border-secondary",
				children: [/* @__PURE__ */ J(fc, { height: 18 }), /* @__PURE__ */ J("span", {
					className: "text-basic-muted label-small",
					children: "design system"
				})]
			}),
			/* @__PURE__ */ Y("main", {
				className: "p-6 flex flex-col gap-6 max-w-[1100px]",
				children: [
					/* @__PURE__ */ J(Ci, {
						title: "Buttons",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-3",
							children: [
								/* @__PURE__ */ J(s, {
									variant: I.Primary,
									children: "Primary"
								}),
								/* @__PURE__ */ J(s, {
									variant: I.Secondary,
									children: "Secondary"
								}),
								/* @__PURE__ */ J(s, {
									variant: I.Tertiary,
									children: "Tertiary"
								}),
								/* @__PURE__ */ J(s, {
									variant: I.Ghost,
									children: "Ghost"
								}),
								/* @__PURE__ */ J(s, {
									variant: I.GhostDestructive,
									children: "Destructive"
								}),
								/* @__PURE__ */ J(s, {
									variant: I.Primary,
									loading: !0,
									children: "Loading"
								}),
								/* @__PURE__ */ J(s, {
									variant: I.Secondary,
									disabled: !0,
									children: "Disabled"
								}),
								/* @__PURE__ */ Y(s, {
									variant: I.Secondary,
									content: R.IconLeft,
									children: [/* @__PURE__ */ J(M, { iconName: L.Add }), "With icon"]
								})
							]
						})
					}),
					/* @__PURE__ */ J(Ci, {
						title: "Badges, loader, switch, tooltip",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-4",
							children: [
								/* @__PURE__ */ J(Si, {
									text: "Running",
									color: xi.Green
								}),
								/* @__PURE__ */ J(Si, {
									text: "Queued",
									color: xi.Blue
								}),
								/* @__PURE__ */ J(Si, {
									text: "Failed",
									color: xi.Red
								}),
								/* @__PURE__ */ J(Si, {
									text: "Idle",
									color: xi.Gray
								}),
								/* @__PURE__ */ J(Le, { size: A.Small }),
								/* @__PURE__ */ J(ll, {
									checked: n,
									onChange: r
								}),
								/* @__PURE__ */ J(Zn, {
									title: "Pin session",
									description: "Keeps the card at the top of the board.",
									position: z.BottomCenter,
									sticky: !0,
									showTooltipOnMobile: !0,
									children: /* @__PURE__ */ J(M, { iconName: L.Pin })
								}),
								/* @__PURE__ */ J(M, { iconName: L.Unpin })
							]
						})
					}),
					/* @__PURE__ */ J(Ci, {
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
									leading: qs.Icon,
									leadingIconName: L.Search,
									placeholder: "Filter sessions",
									hintText: "Matches name and cwd",
									className: "w-[280px]"
								}),
								/* @__PURE__ */ J($c, {
									items: um,
									value: e,
									onValueChange: t,
									placeholder: "Pick a model"
								}),
								/* @__PURE__ */ J(s, {
									variant: I.Secondary,
									onClick: () => a(!0),
									children: "Open modal"
								})
							]
						})
					}),
					/* @__PURE__ */ J(Ci, {
						title: "Popover, copy, shortcuts",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-4",
							children: [
								/* @__PURE__ */ J(Ln, {
									open: o,
									onClose: () => c(!1),
									placement: z.BottomRight,
									sticky: !0,
									content: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("div", {
										className: "label-small text-basic-primary px-2 py-1",
										children: "Anchored panel"
									}), /* @__PURE__ */ J("div", {
										className: "text-micro text-basic-muted px-2 pb-1",
										children: "Closes on Escape or a click outside. On a phone it becomes a bottom sheet instead."
									})] }),
									children: /* @__PURE__ */ J(s, {
										variant: I.Secondary,
										onClick: () => c((e) => !e),
										children: "Open popover"
									})
								}),
								/* @__PURE__ */ J(an, { value: "nac" }),
								/* @__PURE__ */ J(un, { keys: [
									"cmd",
									"shift",
									"k"
								] })
							]
						})
					}),
					/* @__PURE__ */ J(Ci, {
						title: "Choices and multi-line input",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-start gap-6",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2",
									children: [/* @__PURE__ */ J(zi, {
										checked: l,
										onChange: u,
										children: "Skip permission prompts"
									}), /* @__PURE__ */ J(zi, {
										checked: !1,
										onChange: () => {},
										disabled: !0,
										children: "Disabled"
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2",
									children: [/* @__PURE__ */ J(Gc, {
										name: "preview-choice",
										checked: d === "first",
										onChange: () => f("first"),
										children: "Working tree"
									}), /* @__PURE__ */ J(Gc, {
										name: "preview-choice",
										checked: d === "second",
										onChange: () => f("second"),
										children: "Latest snapshot"
									})]
								}),
								/* @__PURE__ */ J(oc, {
									label: "System prompt",
									rows: 3,
									placeholder: "Extra instructions for the agent",
									className: "w-[320px]"
								})
							]
						})
					}),
					/* @__PURE__ */ J(Ci, {
						title: "Notices and loaders",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-4",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-wrap gap-3",
									children: [
										/* @__PURE__ */ J(Sc, {
											variant: pc.Info,
											title: "Read-only snapshot",
											className: "w-[280px]",
											children: "Pick the working tree to edit files again."
										}),
										/* @__PURE__ */ J(Sc, {
											variant: pc.Error,
											title: "Run failed",
											className: "w-[280px]",
											children: "The provider rejected the request."
										}),
										/* @__PURE__ */ J(Sc, {
											variant: pc.Success,
											title: "Branch switched",
											className: "w-[280px]"
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2 w-[398px]",
									children: [
										/* @__PURE__ */ J(Ni, {
											variant: ki.Danger,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										}),
										/* @__PURE__ */ J(Ni, {
											variant: ki.Error,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										}),
										/* @__PURE__ */ J(Ni, {
											variant: ki.Success,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										}),
										/* @__PURE__ */ J(Ni, {
											variant: ki.Info,
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
										/* @__PURE__ */ J(cc, { size: A.Medium }),
										/* @__PURE__ */ J(Li, {
											rows: 3,
											className: "w-[200px]"
										}),
										/* @__PURE__ */ J(lc, {
											active: !0,
											className: "w-[200px]"
										})
									]
								})
							]
						})
					}),
					/* @__PURE__ */ J(Ci, {
						title: "Session avatars",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-4",
							children: [lm.map((e) => /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ J(Hc, {
									id: e,
									size: 40
								}), /* @__PURE__ */ J("span", {
									className: "code code-small text-basic-muted",
									children: e
								})]
							}, e)), /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ J(Ii, {}), /* @__PURE__ */ J("span", {
									className: "code code-small text-basic-muted",
									children: "unassigned"
								})]
							})]
						})
					}),
					/* @__PURE__ */ J(Ci, {
						title: "Project navigation",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-6",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex items-start gap-2",
									children: [
										/* @__PURE__ */ J(Ri, {
											title: "Fix the parser",
											active: !0
										}),
										/* @__PURE__ */ J(Ri, { title: "Rewrite the store layer" }),
										/* @__PURE__ */ J(Ri, {
											title: "Investigating",
											running: !0
										}),
										/* @__PURE__ */ J(Ri, {
											title: "Fork: Fix the parser",
											forkedFromTitle: "Fix the parser"
										}),
										/* @__PURE__ */ J(Ri, {
											title: "Fork running",
											forkedFromTitle: "Fix the parser",
											running: !0
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1 max-w-[320px]",
									children: [
										/* @__PURE__ */ J(Oi, {
											title: "Fix the parser",
											active: !0
										}),
										/* @__PURE__ */ J(Oi, { title: "Rewrite the store layer" }),
										/* @__PURE__ */ J(Oi, {
											title: "Investigating",
											running: !0
										}),
										/* @__PURE__ */ J(Oi, {
											title: "Fork: Fix the parser",
											forkedFromTitle: "Fix the parser"
										}),
										/* @__PURE__ */ J(Oi, {
											title: "Fork running",
											forkedFromTitle: "Fix the parser",
											running: !0
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2 max-w-[320px]",
									children: [/* @__PURE__ */ J(Gs, {
										sessionId: "14231vsd7897-aaaa",
										title: "Fork: Session title"
									}), /* @__PURE__ */ J(Gs, {
										sessionId: "14231vsd7897-aaaa",
										title: "Fork: Session title",
										deleted: !0
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1 max-w-[320px]",
									children: [
										/* @__PURE__ */ J(Wc, {
											entityId: lm[3],
											name: "arcee-ai/nac",
											trailing: "4",
											active: !0
										}),
										/* @__PURE__ */ J(Wc, {
											entityId: lm[4],
											name: "arcee-ai/telos",
											trailing: "1",
											running: !0
										}),
										/* @__PURE__ */ J(Wc, {
											entityId: lm[5],
											name: "Unassigned session",
											variant: Uc.Orphan
										})
									]
								})
							]
						})
					}),
					/* @__PURE__ */ J(Ci, {
						title: "Avatars and editable header",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-4",
							children: [/* @__PURE__ */ Y("div", {
								className: "flex flex-wrap items-center gap-4",
								children: [
									/* @__PURE__ */ J(bi, {
										name: "Aleksy",
										size: yi.Small
									}),
									/* @__PURE__ */ J(bi, { name: "NAC Orchestrator" }),
									/* @__PURE__ */ J(bi, {
										name: "Opus",
										size: yi.Large
									}),
									/* @__PURE__ */ J(bi, {
										name: "🛠",
										glyph: !0,
										size: yi.Large
									}),
									/* @__PURE__ */ J(bi, {
										name: "Anthropic",
										size: yi.XLarge,
										color: "var(--color-bg-info-primary)"
									})
								]
							}), /* @__PURE__ */ J(va, {
								value: p,
								onCommit: m,
								size: _a.Medium,
								className: "max-w-[360px]"
							})]
						})
					}),
					/* @__PURE__ */ J(Ci, {
						title: "Numeric inputs, tags and pagination",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-6",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-wrap items-center gap-8",
									children: [/* @__PURE__ */ J(kc, {
										value: h,
										onChange: g,
										min: 1,
										max: 16,
										"aria-label": "Parallel threads"
									}), /* @__PURE__ */ Y("div", {
										className: "flex items-center gap-4 w-[320px]",
										children: [/* @__PURE__ */ J(Jc, {
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
								/* @__PURE__ */ J(ul, {
									tags: [
										"local",
										"docker",
										"remote",
										"sandbox"
									],
									selected: y,
									onChange: b
								}),
								/* @__PURE__ */ J(Ac, {
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
					/* @__PURE__ */ J(Ci, {
						title: "Dates",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-start gap-6",
							children: [
								/* @__PURE__ */ J(ha, {
									label: "Created after",
									value: C,
									onChange: w,
									className: "w-[240px]"
								}),
								/* @__PURE__ */ J(ha, {
									label: "Window",
									range: T,
									onRangeChange: E,
									hintText: "Two clicks pick the ends.",
									className: "w-[280px]"
								}),
								/* @__PURE__ */ J(ia, {
									selected: C ? /* @__PURE__ */ new Date(`${C}T00:00:00`) : void 0,
									onSelect: (e) => w(`${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`),
									className: "rounded-[8px] border border-muted bg-elevation-level-2"
								})
							]
						})
					}),
					/* @__PURE__ */ J(Ci, {
						title: "Code block and chat loader",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-4",
							children: [/* @__PURE__ */ J(Pt, {
								code: dm,
								language: "rust",
								title: "events.rs",
								lineNumbers: !0,
								expandable: !0,
								maxHeight: "220px"
							}), /* @__PURE__ */ J(Ei, {})]
						})
					}),
					/* @__PURE__ */ J(Ci, {
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
			/* @__PURE__ */ J(ur, {
				open: i,
				onClose: () => a(!1),
				title: "Delete session",
				footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(s, {
					variant: I.Secondary,
					onClick: () => a(!1),
					children: "Cancel"
				}), /* @__PURE__ */ J(s, {
					variant: I.SecondaryDestructive,
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
var pm = /* @__PURE__ */ new Map();
function mm() {
	let { projectId: e = "" } = pi(), t = Df(), n = ct(), r = ot(), i = Xt(), [a, o] = K(null), s = r.refetch, c = i.refetch;
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
	let l = W(() => r.data?.projects.find((t) => t.project_id === e) ?? null, [r.data, e]), u = W(() => vl(re(n, i.data ?? []), e), [
		i.data,
		e,
		n
	]), d = r.isLoading || i.isLoading, f = r.isFetching || i.isFetching, p = r.isError || i.isError, m = r.isSuccess && i.isSuccess, h = a === e && !d && !f && !p && m && l != null && u == null, g = t.newChat;
	U(() => {
		if (!h) return;
		let t = pm.get(e);
		t || (t = g(e, it(n, i.data ?? [], e)).finally(() => {
			pm.delete(e);
		}), pm.set(e, t));
	}, [
		h,
		g,
		e,
		n,
		i.data
	]);
	let _ = a === e;
	return _ && !d && !l ? /* @__PURE__ */ J(si, {
		to: _r.list(),
		replace: !0
	}) : _ && u ? /* @__PURE__ */ J(si, {
		to: _r.session(u.summary.session_id),
		replace: !0
	}) : /* @__PURE__ */ J("div", {
		className: "flex h-full items-center justify-center",
		children: /* @__PURE__ */ J(Le, { size: A.Large })
	});
}
//#endregion
//#region src/app/components/projects/ProjectCardActions.tsx
function hm({ title: e, icon: t, onClick: n, variant: r = I.Ghost, disabled: i = !1 }) {
	return /* @__PURE__ */ J(Zn, {
		title: e,
		position: z.TopCenter,
		sticky: !0,
		children: /* @__PURE__ */ J(s, {
			variant: r,
			size: F.Small,
			content: R.Icon,
			"aria-label": e,
			disabled: i,
			onClick: (e) => {
				e.stopPropagation(), n();
			},
			children: /* @__PURE__ */ J(M, { iconName: t })
		})
	});
}
function gm({ orphan: e, pinned: t, onDelete: n, onTogglePin: r, onRename: i, onAssign: a, reorder: o }) {
	return /* @__PURE__ */ Y("div", {
		className: o ? "flex items-center gap-1.5 shrink-0" : "flex items-center gap-4 xl:gap-1.5 shrink-0",
		children: [o ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(hm, {
			title: "Move down",
			icon: L.ArrowDown,
			disabled: !o.canMoveDown,
			onClick: o.onMoveDown
		}), /* @__PURE__ */ J(hm, {
			title: "Move up",
			icon: L.ArrowTop,
			disabled: !o.canMoveUp,
			onClick: o.onMoveUp
		})] }) : null, e ? /* @__PURE__ */ Y(q, { children: [
			i ? /* @__PURE__ */ J(hm, {
				title: "Edit",
				icon: L.Edit,
				onClick: i
			}) : null,
			a ? /* @__PURE__ */ J(hm, {
				title: "Assign to project",
				icon: L.FolderOpen,
				onClick: a
			}) : null,
			/* @__PURE__ */ J(hm, {
				title: "Delete chat",
				icon: L.Trash,
				variant: I.GhostDestructive,
				onClick: n
			})
		] }) : /* @__PURE__ */ Y(q, { children: [
			r ? /* @__PURE__ */ J(hm, {
				title: t ? "Unpin project" : "Pin project",
				icon: t ? L.Unpin : L.Pin,
				onClick: r
			}) : null,
			i ? /* @__PURE__ */ J(hm, {
				title: "Rename project",
				icon: L.Edit,
				onClick: i
			}) : null,
			/* @__PURE__ */ J(hm, {
				title: "Remove project",
				icon: L.Trash,
				variant: I.GhostDestructive,
				onClick: n
			})
		] })]
	});
}
//#endregion
//#region src/app/components/projects/ProjectCard.tsx
var _m = {
	default: "--color-bg-btn-ghost",
	hovered: "--color-bg-btn-ghost-hovered",
	pressed: "--color-bg-btn-ghost-pressed",
	highlighted: "--color-bg-btn-ghost-highlighted",
	highlightedHovered: "--color-bg-btn-ghost-highlighted-hovered",
	highlightedPressed: "--color-bg-btn-ghost-highlighted-pressed"
};
function vm({ highlighted: e, hover: t, pressed: n }) {
	return n ? e ? _m.highlightedPressed : _m.pressed : t ? e ? _m.highlightedHovered : _m.hovered : e ? _m.highlighted : _m.default;
}
function ym(e, t) {
	if (e.kind === "project") {
		let { project: t, sessions: n, running: r, totalCostMicros: i } = e.entry, a = n.find((e) => Dt(e.active_run));
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
	let { summary: n, active_run: r } = e.session, i = Dt(r);
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
function bm({ facts: e }) {
	let t = e.costMicros > 0 ? qt(e.costMicros) : null;
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
function xm({ facts: e }) {
	let t = Zt(e.representative?.backend);
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-wrap items-center gap-2.5 min-w-0 whitespace-nowrap",
		children: [/* @__PURE__ */ J("span", {
			className: "label-micro text-basic-tertiary",
			children: Nr(e.representative)
		}), t ? /* @__PURE__ */ J("span", {
			className: "text-micro text-basic-muted truncate md:max-w-[128px]",
			children: t
		}) : null]
	});
}
function Sm({ getCardElement: e, onReorderStart: t }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		"aria-label": "Drag to reorder",
		className: V("absolute right-1.5 top-1/2 z-1 -translate-y-1/2", "flex h-6 items-center gap-[3px]", "cursor-grab active:cursor-grabbing touch-none", "rounded-sm border-0 bg-transparent p-0"),
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
function Cm({ item: e, selected: t, attention: n, onOpen: r, onDelete: i, onTogglePin: a, onRename: o, onAssign: s, reorder: c, dragging: l = !1 }) {
	let u = ym(e, ml()), d = u.representative?.model_config_error, f = g(), p = Ye(), [m, h] = K(!1), [_, v] = K(!1), [y, b] = K(!1), x = G(!1), S = G(null), C = !p || m || _ || t, w = !!c && p, T = !!c && !p, E = p && m, D = () => {
		if (x.current) {
			x.current = !1;
			return;
		}
		r();
	};
	return /* @__PURE__ */ Y("div", {
		ref: S,
		"data-item-id": u.id,
		"data-item-kind": u.orphan ? "orphan" : "project",
		"data-item-pinned": u.pinned ? "true" : "false",
		className: V("group fade relative flex flex-col rounded-[8px] overflow-hidden cursor-default", f ? "gap-4 px-4 pt-4 pb-2" : "gap-4 px-6 pt-5 pb-3", "shadow-convex bg-elevation-level-1", l && "shadow-lg"),
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
			h(!1), b(!1);
		},
		onFocus: () => v(!0),
		onBlur: () => v(!1),
		onPointerDown: (e) => {
			e.button === 0 && !e.target.closest("button, a, input, textarea") && b(!0);
		},
		onPointerUp: () => b(!1),
		onPointerCancel: () => b(!1),
		children: [
			/* @__PURE__ */ J("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none ease-out",
				style: { backgroundColor: `var(${vm({
					highlighted: u.running,
					hover: E,
					pressed: y
				})})` }
			}),
			t || _ || l ? /* @__PURE__ */ J("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none border-2",
				style: { borderColor: "var(--blue-500)" }
			}) : null,
			n ? /* @__PURE__ */ J(Zn, {
				title: "Run finished",
				position: z.BottomLeft,
				sticky: !0,
				className: "absolute left-2 top-2 z-1",
				children: /* @__PURE__ */ J("span", { className: "block size-2 rounded-full bg-accent-primary" })
			}) : null,
			w && c ? /* @__PURE__ */ J(Sm, {
				getCardElement: () => S.current,
				onReorderStart: (e) => {
					x.current = !0, c.onReorderStart(e), window.setTimeout(() => {
						x.current = !1;
					}, 100);
				}
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: "relative flex items-center gap-4 w-full",
				children: [u.orphan ? /* @__PURE__ */ J(Ii, { isRunning: u.running }) : /* @__PURE__ */ J(Hc, {
					id: u.id,
					size: 40,
					isRunning: u.running
				}), /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-0.5 flex-1 min-w-0",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-1.5 w-full",
						children: [
							u.pinned ? /* @__PURE__ */ J(M, {
								iconName: L.Pin,
								className: "text-basic-secondary shrink-0"
							}) : null,
							/* @__PURE__ */ J("div", {
								className: V("header-md flex-1 min-w-0 truncate", u.running ? "text-shimmer-basic" : "text-basic-primary"),
								children: u.title
							}),
							d ? /* @__PURE__ */ J(Zn, {
								title: d,
								position: z.BottomRight,
								sticky: !0,
								children: /* @__PURE__ */ J(M, {
									iconName: L.Repair,
									className: "text-error-primary shrink-0"
								})
							}) : null,
							u.running ? u.orphan ? /* @__PURE__ */ J(Le, {
								size: A.Micro,
								className: "shrink-0"
							}) : /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-1 shrink-0",
								children: [/* @__PURE__ */ J(Le, { size: A.XSmall }), /* @__PURE__ */ Y("span", {
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
			p ? null : /* @__PURE__ */ J(xm, { facts: u }),
			/* @__PURE__ */ Y("div", {
				className: "relative flex items-center justify-between w-full h-6 gap-2",
				children: [/* @__PURE__ */ J(bm, { facts: u }), C ? /* @__PURE__ */ J(gm, {
					orphan: u.orphan,
					pinned: u.pinned,
					onTogglePin: a,
					onRename: o,
					onDelete: i,
					onAssign: s,
					reorder: T && c ? {
						canMoveUp: c.canMoveUp,
						canMoveDown: c.canMoveDown,
						onMoveUp: c.onMoveUp,
						onMoveDown: c.onMoveDown
					} : void 0
				}) : /* @__PURE__ */ J(xm, { facts: u })]
			})
		]
	});
}
//#endregion
//#region src/app/components/projects/ProjectsEmptyState.tsx
function wm({ onStart: e, onAddRepository: t, onManagedSettings: n, modelReady: r, githubConnected: i, mobile: a }) {
	let o = t != null;
	return /* @__PURE__ */ J("div", {
		className: V("flex h-full flex-col items-center justify-center py-16", a ? "px-4" : "px-6"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex w-[420px] max-w-full flex-col items-center gap-6",
			children: [
				/* @__PURE__ */ J(nl, {}),
				/* @__PURE__ */ Y("div", {
					className: "w-full text-center",
					children: [/* @__PURE__ */ J("p", {
						className: "header-2xl text-basic-primary",
						children: "No projects yet"
					}), /* @__PURE__ */ J("p", {
						className: "text-medium text-basic-tertiary",
						children: o ? "Connect a repository or create a Project from an existing path." : "Create your first and start building!"
					})]
				}),
				o ? /* @__PURE__ */ Y("div", {
					className: "grid w-full grid-cols-1 gap-2 rounded-lg border border-basic p-4 text-left sm:grid-cols-3",
					"data-testid": "managed-empty-status",
					children: [
						/* @__PURE__ */ J(Tm, {
							label: "Arcee model",
							value: r ? "Ready" : "Needs attention",
							ready: !!r
						}),
						/* @__PURE__ */ J(Tm, {
							label: "GitHub",
							value: i ? "Connected" : "Not connected",
							ready: !!i
						}),
						/* @__PURE__ */ J(Tm, {
							label: "Projects",
							value: "None",
							ready: !1
						})
					]
				}) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-wrap justify-center gap-2",
					children: [
						/* @__PURE__ */ J(s, {
							variant: I.Primary,
							size: F.Large,
							content: R.Text,
							onClick: o ? t : e,
							children: o ? "Add repository" : "Get Started"
						}),
						o ? /* @__PURE__ */ J(s, {
							variant: I.Secondary,
							size: F.Large,
							content: R.Text,
							onClick: e,
							children: "Create Project"
						}) : null,
						o && !i && n ? /* @__PURE__ */ J(s, {
							variant: I.Tertiary,
							size: F.Large,
							content: R.Text,
							onClick: n,
							children: "Connect GitHub"
						}) : null
					]
				})
			]
		})
	});
}
function Tm({ label: e, value: t, ready: n }) {
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
function Em({ children: e, single: t }) {
	return /* @__PURE__ */ J("div", {
		className: V("grid gap-2", t ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]"),
		children: e
	});
}
function Dm() {
	return /* @__PURE__ */ J("div", {
		"aria-hidden": !0,
		className: "min-h-[112px] rounded-[8px] border-2",
		style: { borderColor: "var(--blue-500)" }
	});
}
function Om(e) {
	return e.kind === "project" ? e.entry.sessions.map((e) => e.summary.session_id) : [e.session.summary.session_id];
}
function km(e) {
	return e.kind === "project" && e.entry.project.pinned;
}
function Am({ item: e, onOpen: t, reorderable: n, dragging: r, canMoveUp: i, canMoveDown: a, onMoveUp: o, onMoveDown: s, onReorderStart: c }) {
	let { useAnyAttention: l } = B().stores.attentionStore, u = Df(), d = Vf(), f = {
		item: e,
		selected: !1,
		attention: l(Om(e)),
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
		return /* @__PURE__ */ J(Cm, {
			...f,
			onTogglePin: () => void u.togglePin(t),
			onRename: () => u.rename(t),
			onDelete: () => u.remove(t)
		});
	}
	let { summary: p } = e.session;
	return /* @__PURE__ */ J(Cm, {
		...f,
		onRename: () => d.rename(p),
		onDelete: () => d.remove(p),
		onAssign: () => u.assign(p)
	});
}
function jm(e, t, n, r) {
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
function Mm(e, t) {
	return e.filter((e) => e.pinned === t).sort((e, t) => e.sort_order - t.sort_order);
}
function Nm() {
	let { useVisibleProjectItems: e, useIsDefaultSort: t, useFilterQuery: n, setQuery: r } = B().stores.sessionFiltersStore, { trackAttention: i, clearAttentionAll: a } = B().stores.attentionStore, o = fi(), c = g(), u = Df(), d = Lp(), f = _n(), p = n(), m = t(), h = l(), _ = Ft(), [v, y] = K(!1), [b, x] = K(null), [S, C] = K(null), [w, T] = K(!1), E = G(null), D = G(null), O = G(!1), { data: k, isLoading: A, error: ee, refetch: te } = on(), ne = ot(), ie = ct(), ae = W(() => re(ie, k ?? []), [k, ie]), oe = W(() => ne.data?.projects ?? [], [ne.data]), se = W(() => Cl(oe, ae), [oe, ae]), ce = e(se);
	U(() => {
		k && i(k, null);
	}, [k, i]);
	let le = (e) => {
		let t = Sl(e);
		a(Om(e)), o(e.kind === "project" ? _r.project(t) : _r.session(t));
	}, ue = ce.filter(km), de = ce.filter((e) => e.kind === "project" && !km(e)), fe = ce.filter((e) => e.kind === "orphan"), pe = W(() => Mm(oe, !0), [oe]), me = W(() => Mm(oe, !1), [oe]), j = W(() => xl(ae), [ae]), he = W(() => Ne(ae, !1), [ae]), ge = H(() => {
		E.current = null, D.current = null, O.current = !1, x(null), C(null), T(!1);
	}, []), _e = H(async (e, t, n) => {
		let r = Mm(oe, t).findIndex((t) => t.project_id === e), i = oe.find((t) => t.project_id === e);
		if (i && i.pinned === t && r === n) {
			ge();
			return;
		}
		try {
			await h.mutateAsync({
				projects: oe,
				projectId: e,
				targetPinned: t,
				targetIndex: n
			});
		} catch (e) {
			f.error(`Failed to reorder projects: ${nr($(e))}`);
		} finally {
			ge();
		}
	}, [
		oe,
		ge,
		h,
		f
	]), ve = H(async (e, t) => {
		try {
			await _.mutateAsync({
				sessions: ae,
				sessionId: e,
				targetPinned: !1,
				targetIndex: t
			});
		} catch (e) {
			f.error(`Failed to reorder chats: ${nr($(e))}`);
		} finally {
			ge();
		}
	}, [
		ae,
		ge,
		_,
		f
	]), ye = H(async (e, t) => {
		let n = ae.find((t) => t.summary.session_id === e), r = oe.find((e) => e.project_id === t);
		if (!n || !r) {
			ge();
			return;
		}
		if (Dl(oe, n.summary)?.project_id !== r.project_id) {
			f.error("That chat does not run in this project's location"), ge();
			return;
		}
		try {
			u.assign(n.summary);
		} finally {
			ge();
		}
	}, [
		ae,
		ge,
		u,
		oe,
		f
	]), be = H((e, t) => {
		let n = e.pinned ? pe : me, r = n.findIndex((t) => t.project_id === e.project_id);
		if (r < 0) return;
		let i = r + t;
		i < 0 || i >= n.length || _e(e.project_id, e.pinned, i);
	}, [
		pe,
		me,
		_e
	]), xe = H((e, t) => {
		let n = j.findIndex((t) => t.summary.session_id === e), r = n < 0 ? void 0 : j[n + t];
		if (!r) return;
		let i = On(he, r.summary.session_id, t === -1 ? "before" : "after", e);
		ve(e, i);
	}, [
		j,
		he,
		ve
	]), N = H((e, t, n) => {
		if (t === "orphan") {
			let t = oe.find((e) => e.project_id === n.itemId);
			if (t) {
				ye(e, t.project_id);
				return;
			}
			if (n.itemId === e) {
				ge();
				return;
			}
			let r = On(he, n.itemId, n.edge, e);
			ve(e, r);
			return;
		}
		let r = oe.find((e) => e.project_id === n.itemId);
		if (!r || n.itemId === e) {
			ge();
			return;
		}
		let i = Mm(oe, r.pinned).map((e) => e.project_id).filter((t) => t !== e).indexOf(n.itemId);
		if (i < 0) {
			ge();
			return;
		}
		_e(e, r.pinned, n.edge === "before" ? i : i + 1);
	}, [
		ye,
		ge,
		he,
		ve,
		_e,
		oe
	]), Se = H((e) => {
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
			let r = jm(e.clientX, e.clientY, t.itemId, t.kind);
			if (r === "pin-zone") {
				O.current = !0, D.current = null, T(!0), C(null);
				return;
			}
			O.current = !1, T(!1), r && (D.current = r, C((e) => e?.itemId === r.itemId && e.edge === r.edge ? e : r));
		}, t = () => {
			let e = E.current;
			if (!e) {
				ge();
				return;
			}
			if (O.current && e.kind === "project") {
				_e(e.itemId, !0, 0);
				return;
			}
			let t = D.current;
			if (t) {
				N(e.itemId, e.kind, t);
				return;
			}
			ge();
		};
		return window.addEventListener("pointermove", e), window.addEventListener("pointerup", t), window.addEventListener("pointercancel", t), () => {
			window.removeEventListener("pointermove", e), window.removeEventListener("pointerup", t), window.removeEventListener("pointercancel", t);
		};
	}, [
		N,
		ge,
		b,
		_e
	]);
	let P = (e) => {
		let t = Sl(e), n = e.kind === "project" ? e.entry.project : null, r = n ? n.pinned ? pe : me : [], i = n ? r.findIndex((e) => e.project_id === n.project_id) : -1, a = e.kind === "orphan" ? j.findIndex((e) => e.summary.session_id === t) : -1, o = n ? i : a, s = n ? r.length : j.length, c = b?.itemId === t, l = !c && S?.itemId === t ? S.edge : null;
		return /* @__PURE__ */ Y(Gr, { children: [
			l === "before" ? /* @__PURE__ */ J(Dm, {}) : null,
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
				children: /* @__PURE__ */ J(Am, {
					item: e,
					onOpen: le,
					reorderable: m,
					dragging: c,
					canMoveUp: o > 0,
					canMoveDown: o >= 0 && o < s - 1,
					onMoveUp: () => {
						n ? be(n, -1) : e.kind === "orphan" && xe(t, -1);
					},
					onMoveDown: () => {
						n ? be(n, 1) : e.kind === "orphan" && xe(t, 1);
					},
					onReorderStart: Se
				})
			}),
			l === "after" ? /* @__PURE__ */ J(Dm, {}) : null
		] }, t);
	}, Ce = /* @__PURE__ */ Y("div", {
		className: "fixed inset-x-0 top-16 z-10 flex items-start gap-3 px-2 py-4",
		children: [/* @__PURE__ */ J(ic, {
			className: "flex-1 min-w-0",
			variant: rc.Search,
			placeholder: "Search projects…",
			value: p,
			onChange: (e) => r(e.target.value),
			onClear: () => r(""),
			"aria-label": "Search projects"
		}), /* @__PURE__ */ J(wi, {
			variant: I.Secondary,
			content: R.Icon,
			"aria-label": "Filters",
			"aria-expanded": v,
			onClick: () => y(!0),
			children: /* @__PURE__ */ J(M, { iconName: L.Controls })
		})]
	}), we = /* @__PURE__ */ J(ur, {
		open: v,
		onClose: () => y(!1),
		title: "Filters",
		bodyClassName: "p-0",
		children: /* @__PURE__ */ J(qp, {
			sessions: ae,
			showSearch: !1,
			mobile: !0,
			onChange: () => y(!1)
		})
	});
	if (!A && !ee && se.length === 0) return /* @__PURE__ */ Y("div", {
		className: "flex h-full min-h-0",
		children: [c ? null : /* @__PURE__ */ J(cm, { variant: "projects" }), /* @__PURE__ */ J("div", {
			className: "min-h-0 min-w-0 flex-1",
			children: /* @__PURE__ */ J(wm, {
				mobile: c,
				onStart: u.create,
				onAddRepository: d.isManaged ? d.addRepository : void 0,
				onManagedSettings: d.isManaged ? d.openSettings : void 0,
				modelReady: d.status?.model_ready,
				githubConnected: d.status?.github_status === "connected"
			})
		})]
	});
	let Te = m && b != null && b.kind === "project" && ue.length === 0 && !oe.find((e) => e.project_id === b.itemId)?.pinned;
	return /* @__PURE__ */ Y("div", {
		className: "flex h-full min-h-0",
		children: [
			c ? null : /* @__PURE__ */ J(cm, { variant: "projects" }),
			c ? Ce : null,
			c ? we : null,
			/* @__PURE__ */ J("div", {
				className: V("flex-1 min-h-0 overflow-auto", c ? "px-2" : "px-8", b && "select-none cursor-grabbing"),
				children: /* @__PURE__ */ Y("div", {
					className: V("flex flex-col gap-6 [&>*]:shrink-0", c ? "pt-36 pb-8" : "py-4"),
					children: [
						ee ? /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2 label-small text-error-primary",
							children: [/* @__PURE__ */ J("span", { children: nr(ee) }), /* @__PURE__ */ J(s, {
								variant: I.Ghost,
								size: F.Small,
								content: R.Text,
								onClick: () => {
									te();
								},
								children: "Try again"
							})]
						}) : null,
						!A && !ee && ce.length === 0 ? /* @__PURE__ */ J("div", {
							className: "label-small text-basic-muted text-center py-16",
							children: "No projects match the current filters."
						}) : null,
						ue.length > 0 || Te ? /* @__PURE__ */ Y(Em, {
							single: c,
							children: [ue.map(P), Te ? /* @__PURE__ */ J("div", {
								"data-pin-drop-zone": "true",
								className: V("min-h-[112px] rounded-[8px] border-2 border-dashed", w && "bg-info-primary/10"),
								style: { borderColor: "var(--blue-500)" }
							}) : null]
						}) : null,
						de.length > 0 ? /* @__PURE__ */ J(Em, {
							single: c,
							children: de.map(P)
						}) : null,
						fe.length > 0 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(fl, { children: "Unassigned chat sessions" }), /* @__PURE__ */ J(Em, {
							single: c,
							children: fe.map(P)
						})] }) : null
					]
				})
			})
		]
	});
}
//#endregion
//#region src/app/components/inspector/BranchPicker.tsx
function Pm(e, t, n) {
	return e ? "A run is in flight; wait for it to finish." : t && !n ? "Uncommitted changes: commit or stash them before switching." : null;
}
function Fm({ label: e, icon: t, active: n, disabled: r, title: i, onClick: a }) {
	let o = g();
	return /* @__PURE__ */ Y(Zc, {
		type: "button",
		size: o ? Yc.Large : Yc.Small,
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
function Im({ busy: e, children: t }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
		children: [e ? /* @__PURE__ */ J(Le, {
			size: A.Small,
			variant: de.Neutral
		}) : null, t]
	});
}
function Lm({ sessionId: e, branch: t, placement: n = z.TopRight }) {
	let { useRunning: r } = B().stores.runtimeStore, [i, a] = K(!1), [o, s] = K(""), c = r(e), { data: l, isLoading: u, error: d } = ut(e, i), f = ge(e), p = () => {
		a(!1), s(""), f.reset();
	}, m = o.trim(), h = (l?.branches ?? []).filter((e) => e.name.toLowerCase().includes(m.toLowerCase())), _ = (l?.branches ?? []).some((e) => e.name === m), v = l?.dirty ?? !1, y = Pm(c, v, !0), b = Pm(c, v, !1), x = g(), S = (e, t) => {
		f.mutate({
			name: e,
			create: t
		}, { onSuccess: p });
	}, C = d ? nr(d) : f.error ? nr(f.error) : null;
	return /* @__PURE__ */ J(Ln, {
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
						inputSize: x ? X.Large : X.Small,
						placeholder: "Find or create a branch",
						value: o,
						onChange: (e) => s(e.target.value)
					}), m && !_ && !d ? /* @__PURE__ */ J(Fm, {
						label: /* @__PURE__ */ Y(q, { children: ["Create ", /* @__PURE__ */ J("span", {
							className: "text-basic-primary",
							children: m
						})] }),
						icon: L.Add,
						disabled: !!y,
						title: y ?? void 0,
						onClick: () => S(m, !0)
					}) : null]
				}),
				u ? /* @__PURE__ */ J("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ J(Im, {
						busy: !0,
						children: "Reading branches…"
					})
				}) : null,
				!u && !d ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-h-0 gap-2 md:gap-1 p-2 md:p-0 overflow-auto [&>*]:shrink-0",
					children: [h.map((e) => {
						let t = e.is_current ? null : b;
						return /* @__PURE__ */ J(Fm, {
							label: e.name,
							icon: e.is_current ? L.Check : L.Scheme,
							active: e.is_current,
							disabled: !!t,
							title: t ?? void 0,
							onClick: e.is_current ? () => {} : () => S(e.name, !1)
						}, e.name);
					}), h.length === 0 && !m ? /* @__PURE__ */ J(Im, { children: "No local branches." }) : null]
				}) : null,
				f.isPending ? /* @__PURE__ */ J("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ J(Im, {
						busy: !0,
						children: "Working…"
					})
				}) : null,
				C ? /* @__PURE__ */ J("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ J(Sc, {
						variant: pc.Error,
						title: C
					})
				}) : null,
				!C && v && !c ? /* @__PURE__ */ J("div", {
					className: "shrink-0 px-4 pt-2 md:px-0 md:pt-0",
					children: /* @__PURE__ */ J(Sc, {
						variant: pc.Info,
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
				iconName: L.Scheme,
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
var Rm = {
	title: "Create Subagent",
	description: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from Subagents.",
	muted: !0
}, zm = {
	title: "Create Orchestrator Subagent",
	description: "Start a separate NAC planning session. Browse, steer, continue, and cancel it from Subagents.",
	muted: !0
};
function Bm({ sessionId: e, behavior: t, className: n, onCreateSubagent: r, onCreateOrchestrator: i }) {
	let a = ct().orchestrationEnabled && t === "direct-with-orchestrator", o = he(e, !0), c = f(e, a), [l, u] = K(!1), d = (o.data ?? []).some((e) => e.status === "running") || a && (c.data ?? []).some((e) => e.status === "running");
	return /* @__PURE__ */ J(Ln, {
		open: l,
		onClose: () => u(!1),
		sticky: !0,
		sheetOnMobile: !1,
		placement: z.TopRight,
		panelClassName: "gap-2",
		className: n,
		content: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y(Zc, {
			hoverHint: Rm,
			onClick: () => {
				u(!1), r();
			},
			children: [/* @__PURE__ */ J(M, { iconName: L.Plane }), /* @__PURE__ */ J("span", {
				className: "min-w-0 flex-1 truncate text-left",
				children: "Create Subagent"
			})]
		}), a ? /* @__PURE__ */ Y(Zc, {
			hoverHint: zm,
			onClick: () => {
				u(!1), i();
			},
			children: [/* @__PURE__ */ J(M, { iconName: L.Orchestrator }), /* @__PURE__ */ J("span", {
				className: "min-w-0 flex-1 truncate text-left",
				children: "Create Orchestrator Subagent"
			})]
		}) : null] }),
		children: /* @__PURE__ */ J(s, {
			type: "button",
			size: F.Large,
			variant: d ? I.GhostHighlightedAccent : I.Ghost,
			content: R.Icon,
			"aria-label": "Spawn",
			"aria-expanded": l,
			onClick: () => u((e) => !e),
			children: /* @__PURE__ */ J(M, {
				iconName: L.Add,
				size: 24,
				className: V("transition-transform", l && "rotate-45")
			})
		})
	});
}
//#endregion
//#region src/app/components/inspector/ModelPicker.tsx
var Vm = {
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
}, Hm = [{
	id: "",
	label: "Default effort",
	hoverHint: {
		...Vm[""],
		muted: !0
	}
}, ...rd.map((e) => ({
	...e,
	hoverHint: {
		...Vm[e.id],
		muted: !0
	}
}))];
function Um({ sessionId: e, metadata: t, label: n, disabled: r }) {
	let i = _n(), a = Xn(), o = _d(), s = Mr(a.data), c = Er(), l = t?.model ?? n, u = t?.reasoning_effort ?? "", d = t ? {
		backend: t.backend,
		model: t.model,
		baseUrl: t.base_url ?? ""
	} : null, f = bu(a.data, t?.backend, l), p = W(() => od(f.supportedEfforts, u, Hm), [f.supportedEfforts, u]), m = p.find((e) => e.id === u)?.label, h = typeof m == "string" ? m : "Default effort", [g, _] = K(!1), v = async (n) => {
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
		let d = bu(a.data, n.backend, n.model).supportedEfforts, f = u && d.includes(u) ? u : null, p = s ? {
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
			i.error(`The model was not switched: ${iu($(e), n.backend)}`);
		}
	}, y = async (n) => {
		if (!(!t || n === u)) try {
			await c.mutateAsync({
				id: e,
				patch: { reasoning_effort: n || null }
			}), i.success(`Reasoning set to ${n || "the model default"}`);
		} catch (e) {
			i.error(`Reasoning was not changed: ${iu($(e), t.backend)}`);
		}
	};
	return /* @__PURE__ */ Y("div", {
		className: "flex min-w-0 items-center",
		children: [
			/* @__PURE__ */ J(Au, {
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
			/* @__PURE__ */ J(Zn, {
				title: `Effort: ${h}`,
				description: "How much the model reasons before it answers.",
				position: z.TopCenter,
				sticky: !0,
				disabled: g,
				children: /* @__PURE__ */ J(dd, {
					items: p,
					value: u,
					placeholder: "Default effort",
					disabled: r || !t || c.isPending,
					size: F.Small,
					trailingIcon: L.Right,
					triggerClassName: "!gap-1.5 !pl-3",
					placement: z.TopCenter,
					onOpenChange: _,
					onValueChange: (e) => void y(e)
				})
			})
		]
	});
}
//#endregion
//#region src/app/components/inspector/PermissionControls.tsx
function Wm(e) {
	return e.map((e) => e.id).join(":");
}
function Gm({ grant: e, deleting: t, onDelete: n }) {
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
		}), /* @__PURE__ */ J(s, {
			size: F.Small,
			variant: I.GhostDestructive,
			content: R.Icon,
			"aria-label": `Forget ${e.action} permission`,
			loading: t,
			onClick: n,
			children: /* @__PURE__ */ J(M, {
				iconName: L.Trash,
				size: 16
			})
		})]
	});
}
function Km({ sessionId: e, behavior: t, label: n = "Permissions", autoApprovalAvailable: r = !0, requesterLabel: i }) {
	let a = t === "direct" || t === "direct-with-orchestrator", o = pt(e, a), c = lt(), l = ie(), u = Wr(), d = _n(), f = o.data?.requests ?? [], p = o.data?.grants ?? [], m = o.data?.approval_mode === "auto_approve", h = m && !r, [g, _] = K(!1), [v, y] = K(""), [b, x] = K(null), [S, C] = K(null), w = Wm(f), T = g || !!(w && w !== v), E = () => {
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
				d.error(`Unable to answer permission request: ${nr($(e))}`);
			} finally {
				x(null);
			}
		}
	}, A = async (t) => {
		if (!S) {
			C(t.id);
			try {
				await u.mutateAsync({
					sessionId: e,
					grantId: t.id
				});
			} catch (e) {
				d.error(`Unable to forget permission: ${nr($(e))}`);
			} finally {
				C(null);
			}
		}
	}, ee = async (t) => {
		_(!0);
		try {
			await l.mutateAsync({
				sessionId: e,
				mode: t ? "auto_approve" : "manual"
			});
		} catch (e) {
			d.error(`Unable to change approval mode: ${nr($(e))}`);
		}
	}, te = f.length ? ` (${f.length})` : p.length ? ` (${p.length})` : "", ne = m ? "Accept all" : "Manually", re = h ? "Requests are approved automatically because the parent session accepts all. Change the mode on the parent." : m ? "Requests are approved automatically for this session and the agents it owns." : "Each request pauses until you approve or deny it.";
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Zn, {
		title: `Permission: ${ne}`,
		description: re,
		position: z.TopCenter,
		children: /* @__PURE__ */ Y(s, {
			size: F.Small,
			variant: f.length ? I.GhostHighlightedAccent : I.Ghost,
			content: R.IconLeft,
			className: "pr-3",
			"aria-label": m ? h ? `${n} — auto-approve inherited; open permissions` : "Auto-approve on — open permissions" : `${n}${te}`,
			onClick: () => _(!0),
			children: [/* @__PURE__ */ J(M, {
				iconName: L.Private,
				size: 16
			}), /* @__PURE__ */ J("span", {
				className: "label-micro",
				children: m ? "Accept all" : "Manually"
			})]
		})
	}), /* @__PURE__ */ J(ur, {
		open: T,
		onClose: E,
		size: Wt.Wide,
		flush: !0,
		title: D ? "Permission required" : "Permissions",
		subheader: D ? `${D.tool} requested by ${i ?? "this session"} is paused before execution.` : h ? "Automatic approval is inherited from the parent session; change it from the parent." : m ? "Automatic approval is active for this session and its owned child agents." : "Remembered access for this session.",
		footer: D ? /* @__PURE__ */ Y("div", {
			className: "flex w-full flex-wrap justify-end gap-2",
			children: [
				/* @__PURE__ */ J(s, {
					variant: I.SecondaryDestructive,
					loading: b === D.id && c.variables?.reply === "reject",
					disabled: b !== null,
					onClick: () => void k("reject"),
					children: "Reject"
				}),
				/* @__PURE__ */ J(s, {
					variant: I.Secondary,
					loading: b === D.id && c.variables?.reply === "once",
					disabled: b !== null,
					onClick: () => void k("once"),
					children: "Allow once"
				}),
				/* @__PURE__ */ J(s, {
					variant: I.Primary,
					loading: b === D.id && c.variables?.reply === "always",
					disabled: b !== null || !O,
					title: O ? "Remember the server-derived narrow access pattern" : "This operation has no safe reusable permission pattern",
					onClick: () => void k("always"),
					children: "Always allow"
				})
			]
		}) : void 0,
		children: o.isPending ? /* @__PURE__ */ J("div", {
			className: "py-6 text-center text-small text-basic-secondary",
			children: "Loading permissions…"
		}) : o.isError ? /* @__PURE__ */ J("div", {
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
						})] }), /* @__PURE__ */ J(ll, {
							"aria-label": "Approve all automatically",
							checked: m,
							disabled: l.isPending,
							onChange: (e) => void ee(e)
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
						children: p.map((e) => /* @__PURE__ */ J(Gm, {
							grant: e,
							deleting: S === e.id,
							onDelete: () => void A(e)
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
function qm(e) {
	return e.replaceAll("_", " ");
}
function Jm(e) {
	return e?.token_budget === null || e?.token_budget === void 0 ? "" : String(e.token_budget);
}
function Ym(e) {
	let t = e.trim();
	if (!t) return null;
	let n = Number(t);
	return Number.isSafeInteger(n) && n > 0 ? n : void 0;
}
function Xm({ sessionId: e, behavior: t, openRequest: n = 0 }) {
	let r = t === "direct" || t === "direct-with-orchestrator", i = ce(e, r), a = N(), o = xt(), c = fe(), l = _n(), u = i.data ?? null, [d, f] = K(!1), [p, m] = K(""), [h, g] = K(""), _ = G(0);
	if (U(() => {
		n !== 0 && n !== _.current && (_.current = n, m(u?.objective ?? ""), g(Jm(u)), f(!0));
	}, [u, n]), !r) return null;
	let v = a.isPending || o.isPending || c.isPending, y = () => {
		m(u?.objective ?? ""), g(Jm(u)), f(!0);
	}, b = (e, t) => {
		l.error(`${e}: ${nr($(t))}`);
	}, x = async () => {
		let t = Ym(h);
		if (!p.trim()) {
			l.error("Goal objective is required.");
			return;
		}
		if (t === void 0) {
			l.error("Token budget must be a positive whole number or blank.");
			return;
		}
		try {
			u && u.status !== "complete" ? await o.mutateAsync({
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
			await o.mutateAsync({
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
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Zn, {
		title: "Durable goal",
		position: z.TopCenter,
		children: /* @__PURE__ */ J(s, {
			size: F.Small,
			variant: u?.status === "active" ? I.GhostHighlightedAccent : I.Ghost,
			content: R.Icon,
			"aria-label": u ? `Goal: ${qm(u.status)}` : "Create durable goal",
			onClick: y,
			children: /* @__PURE__ */ J(M, {
				iconName: L.Flag,
				size: 16
			})
		})
	}), /* @__PURE__ */ J(ur, {
		open: d,
		onClose: () => f(!1),
		size: Wt.Wide,
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
							children: qm(u.status)
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
				/* @__PURE__ */ J(oc, {
					label: "Objective",
					textAreaSize: ac.Medium,
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
						/* @__PURE__ */ J(s, {
							variant: I.Secondary,
							disabled: v,
							onClick: () => void S("paused"),
							children: "Pause"
						}),
						/* @__PURE__ */ J(s, {
							variant: I.Secondary,
							disabled: v,
							onClick: () => void S("usage_limited"),
							children: "Usage limit"
						}),
						/* @__PURE__ */ J(s, {
							variant: I.Secondary,
							disabled: v,
							onClick: () => void S("budget_limited"),
							children: "Budget limit"
						})
					] }) : u.status === "complete" ? null : /* @__PURE__ */ J(s, {
						variant: I.Secondary,
						disabled: v,
						onClick: () => void S("active"),
						children: "Resume"
					}), /* @__PURE__ */ J(s, {
						variant: I.GhostDestructive,
						disabled: v,
						onClick: () => void C(),
						children: "Clear"
					})] }) : null, /* @__PURE__ */ J(s, {
						variant: I.Primary,
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
var Zm = "Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited.", Qm = 100, $m = 1e6, eh = 100, th = 9600;
function nh(e) {
	let t = e.replaceAll("_", " ");
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function rh(e) {
	return e === "active" ? xi.Green : e === "complete" ? xi.Gray : xi.Yellow;
}
function ih(e) {
	let t = Math.round(e / eh) * eh;
	return Math.min($m, Math.max(Qm, t));
}
function ah({ sessionId: e, className: t, onOpen: n }) {
	let r = ce(e, !0).data ?? null, i = r?.status === "active";
	return /* @__PURE__ */ J(Zn, {
		className: t,
		position: z.TopCenter,
		title: r ? `Current Goal: ${nh(r.status)} - Click To Edit` : "Set Durable Goal",
		description: r ? r.objective : Zm,
		children: /* @__PURE__ */ J(s, {
			type: "button",
			size: F.Large,
			variant: i ? I.GhostHighlightedAccent : I.Ghost,
			content: R.Icon,
			"aria-label": r ? `Edit goal: ${nh(r.status)}` : "Set durable goal",
			onClick: n,
			children: /* @__PURE__ */ J(M, {
				iconName: L.Flag,
				size: 24
			})
		})
	});
}
function oh({ sessionId: e, onClose: t }) {
	let n = ce(e, !0), r = N(), i = xt(), a = fe(), o = _n(), c = n.data ?? null, [l, u] = K(c?.objective ?? ""), [d, f] = K(c?.token_budget != null), [p, m] = K(ih(c?.token_budget ?? th)), h = G(n.data !== void 0);
	U(() => {
		if (h.current || n.isPending) return;
		h.current = !0;
		let e = n.data ?? null;
		u(e?.objective ?? ""), f(e?.token_budget != null), m(ih(e?.token_budget ?? th));
	}, [n.data, n.isPending]);
	let g = r.isPending || i.isPending || a.isPending, _ = c != null && c.status !== "complete", v = (e, t) => {
		o.error(`${e}: ${nr($(t))}`);
	}, y = async (n) => {
		let a = d ? p : null;
		if (!l.trim()) {
			o.error("Goal objective is required.");
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
			}), u(""), f(!1), m(th);
		} catch (e) {
			v("Unable to clear goal", e);
		}
	}, S = sh(c, g || !l.trim());
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
					/* @__PURE__ */ J(Si, {
						text: nh(c.status),
						color: rh(c.status)
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
					/* @__PURE__ */ J(s, {
						type: "button",
						size: F.Small,
						variant: I.GhostDestructive,
						disabled: g,
						onClick: () => void x(),
						children: "Clear"
					}),
					/* @__PURE__ */ J(s, {
						type: "button",
						size: F.Small,
						variant: I.Primary,
						loading: g,
						disabled: !l.trim(),
						onClick: () => void y(!_),
						children: c.status === "complete" ? "Replace" : "Save"
					})
				]
			}) : null, /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2",
				children: [
					/* @__PURE__ */ J(ll, {
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
					/* @__PURE__ */ J(Jc, {
						className: "min-w-0 flex-1",
						min: Qm,
						max: $m,
						step: eh,
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
				/* @__PURE__ */ J(s, {
					type: "button",
					className: "absolute right-[48px] bottom-0",
					size: F.Large,
					variant: I.Ghost,
					content: R.Icon,
					"aria-label": "Close goal editor",
					onClick: t,
					children: /* @__PURE__ */ J(M, {
						iconName: L.Close,
						size: 24
					})
				}),
				/* @__PURE__ */ J(s, {
					type: "button",
					className: "absolute right-0 bottom-0",
					size: F.Large,
					variant: I.Primary,
					content: R.Icon,
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
function sh(e, t) {
	return e?.status === "active" ? {
		kind: "pause",
		label: "Pause goal",
		icon: L.Stop,
		disabled: !1
	} : e && e.status !== "complete" ? {
		kind: "resume",
		label: "Resume goal",
		icon: L.Play,
		disabled: !1
	} : {
		kind: "save",
		label: e?.status === "complete" ? "Replace goal" : "Create goal",
		icon: L.Plane,
		disabled: t
	};
}
//#endregion
//#region src/app/features/direct-session/browserAdapters.ts
function ch(e, t, n = {
	readMessages: gt(e).api.getMessages,
	subscribe: gt(e).events
}) {
	let { applyAssistantDelta: r, applyEnvelope: i, captureRuntimeActivation: a, clearRuntimeThreads: o, resetRuntime: s, setStreamStatus: l, syncRunFromSnapshot: u } = gt(e).stores.runtimeStore, d = E(e, t), f = !1, p = () => !1;
	return {
		attach: () => {
			f = !0, s(t), p = a(t), u(e.getQueryData(bn.sessionSnapshot(t))?.active_run);
		},
		detach: () => {
			f = !1, p() && s(null), Xe(d), e.cancelQueries({
				queryKey: bn.sessionSnapshot(t),
				exact: !0
			}), e.cancelQueries({ queryKey: bn.threadEventsRoot(t) }), e.removeQueries({ queryKey: bn.threadEventsRoot(t) });
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
			n && (o(), e.cancelQueries({ queryKey: bn.threadEventsRoot(t) }), e.removeQueries({ queryKey: bn.threadEventsRoot(t) })), e.cancelQueries({
				queryKey: bn.sessionSnapshot(t),
				exact: !0
			}), _(d, n);
		},
		snapshot: async () => {
			Ae("query:invalidate.session", { throttleMs: 0 }), await e.invalidateQueries({
				queryKey: bn.sessionSnapshot(t),
				exact: !0
			});
		},
		tail: async (r) => {
			let i = Ir(d), a = AbortSignal.any([r, i.controller.signal]);
			try {
				let r = await n.readMessages(t, {
					limit: 24,
					includeSystem: !0,
					signal: a
				});
				if (!f || a.aborted || !tt(d, i.generation)) return { kind: "obsolete" };
				let o = !1;
				return e.setQueryData(bn.sessionSnapshot(t), (e) => {
					if (!e) return o = !0, e;
					let t = c(e, r);
					return t.kind === "snapshot-required" ? (o = !0, e) : t.snapshot;
				}), o ? { kind: "snapshot-required" } : {
					kind: "accepted",
					total: r.page.total
				};
			} catch (e) {
				if (a.aborted || !tt(d, i.generation)) return { kind: "obsolete" };
				throw e;
			} finally {
				jr(d, i);
			}
		},
		invalidate: (n, r) => {
			let i = n === "permissions" ? bn.sessionPermissions(t) : n === "skills" ? bn.sessionSkills(t) : n === "revisions" ? bn.workspaceRevisions(t) : bn.threadEvents(t, r ?? "");
			e.invalidateQueries({
				queryKey: i,
				exact: !0
			});
		}
	};
}
//#endregion
//#region src/app/features/direct-session/streamReconciliation.ts
var lh = class extends Hn("nac/SessionObservation")() {}, uh = 250, dh = De(function* () {
	let e = yield* lh;
	return yield* Dn(oe(() => {
		e.attach();
		let t = !1, n = null, r = null, i = !1, a = !1, s = !1, c = 0, l = 0, d = null, f = new AbortController();
		function p(i) {
			t || (i && (c = 0), e.fenceSnapshot(i), clearTimeout(n ?? void 0), n = null, s = !1, clearTimeout(r ?? void 0), r = setTimeout(() => {
				if (r = null, t) return;
				let n = ++l;
				a = !0, xe(dt({
					try: e.snapshot,
					catch: () => "snapshot-unavailable"
				}).pipe(Ie, Cn(oe(() => {
					t || n !== l || (a = !1, s && r === null && m());
				}))));
			}, uh));
		}
		function m() {
			if (t || i || a || r !== null) return;
			i = !0;
			let n = De(function* () {
				let n = 1;
				for (; !t && s && !a && r === null;) {
					s = !1;
					let r = yield* dt({
						try: () => e.tail(f.signal),
						catch: () => "tail-unavailable"
					}).pipe(o(() => u({ kind: "snapshot-required" })));
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
			}).pipe(Cn(oe(() => {
				i = !1;
			})));
			xe(n);
		}
		function h(e) {
			t || (c = Math.max(c, e), s = !0, !(r !== null || a || i) && (clearTimeout(n ?? void 0), n = setTimeout(() => {
				n = null, m();
			}, uh)));
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
			t || (t = !0, l += 1, g(), clearTimeout(n ?? void 0), clearTimeout(r ?? void 0), f.abort(), e.detach());
		} };
	}), (e) => oe(e.close));
});
//#endregion
//#region src/app/features/direct-session/browserRuntime.ts
function fh(e) {
	let t = Ur(ht()), n = (() => {
		try {
			return Ur(dh.pipe(ue(pl(lh, e)), yt(t)));
		} catch (n) {
			throw e.detach(), Ur(me(t, hr)), n;
		}
	})();
	return () => {
		n.close(), Ur(me(t, hr));
	};
}
//#endregion
//#region src/app/hooks/useSessionStream.ts
function ph(e) {
	let { resetRuntime: t } = B().stores.runtimeStore, n = ai();
	U(() => {
		if (!e) {
			t(null);
			return;
		}
		return fh(ch(n, e));
	}, [
		e,
		n,
		t
	]);
}
function mh(e, t) {
	let { subscribeToSessionEvents: n } = { subscribeToSessionEvents: B().events }, r = ai();
	U(() => {
		if (!t) return;
		let i = () => {
			r.invalidateQueries({
				queryKey: bn.sessionPermissions(e),
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
function hh(e) {
	let { syncRunFromSnapshot: t } = B().stores.runtimeStore;
	U(() => {
		t(e);
	}, [e, t]);
}
//#endregion
//#region src/app/components/inspector/ChildControls.tsx
function gh({ child: e }) {
	let t = e.status === "running";
	return mh(e.child_session_id, t), t ? /* @__PURE__ */ J(Km, {
		sessionId: e.child_session_id,
		behavior: "direct",
		label: `Permissions for ${e.description}`,
		autoApprovalAvailable: !1,
		requesterLabel: `child agent “${e.description}”`
	}) : null;
}
function _h({ sessionId: e, behavior: t, showTrigger: n = !0, openRequest: r = 0 }) {
	let i = t === "direct" || t === "direct-with-orchestrator", a = he(e, i), o = tr(), c = _n(), [l, u] = K(!1), [d, f] = K(""), [p, m] = K(""), [h, g] = K(!0), _ = G(0);
	if (U(() => {
		!i || r === 0 || r === _.current || (_.current = r, u(!0));
	}, [i, r]), !i) return null;
	let v = a.data ?? [], y = o.isPending, b = () => {
		f(""), m("");
	}, x = async () => {
		if (!d.trim() || !p.trim()) {
			c.error("A short description and complete child prompt are required.");
			return;
		}
		try {
			await o.mutateAsync({
				sessionId: e,
				payload: {
					profile: "general",
					description: d.trim(),
					prompt: p.trim(),
					background: h
				}
			}), b(), u(!1);
		} catch (e) {
			c.error(`Unable to start child: ${nr($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(q, { children: [
		v.map((e) => /* @__PURE__ */ J(gh, { child: e }, e.child_session_id)),
		n ? /* @__PURE__ */ J(Zn, {
			title: "Launch coding agent",
			position: z.TopCenter,
			children: /* @__PURE__ */ J(s, {
				size: F.Small,
				variant: v.some((e) => e.status === "running") ? I.GhostHighlightedAccent : I.Ghost,
				content: R.Icon,
				"aria-label": "Launch coding agent",
				onClick: () => u(!0),
				children: /* @__PURE__ */ J(M, {
					iconName: L.People,
					size: 16
				})
			})
		}) : null,
		/* @__PURE__ */ J(ur, {
			open: l,
			onClose: () => u(!1),
			size: Wt.Wide,
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
						/* @__PURE__ */ J(oc, {
							label: "Complete task prompt",
							textAreaSize: ac.Medium,
							placeholder: "Describe the task, relevant context, and expected verification",
							value: p,
							onChange: (e) => m(e.target.value),
							textAreaClassName: "h-[112px] resize-none"
						}),
						/* @__PURE__ */ Y("div", {
							className: "flex flex-wrap items-center justify-between gap-3",
							children: [/* @__PURE__ */ Y("label", {
								className: "flex items-center gap-2 text-small text-basic-secondary",
								children: [/* @__PURE__ */ J(ll, {
									checked: h,
									disabled: y,
									onChange: g
								}), "Run in background"]
							}), /* @__PURE__ */ J(s, {
								variant: I.Primary,
								loading: o.isPending,
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
function vh({ sessionId: e, behavior: t, showTrigger: n = !0, openRequest: r = 0 }) {
	let i = ct().orchestrationEnabled && t === "direct-with-orchestrator", a = f(e, i), o = ye(), c = _n(), [l, u] = K(!1), [d, p] = K(""), [m, h] = K(""), [g, _] = K(!0), v = G(0);
	if (U(() => {
		!i || r === 0 || r === v.current || (v.current = r, u(!0));
	}, [i, r]), !i) return null;
	let y = a.data ?? [], b = o.isPending, x = () => {
		p(""), h("");
	}, S = async () => {
		if (!d.trim() || !m.trim()) {
			c.error("A short description and complete orchestration objective are required.");
			return;
		}
		try {
			await o.mutateAsync({
				sessionId: e,
				payload: {
					description: d.trim(),
					prompt: m.trim(),
					background: g
				}
			}), x(), u(!1);
		} catch (e) {
			c.error(`Unable to start orchestrator: ${nr($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(q, { children: [n ? /* @__PURE__ */ J(Zn, {
		title: "Launch NAC orchestrator",
		position: z.TopCenter,
		children: /* @__PURE__ */ J(s, {
			size: F.Small,
			variant: y.some((e) => e.status === "running") ? I.GhostHighlightedAccent : I.Ghost,
			content: R.Icon,
			"aria-label": "Launch NAC orchestrator",
			onClick: () => u(!0),
			children: /* @__PURE__ */ J(M, {
				iconName: L.Flow,
				size: 16
			})
		})
	}) : null, /* @__PURE__ */ J(ur, {
		open: l,
		onClose: () => u(!1),
		size: Wt.Wide,
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
						value: d,
						maxLength: 120,
						onChange: (e) => p(e.target.value)
					}),
					/* @__PURE__ */ J(oc, {
						label: "Complete objective",
						textAreaSize: ac.Medium,
						placeholder: "Describe scope, constraints, and expected verification",
						value: m,
						onChange: (e) => h(e.target.value),
						textAreaClassName: "h-[112px] resize-none"
					}),
					/* @__PURE__ */ Y("div", {
						className: "flex flex-wrap items-center justify-between gap-3",
						children: [/* @__PURE__ */ Y("label", {
							className: "flex items-center gap-2 text-small text-basic-secondary",
							children: [/* @__PURE__ */ J(ll, {
								checked: g,
								disabled: b,
								onChange: _
							}), "Run in background"]
						}), /* @__PURE__ */ J(s, {
							variant: I.Primary,
							loading: o.isPending,
							disabled: b,
							onClick: () => void S(),
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
var yh = "The subagent keeps working after you leave this chat. Steer or stop it from here.", bh = {
	completed: {
		text: "Completed",
		color: xi.Green
	},
	cancelled: {
		text: "Cancelled",
		color: xi.Yellow
	},
	failed: {
		text: "Failed",
		color: xi.Red
	},
	interrupted: {
		text: "Interrupted",
		color: xi.Yellow
	}
};
function xh({ value: e, onChange: t, onSubmit: n, onStop: r, running: i, background: a, onBackgroundChange: o, status: c = null, busy: l = !1, permission: u, autoFocus: d = !1, focusRequest: f = 0 }) {
	let p = G(null), m = e.trim().length > 0, h = i ? "Steer a message" : "Send a message", g = !i && c ? bh[c] : void 0, _ = i ? a ? "Running in the background" : "Regular run" : "Run in the background";
	return Qr(() => {
		let e = p.current;
		e && (e.style.height = "auto", e.style.height = `${e.scrollHeight}px`);
	}, [e]), Qr(() => {
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
			}), /* @__PURE__ */ J(s, {
				type: "submit",
				size: F.Medium,
				variant: I.Primary,
				content: R.Icon,
				className: "absolute right-0 bottom-0",
				disabled: l || !i && !m,
				"aria-label": i ? m ? "Steer" : "Stop" : "Send",
				children: /* @__PURE__ */ J(M, { iconName: i && !m ? L.Stop : L.ArrowTop })
			})]
		}), /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2.5 h-6",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex min-w-0 flex-1 items-center gap-2",
				children: [
					i ? null : /* @__PURE__ */ J(ll, {
						checked: a,
						disabled: l,
						"aria-label": "Run in the background",
						onChange: o
					}),
					/* @__PURE__ */ J("span", {
						className: V("label-micro truncate", i && a ? "text-info-primary" : i ? "text-basic-tertiary" : "text-basic-primary"),
						children: _
					}),
					/* @__PURE__ */ J(Zn, {
						title: _,
						description: yh,
						position: z.TopCenter,
						children: /* @__PURE__ */ J("span", {
							className: "inline-flex text-basic-tertiary",
							children: /* @__PURE__ */ J(M, {
								iconName: L.Info,
								size: 16
							})
						})
					}),
					g ? /* @__PURE__ */ J(Si, {
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
function Sh(e) {
	let t = e.trim().split("\n")[0] ?? "";
	return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}
function Ch({ parentSessionId: e, target: t, permissionSessionId: n, permissionBehavior: r, requesterLabel: i, onStarted: a, autoFocus: o = !1, focusRequest: s = 0, showPermissions: c = !0 }) {
	let l = _n(), u = tr(), d = ye(), f = ee(), p = Re(), [m, h] = K(""), [g, _] = K(t.mode === "child" || t.mode === "orchestrator" ? t.background : !0), v = (t.mode === "child" || t.mode === "orchestrator") && t.status === "running", y = u.isPending || d.isPending || f.isPending || p.isPending, b = t.mode === "child" || t.mode === "orchestrator" ? t : null, x = async () => {
		let n = m.trim();
		if (!n) return;
		let r = b ? b.description : Sh(n);
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
			l.error(`Unable to update the subagent: ${nr($(e))}`);
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
			l.error(`Unable to stop the subagent: ${nr($(e))}`);
		}
	};
	return /* @__PURE__ */ J(xh, {
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
		permission: c ? /* @__PURE__ */ J(Km, {
			sessionId: n,
			behavior: r,
			autoApprovalAvailable: !1,
			requesterLabel: i
		}) : null
	});
}
function wh({ parentSessionId: e, sessionId: t, kind: n, description: r, behavior: i }) {
	let a = n === "managed-orchestrator", o = he(e, !a), s = f(e, a), c = a ? s.data?.find((e) => e.orchestrator_session_id === t) : o.data?.find((e) => e.child_session_id === t), l = {
		mode: a ? "orchestrator" : "child",
		id: t,
		description: c?.description || r || "Subagent",
		status: c?.status ?? "idle",
		background: c?.execution_mode !== "foreground"
	};
	return /* @__PURE__ */ J(Ch, {
		parentSessionId: e,
		target: l,
		permissionSessionId: t,
		permissionBehavior: a ? "orchestrator" : i ?? "direct",
		requesterLabel: a ? void 0 : `child agent “${l.description}”`
	}, `${l.mode}:${l.id}:${l.status}:${l.background}`);
}
//#endregion
//#region src/app/hooks/usePromptHistoryPreview.ts
var Th = 40;
function Eh(e) {
	let t = e.trim();
	if (!t) return "[empty]";
	let n = t.split("\n")[0] ?? "";
	return n.length <= Th ? n : `${n.slice(0, Th)}…`;
}
function Dh({ prompts: e, value: t, enabled: n, setValue: r, textareaRef: i, afterCommit: a }) {
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
		previewText: u ? Eh(d) : "",
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
var Oh = /[\p{Alphabetic}\p{Number}_-]/u;
function kh(e, t) {
	return t >= e.length ? null : e.slice(t)[Symbol.iterator]().next().value ?? null;
}
function Ah(e, t) {
	let n = kh(e, t);
	return n === null || !Oh.test(n);
}
function jh(e) {
	return [...e].sort((e, t) => t.name.length - e.name.length || e.name.localeCompare(t.name));
}
function Mh(e, t) {
	if (!e || t.length === 0) return [{
		text: e,
		skillName: null
	}];
	let n = jh(t), r = [], i = 0, a = 0;
	for (;;) {
		let t = e.indexOf("$", a);
		if (t === -1) break;
		let o = t + 1, s = n.find((t) => e.startsWith(t.name, o) && Ah(e, o + t.name.length));
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
function Nh(e, t, n, r) {
	if (t === 0 || t !== n || r.length === 0 || !Ah(e, n)) return null;
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
var Ph = "Ask anything…", Fh = "Ask anything, or press ↑ for an earlier prompt", Ih = {
	mobile: 40,
	wide: 48
}, Lh = {
	mobile: 128,
	wide: 200
};
function Rh(e) {
	let t = /^(\s*)\/(\S*)$/u.exec(e);
	if (!t || t[0] !== e) return null;
	let n = t[2];
	return n.includes("/") || n.includes("\\") ? null : {
		leadingWhitespace: t[1],
		prefix: n
	};
}
function zh(e, t) {
	let n = e.trim();
	if (!n.startsWith("/")) return null;
	let r = n.slice(1), i = r.search(/\s/u), a = i === -1 ? r : r.slice(0, i), o = i === -1 ? "" : r.slice(i).trim();
	return t.find((e) => e.name === a && (e.accepts_arguments || !o)) ?? null;
}
function Bh(e, t, n, r) {
	return `${e}:${n}:${r}:${t}`;
}
var Vh = { WebkitTextStroke: "0.45px currentColor" };
function Hh(e) {
	return e.map((e, t) => e.skillName ? /* @__PURE__ */ J("strong", {
		className: "[font-weight:inherit] text-danger-primary",
		style: Vh,
		children: e.text
	}, `${e.skillName}-${t}`) : /* @__PURE__ */ J("span", { children: e.text }, t));
}
var Uh = { backgroundImage: "linear-gradient(to top, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))" };
function Wh({ iconName: e, prefix: t, value: n, iconSize: r = 14, className: i, title: a, showIcon: o = !0, labelClassName: s = "label-micro" }) {
	return /* @__PURE__ */ J(Zn, {
		title: a,
		position: z.TopCenter,
		children: /* @__PURE__ */ Y("div", {
			className: V("flex items-center gap-[2px] py-1 whitespace-nowrap", i),
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
function Gh(e, t) {
	let n = pn(e), r = t.contextWindow;
	if (!r || e == null) return {
		value: n,
		title: "Orchestrator context"
	};
	let i = pn(r);
	return t.estimated ? {
		value: `${n} / ${i} est.`,
		title: `Orchestrator context against ${t.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate`
	} : {
		value: `${n} / ${i}`,
		title: `Orchestrator context — ${Math.round(e / r * 100)}% of the model's context window`
	};
}
function Kh({ sessionId: t, snapshot: n, entry: r }) {
	let { useSshConnectionStatus: i, sshTargetFromSummary: a, markSshDisconnected: o, markSshConnected: c } = B().stores.sshConnectionStore, { useSessionSpend: l, useRunning: u, useRunUsage: d, useRunStartedAt: f, useLastElapsedMs: p, useCancelArmed: m, pushLocalEvent: h, liftSessionSpend: _, captureRuntimeActivation: v } = B().stores.runtimeStore, { revealSidePanel: y, openSubagentLaunch: b } = B().stores.sessionLayoutStore, { consumePromptRequests: x } = B().stores.composerStore, S = fi();
	En("ChatInputBox");
	let [C, w] = K(""), T = G(C);
	U(() => {
		T.current = C;
	}, [C]);
	let E = g(), D = Ar(), O = E || D, [k, ee] = K(!1), [te, ne] = K({
		start: 0,
		end: 0
	}), [re, ie] = K(null), [ae, oe] = K(0), [se, le] = K(null), ue = E && !k, de = E ? Ih.mobile : Ih.wide, pe = E ? Lh.mobile : Lh.wide, me = u(t), j = m(t), he = _n(), ge = Vf(), _e = gn(), ve = Qn(), ye = e(), be = Ge(), xe = _t(), Se = Oe(), P = r?.summary.behavior ?? n?.metadata.behavior ?? null, Ce = P === "direct" || P === "direct-with-orchestrator", Te = r?.lineage ?? n?.lineage ?? null, Ee = Te != null, De = r !== null || n !== null, ke = at(t, Ce && !Ee), Ae = ce(t, Ce && !Ee), je = N(), Me = xt(), Ne = fe(), [Pe, Fe] = K(0), [Ie, Re] = K(!1), [ze, Be] = K(t);
	ze !== t && (Be(t), Re(!1));
	let { data: Ve, isError: He, refetch: Ue } = wr(t), { data: We, isError: Ke } = Ot(t), qe = G(null), Je = G(null), Ye = G(null), Xe = G([]), Ze = G(!1), Qe = Zr(), $e = d(), et = l();
	U(() => {
		_(Or(n));
	}, [_, n]);
	let tt = Lt(n, r, me || j ? $e : null, et), nt = r?.summary.backend ?? n?.metadata.backend ?? null, rt = Xn(), it = Or(n), ot = tt.usage?.total_tokens || it?.total_tokens || null, st = Gh(ot, bu(rt.data, n?.metadata?.backend, tt.model)), ct = rr(1e3, me), lt = f(), ut = p(), dt = (me && lt != null ? Math.max(0, ct - lt) : null) ?? ut ?? tt.lastResponseMs, ft = a(r?.summary), pt = i(ft), mt = Pr(), ht = Nr(r?.summary) === "SSH", gt = me && Ce && !Ee, vt = me && P === "orchestrator" && !Ee, yt = gt || vt, bt = _e.isPending || ve.isPending || ye.isPending || be.isPending || xe.isPending || Se.isPending || je.isPending || Me.isPending || Ne.isPending, St = bt || j || me && !yt, Ct = !!C.trim() && !St, wt = (ke.data ?? []).filter((e) => e.status === "pending"), Tt = async (e, n, r) => {
		try {
			await xe.mutateAsync({
				sessionId: t,
				itemId: e,
				expectedVersion: n,
				delivery: r
			});
		} catch (e) {
			he.error(`Unable to change pending message: ${nr($(e))}`);
		}
	}, Et = async (e, n) => {
		try {
			await Se.mutateAsync({
				sessionId: t,
				itemId: e,
				expectedVersion: n
			});
		} catch (e) {
			he.error(`Unable to cancel pending message: ${nr($(e))}`);
		}
	}, Dt = H(() => {
		let e = qe.current;
		e && (e.style.height = `${de}px`, e.style.height = `${Math.min(e.scrollHeight, pe)}px`);
	}, [de, pe]);
	Qr(() => {
		let e = Ye.current, t = qe.current;
		e === null || !t || (Ye.current = null, Dt(), t.focus(), t.setSelectionRange(e, e));
	}, [Dt, C]);
	let kt = Dh({
		prompts: W(() => {
			let e = [];
			for (let t of n?.messages ?? []) t.role === "user" && e.push(An(t.content));
			return e.reverse();
		}, [n?.messages]),
		value: C,
		enabled: !E,
		setValue: w,
		textareaRef: qe,
		afterCommit: Dt
	}), At = kt.reset, jt = Zr();
	U(() => At(), [t, At]);
	let Mt = W(() => Rh(C), [C]), Nt = W(() => {
		if (!Mt || !Ve) return [];
		let e = Mt.prefix.toLocaleLowerCase();
		return Ve.filter((t) => (t.name !== "goal" || Ce) && t.name.toLocaleLowerCase().startsWith(e));
	}, [
		Ve,
		Mt,
		Ce
	]), Pt = W(() => Nh(C, te.start, te.end, We ?? []), [
		te,
		We,
		C
	]), Ft = W(() => {
		if (Mt !== null || We !== void 0 || te.start === 0 || te.start !== te.end) return null;
		let e = C.lastIndexOf("$", te.start - 1);
		return e === -1 ? null : {
			start: e,
			end: te.end
		};
	}, [
		Mt,
		te,
		We,
		C
	]), It = Mt ? "slash" : Pt || Ft ? "skill" : null, Rt = W(() => It === "slash" ? Nt.map((e) => ({
		kind: "slash",
		key: e.command,
		name: `/${e.name}`,
		description: e.description,
		definition: e
	})) : It === "skill" && Pt ? Pt.entries.map((e) => ({
		kind: "skill",
		key: e.name,
		name: `$${e.name}`,
		description: e.description,
		definition: e
	})) : [], [
		Nt,
		Pt,
		It
	]), zt = It === "slash" ? Bh("slash", C, 0, C.length) : It === "skill" ? Bh("skill", C, Pt?.start ?? Ft?.start ?? te.start, Pt?.end ?? Ft?.end ?? te.end) : null, Bt = k && It !== null && zt !== re, Vt = Math.min(ae, Math.max(Rt.length - 1, 0)), Ht = se !== null && se < Rt.length ? se : Vt, Ut = Bt ? Rt[Ht] : void 0, Wt = Ut ? `${Qe}-option-${Ht}` : void 0, Gt = H((e) => {
		Ut && e.preventDefault();
	}, [Ut]);
	U(() => {
		Bt && Xe.current[Vt]?.scrollIntoView({ block: "nearest" });
	}, [
		Vt,
		Bt,
		Rt
	]);
	let Kt = H(() => {
		ie(zt), le(null);
	}, [zt]), Jt = H((e) => {
		let t, n, r;
		if (e.kind === "slash") {
			if (!Mt) return;
			t = `${Mt.leadingWhitespace}/${e.definition.name}${e.definition.accepts_arguments ? " " : ""}`, n = t.length, r = Bh("slash", t, 0, t.length);
		} else {
			if (!Pt) return;
			let i = `$${e.definition.name}`;
			t = `${C.slice(0, Pt.start)}${i}${C.slice(Pt.end)}`, n = Pt.start + i.length, r = Bh("skill", t, Pt.start, n);
		}
		t === C ? (Ye.current = null, Dt(), qe.current?.focus(), qe.current?.setSelectionRange(n, n)) : (Ye.current = n, w(t)), ne({
			start: n,
			end: n
		}), ie(r), le(null);
	}, [
		Mt,
		Dt,
		Pt,
		C
	]), Yt = W(() => Mh(C, We ?? []), [We, C]), Xt = !kt.active && Yt.some((e) => e.skillName !== null);
	Qr(() => {
		let e = qe.current, t = Je.current;
		!Xt || !e || !t || (t.scrollTop = e.scrollTop, t.scrollLeft = e.scrollLeft);
	}, [
		ue,
		Xt,
		C
	]), U(() => {
		let e = qe.current;
		e && (ue ? (e.style.height = `${Ih.mobile}px`, e.style.overflow = "hidden") : (e.style.overflow = "", Dt()));
	}, [ue, Dt]);
	let Zt = H(() => {
		let e = qe.current;
		e && (e.focus(), requestAnimationFrame(() => {
			if (!qe.current) return;
			let e = qe.current.value.length;
			qe.current.selectionStart = e, qe.current.selectionEnd = e, ne({
				start: e,
				end: e
			}), qe.current.scrollTop = qe.current.scrollHeight;
		}));
	}, []), Qt = H(async () => {
		if (!(!ft || mt.isPending)) try {
			await mt.mutateAsync(ft), c(ft);
		} catch (e) {
			o(ft), he.error(`SSH reconnect failed: ${nr($(e))}`);
		}
	}, [
		ft,
		mt,
		c,
		o,
		he
	]), $t = H(async (e) => {
		if (!Ce) throw Error("Durable goals are available only in direct chats");
		let n = v(t), r = Ae.data;
		if (r === void 0) {
			let e = await Ae.refetch();
			if (!n()) return;
			if (e.error) throw e.error;
			r = e.data;
		}
		let i = e.trim().slice(5).trim();
		if (i === "" || i === "edit") {
			E ? Fe((e) => e + 1) : Re(!0);
			return;
		}
		if (i === "clear") {
			if (!r) throw Error("There is no durable goal to clear");
			await Ne.mutateAsync({
				sessionId: t,
				goalId: r.goal_id,
				expectedVersion: r.version
			});
			return;
		}
		if (i === "pause" || i === "resume") {
			if (!r) throw Error(`There is no durable goal to ${i}`);
			await Me.mutateAsync({
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
		await je.mutateAsync({
			sessionId: t,
			payload: { objective: i }
		});
	}, [
		v,
		Ne,
		je,
		Ce,
		Ae,
		E,
		t,
		Me
	]), en = H(async (e = C, n) => {
		let r = e.trim();
		if (!r || St || Ze.current) return;
		let i = e === C, a = () => {
			!i || T.current !== e || (T.current = "", w(""), ne({
				start: 0,
				end: 0
			}), At(), qe.current && (qe.current.style.height = `${de}px`));
		};
		Ze.current = !0;
		let o = v(t);
		try {
			let i = Ve;
			if (e.trimStart().startsWith("/") && i === void 0) {
				let e = await Ue();
				if (!o()) return;
				if (i = e.data, i === void 0) {
					he.error("Unable to load slash commands");
					return;
				}
			}
			let s = i ? zh(e, i) : null;
			if (s?.command === "compact") {
				try {
					if (await ye.mutateAsync(t), !o()) return;
					h("compaction", "▶ compacting context…"), a();
				} catch (e) {
					if (!o()) return;
					h("error", `compact failed: ${nr($(e))}`, !0), he.error(`Failed to compact: ${iu($(e), nt)}`);
				}
				return;
			}
			if (s?.command === "goal") {
				try {
					if (await $t(r), !o()) return;
					a();
				} catch (e) {
					if (!o()) return;
					he.error(`Goal command failed: ${iu($(e))}`);
				}
				return;
			}
			if (s && s.command !== "mcp_prompt") {
				he.error(`Unsupported slash command: /${s.name}`);
				return;
			}
			try {
				let e = await we(wn({
					mode: gt ? "direct-running" : vt ? "classic-running" : "idle",
					delivery: n,
					inbox: (e) => be.mutateAsync({
						sessionId: t,
						delivery: e,
						prompt: r
					}),
					steer: () => ve.mutateAsync({
						id: t,
						instruction: r
					}),
					submit: () => _e.mutateAsync({
						id: t,
						prompt: r
					})
				}));
				if (!o()) return;
				e === "submitted" ? h("run", `▶ submitted: ${r.slice(0, 80)}`) : (gt || n) && h("steering", `▶ ${n ?? "steer"}: ${r.slice(0, 80)}`), a();
			} catch (e) {
				if (!o()) return;
				h("error", `submit failed: ${nr($(e))}`, !0), he.error(`Failed to send: ${iu($(e), nt)}`);
			}
		} finally {
			Ze.current = !1;
		}
	}, [
		C,
		St,
		v,
		t,
		At,
		de,
		Ve,
		Ue,
		he,
		ye,
		h,
		nt,
		$t,
		gt,
		vt,
		be,
		ve,
		_e
	]);
	U(() => x((e) => void en(e)), [x, en]);
	let tn = H(async () => {
		await ge.stopRun(t);
	}, [ge, t]), nn = /* @__PURE__ */ J(Zn, {
		title: "Session settings",
		position: z.TopLeft,
		children: /* @__PURE__ */ J(s, {
			className: E ? "btn-round" : void 0,
			size: E ? F.Medium : F.Small,
			variant: I.Ghost,
			content: R.Icon,
			"aria-label": "Session settings",
			onClick: () => ge.settings(t),
			children: /* @__PURE__ */ J(M, {
				iconName: L.Gear,
				size: E ? void 0 : 16
			})
		})
	}), rn = !!C.trim(), an = (me || j) && !rn, on = /* @__PURE__ */ J(M, { iconName: an ? L.Stop : L.ArrowTop }), sn = j ? "Stopping run" : me && !rn ? "Stop run" : yt ? "Steer active run" : "Send", cn = an ? "button" : "submit", ln = j || !an && !Ct, dn = me && !rn && !j ? () => void tn() : void 0, fn = E ? /* @__PURE__ */ J(wi, {
		className: "shrink-0",
		variant: I.Primary,
		content: R.Icon,
		type: cn,
		disabled: ln,
		loading: j,
		"aria-label": sn,
		onPointerDown: Gt,
		onClick: dn,
		children: on
	}) : /* @__PURE__ */ J(s, {
		className: "absolute bottom-0 right-0",
		size: F.Large,
		variant: I.Primary,
		content: R.Icon,
		type: cn,
		disabled: ln,
		loading: j,
		"aria-label": sn,
		onPointerDown: Gt,
		onClick: dn,
		children: on
	}), mn = Bt ? It === "slash" ? Ve === void 0 ? He ? "Slash commands unavailable" : "Loading slash commands" : Rt.length ? `${Rt.length} slash ${Rt.length === 1 ? "command" : "commands"} available` : "No matching commands" : We === void 0 ? Ke ? "Skills unavailable" : "Loading skills" : `${Rt.length} ${Rt.length === 1 ? "skill" : "skills"} available` : "", hn = /* @__PURE__ */ Y("div", {
		className: V("relative flex items-end", E ? V("flex-1 min-w-0 rounded-[20px] bg-elevation-level-3 shadow-2xl overflow-hidden", ue && "pr-[40px]") : V("rounded-[4px] bg-input shadow-concave", Ce ? "pl-[48px] pr-[96px]" : "pr-[48px]")),
		children: [
			/* @__PURE__ */ Y("div", {
				className: "relative flex-1 min-w-0",
				children: [
					/* @__PURE__ */ J("span", {
						className: "sr-only",
						role: "status",
						"aria-live": "polite",
						"aria-atomic": "true",
						children: mn
					}),
					Xt && !ue ? /* @__PURE__ */ Y("div", {
						ref: Je,
						"aria-hidden": "true",
						className: V("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-medium text-input [scrollbar-gutter:stable]", E ? "px-4 py-2" : "p-3"),
						children: [Hh(Yt), C.endsWith("\n") ? " " : null]
					}) : null,
					/* @__PURE__ */ J("textarea", {
						ref: qe,
						className: V("relative block w-full bg-transparent resize-none border-none outline-none text-medium text-input placeholder:text-input-placeholder placeholder:whitespace-nowrap [scrollbar-gutter:stable]", E ? "px-4 py-2" : "p-3", ue && "opacity-0 pointer-events-none"),
						rows: 1,
						role: "combobox",
						"aria-label": "Message",
						"aria-autocomplete": "list",
						"aria-haspopup": "listbox",
						"aria-expanded": Bt,
						"aria-controls": Bt ? Qe : void 0,
						"aria-activedescendant": Wt,
						"aria-describedby": kt.active ? jt : void 0,
						enterKeyHint: E ? "enter" : void 0,
						placeholder: kt.active ? "" : kt.hasHistory && C === "" ? Fh : Ph,
						spellCheck: !1,
						value: C,
						style: {
							minHeight: `${de}px`,
							maxHeight: `${pe}px`,
							color: Xt ? "transparent" : void 0,
							caretColor: Xt ? "var(--color-text-input)" : void 0
						},
						onChange: (e) => {
							e.target.value !== C && ie(null), oe(0), le(null), kt.onValueChange(e.target.value), w(e.target.value), ne({
								start: e.target.selectionStart,
								end: e.target.selectionEnd
							}), Dt();
						},
						onSelect: (e) => {
							let t = {
								start: e.currentTarget.selectionStart,
								end: e.currentTarget.selectionEnd
							};
							(t.start !== te.start || t.end !== te.end) && (oe(0), le(null), ne(t));
						},
						onScroll: (e) => {
							Je.current && (Je.current.scrollTop = e.currentTarget.scrollTop, Je.current.scrollLeft = e.currentTarget.scrollLeft);
						},
						onFocus: (e) => {
							ee(!0), ne({
								start: e.currentTarget.selectionStart,
								end: e.currentTarget.selectionEnd
							});
						},
						onBlur: () => {
							ee(!1), le(null), At();
						},
						onKeyDown: (e) => {
							if (!e.nativeEvent.isComposing && !(e.key === "Enter" && E && !e.metaKey && !e.ctrlKey)) {
								if (Bt && !e.shiftKey) {
									if (e.key === "Escape") {
										e.preventDefault(), Kt();
										return;
									}
									if ((e.key === "ArrowDown" || e.key === "ArrowUp") && Rt.length) {
										e.preventDefault(), oe(e.key === "ArrowDown" ? Math.min(Ht + 1, Rt.length - 1) : Math.max(Ht - 1, 0)), le(null);
										return;
									}
									if (e.key === "Tab" && Ut) {
										e.preventDefault(), Jt(Ut);
										return;
									}
									if (e.key === "Enter" && (Ut || It === "slash")) {
										e.preventDefault(), Ut && Jt(Ut);
										return;
									}
								}
								kt.onKeyDown(e) || e.key === "Enter" && (e.shiftKey || (e.preventDefault(), en()));
							}
						}
					}),
					kt.active ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
						id: jt,
						className: "sr-only",
						children: "Press Tab to take this prompt, Escape to leave it, or start typing to dismiss it"
					}), /* @__PURE__ */ Y("div", {
						className: "pointer-events-none absolute inset-0 flex items-center gap-2 px-3",
						children: [/* @__PURE__ */ J("span", {
							className: "min-w-0 truncate text-medium text-input-placeholder",
							children: kt.previewText
						}), /* @__PURE__ */ J(un, {
							keys: ["tab"],
							spelled: !0,
							className: "shrink-0"
						})]
					})] }) : null,
					ue ? /* @__PURE__ */ J("div", {
						className: "absolute inset-0 flex items-center px-4 cursor-text",
						onClick: Zt,
						children: /* @__PURE__ */ J("span", {
							className: V("w-full truncate text-medium", C ? "text-input" : "text-input-placeholder"),
							children: C ? Hh(Yt) : Ph
						})
					}) : null
				]
			}),
			!E && Ce ? /* @__PURE__ */ J(Bm, {
				className: "absolute bottom-0 left-0",
				sessionId: t,
				behavior: P,
				onCreateSubagent: () => {
					b("agent"), y(E), S(_r.session(t, "delegated"));
				},
				onCreateOrchestrator: () => {
					b("orchestrator"), y(E), S(_r.session(t, "delegated"));
				}
			}) : null,
			!E && Ce ? /* @__PURE__ */ J(ah, {
				className: "absolute right-[48px] bottom-0",
				sessionId: t,
				onOpen: () => Re(!0)
			}) : null,
			E ? ue ? /* @__PURE__ */ J("div", {
				className: "absolute top-0 right-0",
				children: nn
			}) : null : fn
		]
	}), vn = /* @__PURE__ */ J("div", {
		id: Qe,
		role: "listbox",
		"aria-label": It === "skill" ? "Skills" : "Slash commands",
		children: It === "slash" && Ve === void 0 ? /* @__PURE__ */ J("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: He ? "Slash commands unavailable" : "Loading commands…"
		}) : It === "skill" && We === void 0 ? /* @__PURE__ */ J("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: Ke ? "Skills unavailable" : "Loading skills…"
		}) : Rt.length ? Rt.map((e, t) => /* @__PURE__ */ Y("button", {
			id: `${Qe}-option-${t}`,
			ref: (e) => {
				Xe.current[t] = e;
			},
			type: "button",
			role: "option",
			"aria-selected": t === Ht,
			tabIndex: -1,
			className: V("flex min-h-10 w-full items-center gap-3 rounded-[4px] px-3 py-2 text-left", t === Ht ? "btn-ghost-highlighted" : "btn-ghost"),
			onPointerDown: (e) => e.preventDefault(),
			onPointerMove: () => le(t),
			onPointerLeave: () => le((e) => e === t ? null : e),
			onClick: () => Jt(e),
			children: [/* @__PURE__ */ J("span", {
				className: "code code-small shrink-0 text-basic-primary",
				children: e.name
			}), /* @__PURE__ */ J("span", {
				className: V("min-w-0 flex-1 text-small text-basic-secondary", e.kind === "skill" && "truncate"),
				children: e.description
			})]
		}, `${e.kind}-${e.key}`)) : /* @__PURE__ */ J("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: "No matching commands"
		})
	}), yn = /* @__PURE__ */ J(Ln, {
		open: Bt,
		onClose: Kt,
		content: vn,
		placement: z.TopRight,
		sticky: !0,
		closeOnEscape: !1,
		sheetOnMobile: !1,
		className: E ? "flex-1 min-w-0" : "w-full",
		size: "w-[min(400px,calc(100vw-16px))]",
		panelClassName: "max-h-[min(40vh,320px)] overflow-y-auto",
		children: hn
	});
	return De ? Ee && Te ? /* @__PURE__ */ J(wh, {
		parentSessionId: Te.parent_session_id,
		sessionId: t,
		kind: Te.kind,
		description: Te.description,
		behavior: P
	}) : /* @__PURE__ */ Y("form", {
		className: V("flex flex-col", E ? "gap-3 px-4 pt-8 pb-8" : D ? "gap-3 px-2 pt-2 pb-4 rounded-[12px] bg-elevation-level-1 shadow-2xl" : "gap-4 p-4 rounded-[8px] bg-elevation-level-1 shadow-2xl"),
		style: E ? Uh : void 0,
		onSubmit: (e) => {
			if (e.preventDefault(), !Ie) {
				if (Ut) {
					Jt(Ut);
					return;
				}
				en();
			}
		},
		children: [
			E ? /* @__PURE__ */ Y("div", {
				className: "flex items-end gap-2",
				children: [yn, fn]
			}) : Ie && Ce ? /* @__PURE__ */ J(oh, {
				sessionId: t,
				onClose: () => Re(!1)
			}) : yn,
			wt.length ? /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-2",
				"aria-label": "Pending messages",
				children: [/* @__PURE__ */ J("div", {
					className: "tag-label uppercase text-basic-secondary",
					children: "Pending messages"
				}), wt.map((e) => /* @__PURE__ */ Y("div", {
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
						/* @__PURE__ */ Y(s, {
							type: "button",
							size: F.Small,
							variant: I.Ghost,
							disabled: bt,
							onClick: () => void Tt(e.id, e.version, e.delivery === "steer" ? "queue" : "steer"),
							children: ["Change to ", e.delivery === "steer" ? "queue" : "steer"]
						}),
						/* @__PURE__ */ J(s, {
							type: "button",
							size: F.Small,
							variant: I.GhostDestructive,
							disabled: bt,
							onClick: () => void Et(e.id, e.version),
							children: "Cancel"
						})
					]
				}, e.id))]
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: V("flex flex-wrap items-center gap-[10px]", E && "pl-2"),
				children: [/* @__PURE__ */ Y("div", {
					className: "flex flex-1 min-w-0 flex-wrap items-center gap-y-1 gap-x-4",
					children: [
						gt ? /* @__PURE__ */ J(s, {
							type: "button",
							size: F.Small,
							variant: I.Secondary,
							disabled: !Ct,
							onClick: () => void en(C, "queue"),
							children: "Queue Next"
						}) : null,
						/* @__PURE__ */ J(Um, {
							sessionId: t,
							metadata: n?.metadata ?? null,
							label: tt.model,
							disabled: St
						}),
						E ? null : /* @__PURE__ */ J("div", { className: "flex-1" }),
						E ? /* @__PURE__ */ J(Km, {
							sessionId: t,
							behavior: P
						}) : /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2",
							children: [
								nn,
								Ce ? /* @__PURE__ */ J("span", {
									"aria-hidden": !0,
									className: "h-6 w-px shrink-0 bg-divider-muted"
								}) : null,
								/* @__PURE__ */ J(Km, {
									sessionId: t,
									behavior: P
								})
							]
						}),
						!E && Ce ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(_h, {
							sessionId: t,
							behavior: P,
							showTrigger: !1
						}), /* @__PURE__ */ J(vh, {
							sessionId: t,
							behavior: P,
							showTrigger: !1
						})] }) : null,
						E ? /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ J(Xm, {
								sessionId: t,
								behavior: P,
								openRequest: Pe
							}),
							/* @__PURE__ */ J(_h, {
								sessionId: t,
								behavior: P
							}),
							/* @__PURE__ */ J(vh, {
								sessionId: t,
								behavior: P
							})
						] }) : null,
						ht ? /* @__PURE__ */ J(Mf, {
							state: pt === "connected" ? "connected" : "reconnect",
							onReconnect: () => void Qt()
						}) : E ? /* @__PURE__ */ J("span", {
							className: "text-[10px] leading-[12px] font-medium uppercase text-basic-tertiary shrink-0",
							children: tt.env
						}) : null,
						E && (tt.usage || ot) ? /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-[2px] min-w-0",
							children: [/* @__PURE__ */ J(Wh, {
								iconName: L.Timelaps,
								value: st.value,
								className: "text-info-primary",
								title: st.title,
								labelClassName: "tag-label"
							}), tt.usage && !O ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(Wh, {
									iconName: L.ArrowTop,
									value: pn(tt.usage.input_tokens),
									className: "text-info-secondary opacity-75",
									title: "Input tokens",
									labelClassName: "tag-label"
								}),
								tt.usage.cache_read_tokens > 0 ? /* @__PURE__ */ J(Wh, {
									prefix: "C",
									value: pn(tt.usage.cache_read_tokens),
									className: "text-info-secondary opacity-75",
									title: "Cache read tokens",
									labelClassName: "tag-label"
								}) : null,
								/* @__PURE__ */ J(Wh, {
									iconName: L.ArrowDown,
									value: pn(tt.usage.output_tokens),
									className: "text-info-secondary opacity-75",
									title: "Output tokens",
									labelClassName: "tag-label"
								})
							] }) : null]
						}) : null
					]
				}), E ? /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-[10px] shrink-0",
					children: [tt.usage ? /* @__PURE__ */ J(Wh, {
						iconName: L.Price,
						iconSize: 16,
						value: qt(tt.usage.cost?.total),
						className: "text-basic-primary",
						title: "Session cost",
						showIcon: !1
					}) : null, /* @__PURE__ */ J(Zn, {
						title: me ? "Run elapsed" : "Last response time",
						position: z.TopRight,
						children: /* @__PURE__ */ Y("div", {
							className: V("flex items-center gap-1 p-1 shrink-0 label-micro", me ? "text-basic-primary" : "text-basic-tertiary"),
							children: [O ? null : me ? /* @__PURE__ */ J(Le, { size: A.Small }) : /* @__PURE__ */ J(M, {
								iconName: L.History,
								size: 16
							}), /* @__PURE__ */ J("span", {
								className: "block w-[40px] text-center",
								children: vr(dt)
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
		}), me && /* @__PURE__ */ J(s, {
			size: F.Small,
			variant: I.GhostDestructive,
			content: R.Text,
			"aria-label": "Stop run",
			onClick: () => void tn(),
			children: "Stop"
		})]
	});
}
//#endregion
//#region src/app/components/inspector/MobileBottomBar.tsx
var qh = {
	sessions: {
		label: "Sessions",
		iconName: L.Chat
	},
	threads: {
		label: "Threads",
		iconName: L.Flow
	},
	delegated: {
		label: "Subagents",
		iconName: L.Robot
	},
	files: {
		label: "Files",
		iconName: L.Folders
	},
	terminal: {
		label: "Terminal",
		iconName: L.Terminal
	},
	worksets: {
		label: "Worksets",
		iconName: L.Checklist
	},
	history: {
		label: "History",
		iconName: L.History
	}
};
function Jh({ panel: e, onPanelChange: t, panels: n = Wn }) {
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
					className: V("flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]", r ? "btn-primary" : "btn-ghost"),
					onClick: () => t(n),
					children: [/* @__PURE__ */ J(M, {
						iconName: qh[n].iconName,
						size: 28
					}), /* @__PURE__ */ J("span", {
						className: V("label-micro font-bold truncate max-w-full", r ? null : "text-basic-primary"),
						children: qh[n].label
					})]
				}, n);
			})
		})
	});
}
//#endregion
//#region src/app/components/inspector/PanelCountBadge.tsx
function Yh({ count: e }) {
	return /* @__PURE__ */ J("span", {
		className: "pointer-events-none absolute -top-1 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-btn-primary-disabled px-0.5 text-[9px] leading-3 font-medium text-basic-secondary",
		children: e
	});
}
//#endregion
//#region src/app/components/inspector/sessionPanelIcons.ts
var Xh = {
	sessions: L.Chat,
	threads: L.Flow,
	delegated: L.Robot,
	files: L.Folders,
	terminal: L.Terminal,
	worksets: L.Checklist,
	history: L.History
};
function Zh(e, t, n) {
	return e === "delegated" ? t : e === "worksets" ? n : 0;
}
function Qh({ sessionId: e, snapshot: t, behavior: n, panels: r, onOpen: i, onSelect: a }) {
	let o = ct(), s = r.includes("delegated"), c = he(e, s), l = f(e, s && n === "direct-with-orchestrator"), u = (c.data?.length ?? 0) + (o.orchestrationEnabled ? l.data?.length ?? 0 : 0), d = t?.worksets?.items.length ?? 0;
	return /* @__PURE__ */ J("div", {
		className: "flex h-full flex-col items-center p-2",
		style: { width: 52 },
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col items-center gap-4 [&>*]:shrink-0",
			children: [/* @__PURE__ */ J($h, {
				label: "Show panel",
				onClick: i,
				children: /* @__PURE__ */ J(M, { iconName: L.SidebarChevronLeft })
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col items-center gap-4",
				children: r.map((e) => {
					let t = Zh(e, u, d);
					return /* @__PURE__ */ Y("span", {
						className: "relative",
						children: [/* @__PURE__ */ J($h, {
							label: sr[e],
							onClick: () => a(e),
							children: /* @__PURE__ */ J(M, { iconName: Xh[e] })
						}), t > 0 ? /* @__PURE__ */ J(Yh, { count: t }) : null]
					}, e);
				})
			})]
		})
	});
}
function $h({ label: e, onClick: t, children: n }) {
	return /* @__PURE__ */ J(Zn, {
		title: e,
		position: z.CenterLeft,
		sticky: !0,
		children: /* @__PURE__ */ J(s, {
			variant: I.Ghost,
			content: R.Icon,
			"aria-label": e,
			onClick: t,
			children: n
		})
	});
}
//#endregion
//#region src/app/features/terminal/queries.ts
var eg = {
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
function tg(e) {
	let { api: t } = B();
	return ii({
		queryKey: eg.list(e),
		queryFn: ({ signal: n }) => t.listUserTerminals(e, n),
		retry: !1,
		refetchInterval: 2e3
	});
}
function ng(e, t) {
	let { api: n } = B();
	return ii({
		queryKey: eg.status(e, t),
		queryFn: ({ signal: r }) => n.getUserTerminal(e, t, r),
		retry: !1,
		refetchInterval: (e) => !e.state.data || e.state.data.alive || !e.state.data.output_complete ? 1e3 : !1
	});
}
function rg(e) {
	let { api: t } = B(), n = ai();
	return ri({
		mutationFn: (n) => t.openUserTerminal(e, {
			protocol_version: 1,
			launch_id: n,
			cols: 80,
			rows: 24
		}),
		retry: !1,
		onSuccess: () => n.invalidateQueries({ queryKey: eg.list(e) })
	});
}
function ig(e, t) {
	let { api: n } = B(), r = ai();
	return ri({
		mutationFn: () => n.terminateTerminal(e, t),
		retry: !1,
		onSuccess: () => Promise.all([r.invalidateQueries({ queryKey: eg.list(e) }), r.invalidateQueries({ queryKey: eg.status(e, t) })])
	});
}
//#endregion
//#region packages/nac-client/src/userTerminalInputPump.ts
var ag = 16384, og = class extends Error {
	cause;
	constructor(e, t) {
		super(e), this.name = "TerminalInputNotSentError", this.cause = t;
	}
}, sg = class {
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
			this.disposed = !0, this.rejectPending(new og("Terminal input was not sent because its consumer closed", this.signal.reason));
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
		return e.length === 0 || e.length > ag ? Promise.reject(new og("Terminal input was not sent: each input must contain 1–16384 bytes")) : this.disposed ? Promise.reject(new og("Terminal input was not sent because its consumer closed")) : this.failed === void 0 ? this.active && this.pendingBytes + e.length > ag ? Promise.reject(new og("Terminal input was not sent because the pending 16 KiB buffer is full")) : new Promise((t, n) => {
			let r = {
				resolve: t,
				reject: n
			};
			this.active ? (this.pending ??= {
				buffer: new Uint8Array(ag),
				length: 0,
				receipts: []
			}, this.pending.buffer.set(e, this.pending.length), this.pending.length += e.length, this.pending.receipts.push(r)) : (this.active = !0, this.deliver({
				bytes: e.slice(),
				receipts: [r]
			}));
		}) : Promise.reject(new og("Terminal input was not sent: acknowledge the preceding delivery failure first", this.failed));
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
			let n = t instanceof Ee ? t : new og("Terminal input was not sent", t);
			for (let t of e.receipts) t.reject(n);
			this.rejectPending(new og("Pending terminal input was not sent after the preceding delivery failed", t));
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
		if (this.active) throw new og("Wait for the active input receipt before acknowledging its outcome");
		this.failed = void 0, this.connection.acknowledgeInputUncertainty();
	}
	dispose() {
		this.abort.abort(new DOMException("Terminal input consumer closed", "AbortError")), this.signal.removeEventListener("abort", this.cancelListener);
	}
}, cg = 14, lg = 1.2, ug = "\"IBMPlexMono\", Menlo, monospace";
async function dg(e) {
	let { Terminal: t } = await import("./chunks/xterm-DRfz6phr.js"), n = new t({
		cols: 80,
		rows: 24,
		fontFamily: ug,
		fontSize: cg,
		lineHeight: lg,
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
		fit: () => fg(n, e),
		dispose: () => {
			i = !0, r.dispose(), n.dispose();
		}
	};
}
function fg(e, t) {
	let n = document.createElement("canvas").getContext("2d");
	if (!n || t.clientWidth < 1 || t.clientHeight < 1) return null;
	n.font = `${cg}px ${ug}`;
	let r = n.measureText("W").width;
	if (r <= 0) return null;
	let i = Math.max(2, Math.min(500, Math.floor((t.clientWidth - 18) / r))), a = e.element ? e.element.clientHeight / e.rows : 0, o = a > 0 ? a : cg * lg, s = Math.max(1, Math.min(300, Math.floor(t.clientHeight / o)));
	return e.cols === i && e.rows === s ? null : (e.resize(i, s), {
		cols: i,
		rows: s
	});
}
//#endregion
//#region src/app/features/terminal/browserRuntime.ts
var pg = class extends ne("TerminalOperationFailure") {};
function mg(e, t) {
	return dt({
		try: t,
		catch: (t) => new pg({
			operation: e,
			cause: t
		})
	});
}
function hg(e, t) {
	return e instanceof Error ? e.message : t;
}
function gg(e) {
	let n = Ur(ht()), r = new AbortController(), i = () => !r.signal.aborted, a = (e) => {
		i() ? Ur(er(n, oe(e))) : e();
	}, s, c = (t) => {
		i() && (e.phase("Disconnected"), e.notice(hg(t, "Terminal observation failed")), s && (s.terminal.options.disableStdin = !0));
	}, l = (e) => {
		We(e, { signal: r.signal }).then((e) => {
			if (t(e) && i()) {
				let t = Ct(e.cause);
				c(ar(t) ? t.value.cause : Be(e.cause));
			}
		}).catch(c);
	};
	return l(De(function* () {
		s = yield* mg("renderer", () => dg(e.host).then((e) => (a(e.dispose), r.signal.throwIfAborted(), e)));
		let t = s, n = new Fe(e.api, e.sessionId, e.terminalId, t.renderer, { pageLimit: 32768 });
		a(() => {
			n.detach().catch(() => {});
		});
		let c = new sg(n, r.signal);
		a(() => {
			(c.hasActiveInput || c.needsAcknowledgement) && (e.previousFailure.current = !0), c.dispose(), e.controls(null);
		}), e.controls({
			adapter: t,
			pump: c
		});
		let u = !1, d = !1, f = !1, p = null, m = st(() => {
			let a = t.fit();
			return a && (p = a), f || !u || !d ? je : (f = !0, De(function* () {
				for (; p && i() && d;) {
					let e = p;
					p = null, yield* mg("resize", () => n.resize(e.cols, e.rows, r.signal));
				}
			}).pipe(o((t) => oe(() => {
				i() && e.notice(`Terminal resize failed: ${hg(t.cause, "geometry control unavailable")}`);
			})), Cn(oe(() => {
				f = !1;
			}))));
		}), h = (n) => {
			!i() || !u || t.terminal.options.disableStdin || l(mg("input", () => c.send(n)).pipe(o((n) => oe(() => {
				i() && (e.notice(hg(n.cause, "Terminal input failed")), c.needsAcknowledgement && (e.previousFailure.current = !0, t.terminal.options.disableStdin = !0, e.inputFailure(!0)));
			}))));
		}, g = t.terminal.onData((e) => h(new TextEncoder().encode(e)));
		a(() => g.dispose());
		let _ = t.terminal.onBinary((e) => h(Uint8Array.from(e, (e) => e.charCodeAt(0))));
		a(() => _.dispose());
		let v = new ResizeObserver(() => l(m));
		a(() => v.disconnect()), v.observe(e.host), t.terminal.element && v.observe(t.terminal.element), e.phase("Connecting"), e.notice(""), e.inputFailure(e.previousFailure.current);
		let y = yield* mg("attach", () => n.attach(r.signal, e.reconnect ? "reconnect" : "attach"));
		if (!i()) return;
		u = !0, d = y.alive;
		let b = y.alive && e.initialTyping && !e.reconnect && !e.previousFailure.current;
		t.terminal.options.disableStdin = !b, e.needsInputEnable(y.alive && !b), e.previousFailure.current && e.notice("Input delivery was not confirmed. Check the shell before enabling fresh input."), e.phase(y.alive ? "Connected" : "Retained output"), yield* m, document.fonts.ready.then(() => {
			i() && l(m);
		}), yield* mg("observe", () => n.run(r.signal, (t) => {
			d = t.terminal.alive, d || (p = null), t.gap && i() && e.notice("Earlier output was discarded. The display was reset before retained output was replayed.");
		})), i() && (t.terminal.options.disableStdin = !0, e.phase("Output complete"));
	})), () => {
		r.abort(), Ur(me(n, hr));
	};
}
//#endregion
//#region src/app/features/terminal/useTerminalController.ts
function _g(e, t, n, r) {
	let { api: i } = B(), a = G(null), [o, s] = K(0), [c, l] = K("Connecting"), [u, d] = K(""), [f, p] = K(!1), [m, h] = K(!1), g = G(r), _ = G(!1);
	return U(() => {
		let r = n.current;
		if (r) return gg({
			api: i,
			sessionId: e,
			terminalId: t,
			host: r,
			reconnect: o !== 0,
			initialTyping: g.current,
			previousFailure: _,
			controls: (e) => {
				a.current = e;
			},
			phase: l,
			notice: d,
			inputFailure: p,
			needsInputEnable: h
		});
	}, [
		i,
		e,
		t,
		o,
		n
	]), {
		phase: c,
		notice: u,
		inputFailure: f,
		needsInputEnable: m,
		reconnect: () => s((e) => e + 1),
		selection: () => {
			let e = a.current?.adapter.terminal.getSelection() ?? "";
			return e || d("Select text in the terminal before reviewing it."), e;
		},
		focus: () => a.current?.adapter.terminal.focus(),
		acknowledgeInput: () => {
			let e = a.current;
			!e || e.pump.hasActiveInput || c !== "Connected" || (e.pump.acknowledgeFailure(), e.adapter.terminal.options.disableStdin = !1, _.current = !1, p(!1), h(!1), d("Previous input will not be retried. Only fresh typing will be sent."), e.adapter.terminal.focus());
		}
	};
}
//#endregion
//#region src/app/features/terminal/TerminalPane.tsx
function vg(e) {
	let { api: t } = B(), n = W(() => ({
		api: t,
		id: crypto.randomUUID()
	}), [t]);
	return /* @__PURE__ */ J(yg, { ...e }, `${n.id}:${e.sessionId}`);
}
function yg({ sessionId: e, onReviewSelection: t }) {
	let n = tg(e), r = rg(e), [i, a] = K(null), [o, c] = K(null), l = G(null), u = n.data?.terminals ?? [], d = i ?? u[0]?.terminal_id;
	return /* @__PURE__ */ Y("section", {
		"aria-label": "Session terminal",
		className: "flex flex-col flex-1 min-h-0 gap-2 p-3",
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex items-center flex-wrap gap-2",
				children: [
					/* @__PURE__ */ J("label", {
						className: "sr-only",
						htmlFor: `terminal-${e}`,
						children: "Shell"
					}),
					/* @__PURE__ */ Y("select", {
						id: `terminal-${e}`,
						"aria-label": "Shell",
						value: d ?? "",
						onChange: (e) => {
							c(null), a(e.target.value);
						},
						className: "min-w-0 max-w-full rounded-md border border-muted bg-elevation-level-2 px-2 py-1 text-sm",
						children: [
							d ? null : /* @__PURE__ */ J("option", {
								value: "",
								children: "No shell"
							}),
							d && !u.some((e) => e.terminal_id === d) ? /* @__PURE__ */ J("option", {
								value: d,
								children: "Selected shell unavailable"
							}) : null,
							u.map((e, t) => /* @__PURE__ */ Y("option", {
								value: e.terminal_id,
								children: [
									"Shell ",
									t + 1,
									e.alive ? "" : " (exited)"
								]
							}, e.terminal_id))
						]
					}),
					/* @__PURE__ */ J(s, {
						size: F.Small,
						type: "button",
						variant: I.Secondary,
						disabled: r.isPending,
						onClick: () => {
							l.current ??= crypto.randomUUID(), r.mutate(l.current, { onSuccess: (e) => {
								c(e.terminal_id), a(e.terminal_id), l.current = null;
							} });
						},
						children: r.isPending ? "Opening shell…" : r.isError ? "Retry opening same shell" : "New shell"
					})
				]
			}),
			/* @__PURE__ */ J("p", {
				className: "text-sm text-basic-secondary",
				children: "This shell uses the agent’s execution environment and can change the same files."
			}),
			n.isError ? /* @__PURE__ */ Y("p", {
				role: "alert",
				children: [
					"Shell list unavailable.",
					" ",
					/* @__PURE__ */ J(s, {
						size: F.Small,
						type: "button",
						onClick: () => {
							n.refetch();
						},
						children: "Refresh"
					})
				]
			}) : null,
			r.isError ? /* @__PURE__ */ Y("p", {
				role: "alert",
				children: [r.error.message, " Opening was not confirmed; retry uses the same launch identity."]
			}) : null,
			d ? /* @__PURE__ */ J(bg, {
				sessionId: e,
				terminalId: d,
				newlyOpened: o === d,
				onReviewSelection: t
			}, d) : /* @__PURE__ */ J("p", {
				role: "status",
				children: n.isPending ? "Loading shells…" : "Open a shell to start typing. Terminal output stays separate from the conversation."
			})
		]
	});
}
function bg({ sessionId: e, terminalId: t, onReviewSelection: n, newlyOpened: r }) {
	let i = ng(e, t), a = ig(e, t), o = G(null), c = _g(e, t, o, r);
	return /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ Y("div", {
			className: "flex flex-wrap items-center gap-2",
			children: [
				/* @__PURE__ */ Y("span", {
					role: "status",
					children: [c.phase, i.data && !i.data.alive ? ` · Exited${i.data.exit_code == null ? "" : ` (${i.data.exit_code})`}` : ""]
				}),
				/* @__PURE__ */ J(s, {
					size: F.Small,
					type: "button",
					variant: I.Ghost,
					onClick: c.focus,
					children: "Focus terminal"
				}),
				/* @__PURE__ */ J(s, {
					size: F.Small,
					type: "button",
					variant: I.Ghost,
					disabled: c.phase === "Connecting",
					onClick: c.reconnect,
					children: "Reconnect"
				}),
				/* @__PURE__ */ J(s, {
					size: F.Small,
					type: "button",
					variant: I.Ghost,
					disabled: !i.data?.alive || a.isPending,
					onClick: () => a.mutate(),
					children: a.isPending ? "Closing…" : "Close shell"
				}),
				n ? /* @__PURE__ */ J(s, {
					size: F.Small,
					type: "button",
					variant: I.Ghost,
					onClick: () => {
						let r = c.selection();
						!r || !n || n(Object.freeze({
							sessionId: e,
							terminalId: t,
							selectedText: r,
							capturedAtMs: String(Date.now()),
							sourceAlive: i.data?.alive ?? !1
						}));
					},
					children: "Review selected text"
				}) : null
			]
		}),
		c.notice ? /* @__PURE__ */ J("p", {
			role: "alert",
			children: c.notice
		}) : null,
		c.inputFailure || c.needsInputEnable ? /* @__PURE__ */ J(s, {
			size: F.Small,
			type: "button",
			variant: I.Secondary,
			onClick: c.acknowledgeInput,
			children: c.inputFailure ? "Acknowledge failure and enable fresh input" : "Enable terminal input"
		}) : null,
		a.isError ? /* @__PURE__ */ Y("p", {
			role: "alert",
			children: [a.error.message, " Shell closure was not confirmed; check its status."]
		}) : null,
		i.isError ? /* @__PURE__ */ J("p", {
			role: "alert",
			children: "Shell status unavailable; reconnect to refresh observation."
		}) : null,
		i.data?.output_error ? /* @__PURE__ */ J("p", {
			role: "alert",
			children: i.data.output_error
		}) : null,
		/* @__PURE__ */ J("div", {
			ref: o,
			role: "region",
			"aria-label": "Interactive terminal",
			className: "flex-1 min-h-32 overflow-hidden",
			style: { background: "#151719" }
		})
	] });
}
//#endregion
//#region src/app/features/terminal-selection/SelectionReview.tsx
function xg({ state: e, controller: t, availability: n }) {
	let r = Zr(), i = e.phase === "sending", a = i || e.phase === "uncertain" || e.phase === "accepted", o = e.phase === "editing", c = e.choice.delivery === "steer" && e.choice.runId !== n.runId, l = e.phase === "reviewed" && !n.sourceUnavailable && (e.choice.delivery === "queue" || e.choice.delivery === "send" && n.mode === "idle" || e.choice.delivery === "steer" && n.mode === "busy" && !!n.runId && !c), u = e.choice.delivery === "queue" ? "Queue selection" : e.choice.delivery === "steer" ? "Steer selected run" : "Send selection";
	return /* @__PURE__ */ J(ur, {
		open: e.phase !== "empty",
		title: "Review terminal selection",
		size: Wt.Large,
		onClose: i ? void 0 : () => t.clear(),
		onNavigate: () => t.clear(),
		closeOnOverlay: !i,
		footer: /* @__PURE__ */ Y("div", {
			className: "flex flex-wrap gap-2 justify-end",
			children: [
				/* @__PURE__ */ J(s, {
					type: "button",
					variant: I.Ghost,
					disabled: i,
					onClick: () => t.clear(),
					children: e.phase === "uncertain" ? "Dismiss unconfirmed submission" : "Dismiss review"
				}),
				e.phase === "accepted" ? null : /* @__PURE__ */ J(s, {
					type: "button",
					variant: I.Secondary,
					disabled: i,
					onClick: () => t.clear(),
					children: "Clear selection review"
				}),
				e.phase === "uncertain" ? /* @__PURE__ */ J(s, {
					type: "button",
					onClick: () => void t.retry(),
					children: "Retry same submission"
				}) : e.phase === "accepted" ? null : /* @__PURE__ */ J(s, {
					type: "button",
					disabled: !l,
					loading: i,
					onClick: () => void t.send(),
					children: i ? "Sending selection…" : u
				})
			]
		}),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-4 text-sm",
			children: [
				/* @__PURE__ */ J("p", { children: "Only this selected text and optional accompanying text will be shared as literal, untrusted evidence. Reviewing does not send anything to the agent." }),
				e.source ? /* @__PURE__ */ Y("details", { children: [
					/* @__PURE__ */ J("summary", { children: "Selection source" }),
					/* @__PURE__ */ Y("p", {
						className: "break-all",
						children: ["Chat: ", e.source.sessionId]
					}),
					/* @__PURE__ */ Y("p", {
						className: "break-all",
						children: ["Shell: ", e.source.terminalId]
					}),
					/* @__PURE__ */ Y("p", { children: [
						"Client capture time: ",
						e.source.capturedAtMs,
						" ms"
					] })
				] }) : null,
				n.sourceAlive === !1 ? /* @__PURE__ */ J("p", {
					role: "status",
					children: "The source shell has exited. This frozen selection can still be shared while its retained source remains available."
				}) : e.source && !e.source.sourceAlive ? /* @__PURE__ */ J("p", {
					role: "status",
					children: "The shell’s running state was not confirmed at capture."
				}) : null,
				n.sourceUnavailable ? /* @__PURE__ */ J("p", {
					role: "alert",
					children: "The source is currently unavailable. A new send is disabled; an unconfirmed submission can still be reconciled with its original identity."
				}) : null,
				e.error ? /* @__PURE__ */ J("p", {
					role: "alert",
					children: e.error
				}) : null,
				e.phase === "uncertain" ? /* @__PURE__ */ J("p", { children: "Dismissing or clearing this review does not cancel accepted work. Check history before sending a new copy." }) : null,
				e.phase === "previewing" ? /* @__PURE__ */ J("p", {
					role: "status",
					children: "Preparing the server-normalized preview…"
				}) : null,
				e.preview ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-2",
					children: [
						/* @__PURE__ */ J("h3", { children: "Reviewed selected text" }),
						/* @__PURE__ */ J("pre", {
							"aria-label": "Reviewed selected text",
							className: "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3",
							children: e.preview.text
						}),
						/* @__PURE__ */ Y("p", { children: [
							e.preview.text_scalars.toLocaleString(),
							" characters ·",
							" ",
							e.preview.text_utf8_bytes.toLocaleString(),
							" UTF-8 bytes. No truncation."
						] })
					]
				}) : null,
				o ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-2",
					children: [
						/* @__PURE__ */ J("label", {
							htmlFor: `${r}-question`,
							children: "Accompanying literal text (optional)"
						}),
						/* @__PURE__ */ J("textarea", {
							id: `${r}-question`,
							value: e.editorText,
							rows: 4,
							onChange: (e) => t.setUserText(e.target.value),
							className: "rounded bg-bg-elevation-level-1 p-3"
						}),
						/* @__PURE__ */ J("p", { children: "Update the preview before sending. Limits apply separately to selected and accompanying text." }),
						/* @__PURE__ */ J(s, {
							type: "button",
							variant: I.Secondary,
							onClick: () => void t.preview(),
							children: "Update preview"
						})
					]
				}) : !a && e.preview ? /* @__PURE__ */ J(s, {
					type: "button",
					variant: I.Ghost,
					onClick: () => t.editUserText(),
					children: "Edit accompanying text"
				}) : null,
				!o && e.preview?.user_text != null ? /* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("h3", { children: "Reviewed accompanying text" }), /* @__PURE__ */ J("pre", {
					"aria-label": "Reviewed accompanying text",
					className: "max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3",
					children: e.preview.user_text
				})] }) : null,
				e.phase === "error" && e.canPreview ? /* @__PURE__ */ J(s, {
					type: "button",
					variant: I.Secondary,
					onClick: () => void t.preview(),
					children: "Retry preview"
				}) : null,
				/* @__PURE__ */ Y("fieldset", {
					disabled: a,
					className: "flex flex-col gap-2",
					children: [
						/* @__PURE__ */ J("legend", {
							className: "mb-2",
							children: "Delivery"
						}),
						/* @__PURE__ */ Y("label", { children: [
							/* @__PURE__ */ J("input", {
								type: "radio",
								name: `${r}-delivery`,
								checked: e.choice.delivery === "send",
								disabled: n.mode !== "idle",
								onChange: () => t.choose({ delivery: "send" })
							}),
							" ",
							"Send as a new turn (idle chat)"
						] }),
						/* @__PURE__ */ Y("label", { children: [
							/* @__PURE__ */ J("input", {
								type: "radio",
								name: `${r}-delivery`,
								checked: e.choice.delivery === "queue",
								onChange: () => t.choose({ delivery: "queue" })
							}),
							" ",
							"Queue after existing input"
						] }),
						/* @__PURE__ */ J("p", { children: "When idle, queued evidence may start the next turn." }),
						/* @__PURE__ */ Y("label", { children: [
							/* @__PURE__ */ J("input", {
								type: "radio",
								name: `${r}-delivery`,
								checked: e.choice.delivery === "steer" && !c,
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
				c ? /* @__PURE__ */ J("p", {
					role: "alert",
					children: "The selected run ended or changed. Choose Queue or explicitly choose the displayed run again; this selection will not be retargeted automatically."
				}) : null,
				e.phase === "reviewed" && e.choice.delivery === "send" && n.mode !== "idle" ? /* @__PURE__ */ J("p", {
					role: "status",
					children: "The chat is busy or its state is unknown. Choose a delivery option before sending."
				}) : null,
				i ? /* @__PURE__ */ J("p", {
					role: "status",
					children: "Admission is in progress. Leaving this view does not cancel accepted work."
				}) : null,
				e.receipt ? /* @__PURE__ */ Y("p", {
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
//#endregion
//#region src/app/features/terminal-selection/reviewController.ts
var Sg = Object.freeze({
	phase: "empty",
	editorText: "",
	choice: { delivery: "send" }
}), Cg = 32768, wg = 8192;
function Tg(e) {
	let t = 0, n = e[Symbol.iterator]();
	for (; !n.next().done;) if (++t > wg) return !1;
	return new TextEncoder().encode(e).byteLength <= Cg;
}
var Eg = class {
	ports;
	#e = Sg;
	#t;
	#n;
	#r;
	#i;
	#a;
	#o = 0;
	#s;
	#c = !1;
	#l = 0;
	#u = 0;
	#d = /* @__PURE__ */ new Set();
	constructor(e) {
		this.ports = e;
	}
	getSnapshot = () => this.#e;
	subscribe = (e) => (this.#d.add(e), () => this.#d.delete(e));
	checkActivation = () => {
		!this.#s || this.#s() || (this.#s = void 0, this.#a?.abort(), this.#o += 1, this.#e.phase === "sending" && this.#i ? this.#f({
			...this.#e,
			phase: "uncertain",
			error: "The chat view was reset before submission was confirmed. It may already be accepted. Retry keeps the exact reviewed intent and submission identity."
		}) : this.#e.phase === "previewing" && this.#f({
			...this.#e,
			phase: "error",
			error: "The chat view was reset before preview was confirmed. Retry the preview explicitly; nothing was sent."
		}));
	};
	retain = () => (this.#l += 1, this.#u += 1, () => {
		--this.#l;
		let e = ++this.#u;
		queueMicrotask(() => {
			!this.#l && this.#u === e && this.dispose();
		});
	});
	#f(e) {
		if (!this.#c) {
			this.#e = Object.freeze(e);
			for (let e of this.#d) e();
		}
	}
	capture(e, t) {
		if (this.#c) return;
		if (this.#e.phase !== "empty" && this.#e.phase !== "accepted") {
			this.#f({
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
		if (e.sessionId !== this.ports.sessionId || !n.trim() || !Tg(n)) {
			this.#f({
				...Sg,
				source: r,
				phase: "error",
				error: "Select visible text within 32 KiB and 8,192 characters from this chat. Nothing was truncated or sent."
			});
			return;
		}
		this.#t = Object.freeze({
			...r,
			selectedText: n
		}), this.#n = crypto.randomUUID(), this.#f({
			source: Object.freeze(r),
			phase: "editing",
			canPreview: !0,
			editorText: "",
			choice: Object.freeze({ ...t })
		}), this.preview();
	}
	setUserText(e) {
		if (!(!this.#t || [
			"sending",
			"uncertain",
			"accepted"
		].includes(this.#e.phase))) {
			if (!Tg(e)) {
				this.#f({
					...this.#e,
					error: "Accompanying text exceeds 32 KiB or 8,192 characters. That edit was rejected without truncation."
				});
				return;
			}
			this.#a?.abort(), this.#o += 1, this.#r = e === "" ? void 0 : e, this.#f({
				...this.#e,
				phase: "editing",
				editorText: e,
				error: void 0
			});
		}
	}
	editUserText() {
		!this.#t || [
			"sending",
			"uncertain",
			"accepted"
		].includes(this.#e.phase) || (this.#a?.abort(), this.#o += 1, this.#f({
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
		].includes(this.#e.phase) || this.#f({
			...this.#e,
			choice: Object.freeze({ ...e }),
			error: void 0
		});
	}
	async preview() {
		let e = this.#t;
		if (!e || !this.#n || [
			"sending",
			"uncertain",
			"accepted"
		].includes(this.#e.phase)) return;
		this.#a?.abort();
		let t = new AbortController();
		this.#a = t;
		let n = ++this.#o, r = this.ports.captureActivation();
		this.#s = r, this.#f({
			...this.#e,
			phase: "previewing",
			editorText: "",
			error: void 0
		});
		try {
			let i = await this.ports.api.previewUserTerminalSelection(e.sessionId, e.terminalId, {
				protocol_version: 1,
				capture_id: this.#n,
				client_capture_time_ms: e.capturedAtMs,
				selected_text: e.selectedText,
				user_text: this.#r
			}, t.signal);
			if (!this.#c && n === this.#o) {
				if (!r()) {
					this.checkActivation();
					return;
				}
				this.#s = void 0, this.#f({
					...this.#e,
					phase: "reviewed",
					preview: Object.freeze(i),
					editorText: "",
					error: void 0
				});
			}
		} catch {
			if (!this.#c && n === this.#o) {
				if (!r()) {
					this.checkActivation();
					return;
				}
				this.#s = void 0, this.#f({
					...this.#e,
					phase: "error",
					editorText: "",
					error: "This source could not provide a valid selection preview. It may be unavailable or the text may exceed its bounds. Nothing was sent."
				});
			}
		}
	}
	async send() {
		let e = this.#t, t = this.#e.preview;
		if (!e || !t || this.#e.phase !== "reviewed") return;
		let n = this.#e.choice;
		n.delivery === "steer" && !n.runId || (this.#i = Object.freeze({
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
		}), await this.#p(this.#i, e));
	}
	async retry() {
		this.#e.phase !== "uncertain" || !this.#i || !this.#t || await this.#p(this.#i, this.#t);
	}
	async #p(e, t) {
		this.#a?.abort();
		let n = new AbortController();
		this.#a = n;
		let r = ++this.#o, i = this.ports.captureActivation();
		this.#s = i, this.#f({
			...this.#e,
			phase: "sending",
			error: void 0
		});
		try {
			let a = await this.ports.api.submitUserTerminalSelection(t.sessionId, t.terminalId, e, n.signal);
			if (!this.#c && r === this.#o) {
				if (!i()) {
					this.checkActivation();
					return;
				}
				this.#s = void 0, this.ports.accepted(), this.#t = void 0, this.#r = void 0, this.#i = void 0, this.#f({
					...this.#e,
					phase: "accepted",
					receipt: Object.freeze(a),
					editorText: "",
					error: void 0
				});
			}
		} catch {
			if (!this.#c && r === this.#o) {
				if (!i()) {
					this.checkActivation();
					return;
				}
				this.#s = void 0, this.#f({
					...this.#e,
					phase: "uncertain",
					error: "Submission was not confirmed and may already be accepted. Retry uses this exact reviewed text, delivery choice and submission identity."
				});
			}
		}
	}
	clear() {
		this.#s = void 0, this.#a?.abort(), this.#o += 1, this.#t = void 0, this.#n = void 0, this.#r = void 0, this.#i = void 0, this.#f(Sg);
	}
	dispose() {
		this.clear(), this.#c = !0, this.#d.clear();
	}
};
//#endregion
//#region src/app/features/terminal-selection/useSelectionReview.ts
function Dg(e) {
	let t = B(), n = ai(), r = W(() => new Eg({
		sessionId: e,
		api: t.api,
		captureActivation: () => t.stores.runtimeStore.captureRuntimeActivation(e),
		accepted: () => {
			n.invalidateQueries({ queryKey: bn.sessionRoot(e) }), n.invalidateQueries({ queryKey: bn.sessionsAll });
		}
	}), [
		e,
		t,
		n
	]);
	return U(() => r.retain(), [r]), U(() => t.stores.runtimeStore.runtimeStore.subscribe(r.checkActivation), [t, r]), {
		controller: r,
		state: $r(r.subscribe, r.getSnapshot, r.getSnapshot)
	};
}
//#endregion
//#region src/app/features/terminal-selection/TerminalWorkspace.tsx
function Og({ sessionId: e }) {
	let { api: t } = B(), n = W(() => ({
		api: t,
		id: crypto.randomUUID()
	}), [t]);
	return /* @__PURE__ */ J(kg, { sessionId: e }, `${n.id}:${e}`);
}
function kg({ sessionId: e }) {
	let { controller: t, state: n } = Dg(e), r = Nn(e), i = B().stores.runtimeStore.useRunning(e), a = r.data?.active_run?.run_id, o = i || a ? "busy" : r.data && !r.isError ? "idle" : "unknown";
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(vg, {
		sessionId: e,
		onReviewSelection: (e) => t.capture(e, { delivery: o === "idle" ? "send" : "queue" })
	}), n.source ? /* @__PURE__ */ J(Ag, {
		state: n,
		controller: t,
		availability: {
			mode: o,
			runId: a
		}
	}, `${n.source.sessionId}:${n.source.terminalId}`) : null] });
}
function Ag({ state: e, controller: t, availability: n }) {
	let r = e.source, i = ng(r.sessionId, r.terminalId);
	return /* @__PURE__ */ J(xg, {
		state: e,
		controller: t,
		availability: {
			...n,
			sourceAlive: i.data?.alive,
			sourceUnavailable: i.isError
		}
	});
}
//#endregion
//#region src/app/components/inspector/CommitPopover.tsx
function jg(e, t, n) {
	return t == null ? e ? "A run is in flight; wait for it to finish." : n === 0 ? "Nothing to commit: the checkout matches HEAD." : null : "A revision is open; go back to the working tree to commit.";
}
var Mg = (e, t) => `${e} ${t}${e === 1 ? "" : "s"}`;
function Ng({ sessionId: e, changed: t, revision: n }) {
	let { useRunning: r } = B().stores.runtimeStore, [i, a] = K(!1), [o, c] = K(""), l = g(), u = r(e), d = _n(), f = te(e), p = jg(u, n, t.length), m = t.reduce((e, t) => e + (t.additions ?? 0), 0), h = t.reduce((e, t) => e + (t.deletions ?? 0), 0), _ = () => {
		a(!1), f.reset();
	}, v = () => {
		let e = o.trim();
		!e || p || f.isPending || f.mutate({ message: e }, { onSuccess: (e) => {
			d.success(`Committed ${Mg(e.files_changed, "file")} as ${e.sha.slice(0, 7)}.`), c(""), _();
		} });
	};
	return /* @__PURE__ */ J(Ln, {
		open: i,
		onClose: _,
		sticky: !0,
		placement: z.BottomRight,
		size: hn.Medium,
		content: /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(oc, {
				autoFocus: !0,
				rows: 3,
				textAreaSize: ac.Small,
				placeholder: "Commit message",
				value: o,
				onChange: (e) => c(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), v());
				}
			}),
			/* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [
					/* @__PURE__ */ Y("span", {
						className: "flex-1 min-w-0 truncate",
						children: ["Staging ", Mg(t.length, "file")]
					}),
					/* @__PURE__ */ Y("span", {
						className: "code code-small text-success-primary",
						children: ["+", m]
					}),
					/* @__PURE__ */ Y("span", {
						className: "code code-small text-error-primary",
						children: ["-", h]
					})
				]
			}),
			f.error ? /* @__PURE__ */ J("div", {
				className: "p-1 label-micro text-error-primary",
				children: nr(f.error)
			}) : null,
			/* @__PURE__ */ J(s, {
				size: F.Medium,
				variant: I.Secondary,
				disabled: !o.trim(),
				loading: f.isPending,
				onClick: v,
				children: "Commit"
			})
		] }),
		children: l ? /* @__PURE__ */ J(wi, {
			className: "shrink-0",
			variant: I.Secondary,
			disabled: !!p,
			"aria-expanded": i,
			title: p ?? "Commit every change in the checkout",
			onClick: () => i ? _() : a(!0),
			children: "Commit"
		}) : /* @__PURE__ */ J(s, {
			className: "max-w-[120px] shrink-0",
			size: F.Small,
			variant: I.Secondary,
			disabled: !!p,
			"aria-expanded": i,
			title: p ?? "Commit every change in the checkout",
			onClick: () => i ? _() : a(!0),
			children: "Commit"
		})
	});
}
//#endregion
//#region src/app/components/inspector/PanelSplit.tsx
function Pg({ list: e, listToolbar: t, listTitle: n, title: r, titleAction: i, actions: a, children: o }) {
	let { setPanelListWidth: c, usePanelListWidth: l } = B().stores.panelWidth, { useSidePanelList: u, toggleSidePanelList: d, showSidePanelList: f } = B().stores.sessionLayoutStore, p = l(), m = g(), h = Ar(), _ = u(), v = G(null), [b, x] = K(0), S = G(!1), w = G(null);
	U(() => () => w.current?.(), []), U(() => {
		let e = v.current;
		if (!e) return;
		let t = () => x(e.clientWidth);
		t();
		let n = new ResizeObserver(t);
		return n.observe(e), () => n.disconnect();
	}, []);
	let T = b > 0 ? b * C : p, E = y(p, T);
	return m ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-0-5",
		children: o
	}), /* @__PURE__ */ Y(ur, {
		open: _,
		onClose: () => f(!1),
		title: n,
		keepOnNavigate: !0,
		bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
		children: [/* @__PURE__ */ J("div", {
			className: V("flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-2 gap-1 [&>*]:shrink-0", t && "pb-[80px]"),
			children: e
		}), t ? /* @__PURE__ */ J("div", {
			className: "absolute inset-x-0 bottom-0 z-10 p-4 pointer-events-none [&>*]:pointer-events-auto",
			children: t
		}) : null]
	})] }) : h ? /* @__PURE__ */ Y("div", {
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
				/* @__PURE__ */ J(s, {
					size: F.Medium,
					variant: I.Ghost,
					content: R.Icon,
					"aria-label": "Open list",
					"aria-expanded": !1,
					onClick: d,
					children: /* @__PURE__ */ J(M, { iconName: L.List })
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
			children: o
		})]
	}) : /* @__PURE__ */ Y("div", {
		ref: v,
		className: "flex flex-1 min-h-0 w-full",
		children: [/* @__PURE__ */ Y("div", {
			className: "relative flex flex-col shrink-0 min-h-0 border-r border-muted bg-elevation-level-1",
			style: { width: E },
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
					"aria-valuemax": Math.round(T),
					"aria-valuenow": E,
					tabIndex: 0,
					className: "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none",
					onPointerDown: (e) => {
						if (e.button !== 0) return;
						let t = v.current;
						if (!t) return;
						e.preventDefault(), w.current?.(), S.current = !0, e.currentTarget.setPointerCapture(e.pointerId);
						let n = e.currentTarget, r = t.style.cursor, i = t.style.userSelect;
						t.style.cursor = "col-resize", t.style.userSelect = "none";
						let a = (n) => {
							if (!S.current || n.pointerId !== e.pointerId) return;
							let r = t.getBoundingClientRect(), i = n.clientX - r.left;
							c(y(i, r.width * C));
						}, o = () => {
							S.current = !1, t.style.cursor = r, t.style.userSelect = i, window.removeEventListener("pointermove", a), window.removeEventListener("pointerup", o), window.removeEventListener("pointercancel", o);
							try {
								n.releasePointerCapture(e.pointerId);
							} catch {}
						};
						w.current = o, window.addEventListener("pointermove", a), window.addEventListener("pointerup", o), window.addEventListener("pointercancel", o);
					},
					onKeyDown: (e) => {
						let t = e.shiftKey ? 24 : 8;
						e.key === "ArrowLeft" ? (e.preventDefault(), c(y(E - t, T))) : e.key === "ArrowRight" && (e.preventDefault(), c(y(E + t, T)));
					}
				})
			]
		}), /* @__PURE__ */ J("div", {
			className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-1",
			children: o
		})]
	});
}
function Fg({ label: e, active: t = !1, disabled: n = !1, icon: r, trailing: i, labelClassName: a, title: o, onClick: s }) {
	let c = g();
	return /* @__PURE__ */ Y(Zc, {
		type: "button",
		size: c ? Yc.Large : Yc.Small,
		active: t,
		disabled: n,
		"aria-pressed": t,
		title: o,
		onClick: s,
		children: [
			r,
			/* @__PURE__ */ J("span", {
				className: V("flex-1 min-w-0 truncate text-left", a),
				children: e
			}),
			i
		]
	});
}
function Ig({ listTitle: e }) {
	return /* @__PURE__ */ J(Pg, {
		listTitle: e,
		list: /* @__PURE__ */ J("div", {
			className: "px-1",
			children: /* @__PURE__ */ J(Li, {
				rows: 2,
				rowClassName: "h-6"
			})
		}),
		children: /* @__PURE__ */ J("div", {
			role: "status",
			"aria-label": `Loading ${e ?? "panel"}`,
			className: "flex flex-1 flex-col min-h-0 overflow-hidden p-4",
			children: /* @__PURE__ */ J(Li, {
				rows: 3,
				rowClassName: "h-6"
			})
		})
	});
}
function Lg({ title: e, children: t }) {
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
var Rg = 3e3;
function zg(e, t) {
	let { useWorkspaceEpoch: n } = B().stores.runtimeStore, r = ai(), i = n(), a = G(null), o = G(0);
	U(() => {
		if (t != null || i === 0 || a.current !== null) return;
		let n = Math.max(0, Rg - (Date.now() - o.current));
		a.current = window.setTimeout(() => {
			a.current = null, o.current = Date.now(), Ae("query:invalidate.workspace", { throttleMs: 0 }), r.invalidateQueries({
				queryKey: bn.sessionSnapshot(e),
				exact: !0
			}), r.invalidateQueries({ queryKey: bn.workspaceFilesRoot(e) }), r.invalidateQueries({ queryKey: bn.workspaceDiffRoot(e) }), r.invalidateQueries({ queryKey: bn.workspaceFileRoot(e) });
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
var Bg = {
	M: "text-danger-primary",
	A: "text-info-primary",
	"?": "text-info-primary",
	R: "text-info-primary",
	C: "text-info-primary",
	D: "text-error-primary",
	U: "text-error-primary"
}, Vg = (e) => e ? Bg[e.trim()[0]] ?? "text-basic-primary" : null, Hg = (e) => V(Vg(e), e?.trim()[0] === "D" && "line-through") || void 0, Ug = (e) => e.endsWith("/");
function Wg(e) {
	let t = e.replace(/\/+$/, ""), n = t.split("/").pop() || t;
	return Ug(e) ? `${n}/` : n;
}
var Gg = (e, t) => ({
	name: e,
	path: t,
	dirs: /* @__PURE__ */ new Map(),
	files: []
}), Kg = (e, t) => e.name.localeCompare(t.name);
function qg(e) {
	let t = e, n = e.name;
	for (; t.files.length === 0 && t.dirs.size === 1;) {
		let [e] = t.dirs.values();
		n = `${n}/${e.name}`, t = e;
	}
	let r = [...t.dirs.values()].map(qg).sort(Kg), i = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: n,
		path: t.path,
		dirs: r,
		files: i,
		hasChanges: i.some((e) => e.status) || r.some((e) => e.hasChanges)
	};
}
function Jg(e) {
	let t = Gg("", "");
	for (let n of e) {
		let e = n.path.replace(/\/+$/, "").split("/");
		e.pop();
		let r = t, i = "";
		for (let t of e) {
			i = i ? `${i}/${t}` : t;
			let e = r.dirs.get(t);
			e || (e = Gg(t, i), r.dirs.set(t, e)), r = e;
		}
		r.files.push(n);
	}
	let n = [...t.dirs.values()].map(qg).sort(Kg), r = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: "",
		path: "",
		dirs: n,
		files: r,
		hasChanges: r.some((e) => e.status) || n.some((e) => e.hasChanges)
	};
}
function Yg(e, t = []) {
	for (let n of e.dirs) n.hasChanges && (t.push(n.path), Yg(n, t));
	return t;
}
//#endregion
//#region src/app/components/inspector/FilesView.tsx
function Xg({ open: e }) {
	return /* @__PURE__ */ J(M, {
		iconName: L.Right,
		size: 16,
		className: V("shrink-0 transition-transform", e && "rotate-90")
	});
}
function Zg({ dir: e, depth: t, open: n, selected: r, onToggle: i, onSelect: a }) {
	let o = g();
	return /* @__PURE__ */ Y("div", {
		className: V("flex flex-col gap-[2px]", t > 0 && "pl-1 ml-[3px] border-l border-muted"),
		children: [e.dirs.map((e) => {
			let o = n.has(e.path);
			return /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-[2px] w-full",
				children: [/* @__PURE__ */ J(Fg, {
					label: e.name,
					icon: /* @__PURE__ */ J(Xg, { open: o }),
					labelClassName: e.hasChanges ? "text-danger-primary" : void 0,
					onClick: () => i(e.path)
				}), o ? /* @__PURE__ */ J(Zg, {
					dir: e,
					depth: t + 1,
					open: n,
					selected: r,
					onToggle: i,
					onSelect: a
				}) : null]
			}, e.path);
		}), e.files.map((e) => /* @__PURE__ */ J(Fg, {
			label: Wg(e.path),
			active: r === e.path,
			title: e.path,
			labelClassName: Hg(e.status),
			icon: /* @__PURE__ */ J(Us, {
				path: e.path,
				size: o ? 24 : 16
			}),
			onClick: () => a(e.path)
		}, e.path))]
	});
}
function Qg({ files: e, selected: t, onSelect: n }) {
	let r = g();
	return e.length === 0 ? /* @__PURE__ */ J("div", {
		className: "p-1 label-micro text-basic-muted",
		children: "Nothing has changed here yet."
	}) : /* @__PURE__ */ J("div", {
		className: "flex flex-col gap-[2px]",
		children: e.map((e) => /* @__PURE__ */ J(Fg, {
			label: Wg(e.path),
			active: t === e.path,
			title: e.path,
			labelClassName: Hg(e.status),
			icon: /* @__PURE__ */ J(Us, {
				path: e.path,
				size: r ? 24 : 16
			}),
			onClick: () => n(e.path)
		}, e.path))
	});
}
function $g({ iconName: e, label: t, active: n, round: r = !1, onClick: i }) {
	return /* @__PURE__ */ J(s, {
		className: r ? "btn-round" : void 0,
		size: r ? F.Medium : F.Small,
		variant: n ? I.Primary : I.Ghost,
		content: R.Icon,
		"aria-pressed": n,
		"aria-label": t,
		title: t,
		onClick: i,
		children: /* @__PURE__ */ J(M, { iconName: e })
	});
}
function e_({ sessionId: e, listing: t, changed: n, revision: r, readOnly: i }) {
	let { selectFileListing: a } = B().stores.sessionLayoutStore, o = g(), s = /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J($g, {
		iconName: L.Folders,
		label: "Show every file",
		active: t === "tree",
		round: o,
		onClick: () => a("tree")
	}), /* @__PURE__ */ J($g, {
		iconName: L.Scheme,
		label: "Show changed files only",
		active: t === "changed",
		round: o,
		onClick: () => a("changed")
	})] }), c = i ? null : /* @__PURE__ */ J(Ng, {
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
function t_({ lineNo: e, content: t, tokens: n, tone: r, trailing: i }) {
	return /* @__PURE__ */ Y("div", {
		className: V("flex items-start w-full border-l-2 border-solid", r === "add" ? "bg-success-primary border-success-primary" : r === "delete" ? "bg-error-primary border-error-primary" : "border-transparent"),
		children: [/* @__PURE__ */ J("span", {
			className: "shrink-0 w-12 pr-1 text-right opacity-50 code code-small text-basic-muted select-none",
			children: e ?? ""
		}), /* @__PURE__ */ Y("span", {
			className: "flex-1 min-w-0 px-2 code code-small text-basic-primary whitespace-pre-wrap break-words",
			children: [n ? n.map((e, t) => /* @__PURE__ */ J("span", {
				style: Yt(e),
				children: e.text
			}, t)) : t, i]
		})]
	});
}
function n_({ line: e, tokens: t }) {
	let n = e.kind === "delete", r = n ? e.old_lineno : e.new_lineno ?? e.old_lineno;
	return /* @__PURE__ */ J(t_, {
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
function r_({ tone: e, children: t }) {
	return /* @__PURE__ */ J("div", {
		className: V("mx-4 my-2 rounded-md px-3 py-2 code code-small", e === "error" ? "text-error-primary bg-error-tertiary border border-error-muted" : "text-basic-muted bg-elevation-level-0-5"),
		children: t
	});
}
function i_({ section: e, highlighted: t }) {
	return e.error ? /* @__PURE__ */ Y(r_, {
		tone: "error",
		children: ["Error: ", e.error]
	}) : e.binary ? /* @__PURE__ */ J(r_, { children: "Binary or non-UTF-8 content; inline hunks are unavailable." }) : e.too_large ? /* @__PURE__ */ J(r_, { children: "File is too large for inline diff rendering." }) : e.hunks.length === 0 ? /* @__PURE__ */ J(r_, { children: "No hunks for this section." }) : /* @__PURE__ */ Y("div", {
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
			}), e.lines.map((e, n) => /* @__PURE__ */ J(n_, {
				line: e,
				tokens: t.get(e)
			}, n))]
		}, n)), e.truncated ? /* @__PURE__ */ J(r_, { children: "Diff was truncated by the backend." }) : null]
	});
}
function a_({ path: e, trailing: t }) {
	return Ye() ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 h-10 px-4 shrink-0 border-b border-muted bg-elevation-level-1",
		title: e,
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-1 items-center gap-[6px] min-w-0",
			children: [/* @__PURE__ */ J(Us, { path: e }), /* @__PURE__ */ J("span", {
				className: "label-micro text-btn-secondary truncate",
				children: Wg(e)
			})]
		}), /* @__PURE__ */ J("div", {
			className: "flex items-center gap-2 shrink-0 code code-small",
			children: t
		})]
	}) : null;
}
function o_({ children: e }) {
	return /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-h-0 overflow-auto py-2 [&>*]:shrink-0",
		children: e
	});
}
function s_({ sessionId: e, file: t, revision: n }) {
	let { data: r, isFetching: i, error: a } = $n(e, t.path, "all", 3, n), o = W(() => t.additions != null || t.deletions != null ? {
		additions: t.additions ?? 0,
		deletions: t.deletions ?? 0
	} : r ? r.sections.reduce((e, t) => ({
		additions: e.additions + t.additions,
		deletions: e.deletions + t.deletions
	}), {
		additions: 0,
		deletions: 0
	}) : null, [t, r]);
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(a_, {
		path: t.path,
		trailing: o ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("span", {
			className: "text-success-primary",
			children: ["+", o.additions]
		}), /* @__PURE__ */ Y("span", {
			className: "text-error-primary",
			children: ["-", o.deletions]
		})] }) : null
	}), /* @__PURE__ */ Y(o_, { children: [
		i && !r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ J(Le, { size: A.Small }), " Loading diff…"]
		}) : null,
		a ? /* @__PURE__ */ J(r_, {
			tone: "error",
			children: nr(a)
		}) : null,
		r ? /* @__PURE__ */ J(c_, { diff: r }) : null
	] })] });
}
function c_({ diff: e }) {
	let [t, n] = K(() => /* @__PURE__ */ new Map());
	return U(() => {
		let t = !0;
		return br(e.path, e.sections).then((e) => {
			t && n(e);
		}), () => {
			t = !1;
		};
	}, [e]), e.error ? /* @__PURE__ */ J(r_, {
		tone: "error",
		children: e.error
	}) : e.sections.length === 0 ? /* @__PURE__ */ J(r_, { children: "No diff sections returned." }) : /* @__PURE__ */ J(q, { children: e.sections.map((e, n) => /* @__PURE__ */ J(i_, {
		section: e,
		highlighted: t
	}, n)) });
}
var l_ = (e) => e < 1024 ? `${e} B` : `${Math.round(e / 1024)} KB`;
function u_({ sessionId: e, path: t, revision: n }) {
	let { data: r, isFetching: i, error: a } = pe(e, t, n), [o, s] = K(null), c = r?.content?.replace(/\n$/, "") ?? null, l = W(() => c?.split("\n") ?? null, [c]);
	U(() => {
		if (c === null) return;
		let e = !0;
		return Mn(t, c).then((t) => {
			e && t && s({
				text: c,
				lines: t
			});
		}), () => {
			e = !1;
		};
	}, [t, c]);
	let u = o?.text === c ? o.lines : null;
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(a_, {
		path: t,
		trailing: r ? /* @__PURE__ */ J("span", {
			className: "text-basic-muted",
			children: l_(r.size)
		}) : null
	}), /* @__PURE__ */ Y(o_, { children: [
		i && !r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ J(Le, { size: A.Small }), " Loading file…"]
		}) : null,
		a ? /* @__PURE__ */ J(r_, {
			tone: "error",
			children: nr(a)
		}) : null,
		r?.binary ? /* @__PURE__ */ J(r_, { children: "Binary file; nothing to show inline." }) : null,
		r?.too_large ? /* @__PURE__ */ Y(r_, { children: [
			"File is too large to display (",
			l_(r.size),
			")."
		] }) : null,
		l ? l.map((e, t) => /* @__PURE__ */ J(t_, {
			lineNo: t + 1,
			content: e,
			tokens: u?.[t]
		}, t)) : null
	] })] });
}
function d_({ sessionId: e, snapshot: t, revision: n = null, readOnly: r = !1 }) {
	let { useToggledFolders: i, useSelectedFile: a, useFileListing: o, toggleFolder: s, selectFile: c } = B().stores.sessionLayoutStore, l = ai(), u = a(), d = i(), f = o(), { data: p, error: m } = vt(e, n), h = mt(e, n);
	U(() => {
		n ?? l.invalidateQueries({ queryKey: bn.sessionSnapshot(e) });
	}, [
		l,
		e,
		n
	]), zg(e, n);
	let g = t?.workspace ?? null, _ = W(() => n == null ? g?.changed_files ?? [] : h.data?.changed_files ?? [], [
		n,
		g,
		h.data
	]), v = W(() => f_(p?.files ?? [], _), [p, _]), y = W(() => Jg(v), [v]), b = W(() => v.filter((e) => e.status !== null), [v]), x = W(() => {
		let e = new Set(Yg(y));
		for (let t of d) e.delete(t) || e.add(t);
		return e;
	}, [y, d]), S = W(() => new Map(b.map((e) => [e.path, e])), [b]), C = u ?? b[0]?.path ?? null, w = C ? S.get(C) : void 0, T = m ?? (n == null ? null : h.error);
	return n == null && g?.error ? /* @__PURE__ */ J("div", {
		className: "p-6 label-small text-error-primary",
		children: g.error
	}) : T ? /* @__PURE__ */ J("div", {
		className: "p-6 label-small text-error-primary",
		children: nr(T)
	}) : p ? /* @__PURE__ */ J(Pg, {
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
		listToolbar: /* @__PURE__ */ J(e_, {
			sessionId: e,
			listing: f,
			changed: _,
			revision: n,
			readOnly: r
		}),
		list: v.length === 0 ? /* @__PURE__ */ J("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "No files in the workspace."
		}) : f === "changed" ? /* @__PURE__ */ J(Qg, {
			files: b,
			selected: C,
			onSelect: c
		}) : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Zg, {
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
		children: C ? w ? /* @__PURE__ */ J(s_, {
			sessionId: e,
			file: w,
			revision: n
		}, C) : /* @__PURE__ */ J(u_, {
			sessionId: e,
			path: C,
			revision: n
		}, C) : /* @__PURE__ */ J(Lg, { children: v.length === 0 ? "No files in the workspace." : "Select a file to see it." })
	}) : /* @__PURE__ */ J(Ig, { listTitle: "Files" });
}
function f_(e, t) {
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
var p_ = null, m_ = !1;
function h_() {
	return p_ ??= import("./chunks/markdown-renderer-BNFlgw83.js").then((e) => (m_ = !0, e)), p_;
}
function g_() {
	return m_;
}
//#endregion
//#region src/app/lib/markdown.tsx
var __ = Jr(h_);
function v_({ children: e, streaming: t = !1, className: n }) {
	return /* @__PURE__ */ J("div", {
		className: V("chat-response markdown markdown-content text-basic-primary w-full", t && "streaming", n),
		children: /* @__PURE__ */ J(Kr, {
			fallback: /* @__PURE__ */ J("pre", {
				className: "whitespace-pre-wrap font-sans",
				children: e
			}),
			children: /* @__PURE__ */ J(__, {
				streaming: t,
				children: e
			})
		})
	});
}
//#endregion
//#region src/app/components/inspector/ChatBadge.tsx
var y_ = 240;
function b_({ label: e, pending: t = !1, active: n = !1, trailing: r, preface: i, body: a, onClick: o }) {
	En("ChatBadge");
	let [s, c] = K(!1), l = !!a, u = l || !!o, d = s || n;
	return /* @__PURE__ */ Y("div", {
		className: V("flex flex-col items-start w-full my-6 border-l-2 border-solid transition-colors duration-150", d ? "border-primary" : "border-tertiary"),
		children: [
			i,
			/* @__PURE__ */ Y("button", {
				type: "button",
				className: V("group flex items-center py-2 rounded-[4px] max-w-full", l ? "gap-[6px] pl-4 pr-2" : "gap-4 px-4", u ? d ? "btn-ghost-highlighted" : "btn-ghost" : "cursor-default"),
				disabled: !u,
				"aria-expanded": l ? s : void 0,
				"aria-pressed": n || void 0,
				onClick: () => {
					l && c((e) => !e), o?.();
				},
				children: [
					/* @__PURE__ */ J("span", {
						className: V("label-small truncate", t ? "text-shimmer-basic" : "text-btn-secondary"),
						children: e
					}),
					r,
					l ? /* @__PURE__ */ J(M, {
						iconName: s ? L.Down : L.Right,
						size: 20,
						className: V("shrink-0", s ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100")
					}) : null
				]
			}),
			l && a ? /* @__PURE__ */ J(ga, {
				isOpen: s,
				className: "w-full",
				isScrollable: t,
				scrollToBottom: t,
				style: t ? { maxHeight: y_ } : void 0,
				children: /* @__PURE__ */ J("div", {
					className: "thinking-content w-full pl-4 py-3",
					children: /* @__PURE__ */ J(v_, {
						className: "text-basic-tertiary",
						streaming: t,
						children: a
					})
				})
			}) : null
		]
	});
}
function x_({ additions: e, deletions: t }) {
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
var S_ = 8;
function C_({ file: e, active: t, onOpen: n }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		className: V("flex items-center gap-[6px] max-w-full py-2 md:py-1 px-2 rounded-[4px] shrink-0", t ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": t,
		title: e.path,
		onClick: () => n(e.path),
		children: [
			/* @__PURE__ */ J(Us, { path: e.path }),
			/* @__PURE__ */ J("span", {
				className: "text-micro truncate",
				children: Wg(e.path)
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
function w_({ files: e, selected: t, onOpen: n, onOpenAll: r }) {
	if (!e.length) return null;
	let i = e.slice(0, S_), a = e.length - i.length;
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1 md:gap-0 w-full pl-2 pr-4 pb-1 items-start",
		children: [i.map((e) => /* @__PURE__ */ J(C_, {
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
function T_({ revision: e, panel: t }) {
	let { data: n } = mt(t.sessionId, e.id), r = W(() => (n?.changed_files ?? []).filter((e) => !e.path.endsWith("/")), [n]), i = t.selectedRevision === e.id;
	return /* @__PURE__ */ J(b_, {
		label: "Snapshot",
		trailing: /* @__PURE__ */ J(x_, {
			additions: e.additions,
			deletions: e.deletions
		}),
		preface: /* @__PURE__ */ J(w_, {
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
var E_ = 16, D_ = 150;
function O_(e) {
	switch (e) {
		case 0: return "";
		case 1: return "opacity-50";
		case 2: return "opacity-10";
		default: return "opacity-0";
	}
}
function k_(e) {
	let t = G(null), n = G(e);
	return Qr(() => {
		let r = t.current;
		!r || e === n.current || (n.current = e, e && (r.style.transition = "none", r.style.transform = `translateY(${E_}px)`, r.offsetHeight, r.style.transition = `transform ${D_}ms ease-out`, r.style.transform = "translateY(0)"));
	}, [e]), t;
}
function A_({ lines: e, className: t }) {
	let n = e.slice(-4), r = k_(n[n.length - 1]?.key);
	return /* @__PURE__ */ J("div", {
		className: V("flex flex-col justify-end overflow-hidden", t),
		children: /* @__PURE__ */ J("div", {
			ref: r,
			className: "flex flex-col",
			children: n.map((e, t) => /* @__PURE__ */ J("span", {
				className: V("w-full truncate code code-micro !text-[11px] !leading-[16px] !m-0 block", "transition-opacity duration-150 ease-out", "text-basic-tertiary", O_(n.length - 1 - t)),
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
var j_ = {
	error: 0,
	running: 1,
	pending: 2,
	cancelled: 3,
	done: 4
};
function M_({ state: e }) {
	return e === "running" ? /* @__PURE__ */ J(Le, {
		size: A.Small,
		variant: de.Neutral
	}) : e === "pending" ? /* @__PURE__ */ J(M, {
		iconName: L.Timelaps,
		size: 20,
		className: "[&>path]:!fill-basic-muted"
	}) : e === "error" ? /* @__PURE__ */ J(M, {
		iconName: L.Danger,
		size: 20,
		className: "[&>path]:!fill-error-primary"
	}) : e === "cancelled" ? /* @__PURE__ */ J(M, {
		iconName: L.Close,
		size: 20,
		className: "[&>path]:!fill-basic-muted"
	}) : /* @__PURE__ */ J(M, {
		iconName: L.CheckCircle,
		size: 20,
		className: "[&>path]:!fill-basic-primary"
	});
}
function N_(e) {
	return e.reduce((e, t) => j_[t.state] < j_[e] ? t.state : e, "done");
}
function P_({ thread: e, selected: t, onSelect: n }) {
	let r = g(), i = e.state === "running", a = e.state === "pending", o = e.state === "cancelled", s = e.log.length ? e.log : [{
		key: "action",
		text: e.action,
		bare: e.action,
		mark: null,
		name: null,
		body: e.action,
		isError: !1
	}];
	return /* @__PURE__ */ J("div", {
		className: V("shrink-0 h-[84px] max-w-full overflow-hidden rounded-[4px]", r ? "w-[172px]" : "w-[220px]", i || a ? "bg-elevation-level-2" : "bg-elevation-level-1"),
		children: /* @__PURE__ */ Y("button", {
			type: "button",
			className: V("flex flex-col items-start w-full h-full text-left", t ? "btn-ghost-highlighted" : "btn-ghost"),
			"aria-pressed": t,
			onClick: () => n(e.name, e.key),
			children: [/* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 shrink-0 p-2 w-full",
				children: [
					/* @__PURE__ */ J(M_, { state: e.state }),
					/* @__PURE__ */ J("span", {
						className: V("flex-1 min-w-0 truncate label-small", i ? "text-shimmer-basic" : a ? "text-basic-muted" : e.state === "error" ? "text-error-primary" : "text-basic-primary"),
						children: e.name
					}),
					e.weight && /* @__PURE__ */ J("span", {
						className: "shrink-0 rounded-[3px] bg-elevation-level-3 px-1 text-[9px] uppercase tracking-wide text-basic-muted",
						children: e.weight
					})
				]
			}), i || o ? /* @__PURE__ */ J(A_, {
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
function F_({ threads: e, selected: t, onSelect: n }) {
	let r = N_(e);
	return /* @__PURE__ */ J("div", {
		className: V("pl-4 py-3 w-full min-w-0 border-l-2 border-solid", r === "error" ? "border-error-primary" : r === "running" ? "border-primary" : "border-tertiary"),
		children: /* @__PURE__ */ J("div", {
			className: "flex flex-wrap items-start gap-1 w-full min-w-0",
			children: e.map((e) => /* @__PURE__ */ J(P_, {
				thread: e,
				selected: t === e.key,
				onSelect: n
			}, e.key))
		})
	});
}
function I_({ rows: e, selected: t, onSelect: n }) {
	return /* @__PURE__ */ J("div", {
		className: "my-8 w-full flex flex-col items-start",
		children: e.map((e, r) => /* @__PURE__ */ J(F_, {
			threads: e,
			selected: t,
			onSelect: n
		}, e.map((e) => e.key).join("|") || `row-${r}`))
	});
}
//#endregion
//#region src/app/components/inspector/ToolCallDetail.tsx
var L_ = {
	pending: "○",
	running: "▸",
	"awaiting-approval": "◇",
	success: "✓",
	error: "✕",
	"timed-out": "◷",
	cancelled: "■",
	interrupted: "!"
}, R_ = Yr(function({ tool: e }) {
	let t = e.status === "pending" || e.status === "running", n = e.status === "awaiting-approval";
	return /* @__PURE__ */ Y("div", {
		className: "my-3 w-full max-w-full min-w-0 rounded-[6px] border border-tertiary px-3 py-2",
		"data-tool-call-id": e.callId,
		children: [/* @__PURE__ */ Y("div", {
			className: "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1",
			children: [
				/* @__PURE__ */ J("span", {
					"aria-hidden": "true",
					className: V("code code-small shrink-0", n ? "text-accent-primary" : t ? "text-shimmer-basic" : e.status === "success" ? "text-success-primary" : "text-error-primary"),
					children: L_[e.status]
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
					className: V("label-micro shrink-0", n ? "text-accent-primary" : t ? "text-basic-secondary" : "text-basic-muted"),
					children: e.statusLabel
				})
			]
		}), e.resultPreview ? /* @__PURE__ */ J("p", {
			className: "code code-small mt-1 min-w-0 break-all pl-5 text-basic-tertiary",
			children: e.resultPreview
		}) : null]
	});
}), z_ = [
	"parameter",
	"tool_use",
	"tool_call",
	"tool_name",
	"invoke",
	"arguments",
	"parameters",
	"function"
].join("|"), B_ = RegExp(`<(${z_})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), V_ = RegExp(`<\\/?(?:${z_})\\b[^>]*>`, "gi");
function H_(e) {
	if (!e.includes("<")) return e;
	let t = e, n = "";
	for (; t !== n;) n = t, B_.lastIndex = 0, t = t.replace(B_, "");
	return V_.lastIndex = 0, t = t.replace(V_, ""), t;
}
//#endregion
//#region src/app/lib/toolPresentation.ts
function U_(e) {
	return typeof e == "string" ? {
		text: e,
		hasImage: !1
	} : {
		text: e.map((e) => e.type === "text" ? e.text : `[Image: ${e.image.mime_type}]`).join("\n\n"),
		hasImage: e.some((e) => e.type === "image")
	};
}
function W_(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role === "tool") {
			n.set(t.tool_call_id, U_(t.content));
			continue;
		}
		if (t.role === "assistant" || t.role === "user") break;
	}
	return n;
}
function G_(e, t, n) {
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role !== "tool") return t.role === "assistant" && typeof t.content == "string" && t.content.trim() === n;
	}
	return !1;
}
var K_ = {
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
}, q_ = {
	pending: "Pending",
	running: "Running",
	"awaiting-approval": "Awaiting approval",
	success: "Succeeded",
	error: "Failed",
	"timed-out": "Timed out",
	cancelled: "Cancelled",
	interrupted: "Interrupted"
}, J_ = "[tool call cancelled by user]", Y_ = "Tool execution was interrupted; no result was recorded.", X_ = 160, Z_ = 180;
function Q_(e, t) {
	let n = [...e ?? ""].map((e) => {
		let t = e.codePointAt(0) ?? 0;
		return t < 32 || t === 127 ? " " : e;
	}).join("").trim();
	return [...n].length <= t ? n : `${[...n].slice(0, t - 1).join("")}…`;
}
function $_(e) {
	let t = e.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	return t ? t[0].toUpperCase() + t.slice(1) : "Tool call";
}
function ev(e) {
	return K_[e] || (e.startsWith("mcp__") ? `MCP · ${$_(e.split("__").filter(Boolean).at(-1) ?? "tool")}` : $_(e || "tool call"));
}
function tv(e) {
	return e.completion_status === "timed_out" ? "timed-out" : e.completion_status === "cancelled" ? "cancelled" : e.completion_status === "error" ? "error" : e.completion_status === "success" ? "success" : e.command_status === "timed_out" ? "timed-out" : e.command_status === "cancelled" ? "cancelled" : e.command_status === "spawn_error" || e.is_error || e.exit_code != null && e.exit_code !== 0 ? "error" : "success";
}
function nv(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		if (n.type !== "tool_call_started" && n.type !== "tool_call_finished" || n.thread_name) continue;
		let e = t.get(n.call_id) ?? {};
		n.type === "tool_call_started" ? e.started = n : e.finished = n, t.set(n.call_id, e);
	}
	return t;
}
function rv({ call: e, events: t, hasResult: n, resultText: r, resultHasImage: i, active: a, awaitingApproval: o, turnCancelled: s }) {
	let c = Q_(t?.started?.name ?? t?.finished?.name ?? e.function?.name ?? "tool", X_) || "tool", l;
	l = t?.finished ? tv(t.finished) : r?.startsWith(J_) || s && !n ? "cancelled" : r?.trim() === Y_ ? "interrupted" : n ? "success" : a && o ? "awaiting-approval" : a && t?.started ? "running" : a ? "pending" : "interrupted";
	let u = Q_(t?.finished?.content_preview, Z_) || null;
	return !u && i && (u = "Image result"), !u && l === "cancelled" && (u = "No result was retained."), !u && l === "interrupted" && (u = "No result was recorded."), {
		callId: e.id,
		name: c,
		label: ev(c),
		summary: Q_(t?.started?.key_arg_preview, Z_) || null,
		resultPreview: u,
		status: l,
		statusLabel: q_[l]
	};
}
//#endregion
//#region src/app/lib/transcript.ts
var iv = "[run cancelled by user]", av = "[run failed after this partial assistant response]";
function ov(e) {
	let t = e.trim();
	if (t === "[run failed after this partial assistant response]") return "";
	let n = `\n\n${av}`;
	return t.endsWith(n) ? t.slice(0, -n.length).trimEnd() : t;
}
var sv = "[tool call cancelled by user]", cv = /* @__PURE__ */ new Set([
	"threads",
	"thread_read",
	"workset_read",
	"workset_list"
]), lv = "model-streaming";
function uv(e) {
	try {
		let t = JSON.parse(e.function?.arguments || "{}");
		return Object(t) === t ? t : {};
	} catch {
		return {};
	}
}
function dv(e) {
	return P(e) ? e : "";
}
function fv(e, t, n, r, i) {
	if (n.has(e) || i.liveFinishedToolCalls[e]) return !1;
	if (!t || !r) return !0;
	let a = i.worksets.find((e) => e.id === t);
	if (!a) return !0;
	let o = Rr(a.updated_at), s = Rr(r);
	return !Number.isFinite(o) || !Number.isFinite(s) || o < s;
}
function pv(e) {
	let t = [];
	return e.forEach((e) => {
		(e.type === "thread_started" || !t.length) && t.push([]), t[t.length - 1].push(e);
	}), t;
}
function mv(e) {
	let t = {};
	return Object.entries(e).forEach(([e, n]) => {
		t[e] = pv(n);
	}), t;
}
function hv(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = gv(e);
			t[n] = (t[n] ?? 0) + 1;
		});
	}), t;
}
function gv(e) {
	return dv(uv(e).name) || "thread";
}
function _v(e) {
	return gv(e);
}
function vv(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = dv(uv(e).action);
			n && (t[gv(e)] = n);
		});
	}), t;
}
function yv(e) {
	let t = uv(e).threads;
	return Array.isArray(t) ? t.filter(P) : [];
}
function bv(e) {
	let t = e.length;
	if (t <= 1) return t ? [e] : [];
	let n = /* @__PURE__ */ new Map();
	for (let r = 0; r < t; r += 1) {
		let t = gv(e[r]);
		if (n.has(t)) return [e];
		n.set(t, r);
	}
	let r = Array.from({ length: t }, () => []), i = Array.from({ length: t }, () => 0);
	for (let a = 0; a < t; a += 1) {
		let t = /* @__PURE__ */ new Set();
		for (let o of yv(e[a])) {
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
function xv(e, t, n) {
	let r = e.threadEpisodes[t] ?? [];
	return r[n - ((e.dispatchCounts[t] ?? r.length) - r.length)];
}
function Sv(e) {
	let t = /* @__PURE__ */ new Set();
	return e.forEach((n, r) => {
		if (n.role !== "assistant") return;
		let i = W_(e, r), a = (n.tool_calls ?? []).filter((e) => e.function?.name === "thread");
		if (!a.length) return;
		let o = G_(e, r, iv), s = !1;
		for (let e of a) {
			let n = i.get(e.id)?.text, r = _v(e);
			if (n == null) {
				o || t.delete(r);
				continue;
			}
			n.startsWith(sv) ? (t.add(r), s = !0) : t.delete(r);
		}
		if (!(!s && !o)) for (let e of a) i.get(e.id) ?? t.add(_v(e));
	}), t;
}
function Cv(e, t, n, r, i, a, o) {
	let s = gv(e), c = uv(e), l = dv(c.action), u = dv(c.weight), d = u === "light" || u === "heavy" ? u : null, f = i.get(e.id)?.text ?? null, p = t === (r.dispatchCounts[s] ?? 1) - 1 ? r.liveThreads[s] : void 0, m = yv(e).some((e) => a.has(e) && !o.has(e)), h = xv(r, s, t), g = p?.status !== "running" && h?.some((e) => e.type === "thread_finished"), _ = p?.status === "finished", v = !(p?.status === "running" && !p.cancelled) && (f?.startsWith(sv) === !0 || p?.cancelled || f == null && t === (r.dispatchCounts[s] ?? 1) - 1 && r.cancelledNames.has(s)) ? "cancelled" : p?.isError ? "error" : f != null || _ || g ? "done" : m ? "pending" : "running";
	return {
		key: n,
		name: s,
		action: l,
		weight: d,
		summary: f || l,
		log: Gn(cr(h), p?.log ?? []),
		state: v
	};
}
function wv(e, t) {
	for (let n = e.length - 1; n >= 0; --n) {
		let r = e[n];
		if (r.kind === t && (t !== "text" || r.kind !== "text" || r.text.trim() !== "[run cancelled by user]")) return r.text;
	}
	return null;
}
function Tv(e, t) {
	return e.reduce((e, n) => n.kind === t ? e + 1 : e, 0);
}
function Ev(e, t, n = !1) {
	let r = H_(t.reasoning).trim(), i = H_(t.text).trim();
	if (!r && !i) return e;
	let a = e[e.length - 1], o = a?.kind === "model" && !n, s = o ? {
		...a,
		blocks: a.blocks.slice()
	} : {
		kind: "model",
		key: lv,
		blocks: [],
		durationMs: null,
		messageIndex: null
	}, c = !1;
	return r && !wv(s.blocks, "thoughts")?.includes(r) && (s.blocks.push({
		kind: "thoughts",
		key: `thoughts-${Tv(s.blocks, "thoughts")}`,
		text: r,
		durationMs: null,
		streaming: !i
	}), c = !0), i && !wv(s.blocks, "text")?.includes(i) && (s.blocks.push({
		kind: "text",
		key: `text-${Tv(s.blocks, "text")}`,
		text: i
	}), c = !0), c ? o ? [...e.slice(0, -1), s] : [...e, s] : e;
}
function Dv(e, t, n = {}, r = [], i = /* @__PURE__ */ new Set()) {
	let a = e?.messages ?? [], o = e?.response_timing.response_durations_ms ?? [], s = e?.message_created_at ?? [], c = e?.message_page?.start ?? 0, l = e?.metadata?.behavior === "direct" || e?.metadata?.behavior === "direct-with-orchestrator", u = nv(l ? [...e?.primary_tool_events ?? [], ...r] : []), d = -1;
	a.forEach((e, t) => {
		e.role === "user" && (d = t);
	});
	let f = hv(a), p = new Map((e?.threads ?? []).map((e) => [e.name, e.episode_count])), m = new Set(e?.active_threads ?? []), h = {}, g = {};
	for (let [e, t] of Object.entries(f)) {
		let n = p.get(e) ?? 0, r = Math.max(t, n + +!!m.has(e));
		h[e] = r, g[e] = Math.max(0, r - t);
	}
	let _ = {
		liveThreads: t,
		liveFinishedToolCalls: n,
		worksets: e?.worksets?.items ?? [],
		threadEpisodes: mv(e?.thread_events ?? {}),
		dispatchCounts: h,
		cancelledNames: Sv(a)
	}, v = [], y = null, b = /* @__PURE__ */ new Map();
	a.forEach((t, n) => {
		let r = c + n;
		if (t.role === "system" || t.role === "tool") return;
		if (t.role === "user") {
			y = null;
			let e = Qe(t.content);
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
				text: An(t.content),
				invokedSkills: cn(t.content),
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
		let f = H_(t.reasoning_text ?? "").trim();
		f && o.push({
			kind: "thoughts",
			key: `thoughts-${Tv(o, "thoughts")}`,
			text: f,
			durationMs: t.duration_ms ?? null,
			streaming: !1
		});
		let p = ov(H_(t.content ?? ""));
		p && o.push({
			kind: "text",
			key: `text-${Tv(o, "text")}`,
			text: p
		});
		let m = W_(a, n), h = [];
		if ((t.tool_calls ?? []).forEach((t, c) => {
			let f = t.function?.name ?? "tool", p = `${f}-${r}-${c}`;
			if (f === "thread") h.push(t);
			else if (f === "workset_define") {
				let e = dv(uv(t).id);
				o.push({
					kind: "workset",
					key: p,
					worksetId: e,
					pending: fv(t.id, e, m, s[n] ?? null, _)
				});
			} else if (!cv.has(f)) {
				let r = m.get(t.id);
				l ? o.push({
					kind: "tool-detail",
					key: `tool-${t.id}`,
					presentation: rv({
						call: t,
						events: u.get(t.id),
						hasResult: r != null,
						resultText: r?.text ?? null,
						resultHasImage: r?.hasImage ?? !1,
						active: !!e?.active_run && n > d,
						awaitingApproval: i.has(t.id),
						turnCancelled: G_(a, n, iv)
					})
				}) : o.push({
					kind: "tool",
					key: p,
					name: f,
					pending: r == null
				});
			}
		}), h.length) {
			let e = new Set(h.map(gv)), t = /* @__PURE__ */ new Set();
			for (let e of h) {
				let n = gv(e);
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
			let n = bv(h).map((n) => n.map((n) => {
				let i = gv(n), a = g[i] ?? 0;
				return g[i] = a + 1, Cv(n, a, `${i}@${r}:${n.id}`, _, m, e, t);
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
function Ov(e) {
	return e.streaming ? "Thinking" : e.durationMs == null ? "Thoughts" : `Thoughts, ${Yn(e.durationMs)}`;
}
function kv(e) {
	return e.blocks.filter((e) => e.kind === "text").map((e) => e.text).join("\n\n").trim();
}
var Av = Yr(function({ turn: e, model: t, active: n, activity: r, isLast: i = !1, selectedThreadEpisode: a, selectedWorkset: o, onSelectThread: c, onSelectWorkset: l, userMessageIndex: u, userText: d = "", onRefresh: f = null, onRevert: p = null, onFork: m = null, forks: h = [], onOpenFork: _, onDismissFork: v, actionsDisabled: y = !1, readOnly: b = !1, snapshotRevision: x = null, filesPanel: S = null }) {
	En("ModelMessage");
	let C = !b && f != null && u != null, w = !b && p != null && u != null, T = e.messageIndex, E = kv(e), D = e.blocks.some((e) => e.kind === "text" && e.text.trim() === "[run cancelled by user]"), O = g();
	return /* @__PURE__ */ J("div", {
		className: V("group/model-msg flex gap-1 items-start w-full max-w-full py-8 relative", i && "min-h-[calc(70vh-316px)]"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col flex-grow gap-1 pt-2 md:max-w-[calc(100%-36px)] min-w-0",
			children: [
				/* @__PURE__ */ Y("div", {
					className: "flex gap-3 items-center mb-4 min-w-0",
					children: [
						/* @__PURE__ */ J(Ec, { active: n }),
						/* @__PURE__ */ J("span", {
							className: "label-small text-basic-primary truncate",
							children: t
						}),
						n && r ? /* @__PURE__ */ J(q, { children: " " }) : e.durationMs == null ? null : /* @__PURE__ */ J("span", {
							className: "label-micro text-basic-muted shrink-0 fade",
							children: nn(e.durationMs)
						})
					]
				}),
				/* @__PURE__ */ Y("div", {
					className: V("chat-response chat-response-content paragraph-medium text-basic-secondary relative w-full min-w-0 md:pl-3", n && "streaming"),
					children: [
						e.blocks.map((e) => {
							switch (e.kind) {
								case "thoughts": return e.text.trim() ? /* @__PURE__ */ J(b_, {
									label: Ov(e),
									pending: e.streaming,
									body: e.text
								}, e.key) : null;
								case "text": return e.text.trim() === "[run cancelled by user]" ? null : /* @__PURE__ */ J(v_, {
									streaming: n,
									children: e.text
								}, e.key);
								case "workset": return /* @__PURE__ */ J(b_, {
									label: e.worksetId ? `Worksets_${e.worksetId}` : e.pending ? "Defining worksets…" : "Worksets",
									pending: e.pending,
									active: o === e.worksetId,
									onClick: () => l(e.worksetId)
								}, e.key);
								case "tool": return /* @__PURE__ */ J(b_, {
									label: e.pending ? `${e.name}…` : e.name,
									pending: e.pending
								}, e.key);
								case "tool-detail": return /* @__PURE__ */ J(R_, { tool: e.presentation }, e.key);
								case "wave": return /* @__PURE__ */ J(I_, {
									rows: e.rows,
									selected: a,
									onSelect: c
								}, e.key);
								default: return null;
							}
						}),
						x && S ? /* @__PURE__ */ J(T_, {
							revision: x,
							panel: S
						}) : null,
						D ? /* @__PURE__ */ J(Ni, {
							variant: ki.Danger,
							title: "Run cancelled by user"
						}) : null
					]
				}),
				!b && h.length > 0 ? /* @__PURE__ */ J("div", {
					className: "flex flex-col gap-2 pt-4 md:pl-3 [&>*]:shrink-0",
					children: h.map((e) => /* @__PURE__ */ J(Gs, {
						sessionId: e.session_id,
						title: e.title,
						deleted: e.deleted,
						onOpen: _ ? () => _(e.session_id) : void 0,
						onDismiss: v && e.deleted ? () => v(e.session_id) : void 0
					}, e.session_id))
				}) : null,
				n ? null : /* @__PURE__ */ Y("div", {
					className: V("flex items-center justify-start gap-3 pt-4 md:pl-3", "opacity-0 pointer-events-none transition-opacity duration-150", "group-hover/model-msg:opacity-100 group-hover/model-msg:pointer-events-auto", "group-focus-within/model-msg:opacity-100 group-focus-within/model-msg:pointer-events-auto", "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"),
					children: [
						C ? /* @__PURE__ */ J(Zn, {
							title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
							position: z.BottomRight,
							children: /* @__PURE__ */ J(s, {
								size: O ? F.Medium : F.Small,
								variant: O ? I.Ghost : I.Tertiary,
								content: R.Icon,
								"aria-label": "Regenerate from original prompt",
								disabled: y,
								onClick: () => f(u),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(M, {
									iconName: L.Refresh,
									size: 16
								})
							})
						}) : null,
						w ? /* @__PURE__ */ J(Zn, {
							title: "Revert to this snapshot",
							position: z.BottomRight,
							children: /* @__PURE__ */ J(s, {
								size: O ? F.Medium : F.Small,
								variant: O ? I.Ghost : I.Tertiary,
								content: R.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: y,
								onClick: () => p(u, d),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(M, {
									iconName: L.TurnLeft,
									size: 16
								})
							})
						}) : b ? null : /* @__PURE__ */ J(Zn, {
							title: "This message is not in the transcript yet",
							position: z.BottomRight,
							children: /* @__PURE__ */ J("span", {
								className: "inline-flex",
								children: /* @__PURE__ */ J(s, {
									size: O ? F.Medium : F.Small,
									variant: O ? I.Ghost : I.Tertiary,
									content: R.Icon,
									"aria-label": "Revert to this snapshot",
									disabled: !0,
									className: "md:!h-4 md:!min-h-4 md:!p-0",
									children: /* @__PURE__ */ J(M, {
										iconName: L.TurnLeft,
										size: 16
									})
								})
							})
						}),
						!b && m != null && T != null ? /* @__PURE__ */ J(Zn, {
							title: "Create fork",
							position: z.BottomRight,
							children: /* @__PURE__ */ J(s, {
								size: O ? F.Medium : F.Small,
								variant: O ? I.Ghost : I.Tertiary,
								content: R.Icon,
								"aria-label": "Create fork",
								disabled: y,
								onClick: () => m(T),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(M, {
									iconName: L.Scheme,
									size: 16
								})
							})
						}) : null,
						/* @__PURE__ */ J(an, {
							value: E,
							size: O ? F.Medium : F.Small,
							variant: O ? I.Ghost : I.Tertiary,
							title: "Copy message",
							position: z.BottomRight,
							className: "md:!h-4 md:!min-h-4 md:!p-0"
						})
					]
				})
			]
		})
	});
}), jv = Yr(function({ text: e, pending: t = !1, invokedSkills: n = null, timestamp: r = null, messageIndex: i, onRefresh: a = null, onRevert: o = null, actionsDisabled: c = !1, readOnly: l = !1 }) {
	En("UserMessage");
	let u = !l && a != null && i != null, d = !l && o != null && i != null, f = g();
	return /* @__PURE__ */ Y("div", {
		className: "group/user-msg flex flex-col items-end w-full max-w-full pt-4 pb-8",
		children: [
			/* @__PURE__ */ J("div", {
				className: V("py-3 px-5 rounded-[12px] bg-elevation-sublevel-variant-B shadow-convex", "label-small text-basic-primary whitespace-pre-wrap break-words", t && "opacity-60"),
				children: e
			}),
			n && n.length > 0 ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-1 pt-1.5 pr-1 label-micro text-basic-tertiary",
				title: "Skill content was expanded into the prompt sent to the agent",
				children: [/* @__PURE__ */ J(M, {
					iconName: L.Bolt,
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
				className: V("flex items-center justify-end gap-3 pt-3", "opacity-0 pointer-events-none transition-opacity duration-150", "group-hover/user-msg:opacity-100 group-hover/user-msg:pointer-events-auto", "group-focus-within/user-msg:opacity-100 group-focus-within/user-msg:pointer-events-auto", "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"),
				children: [
					r ? /* @__PURE__ */ J("span", {
						className: "label-micro text-basic-tertiary whitespace-nowrap truncate",
						children: r
					}) : null,
					u ? /* @__PURE__ */ J(Zn, {
						title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
						position: z.BottomLeft,
						children: /* @__PURE__ */ J(s, {
							size: f ? F.Medium : F.Small,
							variant: f ? I.Ghost : I.Tertiary,
							content: R.Icon,
							"aria-label": "Regenerate from original prompt",
							disabled: c,
							onClick: () => a(i),
							className: "md:!h-4 md:!min-h-4 md:!p-0",
							children: /* @__PURE__ */ J(M, {
								iconName: L.Refresh,
								size: 16
							})
						})
					}) : null,
					d ? /* @__PURE__ */ J(Zn, {
						title: "Revert to this snapshot",
						position: z.BottomLeft,
						children: /* @__PURE__ */ J(s, {
							size: f ? F.Medium : F.Small,
							variant: f ? I.Ghost : I.Tertiary,
							content: R.Icon,
							"aria-label": "Revert to this snapshot",
							disabled: c,
							onClick: () => o(i, e),
							className: "md:!h-4 md:!min-h-4 md:!p-0",
							children: /* @__PURE__ */ J(M, {
								iconName: L.TurnLeft,
								size: 16
							})
						})
					}) : l ? null : /* @__PURE__ */ J(Zn, {
						title: "This message is not in the transcript yet",
						position: z.BottomLeft,
						children: /* @__PURE__ */ J("span", {
							className: "inline-flex",
							children: /* @__PURE__ */ J(s, {
								size: f ? F.Medium : F.Small,
								variant: f ? I.Ghost : I.Tertiary,
								content: R.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: !0,
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(M, {
									iconName: L.TurnLeft,
									size: 16
								})
							})
						})
					}),
					/* @__PURE__ */ J(an, {
						value: e,
						size: f ? F.Medium : F.Small,
						variant: f ? I.Ghost : I.Tertiary,
						title: "Copy message",
						position: z.BottomLeft,
						className: "md:!h-4 md:!min-h-4 md:!p-0"
					})
				]
			})
		]
	});
});
//#endregion
//#region src/app/features/delegation/presentation/DelegatedCompletionEvent.tsx
function Mv({ turn: e }) {
	let t = ct().orchestrationEnabled || e.completion.kind === "coding-agent", n = fi(), r = e.completion.kind === "coding-agent" ? "Coding agent" : "NAC orchestrator", i = e.completion.status === "completed" ? ki.Success : e.completion.status === "failed" ? ki.Error : ki.Danger;
	return /* @__PURE__ */ J(Ni, {
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
				t ? /* @__PURE__ */ J(s, {
					size: F.Small,
					variant: I.Ghost,
					onClick: () => n(_r.session(e.completion.sessionId)),
					children: "Open exact transcript"
				}) : null
			]
		})
	});
}
//#endregion
//#region src/app/hooks/useDelegatedPreviewStream.ts
var Nv = 250, Pv = {
	text: "",
	reasoning: "",
	running: !1
};
function Fv(e) {
	let { subscribeToSessionEvents: t } = { subscribeToSessionEvents: B().events }, n = ai(), [r, i] = K(Pv), [a, o] = K(e);
	return a !== e && (o(e), i(Pv)), U(() => {
		if (!e || typeof EventSource > "u") return;
		let r = !1, a = !1, o = null, s = () => {
			clearTimeout(o ?? void 0), o = window.setTimeout(() => {
				o = null, !r && n.invalidateQueries({
					queryKey: bn.sessionSnapshot(e),
					exact: !0
				});
			}, Nv);
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
						a = !0, i(Pv), s();
						return;
					default: return;
				}
			},
			onAssistantDelta: (e) => {
				if (e.thread_name) return;
				if (e.reset) {
					a = !1, i(Pv);
					return;
				}
				let t = a;
				a = !1, i((n) => {
					let r = t ? Pv : n;
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
var Iv = (e) => 1 - (1 - e) ** 3, Lv = (e) => e.scrollHeight - (e.scrollTop + e.clientHeight);
function Rv(e) {
	e.scrollTop = e.scrollHeight - e.clientHeight;
}
function zv(e, t, n = 300, r) {
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
			let r = Math.min(1, (t - c) / n), i = Math.max(0, e.scrollHeight - e.clientHeight), s = a + ((p ? i : Math.min(o, i)) - a) * Iv(r);
			e.scrollTop = p ? Math.max(e.scrollTop, s) : s, r < 1 ? l = requestAnimationFrame(m) : d(!0);
		};
		l = requestAnimationFrame(m);
	});
}
//#endregion
//#region src/app/hooks/useStickToBottom.ts
var Bv = 400, Vv = 60, Hv = 400, Uv = 200, Wv = 300, Gv = 1, Kv = 50, qv = 150, Jv = /* @__PURE__ */ new Set([
	"ArrowUp",
	"ArrowDown",
	"PageUp",
	"PageDown",
	"Home",
	"End"
]);
function Yv({ resetKey: e = null } = {}) {
	let t = G(null), n = G(null), [r, i] = K(!1), a = G(!0), o = G(!1), s = G(0), c = G(!1), l = G(null), u = G(null), d = G(null), f = G(!1), p = G(Uv), m = G(0), h = G(null), g = H(() => {
		h.current !== null && (clearTimeout(h.current), h.current = null), c.current = !1, o.current = !0;
	}, []), _ = H(() => {
		h.current !== null && clearTimeout(h.current), h.current = window.setTimeout(() => {
			h.current = null, o.current = !1;
		}, Kv);
	}, []), v = H(() => {
		let e = t.current;
		e && i(Lv(e) > Bv);
	}, []), y = H(() => {
		let e = u.current !== null;
		u.current?.abort(), u.current = null, d.current !== null && (cancelAnimationFrame(d.current), d.current = null), e && _();
	}, [_]), b = H((e) => {
		let n = t.current;
		if (!n || !a.current || (p.current = e, u.current)) return;
		v();
		let r = Lv(n);
		if (r <= 0) return;
		let i = !f.current;
		if (f.current = !0, i || r > n.clientHeight * Gv) {
			y(), g(), Rv(n), v(), _();
			return;
		}
		let o = new AbortController();
		u.current = o, g(), zv(n, n.scrollHeight, e, o.signal).then((e) => {
			u.current === o && (u.current = null, _(), v(), p.current = Uv);
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
			}, qv);
		}, r = () => {
			let t = Lv(e), n = s.current, r = e.scrollHeight !== n;
			if (s.current = e.scrollHeight, r) {
				t <= 60 && (a.current = !0);
				return;
			}
			o.current && !c.current || (t > Vv ? (a.current && y(), a.current = !1) : a.current = !0, v());
		}, i = (t) => {
			n();
			let r = Lv(e);
			t.deltaY < 0 && r > Vv ? (y(), a.current = !1, v()) : t.deltaY > 0 && r <= 60 && (a.current = !0);
		}, u = (t) => {
			let r = e.getBoundingClientRect();
			t.clientX >= r.left + e.clientWidth && n();
		}, d = (e) => {
			Jv.has(e.key) && n();
		};
		return e.addEventListener("scroll", r, { passive: !0 }), e.addEventListener("wheel", i, { passive: !0 }), e.addEventListener("pointerdown", u, { passive: !0 }), e.addEventListener("touchmove", n, { passive: !0 }), e.addEventListener("keydown", d), r(), () => {
			e.removeEventListener("scroll", r), e.removeEventListener("wheel", i), e.removeEventListener("pointerdown", u), e.removeEventListener("touchmove", n), e.removeEventListener("keydown", d), l.current !== null && clearTimeout(l.current);
		};
	}, [y, v]), U(() => {
		let e = t.current, r = n.current;
		if (!e || !r) return;
		let i = () => {
			y(), g(), Rv(e), v(), _();
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
				if (!a.current || Lv(e) <= 60) return;
				i();
				return;
			}
			c();
		});
		x.observe(r);
		let S = new ResizeObserver(() => {
			a.current && (u.current || o.current || Lv(e) <= 60 || i());
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
	]), Qr(() => {
		y(), a.current = !0, s.current = 0, m.current = 0;
		let e = t.current;
		if (!e) {
			f.current = !1;
			return;
		}
		f.current = !0, g(), Rv(e), v(), _();
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
			e && (y(), a.current = !0, i(!1), g(), zv(e, e.scrollHeight, Hv).then((t) => {
				_(), t || (a.current = Lv(e) <= 60, v());
			}));
		}, [
			g,
			y,
			_,
			v
		]),
		followLatest: H((e = Wv) => {
			f.current = !0, b(e);
		}, [b])
	};
}
//#endregion
//#region src/app/hooks/useMarkdownReady.ts
function Xv() {
	let [e, t] = K(g_);
	return U(() => {
		if (e) return;
		let n = !0;
		return h_().finally(() => {
			n && t(!0);
		}), () => {
			n = !1;
		};
	}, [e]), e;
}
//#endregion
//#region src/app/hooks/useTranscriptReveal.ts
var Zv = 1500;
function Qv(e, t) {
	let n = Xv(), r = ni({ queryKey: bn.sessionRoot(e) }), [i, a] = K(null), o = G(null), s = G(!1), c = i === e;
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
		let n = setTimeout(() => a(e), Zv);
		return () => clearTimeout(n);
	}, [
		c,
		t,
		e
	]), c;
}
//#endregion
//#region src/app/components/inspector/SubagentPreview.tsx
function $v() {}
function ey() {}
function ty(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function ny({ sessionId: e, title: t, fallbackText: n, icon: r }) {
	let i = fi(), a = Nn(e, { retry: !1 }), o = Fv(e), c = xn(e), l = a.data, u = !!l?.message_page?.has_older, d = l?.message_page?.start ?? 0, [f, p] = K(!1), [m, h] = K(e), g = G(!1);
	m !== e && (h(e), p(!1));
	let _ = o.running || !!l?.active_run, v = Qv(e, !!l && (!u || f) || a.isError), { scrollRef: y, contentRef: b } = Yv({ resetKey: e }), x = G(null);
	Qr(() => {
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
	let C = W(() => Dv(l ?? null, {}, {}, []), [l]), w = _ ? l?.active_run?.submitted_user_message : void 0, T = w ? An(w.content) : "", E = w ? cn(w.content) : null, D = !!(T && ty(C) !== T), O = o.running && !l?.active_run && !!(o.text || o.reasoning), k = W(() => Ev(C, {
		text: o.text,
		reasoning: o.reasoning
	}, D || O), [
		o.reasoning,
		o.text,
		D,
		C,
		O
	]), A = k[k.length - 1], ee = _ && A?.kind === "model" && (!D || A.key === "model-streaming"), te = _ && !ee, ne = D && A?.key === "model-streaming", re = l?.metadata.model ?? "", ie = v ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
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
					className: V("label-small min-w-0 flex-1 truncate", _ ? "text-shimmer-basic" : "text-basic-primary"),
					children: t
				}),
				/* @__PURE__ */ Y(s, {
					size: F.Small,
					variant: I.Ghost,
					content: R.IconRight,
					"aria-label": "Open",
					onClick: () => i(_r.session(e)),
					children: ["Open", /* @__PURE__ */ J(M, { iconName: L.Right })]
				})
			]
		}), /* @__PURE__ */ Y("div", {
			className: "relative min-h-0 flex-1",
			children: [/* @__PURE__ */ J("div", {
				role: "status",
				"aria-label": v ? void 0 : "Loading conversation",
				className: V("pointer-events-none absolute inset-0 px-4 pt-4 transition-opacity duration-150 ease-in-out", v ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ J(Li, {
					rows: 3,
					rowClassName: "h-[48px]"
				})
			}), /* @__PURE__ */ J("div", {
				ref: y,
				className: V("h-full overflow-y-auto", ie, !v && "invisible"),
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
							}), /* @__PURE__ */ J(s, {
								size: F.Small,
								variant: I.Ghost,
								onClick: () => p(!1),
								children: "Try again"
							})]
						}) : null,
						k.map((e, t) => {
							if (e.kind === "delegated-completion") return /* @__PURE__ */ J(Mv, { turn: e }, e.key);
							if (e.kind === "user") return /* @__PURE__ */ J(jv, {
								text: e.text,
								invokedSkills: e.invokedSkills,
								timestamp: e.createdAt ? Fn(e.createdAt) : null,
								readOnly: !0
							}, e.key);
							let n = t === k.length - 1, r = /* @__PURE__ */ J(Av, {
								turn: e,
								model: re,
								active: _ && n,
								isLast: !1,
								selectedThreadEpisode: null,
								selectedWorkset: null,
								onSelectThread: $v,
								onSelectWorkset: ey,
								readOnly: !0
							}, e.key);
							return ne && e.key === "model-streaming" ? /* @__PURE__ */ Y(Gr, { children: [/* @__PURE__ */ J(jv, {
								text: T,
								invokedSkills: E,
								pending: !0,
								readOnly: !0
							}), r] }, e.key) : r;
						}),
						D && !ne ? /* @__PURE__ */ J(jv, {
							text: T,
							invokedSkills: E,
							pending: !0,
							readOnly: !0
						}) : null,
						te ? /* @__PURE__ */ J(Av, {
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
							onSelectThread: $v,
							onSelectWorkset: ey,
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
function ry(e) {
	return e.startsWith("child:") ? {
		mode: "child",
		id: e.slice(6)
	} : e.startsWith("orchestrator:") ? {
		mode: "orchestrator",
		id: e.slice(13)
	} : null;
}
function iy(e) {
	return e?.trim() || null;
}
function ay(e) {
	return {
		key: `child:${e.child_session_id}`,
		mode: "child",
		id: e.child_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: iy(e.failure) ?? iy(e.report) ?? iy(e.change_summary) ?? iy(e.verification_summary),
		icon: L.Plane
	};
}
function oy(e) {
	return {
		key: `orchestrator:${e.orchestrator_session_id}`,
		mode: "orchestrator",
		id: e.orchestrator_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: iy(e.failure) ?? iy(e.report),
		icon: L.Orchestrator
	};
}
var sy = {
	agent: {
		title: "Launch Subagent",
		body: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from this chat.",
		icon: L.Plane
	},
	orchestrator: {
		title: "Launch Suborchestrator",
		body: "Start a separate NAC planning session. Browse, steer, continue, and cancel it from this chat.",
		icon: L.Orchestrator
	}
};
function cy({ kind: e }) {
	let t = sy[e];
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
function ly({ sessionId: e, behavior: t }) {
	let { useSubagentLaunch: n, showSidePanelList: r, useSubagentLaunchRequest: i, openSubagentLaunch: a, clearSubagentLaunch: o } = B().stores.sessionLayoutStore, c = ct().orchestrationEnabled && t === "direct-with-orchestrator", l = he(e, !0), u = f(e, c), d = n(), p = !c && d === "orchestrator" ? null : d, m = i(), h = rr(6e4), [g, _] = K(null), [v, y] = K(e);
	v !== e && (y(e), _(null));
	let b = W(() => {
		let e = (l.data ?? []).map(ay), t = c ? (u.data ?? []).map(oy) : [];
		return [...e, ...t];
	}, [
		l.data,
		u.data,
		c
	]), x = [...b].sort((e, t) => t.updatedAt.localeCompare(e.updatedAt))[0]?.key ?? null, S = !c && g?.startsWith("orchestrator:") ? null : g, C = p ? null : S ?? x;
	U(() => {
		!c && d === "orchestrator" && o();
	}, [
		c,
		d,
		o
	]), !c && g?.startsWith("orchestrator:") && _(null), !p && g == null && x != null && _(x);
	let w = b.find((e) => e.key === C) ?? null, T = !p && !w && C ? ry(C) : null, E = W(() => Ml(b, (e) => ({
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
	} : { mode: "new-agent" }, A = b.length === 0 && (l.isError || c && u.isError) ? /* @__PURE__ */ Y("div", {
		role: "alert",
		className: "rounded-[6px] border border-error-primary p-3",
		children: [/* @__PURE__ */ J("div", {
			className: "text-small text-error-primary",
			children: "Subagents could not be loaded."
		}), /* @__PURE__ */ J(s, {
			className: "mt-2",
			size: F.Small,
			variant: I.Ghost,
			onClick: () => {
				l.refetch(), c && u.refetch();
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
				children: e.items.map((e) => /* @__PURE__ */ J(Oi, {
					title: e.description,
					icon: e.icon,
					running: e.status === "running",
					active: !p && w?.key === e.key,
					onClick: () => O(e.key)
				}, e.key))
			})]
		}, e.label))
	});
	return /* @__PURE__ */ J(Pg, {
		listTitle: "Subagents",
		title: p ? sy[p].title : w?.description,
		listToolbar: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-1 border-b border-muted p-2",
			children: [/* @__PURE__ */ Y(Zc, {
				active: p === "agent",
				onClick: () => D("agent"),
				children: [/* @__PURE__ */ J(M, { iconName: L.Add }), /* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: "New Agent"
				})]
			}), c ? /* @__PURE__ */ Y(Zc, {
				active: p === "orchestrator",
				onClick: () => D("orchestrator"),
				children: [/* @__PURE__ */ J(M, { iconName: L.Add }), /* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: "New Orchestrator"
				})]
			}) : null]
		}),
		list: A,
		children: /* @__PURE__ */ Y("div", {
			className: "flex min-h-0 flex-1 flex-col",
			children: [p ? /* @__PURE__ */ J(cy, { kind: p }) : w ? /* @__PURE__ */ J(ny, {
				sessionId: w.id,
				title: w.description,
				fallbackText: w.fallbackText,
				icon: w.icon
			}) : T ? /* @__PURE__ */ J(ny, {
				sessionId: T.id,
				title: "Subagent",
				fallbackText: null,
				icon: T.mode === "orchestrator" ? L.Orchestrator : L.Plane
			}) : /* @__PURE__ */ J(cy, { kind: "agent" }), /* @__PURE__ */ J("div", {
				className: V("shrink-0 p-2"),
				children: /* @__PURE__ */ J(Ch, {
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
var uy = (e) => `Snapshot ${e}`, dy = (e, t) => t - e;
function fy(e, t) {
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
function py({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		className: V("flex items-start gap-2 w-full p-2 rounded-[8px] text-left", r ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": r,
		onClick: i,
		children: [
			/* @__PURE__ */ J(M, {
				iconName: r ? L.Check : L.History,
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
function my({ sessionId: e, selected: t, onSelect: n }) {
	let { data: r, isLoading: i, error: a } = St(e), o = r ?? [];
	return a ? /* @__PURE__ */ J(Lg, { children: nr(a) }) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-h-0 overflow-auto p-2 gap-1 bg-elevation-level-1 [&>*]:shrink-0",
		children: [
			/* @__PURE__ */ J(py, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => n(null)
			}),
			i ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 p-2 label-small text-basic-muted",
				children: [/* @__PURE__ */ J(Le, {
					size: A.Small,
					variant: de.Neutral
				}), "Reading snapshots…"]
			}) : null,
			o.map((e, r) => /* @__PURE__ */ J(py, {
				title: `${uy(dy(r, o.length))} · ${Fn(e.created_at)}`,
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
var hy = 50, gy = "200px";
function _y(e, { key: t, step: n = hy, atLeast: r = 0 }) {
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
		}, { rootMargin: gy });
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
function vy({ text: e, active: t, large: n = !1 }) {
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(M, {
		iconName: L.Info,
		size: n ? 20 : 16,
		className: V("shrink-0", t ? "text-basic-primary" : "text-btn-secondary")
	}), /* @__PURE__ */ J("span", {
		className: V("underline", n ? "label-small" : "label-micro", t ? "text-basic-primary" : "text-btn-secondary"),
		children: e
	})] });
}
function yy({ action: e, open: t, onClose: n, children: r }) {
	return /* @__PURE__ */ J(Ln, {
		open: t,
		onClose: n,
		placement: z.BottomRight,
		sticky: !0,
		size: "w-[430px] max-w-[calc(100vw-16px)]",
		panelClassName: "p-4 overflow-auto max-h-[70vh]",
		sheetClassName: "max-h-[70vh] overflow-auto",
		className: "shrink-0",
		content: /* @__PURE__ */ J(v_, {
			className: "text-basic-primary px-4 md:px-0",
			children: e
		}),
		children: r
	});
}
function by({ action: e, large: t = !1 }) {
	let [n, r] = K(!1);
	return /* @__PURE__ */ J(yy, {
		action: e,
		open: n,
		onClose: () => r(!1),
		children: /* @__PURE__ */ J("button", {
			type: "button",
			className: "flex items-center gap-1 shrink-0",
			"aria-expanded": n,
			onClick: () => r((e) => !e),
			children: /* @__PURE__ */ J(vy, {
				text: "See task",
				active: n,
				large: t
			})
		})
	});
}
function xy({ action: e }) {
	let [t, n] = K(!1);
	return /* @__PURE__ */ J(yy, {
		action: e,
		open: t,
		onClose: () => n(!1),
		children: /* @__PURE__ */ J(s, {
			size: F.Medium,
			variant: t ? I.Primary : I.Secondary,
			"aria-expanded": t,
			onClick: () => n((e) => !e),
			children: "Task"
		})
	});
}
//#endregion
//#region src/app/components/inspector/SteeringPromptModal.tsx
function Sy({ open: e, title: t, subheader: n, value: r, submitting: i, disabled: a = !1, footerLeading: o, onChange: c, onClose: l, onSubmit: u }) {
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: i ? void 0 : l,
		onNavigate: l,
		size: Wt.Wide,
		title: t,
		subheader: n,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ J(oc, {
				label: "Steering message",
				"aria-label": "Steering message",
				textAreaSize: ac.Medium,
				value: r,
				onChange: (e) => c(e.target.value),
				isDisabled: i,
				textAreaClassName: "h-[140px] resize-none"
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-wrap items-center justify-between gap-3",
				children: [/* @__PURE__ */ J("div", { children: o }), /* @__PURE__ */ J(s, {
					variant: I.Primary,
					loading: i,
					disabled: a || i,
					onClick: u,
					children: "Send steering"
				})]
			})]
		})
	});
}
//#endregion
//#region src/app/components/inspector/ThreadSteeringModal.tsx
function Cy({ sessionId: e, threadName: t, onClose: n }) {
	let [r, i] = K(""), a = Rn(), o = _n(), s = async () => {
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
			o.error(`Unable to steer ${t}: ${nr($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Sy, {
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
function wy(e, t, n, r) {
	return r ? t.has(r) || n[r] ? !0 : e ? e.threads.some((e) => e.name === r) || Object.hasOwn(e.thread_episodes, r) ? !0 : (e.active_threads ?? []).includes(r) : !1 : !1;
}
function Ty(e, t) {
	return {
		name: e,
		session_id: t,
		created_at: "",
		updated_at: "",
		episode_count: 0,
		latest_action: null
	};
}
function Ey(e) {
	let t = /* @__PURE__ */ new Map();
	if (!e?.length) return t;
	for (let n = e.length - 1; n >= 0; --n) {
		let r = e[n];
		if (r.role !== "assistant") continue;
		let i = (r.tool_calls ?? []).filter((e) => e.function?.name === "thread");
		if (i.length) {
			bv(i).forEach((e, n) => {
				for (let r of e) t.set(_v(r), n);
			});
			break;
		}
	}
	return t;
}
var Dy = Yr(function({ entry: e, running: t }) {
	let n = e.status === "pending" && t;
	return /* @__PURE__ */ Y("div", {
		className: "pt-1",
		children: [/* @__PURE__ */ J("p", {
			className: V("code code-small whitespace-pre-wrap break-words", n ? "text-shimmer-basic" : "text-basic-tertiary"),
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
}), Oy = Yr(function({ entry: e }) {
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
}), ky = Yr(function({ entry: e, running: t }) {
	return e.kind === "tool_call" ? /* @__PURE__ */ J(Dy, {
		entry: e,
		running: t
	}) : /* @__PURE__ */ J(Oy, { entry: e });
}), Ay = {
	error: {
		label: "Failed",
		color: xi.Red
	},
	timed_out: {
		label: "Timed out",
		color: xi.Yellow
	},
	cancelled: {
		label: "Cancelled",
		color: xi.Yellow
	}
};
function jy({ episode: e, index: t }) {
	let [n, r] = K(!1), i = g(), a = Ay[e.status], o = i ? "label-small" : "label-micro";
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col items-start w-full",
		children: [/* @__PURE__ */ Y("button", {
			type: "button",
			className: "group flex items-center gap-2 w-full py-3 pl-1 pr-3 md:py-2 md:pl-3 md:pr-2 rounded-[4px] btn-ghost",
			"aria-expanded": n,
			onClick: () => r((e) => !e),
			children: [
				/* @__PURE__ */ J(M, {
					iconName: n ? L.Down : L.Right,
					size: 16,
					className: "shrink-0 text-basic-muted"
				}),
				/* @__PURE__ */ J("span", {
					className: `shrink-0 ${o} text-basic-primary`,
					children: `Episode ${t + 1}`
				}),
				a ? /* @__PURE__ */ J(Si, {
					text: a.label,
					color: a.color,
					className: "shrink-0"
				}) : null
			]
		}), /* @__PURE__ */ J(ga, {
			isOpen: n,
			className: "w-full",
			children: /* @__PURE__ */ J("div", {
				className: "flex flex-col pl-1 pr-1 md:pl-3 md:pr-2 pt-2 pb-6",
				children: e.content.trim() ? /* @__PURE__ */ J(v_, {
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
var My = {
	pending: 0,
	running: 1,
	done: 2
};
function Ny({ scrollRef: e, stuckRef: t, entries: n, running: r, thinking: i, loading: a, className: o, historyControl: s }) {
	return /* @__PURE__ */ Y("div", {
		ref: e,
		className: V("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0 bg-elevation-level-0-5", o),
		onScroll: () => {
			let n = e.current;
			n && (t.current = Lv(n) <= 60);
		},
		children: [s, /* @__PURE__ */ Y("div", {
			className: "pb-[128px] md:pb-4",
			children: [
				n.map((e) => /* @__PURE__ */ J(ky, {
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
					children: /* @__PURE__ */ J(Li, {
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
function Py({ lines: e, running: t, hasOlder: n, loadingOlder: r, loadingInitial: i, historyError: a, onRetry: o, onLoadOlder: c, className: l }) {
	let u = G(null), d = G(null), f = G(!0), p = W(() => vn(e), [e]), m = W(() => Ht(t, e), [t, e]), h = p[0]?.kind === "tool_call" ? `call-${p[0].callId}` : p[0]?.key ?? null;
	Qr(() => {
		let e = u.current, t = d.current;
		!e || !t || e.firstKey === h || (t.scrollTop = e.top + (t.scrollHeight - e.height), u.current = null);
	}, [h]), U(() => {
		let e = u.current;
		!r && e?.firstKey === h && (u.current = null);
	}, [h, r]);
	let g = () => {
		f.current = !1;
		let e = d.current;
		e && (u.current = {
			height: e.scrollHeight,
			top: e.scrollTop,
			firstKey: h
		}), c().catch(() => {
			u.current = null;
		});
	};
	return Qr(() => {
		let e = d.current;
		!e || !f.current || Rv(e);
	}, [p.length, m]), /* @__PURE__ */ J(Ny, {
		scrollRef: d,
		stuckRef: f,
		entries: p,
		running: t,
		thinking: m,
		loading: i,
		className: l,
		historyControl: n || a ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 pb-3",
			children: [n ? /* @__PURE__ */ J(s, {
				size: F.Small,
				variant: I.Secondary,
				disabled: r,
				onClick: g,
				children: r ? "Loading…" : "Load older commands"
			}) : null, a ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
				className: "text-micro text-error-primary",
				children: a
			}), /* @__PURE__ */ J(s, {
				size: F.Small,
				variant: I.Ghost,
				onClick: () => {
					n ? g() : o();
				},
				children: "Try again"
			})] }) : null]
		}) : null
	});
}
function Fy({ episodes: e, running: t, className: n }) {
	return e.length ? /* @__PURE__ */ J("div", {
		className: V("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", n),
		children: /* @__PURE__ */ J("div", {
			className: "pb-[128px] md:pb-4 flex flex-col",
			children: e.map((e, t) => /* @__PURE__ */ Y("div", {
				className: "flex flex-col",
				children: [t > 0 ? /* @__PURE__ */ J(Q, {}) : null, /* @__PURE__ */ J(jy, {
					episode: e,
					index: t
				})]
			}, e.id))
		})
	}) : /* @__PURE__ */ J("div", {
		className: V("flex flex-1 min-h-0", n),
		children: /* @__PURE__ */ J("p", {
			className: "p-4 max-w-prose label-small text-basic-muted",
			children: t ? "An episode records one dispatch — what the thread was asked to do and what came back. This one is written when the dispatch ends; until then the Command Log is the live view." : "This thread has not been dispatched yet, so it has no episodes."
		})
	});
}
var Iy = {
	log: "Command Log",
	overview: "Episodes"
}, Ly = ["log", "overview"];
function Ry({ view: e, action: t, canSteer: n, onSteer: r, onChange: i }) {
	return /* @__PURE__ */ Y("div", {
		className: "absolute inset-x-0 top-0 flex items-center gap-2 overflow-x-auto overscroll-x-contain p-2",
		role: "toolbar",
		"aria-label": "Thread controls",
		children: [
			Ly.map((t) => /* @__PURE__ */ J("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ J(s, {
					className: "w-full",
					size: F.Medium,
					variant: e === t ? I.Primary : I.Secondary,
					"aria-pressed": e === t,
					onClick: () => i(t),
					children: Iy[t]
				})
			}, t)),
			t ? /* @__PURE__ */ J("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ J(xy, { action: t })
			}) : null,
			n ? /* @__PURE__ */ J("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ J(s, {
					size: F.Medium,
					variant: I.Secondary,
					onClick: r,
					children: "Steer"
				})
			}) : null
		]
	});
}
function zy({ view: e, onChange: t }) {
	return /* @__PURE__ */ J("div", {
		className: "flex items-center gap-2 shrink-0",
		role: "tablist",
		"aria-label": "Thread detail view",
		children: Ly.map((n) => /* @__PURE__ */ J(s, {
			size: F.Small,
			variant: e === n ? I.Primary : I.Secondary,
			className: "!rounded-full",
			"aria-pressed": e === n,
			onClick: () => t(n),
			children: Iy[n]
		}, n))
	});
}
function By({ view: e, onChange: t }) {
	return /* @__PURE__ */ J($c, {
		size: F.Small,
		variant: I.Secondary,
		value: e,
		items: Ly.map((e) => ({
			id: e,
			label: Iy[e]
		})),
		onValueChange: (e) => t(e)
	});
}
function Vy({ thread: e, action: t, episodes: n, events: r, liveLog: i, running: a, hasOlder: o, loadingOlder: c, loadingInitial: l, historyError: u, onLoadOlder: d, onRetry: f, view: p, canSteer: m, onSteer: h, onViewChange: _ }) {
	let v = g(), y = Ar(), b = W(() => Gn(cr(r), i), [r, i]), x = v ? "pt-14" : void 0, S = p === "log" ? /* @__PURE__ */ J(Py, {
		lines: b,
		running: a,
		hasOlder: o,
		loadingInitial: l,
		loadingOlder: c,
		historyError: u,
		onLoadOlder: d,
		onRetry: f,
		className: x
	}) : /* @__PURE__ */ J(Fy, {
		episodes: n,
		running: a,
		className: x
	});
	return v || y ? /* @__PURE__ */ Y("div", {
		className: "relative flex flex-col flex-1 min-h-0 min-w-0",
		children: [S, v ? /* @__PURE__ */ J(Ry, {
			view: p,
			action: t,
			canSteer: m,
			onSteer: h,
			onChange: _
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
							className: V("label-small truncate", a ? "text-shimmer-basic" : "text-basic-primary"),
							children: e.name
						}), t ? /* @__PURE__ */ J(by, { action: t }) : null]
					}), /* @__PURE__ */ J("span", {
						className: "code code-micro text-basic-muted truncate",
						children: e.updated_at
					})]
				}),
				m ? /* @__PURE__ */ J(s, {
					size: F.Small,
					variant: I.Secondary,
					onClick: h,
					children: "Steer"
				}) : null,
				/* @__PURE__ */ J(zy, {
					view: p,
					onChange: _
				}),
				/* @__PURE__ */ Y("span", {
					className: "shrink-0 text-micro text-basic-muted",
					children: [n.length, " ep"]
				})
			]
		}), S]
	});
}
function Hy({ snapshot: e, selected: t, onSelect: n, canSteerWorkers: r }) {
	let { setSelectedThreadRunning: i } = B().stores.sessionLayoutStore, { useStreamStatus: a, useLiveThreads: o } = B().stores.runtimeStore, c = o(), l = a(), [u, d] = K("log"), [f, p] = K(null), m = W(() => e?.threads ?? [], [e]), h = e?.active_threads, g = e?.metadata.session_id ?? "", _ = W(() => Ey(e?.messages), [e?.messages]), v = W(() => vv(e?.messages ?? []), [e?.messages]), y = W(() => Sv(e?.messages ?? []), [e?.messages]), b = W(() => {
		let t = /* @__PURE__ */ new Set();
		for (let n of e?.messages ?? []) if (n.role === "assistant") for (let e of n.tool_calls ?? []) e.function?.name === "thread" && t.add(_v(e));
		return t;
	}, [e?.messages]), x = l === "connecting" || l === "reconnecting", { runningNames: S, pendingNames: C } = W(() => {
		let e = /* @__PURE__ */ new Set(), t = /* @__PURE__ */ new Set();
		for (let n of h ?? []) {
			let r = c[n];
			r?.status === "running" ? e.add(n) : r?.status === "finished" || (x ? e.add(n) : t.add(n));
		}
		for (let [n, r] of Object.entries(c)) r.status === "running" ? (e.add(n), t.delete(n)) : r.status === "finished" && (e.delete(n), t.delete(n));
		return {
			runningNames: e,
			pendingNames: t
		};
	}, [
		h,
		c,
		x
	]), w = W(() => {
		let n = new Set(m.map((e) => e.name)), r = /* @__PURE__ */ new Set();
		for (let e of b) n.has(e) || r.add(e);
		t && !n.has(t) && wy(e, b, c, t) && r.add(t);
		for (let e of S) n.has(e) || r.add(e);
		for (let e of C) n.has(e) || r.add(e);
		for (let [e, t] of Object.entries(c)) t.status === "finished" && !n.has(e) && r.add(e);
		let i = [...m, ...[...r].map((e) => Ty(e, g))], a = (e) => C.has(e) ? "pending" : S.has(e) ? "running" : "done";
		return i.sort((e, t) => {
			let n = My[a(e.name)] - My[a(t.name)];
			if (n !== 0) return n;
			let r = (_.get(t.name) ?? -1) - (_.get(e.name) ?? -1);
			return r === 0 ? 0 : r;
		});
	}, [
		m,
		b,
		t,
		S,
		C,
		c,
		g,
		e,
		_
	]), T = W(() => w.filter((e) => !C.has(e.name)), [w, C]), E = w.find((e) => e.name === t) ?? T[0] ?? w[0] ?? null, { visible: D, hasMore: O, sentinelRef: k } = _y(w, {
		key: g,
		atLeast: (E ? w.findIndex((e) => e.name === E.name) : -1) + 1
	}), ee = E ? c[E.name] : void 0, te = E && (v[E.name] || E.latest_action) || "", ne = E?.name ?? null, re = !!(ne && S.has(ne)), ie = r && ee?.status === "running", ae = dn(e ? g : null, ne), oe = W(() => ae.data ? Mt(ae.data.pages) : void 0, [ae.data]);
	return U(() => {
		ne && t !== ne && (t && w.some((e) => e.name === t) || n(ne));
	}, [
		t,
		ne,
		w,
		n
	]), U(() => {}, [
		t,
		w,
		b,
		c,
		e,
		g,
		m
	]), U(() => (i(re), () => i(!1)), [re, i]), e ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Pg, {
		listTitle: "Threads",
		title: E?.name,
		titleAction: te ? /* @__PURE__ */ J(by, { action: te }) : null,
		actions: E ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2",
			children: [ie ? /* @__PURE__ */ J(s, {
				size: F.Small,
				variant: I.Secondary,
				onClick: () => p(E.name),
				children: "Steer"
			}) : null, /* @__PURE__ */ J(By, {
				view: u,
				onChange: d
			})]
		}) : null,
		list: w.length === 0 ? /* @__PURE__ */ Y("div", {
			className: "flex flex-col px-2 pb-4 pt-2 text-micro",
			children: [/* @__PURE__ */ J("p", {
				className: "text-basic-tertiary",
				children: "No threads yet."
			}), /* @__PURE__ */ J("p", {
				className: "text-basic-muted",
				children: "Start a conversation to create one."
			})]
		}) : /* @__PURE__ */ Y(q, { children: [D.map((t) => {
			let r = C.has(t.name), i = S.has(t.name), a = c[t.name], o = e.thread_episodes?.[t.name]?.at(-1), s = e.thread_episodes?.[t.name]?.length ?? t.episode_count, l = !!a?.cancelled || y.has(t.name) || o?.status === "cancelled" || !i && !r && s === 0, u = a?.isError, d = v[t.name] || t.latest_action || "";
			return /* @__PURE__ */ J(Fg, {
				label: t.name,
				active: t.name === E?.name,
				disabled: r,
				title: r ? "Waiting on source threads" : d || void 0,
				icon: r ? /* @__PURE__ */ J(M, {
					iconName: L.Timelaps,
					size: 16,
					className: "shrink-0 [&>path]:!fill-basic-muted"
				}) : i ? /* @__PURE__ */ J(Le, {
					size: A.Micro,
					variant: de.Neutral
				}) : l ? /* @__PURE__ */ J(M, {
					iconName: L.Close,
					size: 16,
					className: "shrink-0 [&>path]:!fill-basic-muted"
				}) : /* @__PURE__ */ J(M, {
					iconName: u ? L.Danger : L.CheckCircle,
					size: 16,
					className: V("shrink-0", u && "text-error-primary")
				}),
				trailing: /* @__PURE__ */ J("span", {
					className: "code code-micro text-basic-muted shrink-0",
					children: e.thread_episodes?.[t.name]?.length ?? t.episode_count
				}),
				onClick: () => n(t.name)
			}, t.name);
		}), O ? /* @__PURE__ */ J("div", {
			ref: k,
			"aria-hidden": !0,
			className: "h-px"
		}) : null] }),
		children: E ? /* @__PURE__ */ J(Vy, {
			thread: E,
			action: te,
			episodes: e.thread_episodes?.[E.name] ?? [],
			events: oe ?? e.thread_events?.[E.name],
			liveLog: ee?.log ?? [],
			running: S.has(E.name),
			hasOlder: !!ae.hasNextPage,
			loadingOlder: ae.isFetchingNextPage,
			loadingInitial: ae.isPending,
			historyError: ae.error instanceof Error ? ae.error.message : null,
			onLoadOlder: async () => {
				await ae.fetchNextPage();
			},
			onRetry: async () => {
				ae.data ? await ae.fetchNextPage() : await ae.refetch();
			},
			view: u,
			canSteer: ie,
			onSteer: () => p(E.name),
			onViewChange: d
		}, `${g}:${E.name}`) : /* @__PURE__ */ J(Lg, {
			title: "No thread selected",
			children: "Threads contain conversations, command output, and file changes for each task. Select a thread to view its details."
		})
	}), f ? /* @__PURE__ */ J(Cy, {
		sessionId: g,
		threadName: f,
		onClose: () => p(null)
	}) : null] }) : /* @__PURE__ */ J(Ig, { listTitle: "Threads" });
}
//#endregion
//#region src/app/components/inspector/WorksetsView.tsx
var Uy = {
	done: "text-success-primary",
	completed: "text-success-primary",
	finished: "text-success-primary",
	active: "text-info-primary",
	running: "text-info-primary",
	in_progress: "text-info-primary",
	blocked: "text-error-primary",
	failed: "text-error-primary"
}, Wy = (e) => Uy[e.toLowerCase()] ?? "text-basic-secondary";
function Gy({ label: e, children: t }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1",
		children: [/* @__PURE__ */ J("span", {
			className: "tag-label text-basic-muted",
			children: e
		}), t]
	});
}
function Ky({ item: e }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-4 p-4 rounded-[8px] border border-muted bg-elevation-level-1",
		children: [
			e.role ? /* @__PURE__ */ J(Si, {
				text: e.role,
				color: xi.Blue,
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
			e.acceptance ? /* @__PURE__ */ J(Gy, {
				label: "Acceptance",
				children: /* @__PURE__ */ J("p", {
					className: "text-small text-basic-secondary",
					children: e.acceptance
				})
			}) : null,
			e.depends_on.length > 0 ? /* @__PURE__ */ J(Gy, {
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
function qy({ workset: e }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-6 flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0",
		children: [
			/* @__PURE__ */ J(Gy, {
				label: "ID",
				children: /* @__PURE__ */ J("span", {
					className: "header-medium text-basic-primary break-words",
					children: e.id
				})
			}),
			e.goal ? /* @__PURE__ */ J(Gy, {
				label: "Goal",
				children: /* @__PURE__ */ J("p", {
					className: "paragraph-small text-basic-primary",
					children: e.goal
				})
			}) : null,
			e.status ? /* @__PURE__ */ J(Gy, {
				label: "Status",
				children: /* @__PURE__ */ J("span", {
					className: V("code code-medium", Wy(e.status)),
					children: e.status
				})
			}) : null,
			e.summary ? /* @__PURE__ */ J(Gy, {
				label: "Summary",
				children: /* @__PURE__ */ J("p", {
					className: "paragraph-small text-basic-primary",
					children: e.summary
				})
			}) : null,
			e.verification_recipe ? /* @__PURE__ */ J(Gy, {
				label: "Verification recipe",
				children: /* @__PURE__ */ J("p", {
					className: "paragraph-small text-basic-primary whitespace-pre-wrap",
					children: e.verification_recipe
				})
			}) : null,
			e.items.length > 0 ? /* @__PURE__ */ J(Gy, {
				label: "Workset items",
				children: /* @__PURE__ */ J("div", {
					className: "flex flex-col gap-2 pt-1",
					children: e.items.map((e) => /* @__PURE__ */ J(Ky, { item: e }, e.position))
				})
			}) : null
		]
	});
}
function Jy({ snapshot: e, selected: t, onSelect: n }) {
	if (!e) return /* @__PURE__ */ J(Ig, { listTitle: "Worksets" });
	let r = e.worksets;
	if (r.error) return /* @__PURE__ */ J("div", {
		className: "p-6 label-small text-error-primary",
		children: r.error
	});
	let i = r.items.find((e) => e.id === t) ?? r.items[0] ?? null;
	return /* @__PURE__ */ J(Pg, {
		listTitle: "Worksets",
		title: i?.id,
		list: r.items.length === 0 ? /* @__PURE__ */ J("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "No worksets defined for this session."
		}) : r.items.map((e) => /* @__PURE__ */ J(Fg, {
			label: e.id,
			active: e.id === i?.id,
			trailing: /* @__PURE__ */ J("span", {
				className: "code code-micro text-basic-muted shrink-0",
				children: e.items.length
			}),
			onClick: () => n(e.id)
		}, e.id)),
		children: i ? /* @__PURE__ */ J(qy, { workset: i }) : /* @__PURE__ */ J(Lg, { children: "No worksets defined for this session." })
	});
}
//#endregion
//#region src/app/hooks/useSessionFetching.ts
var Yy = 150, Xy = 500;
function Zy(e) {
	let t = ni({ queryKey: bn.sessionRoot(e) }) > 0, [n, r] = K(!1), i = G(0);
	return U(() => {
		if (t) {
			if (n) return;
			let e = window.setTimeout(() => {
				i.current = Date.now(), r(!0);
			}, Yy);
			return () => clearTimeout(e);
		}
		if (!n) return;
		let e = Xy - (Date.now() - i.current), a = window.setTimeout(() => r(!1), Math.max(0, e));
		return () => clearTimeout(a);
	}, [t, n]), n;
}
//#endregion
//#region src/app/components/inspector/SessionSideBox.tsx
function Qy({ sessionId: e }) {
	let t = Zy(e);
	return /* @__PURE__ */ J(lc, {
		active: t,
		className: "absolute bottom-[-1px] left-0 right-0 z-[1]"
	});
}
function $y({ sessionId: e, snapshot: t, behavior: n, panel: r, onPanelChange: i }) {
	let { useSidePanelExpanded: a, useSelectedWorkset: o, useSelectedThread: c, useSelectedRevision: l, toggleSidePanelExpanded: u, toggleSidePanelCollapsed: d, showSidePanelList: p, selectWorkset: m, selectThread: h, selectRevision: _ } = B().stores.sessionLayoutStore, v = a(), y = g(), b = c(), x = o(), S = l(), C = n === void 0 ? t?.metadata.behavior ?? "orchestrator" : n, w = C === "direct" || C === "direct-with-orchestrator", T = C == null ? null : Bl(C, t?.lineage?.kind), E = T?.readOnly ?? !1, D = T?.widePanels ?? [], O = ct(), k = D.includes("delegated"), A = he(e, k), ee = f(e, k && C === "direct-with-orchestrator"), te = (A.data?.length ?? 0) + (O.orchestrationEnabled ? ee.data?.length ?? 0 : 0), ne = T == null ? null : D.includes(r) || y && T.mobilePanels.includes(r) ? r : T.defaultPanel, re = /* @__PURE__ */ Y(q, { children: [
		ne === "files" ? /* @__PURE__ */ J(d_, {
			sessionId: e,
			snapshot: t,
			revision: S,
			readOnly: E
		}) : null,
		ne === "delegated" && w && !E ? /* @__PURE__ */ J(ly, {
			sessionId: e,
			behavior: C
		}) : null,
		ne === "terminal" && w && !E ? /* @__PURE__ */ J(Og, { sessionId: e }) : null,
		ne === "worksets" ? /* @__PURE__ */ J(Jy, {
			snapshot: t,
			selected: x,
			onSelect: m
		}) : null,
		ne === "threads" ? /* @__PURE__ */ J(Hy, {
			snapshot: t,
			selected: b,
			onSelect: h,
			canSteerWorkers: C === "orchestrator" && !E
		}) : null,
		ne === "history" ? /* @__PURE__ */ J(my, {
			sessionId: e,
			selected: S,
			onSelect: _
		}) : null
	] });
	return y ? /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-h-0",
		children: re
	}) : /* @__PURE__ */ Y("div", {
		className: V("flex flex-col min-h-0 h-full overflow-hidden bg-elevation-level-1", v ? null : "border-l border-muted"),
		children: [/* @__PURE__ */ Y("div", {
			className: V("flex items-center gap-4 pl-3 pr-2 py-2 shrink-0 bg-elevation-level-1 relative border-b border-muted", v ? "pr-10" : null),
			children: [
				/* @__PURE__ */ J(Qy, { sessionId: e }),
				/* @__PURE__ */ J("div", {
					className: "flex flex-1 min-w-0 items-center gap-3",
					role: "tablist",
					children: D.map((e) => {
						let n = ne === e, r = Zh(e, te, t?.worksets?.items.length ?? 0);
						return /* @__PURE__ */ Y("span", {
							className: "relative shrink-0",
							children: [/* @__PURE__ */ Y("button", {
								type: "button",
								role: "tab",
								"aria-selected": n,
								"aria-label": sr[e],
								className: V("btn btn-medium btn-icon-left !rounded-full", n ? "btn-secondary-highlighted" : "btn-ghost"),
								onClick: () => {
									p(!1), i(e);
								},
								children: [/* @__PURE__ */ J(M, { iconName: Xh[e] }), sr[e]]
							}), r > 0 ? /* @__PURE__ */ J(Yh, { count: r }) : null]
						}, e);
					})
				}),
				v ? null : /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-2 pb-[2px] shrink-0",
					children: [/* @__PURE__ */ J(Zn, {
						title: "Expand panel",
						position: z.BottomLeft,
						children: /* @__PURE__ */ J(s, {
							size: F.Medium,
							variant: I.Ghost,
							content: R.Icon,
							"aria-label": "Expand panel",
							onClick: u,
							children: /* @__PURE__ */ J(M, { iconName: L.FullScreen })
						})
					}), /* @__PURE__ */ J(Zn, {
						title: "Hide panel",
						position: z.BottomLeft,
						children: /* @__PURE__ */ J(s, {
							size: F.Medium,
							variant: I.Ghost,
							content: R.Icon,
							"aria-label": "Hide panel",
							onClick: d,
							children: /* @__PURE__ */ J(M, { iconName: L.SidebarChevronRight })
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
var eb = [
	{
		icon: L.FolderOpen,
		title: "Explore this repository",
		prompt: "Understand the project structure, key components, and how they work together."
	},
	{
		icon: L.Eye,
		title: "Review current changes",
		prompt: "Review the working tree for bugs, regressions, and opportunities to simplify the code."
	},
	{
		icon: L.SearchPage,
		title: "Find something to improve",
		prompt: "Identify one meaningful improvement, explain its impact, and propose an implementation plan."
	},
	{
		icon: L.Bolt,
		title: "Help me get started",
		prompt: "Read the project documentation and suggest the best first task based on the current repository state"
	}
];
function tb() {
	let { sendPrompt: e } = B().stores.composerStore;
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-1 flex-col justify-center gap-2",
		children: [/* @__PURE__ */ J("p", {
			className: "text-[10px] leading-[12px] font-medium uppercase text-input-placeholder",
			children: "Get started"
		}), /* @__PURE__ */ J("div", {
			className: "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]",
			children: eb.map((t) => /* @__PURE__ */ J(Ks, {
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
function nb(e, t) {
	let r = t != null && ru(t, e).fix?.kind === "login", i = e ? n(e) : null, a = Pn(r && i !== null), o = a.data?.providers.find((e) => e.provider === i), s = o?.backend ?? null, c = !!o?.signed_in, l = Et(s, r && c), u = ai();
	U(() => {
		!r || s === null || u.invalidateQueries({ queryKey: bn.managedProviderModels(s) });
	}, [
		r,
		s,
		u
	]);
	let d = i === null || a.isError || a.data != null && !c || l.isError;
	return r && !d;
}
//#endregion
//#region src/app/hooks/useErrorNotice.ts
function rb(e, t) {
	let r = Vf(), { start: i } = Lu(), a = t ? n(t) : null;
	return H((n, o) => {
		let { title: s, description: c, fix: l } = ru(n, t);
		return {
			title: s,
			description: c,
			action: ib(l, {
				login: a ? () => void i(a) : null,
				settings: e ? () => r.settings(e) : null,
				retry: o ?? null
			})
		};
	}, [
		r,
		t,
		a,
		e,
		i
	]);
}
function ib(e, t) {
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
function ab({ open: e, onClose: t, sessionId: n, messageIdx: r, prompt: i }) {
	let a = _n(), o = dr();
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: t,
		title: "Revert to this snapshot",
		size: Wt.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(s, {
			variant: I.Ghost,
			size: F.Large,
			content: R.Text,
			onClick: t,
			disabled: o.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(s, {
			variant: I.SecondaryDestructive,
			size: F.Large,
			content: R.Text,
			onClick: async () => {
				if (!(r == null || o.isPending)) try {
					let e = await o.mutateAsync({
						id: n,
						messageIdx: r
					});
					a.success(e.workspace_restored ? "Reverted to this snapshot" : "Transcript reverted; no workspace snapshot covered this point"), t();
				} catch (e) {
					a.error(`Failed to revert: ${nr($(e))}`);
				}
			},
			loading: o.isPending,
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
function ob(e, t, n) {
	return e.recovery_action === "resume_goal" ? t?.status === "blocked" ? "resume_goal" : null : e.recovery_action === "settings" ? "settings" : e.recovery_action === "regenerate_with_rewind" && n ? "regenerate" : null;
}
//#endregion
//#region src/app/components/inspector/Transcript.tsx
function sb({ warning: e }) {
	return e ? /* @__PURE__ */ J(Ni, {
		role: "status",
		variant: ki.Info,
		title: "Session recovered",
		children: e
	}) : null;
}
function cb({ failure: e, goal: t, action: n }) {
	let r = e.recovery_action === "automatic_retry" && t?.status === "active", i = e.recovery_action === "resume_goal" && t?.status === "blocked", a = e.kind === "capacity", o = !!(e.partial_output?.text || e.partial_output?.reasoning || e.partial_output?.tool_call), s = a ? e.summary : r ? "Goal retry scheduled" : i ? "Goal stopped after repeated run failures" : o ? "Run stopped after a partial response" : e.summary, c = t?.next_attempt_at_epoch_ms ? new Date(t.next_attempt_at_epoch_ms).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit"
	}) : null, l = a ? "" : `${e.summary} `, u = r ? `${l}The durable goal and its usage were preserved. NAC will continue automatically${c ? ` at ${c}` : ""}.` : i ? `${l}The durable goal and its usage were preserved. Resume it when you want another bounded retry sequence.` : a ? `Retrying later may be necessary.${lb(e.retry_after_ms)}` : e.summary;
	return /* @__PURE__ */ Y(Ni, {
		role: r ? "status" : "alert",
		variant: r ? ki.Info : ki.Danger,
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
function lb(e) {
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
function ub(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		if (e[t]?.kind === "delegated-completion") return null;
		if (e[t]?.kind === "user") return t;
	}
	return null;
}
function db(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function fb({ sessionId: e, snapshot: t, panel: n, onFocusPanel: r, errorNotice: i = null }) {
	let { useStreamText: o, useStreamReasoning: c, useModelRetryAttempt: l, useRunning: u, useRunFailure: d, useRunError: f, useOptimisticUserPrompt: p, useLiveThreads: m, useCancelArmed: h, usePrimaryToolEvents: _, useFinishedToolCalls: v, useActivity: y, setOptimisticUserPrompt: b, pushLocalEvent: x } = B().stores.runtimeStore, { useSelectedWorkset: S, useSelectedThreadEpisode: C, useSelectedRevision: w, useSelectedFile: T, selectWorkset: E, selectThread: D, selectRevision: O, selectFile: k } = B().stores.sessionLayoutStore, A = u(e), ee = h(e), te = y(), ne = f(), re = d(), ie = l(), ae = m(), oe = v(), se = _(), le = o(), ue = c(), de = p(), fe = C(), pe = S(), me = T(), j = w(), he = _n(), ge = Vf(), _e = fi(), ve = t?.metadata.backend ?? null, ye = rb(e, ve), be = nb(ve, ne), xe = gn(), N = qn(), Se = or(), P = Un(), Ce = xn(e), { data: we } = St(e), Te = t?.metadata.behavior === "direct" || t?.metadata.behavior === "direct-with-orchestrator", Ee = ce(e, Te), De = xt(), { data: Oe } = pt(e, Te), ke = W(() => new Set((Oe?.requests ?? []).map((e) => e.call_id).filter((e) => !!e)), [Oe?.requests]), { scrollRef: je, contentRef: Me, showJumpButton: Ne, jumpToLatest: Pe, followLatest: Fe } = Yv({ resetKey: e }), Ie = G(null), Le = G(!1), Re = G(!1), ze = t?.message_page?.start ?? 0;
	Qr(() => {
		let e = Ie.current, t = je.current;
		!e || !t || (t.scrollTop = e.top + (t.scrollHeight - e.height), Ie.current = null);
	}, [ze, je]);
	let Be = H(() => {
		let e = je.current;
		e && (Ie.current = {
			height: e.scrollHeight,
			top: e.scrollTop
		}), Ce.mutateAsync().then((e) => {
			e || (Ie.current = null);
		}).catch(() => {
			Ie.current = null;
		});
	}, [Ce, je]);
	En("Transcript");
	let Ve = W(() => a("buildTranscript", () => Dv(t, ae, oe, se, ke)), [
		t,
		ae,
		oe,
		se,
		ke
	]), He = A ? t?.active_run?.submitted_user_message : void 0, Ue = He ? An(He.content) : de ?? "", We = He ? cn(He.content) : null, Ge = !!(Ue && db(Ve) !== Ue);
	Qr(() => {
		Le.current = !1, Re.current = !1;
	}, [e]), U(() => {
		Re.current = !0;
	}, [e]), Qr(() => {
		let e = Ge && !Le.current;
		Le.current = Ge, e && Re.current && Fe(300);
	}, [Ge, Fe]);
	let Ke = W(() => Ev(Ve, {
		text: le,
		reasoning: ue
	}, Ge), [
		Ve,
		le,
		ue,
		Ge
	]), qe = Ge && Ke[Ke.length - 1]?.key === "model-streaming";
	Ae("transcript:turns", {
		fields: {
			turns: Ke.length,
			streamChars: le.length
		},
		throttleMs: 1e3
	});
	let Je = W(() => ub(Ke), [Ke]), Ye = A || ee || xe.isPending || N.isPending || Se.isPending, [Xe, Ze] = K(null), Qe = N.mutateAsync, $e = H((t) => {
		Ye || (async () => {
			try {
				let n = await Qe({
					id: e,
					messageIdx: t
				});
				x("run", `▶ regenerated: ${n.display_prompt.slice(0, 80)}`);
			} catch (e) {
				x("error", `regeneration failed: ${nr($(e))}`, !0), he.error(`Failed to regenerate: ${iu($(e), ve)}`);
			}
		})();
	}, [
		Ye,
		ve,
		x,
		Qe,
		e,
		he
	]), et = Se.mutateAsync, tt = H((t) => {
		Ye || (async () => {
			try {
				let n = await et({
					id: e,
					messageIdx: t
				});
				_e(_r.session(n.session_id));
			} catch (e) {
				he.error(`Failed to create fork: ${iu($(e), ve)}`);
			}
		})();
	}, [
		Ye,
		ve,
		et,
		_e,
		e,
		he
	]), nt = H((e) => {
		_e(_r.session(e));
	}, [_e]), rt = P.mutate, it = H((t) => {
		rt({
			id: e,
			forkId: t
		}, { onError: (e) => {
			he.error(`Failed to dismiss fork: ${iu($(e), ve)}`);
		} });
	}, [
		ve,
		rt,
		e,
		he
	]), at = H((e, t) => {
		Ze({
			messageIdx: e,
			prompt: t
		});
	}, []), ot = g(), st = t?.metadata.model ?? "", ct = t?.lineage != null, lt = W(() => fy(Ke, we), [Ke, we]);
	U(() => {
		!Ge && de && b(null);
	}, [
		Ge,
		de,
		b
	]);
	let ut = Ke[Ke.length - 1], dt = A && ut?.kind === "model" && (!Ge || ut.key === "model-streaming"), ft = (A || Ge) && !dt, mt = H((e, t) => {
		D(e, t), r("threads");
	}, [r, D]), ht = H((e) => {
		E(e), r("worksets");
	}, [r, E]), gt = H((e) => {
		O(e), r("files");
	}, [r, O]), _t = H((e, t) => {
		O(e), k(t), r("files");
	}, [
		r,
		k,
		O
	]), vt = W(() => ({
		sessionId: e,
		selectedFile: n === "files" ? me : null,
		selectedRevision: n === "files" ? j : null,
		onOpenFile: _t,
		onOpenPanel: gt
	}), [
		e,
		n,
		me,
		j,
		_t,
		gt
	]), yt = !!(t && Ke.length === 0 && !A && !Ge), bt = ne && !A ? ne : null, Ct = A ? null : re ?? t?.run_failure ?? Ee.data?.last_failure ?? null, wt = [...Ke].reverse().find((e) => e.kind === "user"), Tt = Ct ? ob(Ct, Ee.data, wt?.kind === "user") : null, Et = Ct ? Tt === "resume_goal" ? {
		label: "Resume goal",
		onClick: () => {
			let t = Ee.data;
			t && De.mutateAsync({
				sessionId: e,
				goalId: t.goal_id,
				payload: {
					expected_version: t.version,
					status: "active"
				}
			}).catch((e) => he.error(`Failed to resume goal: ${iu($(e), ve)}`));
		}
	} : Tt === "settings" ? {
		label: "Open settings",
		onClick: () => ge.settings(e)
	} : Tt === "regenerate" && wt?.kind === "user" ? {
		label: "Regenerate from original prompt",
		onClick: () => $e(wt.messageIndex)
	} : void 0 : void 0, Dt = Ct ? null : i ?? (bt && !be ? ye(bt) : null), Ot = Qv(e, !!t || i !== null), kt = Ot ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
	return /* @__PURE__ */ Y("div", {
		className: "relative flex-1 min-h-0",
		children: [
			/* @__PURE__ */ J("div", {
				role: "status",
				"aria-label": Ot ? void 0 : "Loading conversation",
				className: V("pointer-events-none absolute inset-x-0 top-[96px] px-4 transition-opacity duration-150 ease-in-out md:top-[72px] md:px-0", Ot ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ J("div", {
					className: "mx-auto w-full max-w-[720px]",
					children: /* @__PURE__ */ J(Li, {
						rows: 3,
						rowClassName: "h-[48px]"
					})
				})
			}),
			yt ? /* @__PURE__ */ J("div", {
				className: V("absolute inset-x-0 top-[96px] flex overflow-auto px-4 md:top-[72px] md:px-0", ot ? "bottom-[128px]" : "bottom-[136px]", kt),
				children: /* @__PURE__ */ J("div", {
					className: "m-auto w-full max-w-[720px]",
					children: /* @__PURE__ */ J(tb, {})
				})
			}) : null,
			/* @__PURE__ */ J("div", {
				ref: je,
				className: V("h-full overflow-auto", kt, !Ot && "invisible"),
				children: /* @__PURE__ */ Y("div", {
					ref: Me,
					className: V("flex flex-col pt-[96px] md:pt-[72px] [&>*]:shrink-0 px-4 md:px-0", ot ? "pb-[180px]" : "pb-[320px] mx-auto max-w-[720px]"),
					children: [
						t?.message_page?.has_older ? /* @__PURE__ */ Y("div", {
							className: "mb-4 flex flex-col items-start gap-2",
							children: [/* @__PURE__ */ J(s, {
								variant: I.Ghost,
								size: F.Small,
								content: R.Text,
								disabled: Ce.isPending,
								onClick: Be,
								children: Ce.isPending ? "Loading…" : "Load older"
							}), Ce.isError ? /* @__PURE__ */ Y("div", {
								role: "alert",
								className: "flex items-center gap-2 text-basic-muted label-small",
								children: [/* @__PURE__ */ J("span", { children: "Couldn’t load older messages." }), /* @__PURE__ */ J(s, {
									variant: I.Ghost,
									size: F.Small,
									content: R.Text,
									onClick: Be,
									children: "Try again"
								})]
							}) : null]
						}) : null,
						/* @__PURE__ */ J(fr, {
							id: "turns",
							children: Ke.map((e, r) => {
								if (e.kind === "delegated-completion") return /* @__PURE__ */ J(Mv, { turn: e }, e.key);
								if (e.kind === "user") return /* @__PURE__ */ J(jv, {
									text: e.text,
									invokedSkills: e.invokedSkills,
									timestamp: e.createdAt ? Fn(e.createdAt) : null,
									messageIndex: e.messageIndex,
									actionsDisabled: Ye,
									readOnly: ct,
									onRefresh: !ct && Je === r ? $e : null,
									onRevert: ct ? null : at
								}, e.key);
								let i = null, a = null;
								for (let e = r - 1; e >= 0; --e) {
									let t = Ke[e];
									if (t?.kind === "delegated-completion") break;
									if (t?.kind === "user") {
										i = e, a = t;
										break;
									}
								}
								let o = r === Ke.length - 1 && !(Ge && e.key !== "model-streaming"), s = /* @__PURE__ */ J(Av, {
									turn: e,
									model: st,
									active: A && o,
									isLast: o && !ft,
									activity: A && o ? te : void 0,
									selectedThreadEpisode: n === "threads" ? fe : null,
									selectedWorkset: n === "worksets" ? pe : null,
									onSelectThread: mt,
									onSelectWorkset: ht,
									userMessageIndex: a?.messageIndex,
									userText: a?.text,
									actionsDisabled: Ye,
									readOnly: ct,
									onRefresh: !ct && i != null && Je === i ? $e : null,
									onRevert: ct ? null : at,
									onFork: ct ? null : tt,
									forks: ct ? [] : (t?.forks ?? []).filter((t) => t.source_message_idx === e.messageIndex),
									onOpenFork: nt,
									onDismissFork: it,
									snapshotRevision: e.messageIndex == null ? null : lt.get(e.messageIndex) ?? null,
									filesPanel: vt
								}, e.key);
								return qe && e.key === "model-streaming" ? /* @__PURE__ */ Y(Gr, { children: [/* @__PURE__ */ J(jv, {
									text: Ue,
									invokedSkills: We,
									pending: !0
								}), s] }, e.key) : s;
							})
						}),
						Ge && !qe ? /* @__PURE__ */ J(jv, {
							text: Ue,
							invokedSkills: We,
							pending: !0
						}) : null,
						ft ? /* @__PURE__ */ J(Av, {
							turn: {
								kind: "model",
								key: "model-pending",
								blocks: [],
								durationMs: null,
								messageIndex: null
							},
							model: st,
							active: !0,
							isLast: !0,
							selectedThreadEpisode: n === "threads" ? fe : null,
							selectedWorkset: n === "worksets" ? pe : null,
							onSelectThread: mt,
							onSelectWorkset: ht
						}) : null,
						Dt ? /* @__PURE__ */ J(Ni, {
							role: "alert",
							variant: ki.Error,
							title: Dt.title,
							action: Dt.action,
							children: Dt.description
						}) : null,
						A && ie ? /* @__PURE__ */ J(Ni, {
							role: "status",
							variant: ki.Info,
							title: `Connection interrupted; retrying model response (attempt ${ie})`,
							children: "The abandoned partial stream was cleared before this attempt began."
						}) : null,
						Ct ? /* @__PURE__ */ J(cb, {
							failure: Ct,
							goal: Ee.data,
							action: Et
						}) : null,
						/* @__PURE__ */ J(sb, { warning: t?.transcript_recovery_warning })
					]
				})
			}),
			/* @__PURE__ */ J("div", {
				className: `absolute z-[2] left-1/2 bottom-0 -translate-x-1/2 rounded-full  transition-all duration-150 ease-out ${Ne ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-75 opacity-0 pointer-events-none"}`,
				children: /* @__PURE__ */ Y(s, {
					variant: I.Primary,
					size: F.Small,
					content: R.IconRight,
					className: "!rounded-b-none !shadow-3xl",
					onClick: Pe,
					children: ["Last messages", /* @__PURE__ */ J(M, { iconName: L.Down })]
				})
			}),
			/* @__PURE__ */ J(ab, {
				open: Xe !== null,
				onClose: () => Ze(null),
				sessionId: e,
				messageIdx: Xe?.messageIdx ?? null,
				prompt: Xe?.prompt ?? ""
			})
		]
	});
}
//#endregion
//#region src/app/features/direct-session/RunDetails.tsx
function pb({ context: e, input: t, output: n, cost: r, elapsed: i }) {
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
function mb({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		className: "flex items-start gap-2 w-full p-1 rounded-[4px] text-left btn-ghost",
		onClick: i,
		children: [
			/* @__PURE__ */ J(M, {
				iconName: r ? L.Check : L.History,
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
function hb({ sessionId: e, selected: t, onSelect: n, placement: r = z.TopRight }) {
	let [i, a] = K(!1), { data: o, isLoading: s, error: c } = St(e), l = o ?? [], u = (e) => dy(e, l.length), d = l.findIndex((e) => e.id === t), f = d >= 0 ? uy(u(d)) : "Working tree", p = (e) => {
		n(e), a(!1);
	};
	return /* @__PURE__ */ J(Ln, {
		open: i,
		onClose: () => a(!1),
		placement: r,
		className: "min-w-0",
		content: /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(mb, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => p(null)
			}),
			s ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [/* @__PURE__ */ J(Le, {
					size: A.Small,
					variant: de.Neutral
				}), "Reading snapshots…"]
			}) : null,
			c ? /* @__PURE__ */ J("div", {
				className: "p-1 label-micro text-error-primary",
				children: nr(c)
			}) : null,
			!s && !c ? /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1 max-h-[280px] overflow-auto [&>*]:shrink-0",
				children: [l.map((e, n) => /* @__PURE__ */ J(gb, {
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
			className: V("flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost", t != null && "text-info-primary"),
			"aria-expanded": i,
			"aria-label": `Snapshot: ${f}`,
			onClick: () => a(!i),
			children: [/* @__PURE__ */ J(M, {
				iconName: L.History,
				size: 16,
				className: "shrink-0"
			}), /* @__PURE__ */ J("span", {
				className: "label-micro text-btn-secondary truncate max-w-[64px] xl:max-w-[128px]",
				children: f
			})]
		})
	});
}
function gb({ revision: e, ordinal: t, selected: n, onClick: r }) {
	let i = e.label.trim();
	return /* @__PURE__ */ J(mb, {
		title: `${uy(t)} · ${Fn(e.created_at)}`,
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
var _b = {
	direct: "Agent",
	"direct-with-orchestrator": "Agent + NAC",
	orchestrator: "Orchestrator"
};
function vb(e, t) {
	let n = t.contextWindow;
	return !n || e == null ? "Context tokens" : t.estimated ? `Context against ${t.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate` : `Context — ${Math.round(e / n * 100)}% of the model's context window`;
}
function yb({ iconName: e, value: t, title: n, className: r, labelClassName: i }) {
	return /* @__PURE__ */ J(Zn, {
		title: n,
		position: z.BottomCenter,
		children: /* @__PURE__ */ Y("div", {
			className: V("flex items-center gap-0.5 whitespace-nowrap", r),
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
function bb({ sessionId: e, snapshot: t, entry: n, onShowPanel: r }) {
	let { useSessionSpend: i, useRunning: a, useRunUsage: o, useRunStartedAt: c, useLastElapsedMs: l, useCancelArmed: u, liftSessionSpend: d } = B().stores.runtimeStore, { useSelectedRevision: f, selectRevision: p } = B().stores.sessionLayoutStore, m = fi(), h = ml(), { data: g = [] } = Bt(), _ = a(e), v = u(e), y = o(), b = i();
	U(() => {
		d(Or(t));
	}, [d, t]);
	let x = Lt(t, n, _ || v ? y : null, b), S = Xn(), C = Or(t), w = x.usage?.total_tokens || C?.total_tokens || null, T = vb(w, bu(S.data, t?.metadata?.backend, x.model)), E = rr(1e3, _), D = c(), O = l(), k = (_ && D != null ? Math.max(0, E - D) : null) ?? O ?? x.lastResponseMs, A = f(), ee = mt(e, A), te = t?.workspace ?? null, ne = A == null ? te : ee.data ?? {
		total_additions: 0,
		total_deletions: 0
	}, re = ne?.total_additions ?? 0, ie = ne?.total_deletions ?? 0, ae = te?.repo_label ?? te?.workspace_display ?? null, oe = te?.branch ?? null, se = n?.lineage ?? t?.lineage ?? null, ce = se != null, le = se?.kind === "traditional-child" ? "Traditional coding agent" : se?.kind === "managed-orchestrator" ? "Managed NAC orchestrator" : null, ue = se ? g.find((e) => e.summary.session_id === se.parent_session_id) : void 0, de = ue ? h(ue.summary) : "Parent session", fe = () => {
		se && m(_r.session(se.parent_session_id, "delegated"));
	}, pe = ct(), me = n?.summary.behavior ?? t?.metadata.behavior ?? null, j = h(n?.summary);
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
							se ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(s, {
									size: F.Large,
									variant: I.Ghost,
									content: R.Icon,
									className: "!h-6 !w-6 !min-h-0 !p-0",
									"aria-label": "Parent chat",
									onClick: fe,
									children: /* @__PURE__ */ J(M, { iconName: L.Left })
								}),
								/* @__PURE__ */ J("button", {
									type: "button",
									className: "label-medium max-w-[120px] truncate text-btn-secondary",
									title: de,
									onClick: fe,
									children: de
								}),
								/* @__PURE__ */ J(M, {
									iconName: L.Right,
									size: 16,
									className: "shrink-0 text-btn-secondary"
								})
							] }) : null,
							/* @__PURE__ */ J("p", {
								className: V("header-md min-w-0 truncate", _ ? "text-shimmer-basic" : "text-basic-primary"),
								children: j
							}),
							le ? /* @__PURE__ */ J("span", {
								className: "tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-1 py-[2px] text-basic-tertiary",
								children: le
							}) : me && pe.orchestrationEnabled ? /* @__PURE__ */ J("span", {
								className: "tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-1 py-[2px] text-basic-tertiary",
								children: _b[me]
							}) : null
						]
					}),
					me === "direct" || me === "direct-with-orchestrator" ? /* @__PURE__ */ J(pb, {
						context: pn(w),
						input: pn(x.usage?.input_tokens),
						output: pn(x.usage?.output_tokens),
						cost: qt(x.usage?.cost?.total),
						elapsed: vr(k)
					}) : /* @__PURE__ */ Y(q, { children: [x.usage || w ? /* @__PURE__ */ Y("div", {
						className: "shrink-0 items-center gap-0.5 hidden xl:flex",
						children: [/* @__PURE__ */ J(yb, {
							iconName: L.Timelaps,
							value: pn(w),
							title: T,
							className: "text-info-primary",
							labelClassName: "label-micro"
						}), x.usage ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(yb, {
							iconName: L.ArrowTop,
							value: pn(x.usage.input_tokens),
							title: "Input tokens",
							className: "text-info-secondary opacity-75",
							labelClassName: "text-micro"
						}), /* @__PURE__ */ J(yb, {
							iconName: L.ArrowDown,
							value: pn(x.usage.output_tokens),
							title: "Output tokens",
							className: "text-info-secondary opacity-75",
							labelClassName: "text-micro"
						})] }) : null]
					}) : null, /* @__PURE__ */ Y("div", {
						className: "flex shrink-0 items-center",
						children: [x.usage ? /* @__PURE__ */ J(Zn, {
							title: "Session cost",
							position: z.BottomCenter,
							children: /* @__PURE__ */ J("span", {
								className: "text-micro whitespace-nowrap text-basic-primary",
								children: qt(x.usage.cost?.total)
							})
						}) : null, /* @__PURE__ */ J(Zn, {
							title: _ ? "Run elapsed" : "Last response time",
							position: z.BottomRight,
							children: /* @__PURE__ */ J("span", {
								className: "label-micro flex h-6 w-14 items-center justify-end text-basic-tertiary",
								children: vr(k)
							})
						})]
					})] }),
					r ? /* @__PURE__ */ J(Zn, {
						title: "Show panel",
						position: z.BottomLeft,
						children: /* @__PURE__ */ J(s, {
							size: F.Medium,
							variant: I.Ghost,
							content: R.Icon,
							"aria-label": "Show panel",
							onClick: r,
							children: /* @__PURE__ */ J(M, { iconName: L.SidebarChevronLeft })
						})
					}) : null
				]
			}), /* @__PURE__ */ Y("div", {
				className: "flex w-full items-center gap-2",
				children: [
					/* @__PURE__ */ Y("div", {
						className: "flex min-w-0 flex-1 items-center gap-4 overflow-hidden",
						children: [
							se?.description ? /* @__PURE__ */ J("span", {
								className: "label-micro min-w-0 truncate text-basic-secondary",
								children: se.description
							}) : null,
							ae ? /* @__PURE__ */ Y("div", {
								className: "flex shrink-0 items-center gap-0.5",
								children: [/* @__PURE__ */ J("span", {
									className: "label-micro max-w-[120px] truncate text-basic-tertiary",
									children: ae
								}), /* @__PURE__ */ J("span", {
									className: "tag-label text-basic-muted",
									children: Nr(n?.summary)
								})]
							}) : null,
							oe && !ce ? /* @__PURE__ */ J(Lm, {
								sessionId: e,
								branch: oe,
								placement: z.BottomRight
							}) : null,
							oe && ce ? /* @__PURE__ */ Y("span", {
								className: "label-micro flex min-w-0 items-center gap-1.5 text-btn-secondary",
								children: [/* @__PURE__ */ J(M, {
									iconName: L.Scheme,
									size: 16,
									className: "shrink-0"
								}), /* @__PURE__ */ J("span", {
									className: "truncate",
									children: oe
								})]
							}) : null
						]
					}),
					/* @__PURE__ */ J(hb, {
						sessionId: e,
						selected: A,
						onSelect: p,
						placement: z.BottomLeft
					}),
					re || ie ? /* @__PURE__ */ Y("div", {
						className: "code code-small flex shrink-0 items-center gap-2",
						children: [/* @__PURE__ */ Y("span", {
							className: "text-success-primary",
							children: ["+", re]
						}), /* @__PURE__ */ Y("span", {
							className: "text-error-primary",
							children: ["-", ie]
						})]
					}) : null
				]
			})]
		})
	});
}
//#endregion
//#region src/app/components/pages/SessionPage.tsx
function xb(e, t) {
	let { useSshConnectionStatus: n, sshTargetKey: r, sshTargetFromSummary: i, markSshDisconnected: a, markSshConnected: o } = B().stores.sshConnectionStore, s = W(() => i(t), [i, t]), c = n(s), l = Pr(), u = G(null);
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
function Sb() {
	let { useSidePanelExpanded: e, useSidePanelCollapsed: t, useSidePanelAnimate: n, useSelectedWorkset: r, useSelectedThreadRunning: i, useSelectedThread: a, useSelectedRevision: o, useSelectedFile: c, toggleSidePanelList: l, toggleSidePanelExpanded: u, toggleSidePanelCollapsed: d, showSidePanelList: f, revealSidePanel: p, setSidePanelAnimate: m, resetSessionSelection: h, unbindSidePanelProject: _, bindSidePanelProject: v } = B().stores.sessionLayoutStore, { clearAttention: y } = B().stores.attentionStore, { sessionId: b, panel: x } = pi(), S = fi(), C = b ?? null, w = ct(), T = Df();
	En("SessionPage");
	let { data: E = null, error: D, refetch: O } = Nn(C), { data: k = null } = xr(C), A = rb(C, k?.summary.backend), ee = t(), te = n(), ne = e(), re = a(), ie = i(), ae = r(), oe = c(), se = o(), ce = g(), le = k != null || E != null, ue = le ? k?.summary.behavior ?? E?.metadata.behavior ?? "orchestrator" : null, de = !le || ft(w, ue, k?.lineage ?? E?.lineage);
	ph(de ? C : null), hh(de ? E?.active_run : null), xb(de ? C : null, de ? k?.summary : null);
	let fe = ue == null ? null : Bl(ue, E?.lineage?.kind), pe = fe?.mobilePanels ?? [], me = Vt(x) ? x : jt, j = fe == null || fe.mobilePanels.includes(me) ? me : fe.defaultPanel;
	U(() => {
		!C || !E || !Vt(x) || x === j || S(_r.session(C, j), { replace: !0 });
	}, [
		j,
		C,
		S,
		x,
		E
	]);
	let he = mt(C, ce && j === "files" ? se : null);
	U(() => {
		C && y(C), h();
	}, [
		y,
		C,
		h
	]);
	let ge = k ? k.summary.project_id ?? "" : null;
	if (Qr(() => {
		_(), ge != null && v(ge);
	}, [
		v,
		C,
		ge,
		_
	]), U(() => {
		if (te) return;
		let e = requestAnimationFrame(() => m(!0));
		return () => cancelAnimationFrame(e);
	}, [te, m]), le && !de) return /* @__PURE__ */ Y("div", {
		className: "flex flex-1 flex-col items-center justify-center gap-4 p-8",
		children: [
			/* @__PURE__ */ J("h1", {
				className: "heading-small",
				children: "This chat is unavailable in direct-only mode"
			}),
			/* @__PURE__ */ J("p", { children: "Its saved behavior and history are preserved. An operator can enable orchestration to open it." }),
			/* @__PURE__ */ J(s, {
				onClick: () => {
					let e = k?.summary.project_id ?? E?.metadata.project_id;
					e ? T.newChat(e) : T.create();
				},
				children: "New direct chat"
			})
		]
	});
	if (!C) return /* @__PURE__ */ J(si, {
		to: _r.list(),
		replace: !0
	});
	if (!Vt(x)) return /* @__PURE__ */ J(si, {
		to: _r.session(C, jt),
		replace: !0
	});
	let _e = k?.summary.model_config_error ?? (!E && D ? D : null), ve = _e ? A(_e, () => void O()) : null, ye = (e) => S(_r.session(C, e)), be = (e) => {
		p(ce), ye(e);
	}, xe = se == null ? E?.workspace?.changed_files ?? [] : he.data?.changed_files ?? [], N = oe ?? xe[0]?.path ?? null, Se = N ? xe.find((e) => e.path === N) : void 0, P = Se && (Se.additions || Se.deletions) ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 shrink-0 code code-small",
		children: [/* @__PURE__ */ Y("span", {
			className: "text-success-primary",
			children: ["+", Se.additions ?? 0]
		}), /* @__PURE__ */ Y("span", {
			className: "text-error-primary",
			children: ["-", Se.deletions ?? 0]
		})]
	}) : null, Ce = re, we = j === "threads" && ie, Te = /* @__PURE__ */ J($y, {
		sessionId: C,
		snapshot: E,
		behavior: ue,
		panel: j,
		onPanelChange: ye
	});
	return /* @__PURE__ */ Y("section", {
		className: "relative flex min-h-0 min-w-0 flex-1 h-full overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ Y("div", {
			className: "relative flex flex-1 min-w-0 h-full min-h-0",
			children: [/* @__PURE__ */ J("div", {
				className: V("flex flex-col items-center flex-1 min-w-0 h-full", ce ? "px-0" : "px-2"),
				children: /* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-h-0 w-full relative",
					children: [
						ce && (k?.lineage ?? E?.lineage) ? /* @__PURE__ */ J("div", {
							className: "pointer-events-none absolute inset-x-0 top-16 z-20 flex items-center px-3 pt-2",
							children: /* @__PURE__ */ J(s, {
								className: "pointer-events-auto relative",
								size: F.Small,
								variant: I.Ghost,
								onClick: () => {
									let e = (k?.lineage ?? E?.lineage)?.parent_session_id;
									e && S(_r.session(e, "delegated"));
								},
								children: "Parent chat"
							})
						}) : null,
						ce ? null : /* @__PURE__ */ J(bb, {
							sessionId: C,
							snapshot: E,
							entry: k
						}),
						/* @__PURE__ */ J(fb, {
							sessionId: C,
							snapshot: E,
							panel: j,
							onFocusPanel: be,
							errorNotice: ve
						}),
						/* @__PURE__ */ J("div", {
							className: V("absolute bottom-0 left-0 right-0", ce ? "-mx-2" : "pb-2 mx-auto max-w-[720px]"),
							children: /* @__PURE__ */ J(Kh, {
								sessionId: C,
								snapshot: E,
								entry: k
							})
						})
					]
				})
			}), ce ? null : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("div", {
				className: V("relative h-full shrink-0", te && "transition-[width] duration-500 ease-in-out", ee ? "w-[52px]" : "w-1/2"),
				style: te ? void 0 : { transition: "none" },
				children: ee ? /* @__PURE__ */ J("div", {
					className: "absolute inset-y-0 right-0 w-[52px]",
					children: /* @__PURE__ */ J(Qh, {
						sessionId: C,
						snapshot: E,
						behavior: ue,
						panels: fe?.widePanels ?? [],
						onOpen: d,
						onSelect: be
					})
				}) : null
			}), /* @__PURE__ */ J("div", {
				className: V("absolute inset-y-0 right-0 z-[1] flex flex-col min-w-0 w-1/2", te && "transition-transform duration-500 ease-in-out", ee && "translate-x-full"),
				style: te ? void 0 : { transition: "none" },
				"aria-hidden": ee,
				inert: ee,
				children: /* @__PURE__ */ J("div", {
					className: "flex flex-col flex-1 min-h-0",
					children: /* @__PURE__ */ J("div", {
						className: "flex-1 min-h-0",
						children: ne ? null : Te
					})
				})
			})] })]
		}), ce ? /* @__PURE__ */ Y(ur, {
			open: ne,
			onClose: u,
			keepOnNavigate: !0,
			title: /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 min-w-0",
				children: [/* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-w-0 justify-center",
					children: [/* @__PURE__ */ J("div", {
						className: "min-w-0 truncate",
						children: /* @__PURE__ */ J("span", {
							className: V("header-small", we ? "text-shimmer-basic" : "text-basic-primary"),
							children: j === "threads" ? Ce ?? sr.threads : j === "worksets" ? ae ?? E?.worksets.items[0]?.id ?? sr.worksets : j === "files" ? oe?.split("/").pop() ?? E?.workspace?.changed_files?.[0]?.path.split("/").pop() ?? sr.files : sr[j]
						})
					}), j === "files" ? P : null]
				}), E?.workspace?.branch && !E.lineage ? /* @__PURE__ */ J(Lm, {
					sessionId: C,
					branch: E.workspace.branch
				}) : null]
			}),
			headerActions: j === "history" ? null : /* @__PURE__ */ J(s, {
				size: F.Large,
				variant: I.Ghost,
				content: R.Icon,
				"aria-label": "Open list",
				onClick: l,
				children: /* @__PURE__ */ J(M, {
					iconName: L.List,
					size: 24
				})
			}),
			bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
			children: [/* @__PURE__ */ J("div", {
				className: "flex flex-col flex-1 min-h-0",
				children: Te
			}), pe.length > 0 ? /* @__PURE__ */ J(Jh, {
				panel: j,
				panels: pe,
				onPanelChange: (e) => {
					f(!1), ye(e);
				}
			}) : null]
		}) : /* @__PURE__ */ J(ur, {
			open: ne,
			onClose: u,
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
function Cb({ onConnected: e }) {
	let { api: t } = B(), n = _n(), r = ai(), i = fn(), [a, o] = K(null), [c, l] = K(""), [u, d] = K(!1);
	U(() => {
		if (!a) return;
		let i = !1, s = new AbortController();
		return (async () => {
			for (; !i;) {
				try {
					let i = await t.pollManagedGitHubLogin(a.login_id, s.signal);
					if (i.state === "complete") {
						r.setQueryData(tn.github, i.auth), o(null), l(""), Promise.all([r.invalidateQueries({ queryKey: tn.github }), r.invalidateQueries({ queryKey: tn.hostStatus })]), n.success("GitHub connected"), e?.();
						return;
					}
					if (i.state === "failed") {
						l(i.error), o(null);
						return;
					}
				} catch (e) {
					s.signal.aborted || l(iu($(e)));
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
	let f = async () => {
		d(!0), l("");
		try {
			o(await t.startManagedGitHubLogin());
		} catch (e) {
			l(iu($(e)));
		} finally {
			d(!1);
		}
	}, p = async () => {
		d(!0);
		try {
			await t.disconnectManagedGitHub(), await Promise.all([r.invalidateQueries({ queryKey: tn.github }), r.invalidateQueries({ queryKey: tn.hostStatus })]), n.success("GitHub disconnected");
		} catch (e) {
			n.error(`Disconnect failed: ${nr($(e))}`);
		} finally {
			d(!1);
		}
	};
	return i.isLoading ? /* @__PURE__ */ J(Le, { size: A.Medium }) : /* @__PURE__ */ Y("div", {
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
						}) : /* @__PURE__ */ J(M, { iconName: L.Github }),
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
								iconName: L.CheckCircle,
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
						}), /* @__PURE__ */ J(an, {
							value: a.user_code,
							title: "Copy device code"
						})]
					}),
					/* @__PURE__ */ Y("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: [/* @__PURE__ */ Y(s, {
							variant: I.Primary,
							content: R.IconRight,
							onClick: () => window.open(a.verification_uri, "_blank", "noopener"),
							children: ["Open GitHub ", /* @__PURE__ */ J(M, { iconName: L.External })]
						}), /* @__PURE__ */ J(s, {
							variant: I.Tertiary,
							content: R.Text,
							onClick: () => {
								t.cancelManagedGitHubLogin(a.login_id), o(null);
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
				children: [/* @__PURE__ */ J(s, {
					variant: I.Primary,
					content: R.Text,
					onClick: () => void f(),
					loading: u,
					children: i.data?.connected ? "Reconnect GitHub" : "Connect GitHub"
				}), i.data?.connected ? /* @__PURE__ */ J(s, {
					variant: I.SecondaryDestructive,
					content: R.Text,
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
function wb() {
	let e = Sr(), t = It(), n = Jn(), r = _n(), [i, a] = K(""), [o, c] = K(""), [l, u] = K(!1), d = W(() => l ? Pe(i) : "", [l, i]), f = async () => {
		if (u(!0), !(Pe(i) || o.length === 0)) try {
			await t.mutateAsync({
				name: i,
				value: o
			}), a(""), c(""), u(!1), r.success("Secret saved for future command spawns");
		} catch (e) {
			r.error(`Secret was not saved: ${nr($(e))}`);
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
					value: o,
					onChange: (e) => c(e.target.value),
					validation: l && o.length === 0,
					validationText: "Enter a value.",
					autoComplete: "new-password"
				})]
			}),
			/* @__PURE__ */ J("div", { children: /* @__PURE__ */ J(s, {
				variant: I.Primary,
				content: R.Text,
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
					e.isLoading ? /* @__PURE__ */ J(Le, { size: A.Small }) : null,
					e.data?.secrets.length === 0 ? /* @__PURE__ */ J("p", {
						className: "text-small text-basic-tertiary",
						children: "No host secrets saved."
					}) : null,
					e.data?.secrets.map((e) => /* @__PURE__ */ Y("div", {
						className: "flex items-center gap-3 rounded-lg border border-basic p-3",
						children: [
							/* @__PURE__ */ J(M, { iconName: L.Key }),
							/* @__PURE__ */ J("code", {
								className: "min-w-0 flex-1 truncate text-basic-primary",
								children: e.name
							}),
							/* @__PURE__ */ J("span", {
								className: "text-small text-basic-muted",
								children: "value hidden"
							}),
							/* @__PURE__ */ J(s, {
								variant: I.Ghost,
								size: F.Small,
								content: R.Icon,
								"aria-label": `Delete ${e.name}`,
								onClick: async () => {
									try {
										await n.mutateAsync(e.name), r.success(`${e.name} removed from future command spawns`);
									} catch (e) {
										r.error(`Secret was not removed: ${nr($(e))}`);
									}
								},
								loading: n.isPending,
								children: /* @__PURE__ */ J(M, { iconName: L.Trash })
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
function Tb() {
	return `nac-upgrade-${globalThis.crypto.randomUUID()}`;
}
function Eb(e) {
	if (!e) throw Error("managed upgrade action target is unavailable");
	return e;
}
async function Db(e, t) {
	if (!t.actionable || t.action === "wait" || !t.target) throw Error("managed upgrade blocker is wait-only");
	let n = t.target;
	switch (t.action) {
		case "cancel_active_run": {
			let t = Eb(n.session_id), r = Eb(n.run_id);
			await e.cancelExactRun(t, r);
			return;
		}
		case "cancel_traditional_child":
			await e.cancelTraditionalChild(Eb(n.session_id), Eb(n.child_session_id));
			return;
		case "cancel_managed_orchestrator":
			await e.cancelManagedOrchestrator(Eb(n.session_id), Eb(n.orchestrator_session_id));
			return;
		case "terminate_terminal":
			await e.terminateTerminal(Eb(n.session_id), Eb(n.terminal_id));
			return;
		case "cancel_clone_operation":
			await e.cancelManagedClone(Eb(n.clone_operation_id));
			return;
	}
}
function Ob(e, t, n) {
	if (!t) return !1;
	let r = t.target_release ?? t.desired_release;
	return !r || !i(r, n) ? !1 : !e || t.operation_id !== e.operation_id || t.state !== e.state || t.updated_at !== e.updated_at;
}
function kb() {
	let { api: e } = B(), t = Lr(), n = Ke(), r = G(null), i = t.data?.operation?.operation_id ?? null, [a, o] = K(!1), [s, c] = K(""), [l, u] = K({}), d = G(i);
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
		let e = r.current ?? Tb(), i = t.data?.operation ?? null, a = t.data?.preview.latest_beta;
		r.current = e, c("");
		try {
			await n.mutateAsync(e), r.current = null, o(!1);
		} catch (e) {
			c(ke(e).message), Dr(e) && (r.current = null, o(!1));
			let n = await t.refetch();
			!Dr(e) && !n.error && a && Ob(i, n.data?.operation, a) && (r.current = null, c(""), o(!1));
		}
	}, [t, n]), h = H(async (n) => {
		u((e) => ({
			...e,
			[n.selection_key]: "requesting"
		}));
		try {
			await Db(e, n), u((e) => ({
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
function Ab() {
	let e = kb(), t = e.snapshot, n = Tn(t.error);
	if (t.isLoading) return /* @__PURE__ */ Y("section", {
		"aria-labelledby": "managed-upgrade-heading",
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ J("h2", {
			id: "managed-upgrade-heading",
			className: "label-medium text-basic-primary",
			children: "Managed NAC upgrade"
		}), /* @__PURE__ */ J("div", {
			className: "mt-3",
			children: /* @__PURE__ */ J(Le, { size: A.Small })
		})]
	});
	if (!t.data || n) {
		let e = ke(t.error);
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
				e.retryLabel ? /* @__PURE__ */ J(s, {
					className: "mt-3",
					size: F.Small,
					variant: I.Secondary,
					content: R.Text,
					onClick: () => void t.refetch(),
					loading: t.isFetching,
					children: e.retryLabel
				}) : null
			]
		});
	}
	let { preview: r, operation: a } = t.data, o = a ? S(a.state) : !1, c = r.upgrade_available && !o, l = a?.target_release, u = l && !i(l, r.latest_beta);
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
					children: Ze(r.distance?.accepted_releases ?? null)
				})] }), c ? /* @__PURE__ */ J(s, {
					size: F.Small,
					variant: I.Primary,
					content: R.Text,
					onClick: e.requestStart,
					children: a?.state === "failed" ? "Retry upgrade to latest beta" : "Upgrade to latest beta"
				}) : !r.upgrade_available && !o ? /* @__PURE__ */ J("span", {
					className: "rounded-full bg-success-secondary px-3 py-1 text-small text-success-primary",
					children: "Up to date"
				}) : null]
			}),
			/* @__PURE__ */ Y("div", {
				className: "mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2",
				children: [
					/* @__PURE__ */ J(jb, {
						label: "Current",
						release: r.current
					}),
					/* @__PURE__ */ J(jb, {
						label: "Latest beta",
						release: r.latest_beta
					}),
					u ? /* @__PURE__ */ J(jb, {
						label: "Accepted target",
						release: l,
						className: "lg:col-span-2"
					}) : null
				]
			}),
			a ? /* @__PURE__ */ J(Mb, {
				operation: a,
				settlements: e.settlements,
				onSettle: (t) => void e.requestSettlement(t)
			}) : null,
			/* @__PURE__ */ Y(ur, {
				open: e.confirmationOpen,
				onClose: e.cancelStart,
				title: "Upgrade Managed NAC?",
				size: Wt.Small,
				footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(s, {
					variant: I.Tertiary,
					content: R.Text,
					onClick: e.cancelStart,
					disabled: e.startPending,
					children: "Cancel"
				}), /* @__PURE__ */ J(s, {
					variant: I.Primary,
					content: R.Text,
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
function jb({ label: e, release: t, className: n = "" }) {
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
function Mb({ operation: e, settlements: t, onSettle: n }) {
	let r = e.blockers ?? [], i = e.state === "failed", a = e.state === "succeeded";
	return /* @__PURE__ */ Y("div", {
		className: `mt-4 rounded-lg border p-4 ${i ? "border-error-primary" : a ? "border-success-primary" : "border-basic"}`,
		"aria-live": "polite",
		"data-testid": "managed-upgrade-operation",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-wrap items-start justify-between gap-2",
			children: [/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
				className: "label-medium text-basic-primary",
				children: v(e.state)
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
							}), e.actionable ? /* @__PURE__ */ J(s, {
								size: F.Small,
								variant: I.SecondaryDestructive,
								content: R.Text,
								onClick: () => n(e),
								loading: r === "requesting",
								disabled: r === "settling",
								children: r === "settling" ? "Waiting for cleanup" : r === "failed" ? `Try again: ${p(e.action)}` : p(e.action)
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
function Nb({ ready: e }) {
	return /* @__PURE__ */ J("span", {
		"aria-hidden": !0,
		className: `inline-block h-2 w-2 rounded-full ${e ? "bg-success-primary" : "bg-warning-primary"}`
	});
}
function Pb() {
	let e = sn();
	if (e.isLoading) return /* @__PURE__ */ J(Le, { size: A.Medium });
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
			/* @__PURE__ */ J(Ab, {}),
			/* @__PURE__ */ Y("div", {
				className: "grid grid-cols-1 gap-2 sm:grid-cols-2",
				children: [
					/* @__PURE__ */ J(Fb, {
						label: t.model.display_name,
						value: t.model_ready ? t.model.id : "Needs attention",
						ready: t.model_ready
					}),
					/* @__PURE__ */ J(Fb, {
						label: "GitHub",
						value: t.github_status.replace("-", " "),
						ready: t.github_status === "connected"
					}),
					/* @__PURE__ */ J(Fb, {
						label: "Projects",
						value: String(t.project_count),
						ready: !0
					}),
					/* @__PURE__ */ J(Fb, {
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
						children: /* @__PURE__ */ J(Nb, { ready: e.ready })
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
function Fb({ label: e, value: t, ready: n }) {
	return /* @__PURE__ */ Y("div", {
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ J("p", {
			className: "text-small text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ Y("div", {
			className: "mt-1 flex items-center gap-2",
			children: [/* @__PURE__ */ J(Nb, { ready: n }), /* @__PURE__ */ J("p", {
				className: "label-medium capitalize text-basic-primary",
				children: t
			})]
		})]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedHostModal.tsx
function Ib({ open: e, onClose: t, tab: n, onTabChange: r, onGitHubConnected: i }) {
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: t,
		title: "Managed host",
		size: Wt.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		children: /* @__PURE__ */ Y("div", {
			className: "flex h-full min-h-0 flex-col md:flex-row",
			children: [/* @__PURE__ */ J("nav", {
				className: "flex shrink-0 gap-1 overflow-x-auto border-b border-basic md:w-44 md:flex-col md:border-b-0 md:border-r p-2",
				children: Sn.map((e) => /* @__PURE__ */ J("button", {
					type: "button",
					className: `rounded px-3 py-2 text-left label-small capitalize ${n === e ? "bg-elevation-level-2 text-basic-primary" : "text-basic-tertiary"}`,
					onClick: () => r(e),
					children: e === "github" ? "GitHub" : e
				}, e))
			}), /* @__PURE__ */ Y("div", {
				className: "min-h-0 flex-1 overflow-auto p-4 md:p-6",
				children: [
					n === "status" ? /* @__PURE__ */ J(Pb, {}) : null,
					n === "github" ? /* @__PURE__ */ J(Cb, { onConnected: i }) : null,
					n === "secrets" ? /* @__PURE__ */ J(wb, {}) : null
				]
			})]
		})
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedBranchPicker.tsx
function Lb(e, t) {
	return e.toLowerCase().localeCompare(t.toLowerCase()) || e.localeCompare(t);
}
function Rb({ branches: e, value: t, onValueChange: n, isLoading: r, error: i }) {
	let [a, o] = K(!1), [s, c] = K(""), [l, u] = K(null), d = G(null), f = G(null), p = Zr(), m = g(), h = W(() => {
		let t = s.trim().toLowerCase(), n = [...e].sort(Lb);
		return t ? n.filter((e) => e.toLowerCase().includes(t)) : n;
	}, [e, s]), _ = l === null ? -1 : h.indexOf(l), v = (e = !0) => {
		o(!1), c(""), u(null), e && d.current?.focus();
	}, y = () => {
		if (a) {
			v();
			return;
		}
		let n = [...e].sort(Lb);
		u(t || n[0] || null), o(!0);
	};
	U(() => {
		a && f.current?.focus();
	}, [a]), U(() => {
		!a || _ < 0 || document.getElementById(`${p}-option-${_}`)?.scrollIntoView?.({ block: "nearest" });
	}, [
		_,
		p,
		a
	]);
	let b = (e) => {
		n(e), v();
	}, x = (e) => {
		if (h.length === 0) return;
		let t = l === null ? -1 : h.indexOf(l), n = t < 0 ? e > 0 ? 0 : h.length - 1 : (t + e + h.length) % h.length;
		u(h[n] ?? null);
	}, S = (e) => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault(), x(1);
				break;
			case "ArrowUp":
				e.preventDefault(), x(-1);
				break;
			case "Home":
				e.preventDefault(), u(h[0] ?? null);
				break;
			case "End":
				e.preventDefault(), u(h.at(-1) ?? null);
				break;
			case "Enter": {
				let t = _ >= 0 ? h[_] : null;
				if (!t) break;
				e.preventDefault(), b(t);
				break;
			}
			case "Escape":
				e.preventDefault(), e.stopPropagation(), v();
				break;
			case "Tab": v(!1);
		}
	}, C = r ? /* @__PURE__ */ Y("div", {
		role: "status",
		className: "flex items-center gap-2 p-3 text-small text-basic-tertiary",
		children: [/* @__PURE__ */ J(Le, {
			size: A.Small,
			variant: de.Neutral
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
		children: [/* @__PURE__ */ J("span", { children: "Branch" }), /* @__PURE__ */ J(Ln, {
			open: a,
			onClose: () => v(),
			placement: z.BottomLeft,
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
					"aria-activedescendant": _ >= 0 ? `${p}-option-${_}` : void 0,
					value: s,
					onChange: (t) => {
						let n = t.target.value, r = n.trim().toLowerCase(), i = [...e].sort(Lb).filter((e) => !r || e.toLowerCase().includes(r));
						c(n), u(i[0] ?? null);
					},
					onKeyDown: S
				}), /* @__PURE__ */ Y("div", {
					id: p,
					role: "listbox",
					"aria-label": "Branches",
					className: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded border border-basic p-1",
					children: [C, !r && !i ? h.map((e, n) => /* @__PURE__ */ Y(Zc, {
						id: `${p}-option-${n}`,
						role: "option",
						"aria-selected": e === t,
						tabIndex: -1,
						size: m ? Yc.Large : Yc.Medium,
						active: e === l,
						className: "shrink-0",
						onMouseEnter: () => u(e),
						onMouseDown: (e) => e.preventDefault(),
						onClick: () => b(e),
						children: [/* @__PURE__ */ J("span", {
							className: "min-w-0 flex-1 truncate text-left",
							title: e,
							children: e
						}), e === t ? /* @__PURE__ */ J(M, {
							iconName: L.Check,
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
				onClick: y,
				onKeyDown: (e) => {
					[
						"ArrowDown",
						"ArrowUp",
						"Enter",
						" "
					].includes(e.key) && (e.preventDefault(), a || y());
				},
				children: [/* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					title: t,
					children: t || "Select a branch"
				}), /* @__PURE__ */ J(M, {
					iconName: L.Down,
					className: `shrink-0 transition-transform duration-150 ${a ? "rotate-180" : "rotate-0"}`
				})]
			})
		})]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedRepositoryModal.tsx
function zb({ open: e, onClose: t, onConnect: n }) {
	let { api: r } = B(), i = fi(), a = _n(), o = ai(), c = sn(), l = fn(e), [u, d] = K(""), [f, p] = K(null), [m, h] = K(""), [g, _] = K(""), [v, y] = K(""), [b, x] = K(null), [S, C] = K(""), [w, T] = K(!1), E = ii({
		queryKey: ["managed-github-repositories"],
		queryFn: ({ signal: e }) => r.listManagedGitHubRepositories(e),
		enabled: e && l.data?.connected === !0,
		retry: !1
	}), D = le(f?.full_name), O = ii({
		queryKey: ["managed-github-branches", f?.full_name],
		queryFn: ({ signal: e }) => r.listManagedGitHubBranches(D[0], D[1], e),
		enabled: e && D !== null,
		retry: !1
	});
	U(() => {
		if (!b || !Se(b)) return;
		let e = !1, n = new AbortController();
		return (async () => {
			for (; !e;) {
				await new Promise((e) => setTimeout(e, 500));
				try {
					let e = await r.getManagedClone(b.operation_id, n.signal);
					if (x(e), e.status !== "running") {
						e.status === "completed" && (await Promise.all([o.invalidateQueries({ queryKey: bn.projects }), o.invalidateQueries({ queryKey: tn.hostStatus })]), a.success(`${e.project_name} is ready`), t(), i(_r.project(e.project_id)));
						return;
					}
				} catch (e) {
					n.signal.aborted || C(iu($(e)));
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
				C(iu($(e)));
			} finally {
				T(!1);
			}
		}
	}, te = async () => {
		if (!(!b || !Se(b))) try {
			x(await r.cancelManagedClone(b.operation_id));
		} catch (e) {
			C(nr($(e)));
		}
	}, ne = w || Se(b), re = O.error ? iu($(O.error)) : null;
	return /* @__PURE__ */ J(ur, {
		open: e,
		onClose: ne ? void 0 : t,
		title: "Add repository",
		size: Wt.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		footer: b?.status === "running" ? /* @__PURE__ */ J(s, {
			variant: I.SecondaryDestructive,
			content: R.Text,
			onClick: () => void te(),
			children: "Cancel clone"
		}) : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(s, {
			variant: I.Tertiary,
			content: R.Text,
			onClick: t,
			children: "Cancel"
		}), /* @__PURE__ */ J(s, {
			variant: I.Primary,
			content: R.Text,
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
					})] }), /* @__PURE__ */ J(s, {
						variant: I.Primary,
						content: R.Text,
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
								children: /* @__PURE__ */ J(Le, { size: A.Small })
							}) : null,
							E.error ? /* @__PURE__ */ J("p", {
								className: "p-4 text-small text-error-primary",
								children: iu($(E.error))
							}) : null,
							k.map((e) => /* @__PURE__ */ Y("button", {
								type: "button",
								className: `flex w-full items-center gap-3 rounded p-3 text-left ${f?.id === e.id ? "bg-elevation-level-2" : "hover:bg-elevation-level-1"}`,
								onClick: () => {
									p(e), h(e.default_branch), _(e.name), y(e.name), C("");
								},
								children: [
									/* @__PURE__ */ J(M, { iconName: e.private ? L.Lock : L.Github }),
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
									f?.id === e.id ? /* @__PURE__ */ J(M, { iconName: L.CheckCircle }) : null
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
							/* @__PURE__ */ J(Rb, {
								branches: O.data?.branches ?? [],
								value: m,
								onValueChange: h,
								isLoading: O.isLoading,
								error: re
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
							children: [b.status === "running" ? /* @__PURE__ */ J(Le, { size: A.Small }) : /* @__PURE__ */ J(M, { iconName: b.status === "completed" ? L.CheckCircle : L.Danger }), /* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
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
function Bb({ children: e }) {
	let t = sn(), [n, r] = K(!1), [i, a] = K("status"), [o, s] = K(!1), [c, l] = K(!1), u = t.data ?? null, d = H(() => {
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
	return /* @__PURE__ */ Y(Ip.Provider, {
		value: h,
		children: [
			e,
			/* @__PURE__ */ J(Ib, {
				open: n,
				tab: i,
				onTabChange: a,
				onClose: () => {
					r(!1), l(!1);
				},
				onGitHubConnected: m
			}),
			o ? /* @__PURE__ */ J(zb, {
				open: !0,
				onClose: () => s(!1),
				onConnect: f
			}) : null
		]
	});
}
//#endregion
//#region src/App.tsx
function Vb() {
	let { sessionId: e } = pi();
	return /* @__PURE__ */ Y("section", {
		className: "relative flex h-full min-h-0 overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ J(cm, {}), /* @__PURE__ */ J(Sb, {}, e)]
	});
}
function Hb() {
	return ct().orchestrationEnabled ? /* @__PURE__ */ J(fm, {}) : /* @__PURE__ */ J(si, {
		to: _r.list(),
		replace: !0
	});
}
function Ub() {
	return /* @__PURE__ */ J(vi, { children: /* @__PURE__ */ J(zn, { children: /* @__PURE__ */ J(Bf, { children: /* @__PURE__ */ J(Ef, { children: /* @__PURE__ */ J(Bb, { children: /* @__PURE__ */ Y(ui, { children: [
		/* @__PURE__ */ Y(li, {
			element: /* @__PURE__ */ J(Vp, {}),
			children: [
				/* @__PURE__ */ J(li, {
					path: "/",
					element: /* @__PURE__ */ J(Nm, {})
				}),
				/* @__PURE__ */ J(li, {
					path: "/project/:projectId",
					element: /* @__PURE__ */ J(mm, {})
				}),
				/* @__PURE__ */ J(li, {
					path: "/session/:sessionId/:panel?",
					element: /* @__PURE__ */ J(Vb, {})
				})
			]
		}),
		/* @__PURE__ */ J(li, {
			path: "/design",
			element: /* @__PURE__ */ J(Hb, {})
		}),
		/* @__PURE__ */ J(li, {
			path: "*",
			element: /* @__PURE__ */ J(si, {
				to: _r.list(),
				replace: !0
			})
		})
	] }) }) }) }) }) });
}
//#endregion
//#region src/app/providers/ThemeProvider.tsx
var Wb = [
	"light",
	"dark",
	"system"
], Gb = "nac-theme", Kb = "dark", qb = qr(null), Jb = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
function Yb(e) {
	return Kb;
}
function Xb() {
	let e = document.documentElement;
	e.setAttribute("data-theme", Kb), e.classList.remove("light", "dark"), e.classList.add(Kb), e.style.colorScheme = Kb;
}
function Zb() {
	let e = localStorage.getItem(Gb);
	return e && Wb.includes(e) ? e : Jb() ? "dark" : "light";
}
var Qb = ({ children: e, local: t = !1 }) => {
	let [n, r] = K(() => t ? "dark" : Zb()), i = H((e) => {
		Wb.includes(e) && (r(e), t || (localStorage.setItem(Gb, e), Xb()));
	}, [t]), a = H(() => {
		r((e) => {
			let n = e === "light" ? "dark" : e === "dark" ? "system" : "light";
			return t || (localStorage.setItem(Gb, n), Xb()), n;
		});
	}, [t]);
	return U(() => {
		t || Xb();
	}, [t]), /* @__PURE__ */ J(qb.Provider, {
		value: {
			theme: n,
			resolved: Yb(n),
			setTheme: i,
			toggleTheme: a
		},
		children: e
	});
};
function $b() {
	let e = Xr(qb);
	if (!e) throw Error("useTheme must be used within a ThemeProvider");
	return e;
}
//#endregion
//#region src/app/runtime/NativePresentationRoot.tsx
function ex(e) {
	return /* @__PURE__ */ J(tx, { ...e }, e.runtime.id);
}
function tx({ runtime: e, router: t, theme: n, className: r, styles: i, globalKeyboard: a }) {
	if (U(() => e.retain(), [e]), $r(e.subscribe, e.isClosed, e.isClosed)) return null;
	let o = /* @__PURE__ */ J(nx, {
		runtime: e,
		className: r,
		styles: i,
		globalKeyboard: a,
		children: t(/* @__PURE__ */ J(Ub, {}))
	});
	return /* @__PURE__ */ J(ve.Provider, {
		value: e,
		children: /* @__PURE__ */ J(ei, {
			client: e.queryClient,
			children: n ? n(o) : /* @__PURE__ */ J(Qb, {
				local: !0,
				children: o
			})
		})
	});
}
function nx({ runtime: e, className: t, styles: n, globalKeyboard: r, children: i }) {
	let { resolved: a } = $b();
	return /* @__PURE__ */ Y("div", {
		className: `${t ?? "nac-presentation h-full min-h-0"} ${a}`,
		style: { contain: "layout paint" },
		"data-nac-runtime": e.id,
		"data-theme": a,
		children: [n, /* @__PURE__ */ J(et, {
			globalKeyboard: r,
			children: i
		})]
	});
}
//#endregion
export { ex as NativePresentationRoot, j as NativeRuntime, ve as RuntimeContext, bt as createNativeRuntime, B as useNativeRuntime };
