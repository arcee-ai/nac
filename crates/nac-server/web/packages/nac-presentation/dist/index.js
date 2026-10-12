import { $ as e, $n as t, $r as n, $t as r, A as i, Ai as a, An as o, Ar as s, At as c, B as l, Bn as u, Br as d, Bt as f, C as p, Ci as m, Cn as h, Cr as g, Ct as _, D as v, Di as y, Dn as b, Dr as x, Dt as S, E as C, Ei as w, En as T, Er as E, Et as D, F as ee, Fi as O, Fn as k, Fr as A, Ft as te, G as j, Gn as ne, Gr as re, Gt as ie, H as ae, Hn as oe, Hr as se, Ht as ce, I as le, Ii as ue, In as de, Ir as M, It as fe, J as pe, Jn as N, Jr as P, Jt as F, K as me, Kn as he, Kr as ge, Kt as _e, L as ve, Ln as ye, Lr as be, Lt as xe, M as Se, Mn as Ce, Mr as I, Mt as we, N as Te, Ni as Ee, Nn as De, Nr as L, Nt as Oe, O as ke, Oi as Ae, On as je, Ot as Me, P as Ne, Pi as Pe, Pn as Fe, Pr as R, Pt as Ie, Q as Le, Qn as Re, Qr as ze, Qt as Be, R as Ve, Rn as He, Rr as z, Rt as Ue, S as We, Si as Ge, Sn as Ke, Sr as qe, St as Je, T as Ye, Ti as Xe, Tn as Ze, Tr as Qe, Tt as $e, U as et, Un as tt, Ur as nt, Ut as rt, V as it, Vn as at, Vr as ot, Vt as st, W as ct, Wn as lt, Wr as ut, Wt as dt, X as ft, Xn as pt, Xr as mt, Xt as ht, Y as gt, Yn as _t, Yr as vt, Yt as yt, Z as bt, Zn as xt, Zr as St, Zt as Ct, _ as wt, _i as Tt, _n as Et, _r as Dt, _t as Ot, a as kt, ai as At, an as jt, ar as Mt, at as Nt, b as Pt, bi as Ft, bn as It, br as Lt, bt as Rt, c as zt, ci as Bt, cn as Vt, cr as Ht, ct as Ut, d as Wt, di as Gt, dn as Kt, dr as qt, dt as Jt, ei as Yt, en as Xt, er as Zt, et as Qt, f as $t, fi as en, fn as tn, fr as nn, ft as rn, g as an, gi as on, gn as sn, gr as cn, gt as ln, h as un, hi as dn, hn as fn, hr as pn, ht as mn, i as hn, ii as gn, in as _n, ir as vn, it as yn, j as bn, ji as xn, jn as Sn, jr as B, jt as Cn, k as wn, ki as Tn, kn as En, kr as Dn, kt as On, l as kn, li as An, ln as jn, lr as Mn, lt as Nn, m as Pn, mi as Fn, mn as In, mr as Ln, mt as Rn, n as zn, ni as Bn, nn as Vn, nr as Hn, nt as Un, o as Wn, oi as Gn, on as Kn, or as qn, ot as Jn, p as Yn, pi as Xn, pn as Zn, pr as Qn, pt as $n, q as er, qn as tr, qr as nr, qt as rr, r as ir, ri as ar, rn as or, rr as sr, rt as cr, s as lr, si as ur, sn as dr, st as fr, t as pr, ti as mr, tn as hr, tr as gr, tt as _r, u as vr, ui as yr, un as br, ur as xr, ut as Sr, v as Cr, vi as wr, vn as Tr, vr as Er, vt as Dr, w as Or, wi as kr, wn as Ar, wr as jr, wt as Mr, x as Nr, xi as Pr, xn as Fr, xr as Ir, xt as Lr, y as Rr, yi as zr, yn as Br, yr as Vr, yt as Hr, z as Ur, zn as Wr, zr as V, zt as Gr } from "./chunks/PerfProfiler-9mKYQufc.js";
import { Fragment as Kr, Suspense as qr, createContext as Jr, lazy as Yr, memo as Xr, useCallback as H, useContext as Zr, useEffect as U, useId as Qr, useLayoutEffect as $r, useMemo as W, useRef as G, useState as K, useSyncExternalStore as ei } from "react";
import { QueryClientProvider as ti, QueryObserver as ni, useIsFetching as ri, useMutation as ii, useQuery as ai, useQueryClient as oi } from "@tanstack/react-query";
import { Link as si, Navigate as ci, Outlet as li, Route as ui, Routes as di, useLocation as fi, useNavigate as pi, useParams as mi } from "react-router-dom";
import { Fragment as q, jsx as J, jsxs as Y } from "react/jsx-runtime";
import { flushSync as hi } from "react-dom";
//#region src/app/features/ui-policy/UiPolicyProvider.tsx
var gi = /* @__PURE__ */ new WeakMap(), _i = 0;
function vi(e) {
	let t = gi.get(e);
	return t === void 0 && (t = ++_i, gi.set(e, t)), t;
}
function yi({ children: e, client: t }) {
	let n = P(), r = t ?? n.client, i = ai({
		queryKey: [
			"ui-configuration",
			r.transport.endpoint,
			vi(r)
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
	}) : /* @__PURE__ */ Y(ot.Provider, {
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
var bi = /* @__PURE__ */ function(e) {
	return e.Micro = "w-4 h-4 text-[10px]", e.Small = "w-5 h-5 text-xs", e.Medium = "w-6 h-6 text-xs", e.Large = "w-8 h-8 text-sm", e.XLarge = "w-12 h-12 text-lg", e;
}({}), xi = ({ imageUrl: e, name: t, size: n = "w-6 h-6 text-xs", color: r = "var(--color-bg-accent-primary)", glyph: i = !1, className: a = "" }) => {
	let o = t?.trim() ?? "", s = i ? o : o[0]?.toUpperCase() ?? "?";
	return /* @__PURE__ */ J("div", {
		className: d("flex items-center justify-center shrink-0 rounded-full overflow-hidden", "font-semibold text-basic-primary-inverse shadow-convex", n, a),
		style: { background: e ? void 0 : r },
		children: e ? /* @__PURE__ */ J("img", {
			src: e,
			alt: o,
			className: "w-full h-full object-cover"
		}) : s
	});
};
xi.Size = bi;
//#endregion
//#region src/app/atoms/badge/index.tsx
var Si = /* @__PURE__ */ function(e) {
	return e.Neutral = "bg-elevation-sublevel-variant-B text-basic-secondary border-tertiary", e.Green = "bg-success-tertiary text-success-primary border-success-muted", e.Blue = "bg-info-tertiary text-info-primary border-info-muted", e.Red = "bg-error-tertiary text-error-primary border-error-muted", e.Yellow = "bg-danger-tertiary  text-danger-primary border-danger-muted", e.Violet = "bg-indigo-400 text-indigo-800 border-indigo-300", e.Gray = "bg-elevation-sublevel-variant-A text-basic-secondary border-muted", e;
}({}), Ci = ({ text: e, color: t = "bg-elevation-sublevel-variant-B text-basic-secondary border-tertiary", className: n = "" }) => {
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
Ci.Color = Si;
//#endregion
//#region src/app/atoms/box-surface/index.tsx
var wi = ({ title: e, headerContent: t, footer: n, className: r = "", bodyClassName: i = "", children: a }) => {
	let o = e != null || t != null;
	return /* @__PURE__ */ Y("div", {
		className: d("flex flex-col rounded-[8px] overflow-hidden bg-elevation-level-1 shadow-convex", r),
		children: [
			o ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-4 h-14 px-4 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ J("div", {
					className: "header-md text-basic-primary flex-1 min-w-0 truncate",
					children: e
				}), t]
			}) : null,
			/* @__PURE__ */ J("div", {
				className: d("flex-1 min-h-0 flex flex-col [&>*]:shrink-0", i),
				children: a
			}),
			n ? /* @__PURE__ */ J("div", {
				className: "flex items-center p-4 border-t border-muted shrink-0",
				children: n
			}) : null
		]
	});
}, Ti = ({ variant: e = R.Ghost, content: t = I.Text, disabled: n, className: r = "", buttonClassName: i = "", children: a, loading: o = !1, type: s = "button", ...c }) => {
	let l = r.includes("flex-grow") || r.includes("flex-1");
	return /* @__PURE__ */ J("div", {
		className: d("bg-elevation-level-3 shadow-2xl rounded-full overflow-hidden h-10", l ? "flex w-full" : "inline-flex w-fit", r),
		children: /* @__PURE__ */ J(B, {
			size: L.Large,
			variant: e,
			content: t,
			type: s,
			disabled: n,
			loading: o,
			className: d("btn-sticky", l && "w-full", i),
			...c,
			children: a
		})
	});
};
Ti.Variant = R, Ti.Content = I;
//#endregion
//#region src/app/atoms/chat-loader/index.tsx
var Ei = /* @__PURE__ */ function(e) {
	return e.Small = "w-1.5 h-1.5", e.Medium = "w-2 h-2", e.Large = "w-3 h-3", e;
}({}), Di = ({ size: e = "w-2 h-2", className: t = "" }) => /* @__PURE__ */ J("div", {
	role: "status",
	"aria-label": "Waiting for a response",
	className: d("flex items-end gap-1 fade", t),
	children: [
		0,
		1,
		2
	].map((t) => /* @__PURE__ */ J("span", { className: d("chat-loader-dot rounded-full bg-divider-secondary", e) }, t))
});
Di.Size = Ei;
//#endregion
//#region src/app/atoms/chat-session-fork-mark/index.tsx
var Oi = ({ forkedFromTitle: e, running: t = !1, className: n = "" }) => {
	if (t) return /* @__PURE__ */ J(A, {
		size: M.Micro,
		variant: be.Neutral,
		className: "shrink-0"
	});
	let r = e?.trim();
	if (!r) return null;
	let i = `Fork of ${r}`;
	return /* @__PURE__ */ J(Ln, {
		title: i,
		position: Ln.Position.BottomCenter,
		sticky: !0,
		className: "shrink-0",
		children: /* @__PURE__ */ J("span", {
			className: "inline-flex shrink-0",
			"aria-label": i,
			children: /* @__PURE__ */ J(z, {
				iconName: V.Scheme,
				size: 16,
				className: d("shrink-0", n)
			})
		})
	});
}, ki = ({ title: e, active: t = !1, running: n = !1, icon: r = V.Plane, forkedFromTitle: i, badge: a, badgeLabel: o, unread: s = !1, isMobile: c = !1, actions: l, className: u = "", type: f = "button", "aria-label": p, ...m }) => {
	let h = t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered", g = n ? "text-shimmer-basic" : h;
	return /* @__PURE__ */ Y("div", {
		className: d("group flex items-center min-w-0 rounded-[4px]", c ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1", t ? "bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered" : "hover:bg-btn-ghost-hovered", u),
		children: [/* @__PURE__ */ Y("button", {
			type: f,
			title: o ? `${e} · ${o}` : e,
			"aria-label": p ?? (o ? `${e}, ${o}` : e),
			"aria-current": t ? "page" : void 0,
			className: d("flex flex-1 items-center min-w-0 rounded-[3px] text-left", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary", c ? "gap-3" : "gap-1.5"),
			...m,
			children: [
				/* @__PURE__ */ J(z, {
					iconName: r,
					size: 20,
					"aria-hidden": !0,
					"data-session-behavior-icon": r,
					className: d("shrink-0", h)
				}),
				/* @__PURE__ */ J("span", {
					className: d("min-w-0 flex-1 truncate", c ? "text-medium" : "label-small", g),
					children: e
				}),
				/* @__PURE__ */ J(Oi, {
					forkedFromTitle: i,
					className: h
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
			className: d("flex items-center gap-1 shrink-0", c ? null : "hidden group-hover:flex group-has-[:focus-visible]:flex"),
			children: l
		}) : null]
	});
}, Ai = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), ji = {
	info: "border-info-primary text-info-primary",
	error: "border-error-primary text-error-primary",
	danger: "border-danger-primary text-danger-primary",
	success: "border-success-primary text-success-primary"
}, Mi = {
	info: V.Info,
	error: V.Close,
	danger: V.Danger,
	success: V.CheckCircle
}, Ni = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, Pi = ({ title: e, variant: t = "info", action: n, className: r = "", children: i, ...a }) => /* @__PURE__ */ J("div", {
	className: d("flex w-full items-start overflow-hidden border-l-2 px-4 py-2", ji[t], r),
	...a,
	children: /* @__PURE__ */ Y("div", {
		className: "flex flex-1 min-w-0 flex-col items-start gap-2",
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex w-full items-start gap-1.5",
				children: [/* @__PURE__ */ J(z, {
					iconName: Mi[t],
					size: 20,
					color: Ni[t],
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
			n ? /* @__PURE__ */ J(B, {
				size: L.Small,
				variant: R.Primary,
				content: I.Text,
				onClick: n.onClick,
				children: n.label
			}) : null
		]
	})
});
Pi.Variant = Ai;
//#endregion
//#region src/app/atoms/chat-session-orphan-avatar/index.tsx
var Fi = (e) => Math.round(e * .7 / 4) * 4, Ii = (e) => Math.round(e / 10), Li = ({ size: e = 40, isRunning: t = !1, className: n = "", ...r }) => /* @__PURE__ */ J("div", {
	className: d("flex items-center justify-center shrink-0", "border border-muted bg-elevation-sublevel-variant-B", n),
	style: {
		width: e,
		height: e,
		borderRadius: Ii(e)
	},
	"aria-hidden": "true",
	...r,
	children: /* @__PURE__ */ J(z, {
		iconName: V.Chat,
		size: Fi(e),
		className: d("text-basic-secondary", t && "pulse-dim")
	})
}), Ri = ({ rows: e = 3, className: t = "", rowClassName: n = "" }) => /* @__PURE__ */ J("div", {
	className: d("flex flex-col gap-2", t),
	children: Array.from({ length: e }).map((e, t) => /* @__PURE__ */ J("div", {
		className: d("relative h-4 rounded-[4px] overflow-hidden bg-elevation-level-2", n),
		children: /* @__PURE__ */ J("div", {
			className: "absolute inset-0 animate-shimmer bg-[length:200%_100%] bg-[position:-200%_0]",
			style: { backgroundImage: "linear-gradient(90deg, transparent 0%, var(--color-bg-btn-secondary-highlighted-hovered) 50%, transparent 100%)" }
		})
	}, t))
}), zi = ({ title: e, active: t = !1, running: n = !1, forkedFromTitle: r, behaviorIcon: i, behaviorLabel: a, onDismiss: o, className: s = "", type: c = "button", "aria-label": l, ...u }) => {
	let f = n ? "text-shimmer-basic" : r ? "text-btn-secondary group-hover:text-btn-secondary-hovered" : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered", p = /* @__PURE__ */ Y("button", {
		type: c,
		title: e,
		"aria-label": l ?? (a ? `${e}, ${a}` : e),
		"aria-current": t ? "page" : void 0,
		className: "flex h-10 w-full min-w-0 flex-1 items-center justify-start gap-1 py-1 pl-2 pr-2 group-hover:pr-8 group-has-[:focus-visible]:pr-8",
		...u,
		children: [
			/* @__PURE__ */ J(Oi, {
				forkedFromTitle: r,
				running: n,
				className: n ? void 0 : t ? "text-btn-secondary-pressed" : "text-btn-secondary group-hover:text-btn-secondary-hovered"
			}),
			i ? /* @__PURE__ */ J(z, {
				iconName: i,
				size: 16,
				"aria-hidden": !0,
				"data-session-behavior-icon": i,
				className: d("shrink-0", f)
			}) : null,
			/* @__PURE__ */ J("span", {
				"data-session-tab-title": !0,
				className: d("label-micro w-full min-w-0 flex-1 truncate text-left", f),
				children: e
			})
		]
	});
	return /* @__PURE__ */ Y("div", {
		className: d("chat-session-tab group relative flex w-32 max-w-full shrink-0 items-center justify-start gap-1", t ? "chat-session-tab-active bg-btn-ghost-highlighted hover:bg-btn-ghost-highlighted-hovered" : "hover:bg-btn-ghost-hovered", s),
		children: [a ? /* @__PURE__ */ J(Ln, {
			title: a,
			position: Ln.Position.BottomLeft,
			sticky: !0,
			className: "min-w-0 flex-1",
			children: p
		}) : p, o ? /* @__PURE__ */ J(B, {
			variant: R.Tertiary,
			size: L.Small,
			content: I.Icon,
			"aria-label": `Close ${e}`,
			title: "Close tab",
			onClick: (e) => {
				e.stopPropagation(), o();
			},
			className: "absolute right-1 top-1/2 -translate-y-1/2 shrink-0 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-has-[:focus-visible]:opacity-100 group-has-[:focus-visible]:pointer-events-auto",
			children: /* @__PURE__ */ J(z, { iconName: V.Close })
		}) : null]
	});
}, Bi = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ Y("label", {
	className: d("flex items-center gap-2 w-fit", n ? "cursor-not-allowed opacity-60" : "", i),
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
			className: d("flex items-center justify-center shrink-0 w-4 h-4 rounded-[4px] border transition-colors duration-150", "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-primary", n ? "bg-btn-secondary-disabled border-muted" : e ? "bg-btn-secondary-accent border-accent-primary hover:bg-btn-secondary-accent-hovered" : "bg-btn-secondary border-secondary hover:bg-btn-secondary-hovered hover:border-tertiary"),
			children: e ? /* @__PURE__ */ J(z, {
				iconName: V.Check,
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
}), Vi = "en-US", Hi = new Intl.DateTimeFormat(Vi, {
	month: "long",
	year: "numeric"
}), Ui = new Intl.DateTimeFormat(Vi, { weekday: "short" }), Wi = (e) => new Date(e.getFullYear(), e.getMonth(), 1), Gi = (e, t) => new Date(e.getFullYear(), e.getMonth() + t, 1), Ki = (e, t) => new Date(e.getFullYear(), e.getMonth(), e.getDate() + t), qi = (e) => new Date(e.getFullYear(), e.getMonth(), e.getDate()), Ji = (e, t) => e.getFullYear() === t.getFullYear() && e.getMonth() === t.getMonth() && e.getDate() === t.getDate(), Yi = (e) => Ji(e, /* @__PURE__ */ new Date()), Xi = (e, t, n) => {
	let r = qi(e).getTime();
	return r >= qi(t).getTime() && r <= qi(n).getTime();
}, Zi = (e, t, n) => {
	let r = qi(e).getTime();
	return !!(t && r < qi(t).getTime() || n && r > qi(n).getTime());
}, Qi = (e) => Hi.format(e), $i = () => {
	let e = new Date(2021, 7, 1);
	return Array.from({ length: 7 }, (t, n) => Ui.format(Ki(e, n)));
}, ea = (e) => `${e.getFullYear()}-${e.getMonth()}-${e.getDate()}`;
function ta(e) {
	let t = Wi(e), n = t.getDay(), r = new Date(e.getFullYear(), e.getMonth() + 1, 0).getDate(), i = [];
	for (let e = -n; e < 0; e += 1) i.push({
		date: Ki(t, e),
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
function na(e, t, n, r) {
	return e || t ? R.Primary : n ? R.GhostHighlightedAccent : r ? R.SecondaryHighlighted : R.Ghost;
}
var ra = ({ days: e, selected: t, range: n, focused: r, min: i, max: a, disabled: o = !1, onSelect: s, onFocusDay: c, onNavigate: l }) => {
	let u = G(null);
	U(() => {
		let e = u.current;
		if (!r || !e) return;
		let t = requestAnimationFrame(() => {
			let t = e.querySelector(`button[data-day="${ea(r)}"]`);
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
		n !== void 0 && (e.preventDefault(), l(t, n));
	};
	return /* @__PURE__ */ J("div", {
		ref: u,
		className: "grid grid-cols-7 gap-y-1 p-2",
		role: "rowgroup",
		children: e.map(({ date: e, inMonth: l }) => {
			let u = t ? Ji(e, t) : !1, p = n?.from ? Ji(e, n.from) : !1, m = n?.to ? Ji(e, n.to) : !1, h = n?.from && n?.to ? Xi(e, n.from, n.to) : !1, g = o || !l || Zi(e, i, a), _ = p && m ? null : p ? "rounded-r-none" : m ? "rounded-l-none" : h ? "rounded-none" : null;
			return /* @__PURE__ */ J("div", {
				role: "gridcell",
				"aria-selected": u,
				children: /* @__PURE__ */ J(B, {
					"data-day": ea(e),
					variant: na(u, p || m, h, Yi(e)),
					size: L.Medium,
					disabled: g,
					tabIndex: r && Ji(e, r) ? 0 : -1,
					className: d("w-full", _, !l && "invisible"),
					onClick: () => s(e),
					onFocus: () => c(e),
					onKeyDown: (t) => f(t, e),
					children: e.getDate()
				})
			}, ea(e));
		})
	});
}, ia = $i(), aa = ({ selected: e, onSelect: t, range: n, onRangeChange: r, min: i, max: a, disabled: o = !1, defaultMonth: s, className: c = "" }) => {
	let l = n ? n.to ?? n.from : e, [u, f] = K(() => Wi(s ?? l ?? /* @__PURE__ */ new Date())), [p, m] = K(l), h = W(() => ta(u), [u]);
	return /* @__PURE__ */ Y("div", {
		role: "group",
		"aria-label": "Calendar",
		className: d("flex flex-col min-w-0 w-[280px]", c),
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex items-center justify-between gap-2 p-1 border-b border-muted",
				children: [
					/* @__PURE__ */ J(B, {
						variant: R.Ghost,
						size: L.Medium,
						content: I.Icon,
						"aria-label": "Previous month",
						onClick: () => f((e) => Gi(e, -1)),
						children: /* @__PURE__ */ J(z, { iconName: V.Left })
					}),
					/* @__PURE__ */ J("div", {
						className: "label-small text-basic-primary",
						"aria-live": "polite",
						children: Qi(u)
					}),
					/* @__PURE__ */ J(B, {
						variant: R.Ghost,
						size: L.Medium,
						content: I.Icon,
						"aria-label": "Next month",
						onClick: () => f((e) => Gi(e, 1)),
						children: /* @__PURE__ */ J(z, { iconName: V.Right })
					})
				]
			}),
			/* @__PURE__ */ J("div", {
				className: "grid grid-cols-7 px-2 pt-2",
				role: "row",
				children: ia.map((e) => /* @__PURE__ */ J("div", {
					role: "columnheader",
					className: "label-micro text-basic-tertiary text-center py-1",
					children: e
				}, e))
			}),
			/* @__PURE__ */ J(ra, {
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
					let n = Ki(e, t);
					m(n), (n.getFullYear() !== u.getFullYear() || n.getMonth() !== u.getMonth()) && f(Wi(n));
				}
			})
		]
	});
}, oa = /* @__PURE__ */ function(e) {
	return e[e.Small = 16] = "Small", e[e.Medium = 20] = "Medium", e[e.Large = 24] = "Large", e;
}({}), sa = ({ title: e, description: t, size: n = 16, position: r = s.TopCenter, className: i = "", muted: a = !1 }) => /* @__PURE__ */ J(Ln, {
	title: e,
	description: t,
	position: r,
	sticky: !0,
	showTooltipOnMobile: !0,
	className: i,
	children: /* @__PURE__ */ J(z, {
		iconName: V.Info,
		size: n,
		className: d("cursor-help shrink-0", a && "[&>path]:!fill-basic-muted"),
		color: a ? void 0 : "var(--color-fill-basic-tertiary)"
	})
});
sa.Size = oa;
//#endregion
//#region src/app/atoms/label/index.tsx
var ca = /* @__PURE__ */ function(e) {
	return e.Micro = "label-micro", e.Small = "label-small", e.Medium = "label-medium", e;
}({}), la = {
	"label-micro": 16,
	"label-small": 20,
	"label-medium": 24
}, ua = {
	"label-micro": oa.Small,
	"label-small": oa.Small,
	"label-medium": oa.Medium
}, da = ({ children: e, htmlFor: t, size: n = "label-small", icon: r, validation: i = !1, tone: a = "secondary", hoverHint: o, className: s = "" }) => /* @__PURE__ */ Y("label", {
	htmlFor: t,
	className: d("flex items-center gap-1.5 min-w-0", n, i ? "text-error-primary" : a === "primary" ? "text-basic-primary" : a === "muted" ? "text-basic-muted" : "text-basic-secondary", s),
	children: [
		r ? /* @__PURE__ */ J(z, {
			iconName: r,
			size: la[n],
			className: "shrink-0"
		}) : null,
		/* @__PURE__ */ J("span", {
			className: "truncate",
			children: e
		}),
		o ? /* @__PURE__ */ J(sa, {
			title: o.title,
			description: o.description,
			muted: o.muted,
			size: ua[n]
		}) : null
	]
});
da.Size = ca;
//#endregion
//#region src/app/atoms/input/InputWrapper.tsx
var fa = ({ label: e, required: t, validation: n, validationText: r, hintText: i, hoverHint: a, className: o, children: s }) => /* @__PURE__ */ Y("div", {
	className: d("flex text-left flex-col gap-1", o),
	children: [
		e ? /* @__PURE__ */ Y("div", {
			className: "flex gap-2 items-center",
			children: [/* @__PURE__ */ J(da, {
				validation: n,
				hoverHint: a,
				tone: "primary",
				className: "flex-1",
				children: e
			}), t ? /* @__PURE__ */ J("div", {
				className: d("text-micro shrink-0", n ? "text-error-secondary" : "text-basic-tertiary"),
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
}), pa = (e) => `${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`, ma = (e) => {
	let t = e?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
	if (t) return new Date(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
}, ha = (e) => {
	let t = ma(e);
	return t ? t.toLocaleDateString("en-US") : "";
}, ga = ({ value: e, onChange: t, range: n, onRangeChange: r, size: i = L.Medium, disabled: a = !1, validation: o, validationText: c, placement: l = s.BottomRight, min: u, max: f, placeholder: p, label: m, required: h, hintText: g, hoverHint: _, className: v = "" }) => {
	let [y, b] = K(!1), x = !!n, S = x ? n?.from || n?.to ? `${ha(n?.from) || "Start"} – ${ha(n?.to) || "End"}` : p ?? "Select range" : (ha(e) || p) ?? "Select date", C = x ? /* @__PURE__ */ J(aa, {
		range: {
			from: ma(n?.from),
			to: ma(n?.to)
		},
		onRangeChange: (e) => {
			r?.({
				from: e.from ? pa(e.from) : null,
				to: e.to ? pa(e.to) : null
			}), e.from && e.to && b(!1);
		},
		min: ma(u),
		max: ma(f),
		disabled: a
	}) : /* @__PURE__ */ J(aa, {
		selected: ma(e),
		onSelect: (e) => {
			t?.(pa(e)), b(!1);
		},
		min: ma(u),
		max: ma(f),
		disabled: a
	});
	return /* @__PURE__ */ J(fa, {
		label: m,
		required: h,
		validation: o,
		validationText: c,
		hintText: g,
		hoverHint: _,
		className: v,
		children: /* @__PURE__ */ J(pn, {
			open: y,
			onClose: () => b(!1),
			placement: l,
			size: cn.Fit,
			sticky: !0,
			className: "w-full",
			panelClassName: "p-0",
			content: C,
			children: /* @__PURE__ */ Y(B, {
				variant: y ? R.SecondaryHighlighted : R.Secondary,
				size: i,
				content: I.IconLeft,
				disabled: a,
				"aria-haspopup": "dialog",
				"aria-expanded": y,
				className: d("w-full justify-between", o && "input-validation"),
				onClick: () => b((e) => !e),
				children: [
					/* @__PURE__ */ J(z, { iconName: V.Calendar }),
					/* @__PURE__ */ J("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: S
					}),
					/* @__PURE__ */ J(z, {
						iconName: V.Down,
						className: d("transition-transform", y && "rotate-180")
					})
				]
			})
		})
	});
}, _a = ({ isOpen: e, children: t, className: n = "", onCloseMaxHeight: r, isScrollable: i = !1, scrollToBottom: a = !1, ...o }) => {
	let s = G(null), c = G(null), [l, u] = K(0), f = G(null);
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
			c.current && f.current === null && (f.current = window.setTimeout(() => {
				c.current && (c.current.scrollTop = c.current.scrollHeight), f.current = null;
			}, 100));
		});
		return e.observe(s.current), () => {
			e.disconnect(), f.current !== null && (clearTimeout(f.current), f.current = null);
		};
	}, [i, a]);
	let p = i ? "overflow-y-auto" : "overflow-hidden";
	return /* @__PURE__ */ J("div", {
		...o,
		ref: c,
		className: d(p, "transition-[height] duration-150 ease-out", n),
		style: {
			height: `${l}px`,
			...o.style
		},
		children: /* @__PURE__ */ J("div", {
			ref: s,
			children: t
		})
	});
}, va = /* @__PURE__ */ function(e) {
	return e.Micro = "header-micro", e.Small = "header-small", e.Medium = "header-medium", e;
}({}), ya = ({ value: e, onCommit: t, size: n = "header-small", placeholder: r = "Untitled", disabled: i = !1, className: a = "" }) => {
	let [o, s] = K(!1), [c, l] = K(e), u = G(null), [f, p] = K(e);
	f !== e && (p(e), o || l(e)), U(() => {
		if (!o) return;
		let e = u.current;
		e?.focus(), e?.select();
	}, [o]);
	let m = () => {
		s(!1);
		let n = c.trim();
		n && n !== e ? t(n) : l(e);
	};
	return /* @__PURE__ */ J("div", {
		className: d("flex items-center min-w-0 h-8", n, a),
		children: o ? /* @__PURE__ */ J("input", {
			ref: u,
			value: c,
			placeholder: r,
			className: d("w-full min-w-0 bg-btn-secondary-hovered text-basic-primary font-normal", "rounded-t-[4px] border-b border-primary outline-none px-1", n),
			onChange: (e) => l(e.target.value),
			onBlur: m,
			onKeyDown: (t) => {
				t.key === "Enter" && (t.preventDefault(), m()), t.key === "Escape" && (t.preventDefault(), l(e), s(!1));
			}
		}) : /* @__PURE__ */ J("button", {
			type: "button",
			disabled: i,
			className: d("min-w-0 truncate text-left text-basic-primary px-1", i ? "cursor-default" : "cursor-text", n),
			onClick: () => !i && s(!0),
			children: e || r
		})
	});
};
ya.Size = va;
//#endregion
//#region src/app/atoms/file-icon/icons/asciidoc.svg?raw
var ba = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M4 18V8l5.39 10Zm0 4v3.67A2.33 2.33 0 0 0 6.33 28h8.9l-3.496-6Zm12.444 0 3.177 5.444A11.88 11.88 0 0 0 26.448 22Zm11.419-4A15 15 0 0 0 28 16 12 12 0 0 0 16 4L6 3.995q-.08 0-.158.005L14 18Z\"/></svg>", xa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff6e40\" d=\"M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h2v-1H2V2h2V1Zm10 0v1h2v12h-2v1h2a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1ZM6 3c0 1 0 1-1 1v1h1v2h1V3Zm3 0a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1Zm0 1h1v2H9ZM6 9a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1Zm4 0c0 1 0 1-1 1v1h1v2h1V9Zm-4 1h1v2H6Z\"/></svg>", Sa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M12.106 25.849c-1.262-1.156-1.63-3.586-1.105-5.346a5.18 5.18 0 0 0 3.484 1.66 9.68 9.68 0 0 0 5.882-.734c.215-.106.413-.247.648-.39a3.5 3.5 0 0 1 .16 1.555 4.26 4.26 0 0 1-1.798 3.021c-.404.3-.832.569-1.25.852a2.613 2.613 0 0 0-1.15 3.372l.048.161a3.4 3.4 0 0 1-1.5-1.285 3.6 3.6 0 0 1-.578-1.962 9 9 0 0 0-.05-1.037c-.114-.831-.504-1.204-1.238-1.225a1.45 1.45 0 0 0-1.507 1.18c-.012.056-.028.112-.046.178M4.901 20a17.75 17.75 0 0 1 7.4-2l2.913-8.38a.765.765 0 0 1 1.527 0L19.7 18a14.24 14.24 0 0 1 7.399 2S20.704 2.877 20.692 2.842C20.51 2.33 20.202 2 19.787 2h-7.619c-.415 0-.71.33-.904.842z\"/></svg>", Ca = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m6 10h-4v8a4 4 0 1 1-4-4 3.96 3.96 0 0 1 2 .555V8h6Z\"/></svg>", wa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fbc02d\" d=\"M3 18S4.15 6.885 7 3l5 1-1 3H9v7h1c1.9-2.915 5.783-3.98 8.157-2.915 4.475 1.915 2.998 5.967.148 7.905C16.025 20.548 10.113 23.05 3 18\"/></svg>", Ta = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", Ea = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g transform=\"translate(0 -822.52)\"><rect width=\"107.25\" height=\"156.59\" x=\"405.55\" y=\"967.22\" fill=\"#0097a7\" rx=\"12.306\" ry=\"12.31\" transform=\"matrix(-.98339 .18149 .60192 .79856 0 0)\"/><rect width=\"108.34\" height=\"123.15\" x=\"-1156.5\" y=\"1461.9\" fill=\"#3f51b5\" rx=\"10.69\" ry=\"12.31\" transform=\"matrix(-.98528 .17093 -.59175 .80612 0 0)\"/><path fill=\"#3f51b5\" d=\"M52.112 965.158c-1.343 3.515-26.292 23.248-25.744 27.277.548 4.03 29.812 16.023 32.04 19.027s10.545 41.668 13.603 42.5 18.828-31.274 21.548-32.932 32.808 2.503 34.15-1.01c1.343-3.515-18.174-35.352-18.721-39.381s9.732-40.12 7.502-43.125-30.06 9.427-33.118 8.594-26.793-27.3-29.514-25.643-.405 41.177-1.747 44.693z\"/></g></svg>", Da = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M2 2a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h6v3l2-1.25L12 14v-3h2a1 1 0 0 0 1-1V3a1 1 0 0 0-1-1Zm0 1h4v1H2Zm6 0 2 1.25L12 3v2.5l2 1-2 1V10l-2-1.25L8 10V7.5l-2-1 2-1zM2 5h3v1H2Zm0 2h3v1H2Zm0 2h4v1H2Z\"/></svg>", Oa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 256 256\"><path fill=\"#64dd17\" d=\"M123.456 129.975a507 507 0 0 0-3.54 7.846c-4.406 9.981-9.284 22.127-11.066 29.908-.64 2.77-1.037 6.205-1.03 10.013 0 1.506.081 3.09.21 4.702a58.1 58.1 0 0 0 19.98 3.559 58.2 58.2 0 0 0 18.29-2.98c-1.352-1.237-2.642-2.554-3.816-4.038-7.796-9.942-12.146-24.512-19.028-49.01m-28.784-49.39C79.782 91.08 70.039 108.387 70.002 128c.037 19.32 9.487 36.403 24.002 46.94 3.56-14.83 12.485-28.41 25.868-55.63a219 219 0 0 0-2.714-7.083c-3.708-9.3-9.059-20.102-13.834-24.993-2.435-2.555-5.389-4.763-8.652-6.648\"/><path fill=\"#7cb342\" d=\"M178.532 194.535c-7.683-.963-14.023-2.124-19.57-4.081a69.4 69.4 0 0 1-30.958 7.249c-38.491 0-69.693-31.198-69.698-69.7 0-20.891 9.203-39.62 23.764-52.392-3.895-.94-7.956-1.49-12.104-1.482-20.45.193-42.037 11.51-51.025 42.075-.84 4.45-.64 7.813-.64 11.8 0 60.591 49.12 109.715 109.705 109.715 37.104 0 69.882-18.437 89.732-46.633-10.736 2.675-21.06 3.955-29.902 3.982-3.314 0-6.425-.177-9.305-.53\"/><path fill=\"#29b6f6\" d=\"M157.922 173.271c.678.336 2.213.884 4.35 1.49 14.375-10.553 23.717-27.552 23.754-46.764h-.005c-.055-32.03-25.974-57.945-58.011-58.009a58.2 58.2 0 0 0-18.213 2.961c11.779 13.426 17.443 32.613 22.922 53.6l.01.025c.01.017 1.752 5.828 4.743 13.538 2.97 7.7 7.203 17.231 11.818 24.178 3.03 4.655 6.363 8 8.632 8.981\"/><path fill=\"#1e88e5\" d=\"M128.009 18.29c-36.746 0-69.25 18.089-89.16 45.826 10.361-6.49 20.941-8.83 30.174-8.747 12.753.037 22.779 3.991 27.589 6.696a51 51 0 0 1 3.345 2.131 69.4 69.4 0 0 1 28.049-5.894c38.496.004 69.703 31.202 69.709 69.698h-.006c0 19.409-7.938 36.957-20.736 49.594 3.142.352 6.492.571 9.912.554 12.15.006 25.284-2.675 35.13-10.956 6.42-5.408 11.798-13.327 14.78-25.199.584-4.586.92-9.247.92-13.991 0-60.588-49.116-109.715-109.705-109.715\"/></svg>", ka = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M11.94 2.984 2.928 21.017l9.875-8.47z\"/><path fill=\"#e53935\" d=\"m11.958 2.982.002.29 1.312 14.499-.002.006.023.26 7.363 2.978h.415l-.158-.31-.114-.228h-.001l-8.84-17.494z\"/><path fill=\"#7cb342\" d=\"m8.558 16.13-5.627 4.884h17.743v-.016z\"/></svg>", Aa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff7043\" d=\"M2 2a1 1 0 0 0-1 1v10c0 .554.446 1 1 1h12c.554 0 1-.446 1-1V3a1 1 0 0 0-1-1zm0 3h12v8H2zm1 2 2 2-2 2 1 1 3-3-3-3zm5 3.5V12h5v-1.5z\"/></svg>", ja = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#0288d1\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", Ma = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#cfd8dc\" d=\"m179.363 121.67-57.623 57.507c-.23.23-.576.346-.806.23l-78.713-21.09c-.346-.115-.577-.345-.577-.576L20.44 79.144c-.115-.345 0-.576.23-.806L78.294 20.83c.23-.23.576-.346.807-.23l78.713 21.09c.345.114.576.345.576.575l21.09 78.597c.23.346.115.577-.115.807zm-77.215-62.58-77.33 20.63c-.115 0-.23.23-.115.345l56.586 56.47c.115.115.346.115.346-.115l20.744-77.215c.115 0-.115-.23-.23-.116z\"/></svg>", Na = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M30 14v-2h-2V8h-2v4h-2V8h-2v4h-2v2h2v2h-2v2h2v4h2v-4h2v4h2v-4h2v-2h-2v-2Zm-4 2h-2v-2h2Zm-12.437 6A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", Pa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7e57c2\" d=\"M20 18h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 20 22h2v2h2v-2c0-.388-.562-.851-1.254-1.034C20.356 20.34 20 18.84 20 18m-3.254 2.966C14.356 20.34 14 18.84 14 18h-2v-2h-2v8h2v-2h4v2h2v-2c0-.388-.562-.851-1.254-1.034\"/><path fill=\"#7e57c2\" d=\"M24 4H4v20a4 4 0 0 0 4 4h16.16A3.84 3.84 0 0 0 28 24.16V8a4 4 0 0 0-4-4m2 14h-2v-2h-2v2c0 .193 0 .703 1.254 1.033A3.345 3.345 0 0 1 26 22v2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2 2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2 2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z\"/></svg>", Fa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#4fc3f7\" d=\"M16.83 2a1.3 1.3 0 0 0-.916.377l-.013.01L7.323 7.34l8.556 8.55v.005l10.283 10.277 1.96-3.529-7.068-16.96-3.299-3.297A1.3 1.3 0 0 0 16.828 2Z\"/><path fill=\"#01579b\" d=\"m7.343 7.32-4.955 8.565-.01.013a1.297 1.297 0 0 0 .004 1.835l.005.005 4.106 4.107 16.064 6.314 3.632-2.015-.098-.098-.025.002L15.995 15.97h-.012z\"/><path fill=\"#01579b\" d=\"m7.321 7.324 8.753 8.755h.013L26.16 26.156l3.835-.73L30 14.089l-4.049-3.965a6.5 6.5 0 0 0-3.618-1.612l.002-.043L7.323 7.325Z\"/><path fill=\"#64b5f6\" d=\"m7.332 7.335 8.758 8.75v.013l10.079 10.071L25.436 30H14.09l-3.967-4.048a6.5 6.5 0 0 1-1.611-3.618l-.045.004Z\"/></svg>", Ia = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M16 24c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-8c-5.525 0-10-.9-10-2v4c0 1.1 4.475 2 10 2s10-.9 10-2v-4c0 1.1-4.475 2-10 2m0-12C10.477 4 6 4.895 6 6v4c0 1.1 4.475 2 10 2s10-.9 10-2V6c0-1.105-4.477-2-10-2\"/></svg>", La = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M18 23H4c-1.1 0-2-.9-2-2V7h2v14h14zM14.5 7V5h-2v2h-2v2h2v2h2V9h2V7zm2 6h-6v2h6zM15 1H8c-1.1 0-1.99.9-1.99 2L6 17c0 1.1.89 2 1.99 2H19c1.1 0 2-.9 2-2V7zm4 16H8V3h6.17L19 7.83z\"/></svg>", Ra = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#42a5f5\" d=\"M6 2a2 2 0 0 0-2 2v16c0 1.11.89 2 2 2h6v-2H6V4h7v5h5v3h2V8l-6-6m4 12a.26.26 0 0 0-.26.21l-.19 1.32c-.3.13-.59.29-.85.47l-1.24-.5c-.11 0-.24 0-.31.13l-1 1.73c-.06.11-.04.24.06.32l1.06.82a4.2 4.2 0 0 0 0 1l-1.06.82a.26.26 0 0 0-.06.32l1 1.73c.06.13.19.13.31.13l1.24-.5c.26.18.54.35.85.47l.19 1.32c.02.12.12.21.26.21h2c.11 0 .22-.09.24-.21l.19-1.32c.3-.13.57-.29.84-.47l1.23.5c.13 0 .26 0 .33-.13l1-1.73a.26.26 0 0 0-.06-.32l-1.07-.82c.02-.17.04-.33.04-.5s-.01-.33-.04-.5l1.06-.82a.26.26 0 0 0 .06-.32l-1-1.73c-.06-.13-.19-.13-.32-.13l-1.23.5c-.27-.18-.54-.35-.85-.47l-.19-1.32A.236.236 0 0 0 20 14m-1 3.5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5c-.84 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5\"/></svg>", za = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M21.81 10.25c-.06-.04-.56-.43-1.64-.43-.28 0-.56.03-.84.08-.21-1.4-1.38-2.11-1.43-2.14l-.29-.17-.18.27c-.24.36-.43.77-.51 1.19-.2.8-.08 1.56.33 2.21-.49.28-1.29.35-1.46.35H2.62c-.34 0-.62.28-.62.63 0 1.15.18 2.3.58 3.38.45 1.19 1.13 2.07 2 2.61.98.6 2.59.94 4.42.94.79 0 1.61-.07 2.42-.22 1.12-.2 2.2-.59 3.19-1.16A8.3 8.3 0 0 0 16.78 16c1.05-1.17 1.67-2.5 2.12-3.65h.19c1.14 0 1.85-.46 2.24-.85.26-.24.45-.53.59-.87l.08-.24zm-17.96.99h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H3.85c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.43 0h1.76c.08 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16H6.28c-.09 0-.16.07-.16.16v1.58c.01.09.07.16.16.16m2.47 0h1.75c.1 0 .17-.07.17-.16V9.5c0-.08-.06-.16-.17-.16H8.75c-.08 0-.15.07-.15.16v1.58c0 .09.06.16.15.16m2.44 0h1.77c.08 0 .15-.07.15-.16V9.5c0-.08-.06-.16-.15-.16h-1.77c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16M6.28 9h1.76c.08 0 .16-.09.16-.18V7.25c0-.09-.07-.16-.16-.16H6.28c-.09 0-.16.06-.16.16v1.57c.01.09.07.18.16.18m2.47 0h1.75c.1 0 .17-.09.17-.18V7.25c0-.09-.06-.16-.17-.16H8.75c-.08 0-.15.06-.15.16v1.57c0 .09.06.18.15.18m2.44 0h1.77c.08 0 .15-.09.15-.18V7.25c0-.09-.07-.16-.15-.16h-1.77c-.08 0-.15.06-.15.16v1.57c0 .09.07.18.15.18m0-2.28h1.77c.08 0 .15-.07.15-.16V5c0-.1-.07-.17-.15-.17h-1.77c-.08 0-.15.06-.15.17v1.56c0 .08.07.16.15.16m2.46 4.52h1.76c.09 0 .16-.07.16-.16V9.5c0-.08-.07-.16-.16-.16h-1.76c-.08 0-.15.07-.15.16v1.58c0 .09.07.16.15.16\"/></svg>", Ba = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 16h8v2H8zm0-4h8v2H8zm6-10H6c-1.1 0-2 .9-2 2v16c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8zm4 18H6V4h7v5h5z\"/></svg>", Va = "<svg xmlns=\"http://www.w3.org/2000/svg\" clip-rule=\"evenodd\" image-rendering=\"optimizeQuality\" shape-rendering=\"geometricPrecision\" text-rendering=\"geometricPrecision\" viewBox=\"0 0 3473 3473\"><path fill=\"#ede7f6\" d=\"M989.342 1977.409c41.146-26.835 75.137-93.922 54.564-141.33-56.353 24.151-53.67 79.61-54.564 141.33m636.877 153.851c44.724-14.311 87.66-64.402 63.509-116.283-34.886 24.151-57.248 57.247-63.51 116.284z\"/><g fill=\"#fafafa\"><path d=\"M374.827 2871.899c0 56.352 14.312 117.178 53.67 138.645 144.907 81.4 652.977 17.89 825.614-20.573 90.343-20.573 163.692-87.66 248.668-124.334 191.421-83.187 330.067-150.274 483.025-262.085 110.916-81.399 287.131-310.388 305.915-447.245l-151.169-33.991c-3.578 153.852-38.463 188.737-175.32 224.517-92.132 25.046-271.925 30.413-365.846 14.312-124.334-20.574-180.687-85.871-237.04-160.114-109.128-144.907 24.151-245.985-148.485-255.824-181.582 222.728-501.81 62.614-642.244 40.252-59.93 86.765-200.366 650.294-198.577 779.1 86.766-29.517 141.33 2.684 219.15 33.097 275.503 106.444 34.885 200.366-75.137 172.636-75.137-17.89-98.394-67.086-142.224-98.393m360.48-1285.383c111.81 21.468 211.1 67.982 305.915 115.39 154.747 76.926 182.476 66.192 196.788 173.53 1.789 19.68-1.789 30.413 54.564 48.303 94.816 29.518-54.564-23.257 199.471-22.362 151.169.894 497.337 61.72 609.148 132.384 46.513 29.519 37.568 67.087 194.999 62.615-1.79-185.16-50.986-461.557-123.44-631.51-88.554-205.733-205.733-237.04-444.561-313.966-139.54-44.725-549.217-93.922-676.235-15.207-118.967 74.243-141.33 162.798-252.246 318.439-32.202 45.619-43.83 80.504-64.403 132.384\"/><path d=\"M1720.14 1966.675c89.45 36.674-4.472 273.714-128.806 216.466-40.252-113.6 55.458-178.003 81.398-228.99-53.67-8.05-206.627-32.2-252.246-15.206-59.036 22.363-72.454 148.486-42.041 207.522 143.118 280.87 775.523 220.94 708.436 2.684-26.835-88.555-51.88-102.867-142.224-133.28-72.454-24.15-144.907-49.196-224.517-49.196m-1124.374-31.307c71.56 68.875 233.462 79.61 338.117 84.976 13.418-138.646 25.046-242.407 135.963-234.356 54.564 74.242 25.94 161.902-31.307 218.255 97.5-.894 153.852-74.242 139.54-180.687-82.293-59.036-331.856-177.109-457.084-194.104-34.885 37.569-120.756 243.301-125.229 305.916\"/></g><path d=\"M427.602 2820.913c59.036-5.367 212.889 39.357 225.412 89.449-95.71 11.628-217.361 2.683-225.412-89.45zm-52.775 50.986c43.83 31.307 67.087 80.504 142.224 98.393 110.022 27.73 350.64-66.192 75.137-172.636-77.82-30.413-132.384-62.614-219.15-33.096-1.789-128.807 138.646-692.336 198.577-779.101 140.435 22.362 460.662 182.476 642.244-40.252 172.636 9.84 39.357 110.917 148.485 255.824 56.353 74.243 112.706 139.54 237.04 160.114 93.921 16.1 273.714 10.734 365.846-14.312 136.857-35.78 171.742-70.665 175.32-224.517l151.17 33.99c-18.785 136.858-195 365.847-305.916 447.246-152.958 111.81-291.604 178.898-483.025 262.085-84.976 36.674-158.325 103.761-248.668 124.334-172.637 38.463-680.707 101.972-825.614 20.574-39.358-21.468-53.67-82.294-53.67-138.646M1626.22 2131.26c6.261-59.037 28.623-92.133 63.508-116.284 24.152 51.88-18.784 101.972-63.508 116.284m93.921-164.586c79.61 0 152.063 25.045 224.517 49.197 90.344 30.412 115.39 44.724 142.224 133.279 67.087 218.255-565.318 278.186-708.436-2.684-30.413-59.036-16.995-185.16 42.041-207.522 45.619-16.995 198.577 7.156 252.246 15.207-25.94 50.986-121.65 115.389-81.398 228.99 124.334 57.247 218.255-179.793 128.806-216.467m-730.798 10.734c.894-61.72-1.79-117.179 54.564-141.33 20.573 47.408-13.418 114.495-54.564 141.33m-393.576-42.041c4.473-62.615 90.344-268.347 125.229-305.916 125.228 16.995 374.791 135.068 457.084 194.104 14.312 106.445-42.04 179.793-139.54 180.687 57.247-56.353 85.87-144.013 31.307-218.255-110.917-8.05-122.545 95.71-135.963 234.356-104.655-5.367-266.558-16.1-338.117-84.976m-89.449-71.56c-33.096-91.238-33.096-233.462 107.339-245.09l-71.56 199.471c-18.783 42.936-18.783 33.096-35.779 45.62zm228.99-277.292c20.573-51.88 32.201-86.765 64.403-132.384 110.917-155.641 133.279-244.196 252.246-318.439 127.018-78.715 536.694-29.518 676.235 15.207 238.828 76.926 356.007 108.233 444.561 313.966 72.454 169.953 121.65 446.35 123.44 631.51-157.43 4.472-148.486-33.096-195-62.615-111.81-70.664-457.978-131.49-609.147-132.384-254.035-.895-104.655 51.88-199.471 22.362-56.353-17.89-52.775-28.624-54.564-48.302-14.312-107.34-42.041-96.605-196.788-173.531-94.816-47.408-194.104-93.922-305.915-115.39m1583.247-43.83c-16.995-56.352 14.312-52.775 68.876-91.238 31.307-22.362 56.353-45.619 94.816-67.086 144.013-80.504 412.36-93.922 526.854 1.789 46.514 38.463 122.545 113.6 110.917 211.994-24.151 195.893-158.325 303.232-268.347 392.68-111.811 91.239-297.865 185.16-490.18 122.546-16.101-39.358-3.578-288.92-22.363-381.053-16.995-82.293-8.05-91.238 39.358-140.435 139.54-144.907 441.878-250.457 613.62-126.123 72.454 53.67 51.88 74.243 89.449 115.39 46.513-50.092-40.252-218.256-360.48-207.522-217.36 7.156-311.282 177.109-402.52 169.058m-1302.377-508.964c4.472-124.335 118.967-381.948 233.461-471.397 138.646-107.338 283.554-208.416 496.442-87.66 52.775 29.519 50.092 44.725 55.459 118.073 4.472 70.665-1.79 96.605-19.679 153.852-141.33 456.19-259.402 194.105-712.014 302.338 16.995-148.485 145.802-280.87 217.361-349.746 122.545-118.967 211.1-195.893 395.365-170.847 50.986 84.976 56.352 138.646-5.367 237.934-82.293 132.385-102.867 124.334-90.344 214.678 64.403-16.101 84.082-78.715 113.6-141.33 179.793-375.686-81.398-421.305-241.512-352.429-107.339 45.62-298.76 256.719-361.374 383.736-12.523 25.046-25.94 57.248-37.568 84.977zm708.436 18.784c18.784-111.811 129.7-139.54 129.7-483.92 0-148.485-182.475-281.764-421.304-182.475-204.838 84.082-236.145 148.485-345.273 313.071-102.867 155.642-99.289 326.49-187.843 470.502-25.94 41.147-49.197 55.458-77.82 96.605-20.574 30.413-35.78 68.876-56.354 104.655-42.04 68.876-84.976 118.968-118.967 201.26-107.339 2.684-197.682 4.473-208.416 115.39-14.312 152.063 57.247 189.632 57.247 246.879-.894 61.72-251.351 684.285-181.581 1055.498 19.679 101.972 86.765 102.867 194.104 115.39 258.508 31.307 593.942 20.573 825.614-72.454l420.41-201.26c106.445-59.931 285.343-173.532 364.953-256.72 56.353-58.141 85.87-107.338 134.173-176.214 66.192-96.605 67.981-94.816 82.293-226.306 87.66 16.101 251.352 54.564 305.916 101.972-6.262 61.72-36.674 32.202-36.674 87.66 34.885.895 93.027-42.935 107.339-91.238-36.675-53.67-75.138-44.724-127.913-87.66 42.042-33.096 118.073-48.302 176.215-72.453 125.229-51.88 339.012-209.311 391.787-352.43 42.04-115.389 10.734-307.704-57.248-382.841-71.559-78.715-237.934-118.967-373.897-118.967-161.902 0-329.172 116.283-459.767 166.375-50.092-43.83-53.67-93.922-90.344-142.224-42.04-57.248-315.755-200.366-446.35-228.095\"/><path fill=\"#efebe9\" d=\"M2318.554 1542.686c91.238 8.05 185.16-161.902 402.52-169.058 320.228-10.734 406.993 157.43 360.48 207.521-37.569-41.146-16.995-61.72-89.45-115.389-171.741-124.334-474.079-18.784-613.62 126.123-47.407 49.197-56.352 58.142-39.357 140.435 18.785 92.133 6.262 341.695 22.362 381.053 192.316 62.614 378.37-31.307 490.181-122.545 110.022-89.45 244.196-196.788 268.347-392.681 11.628-98.394-64.403-173.531-110.917-211.994-114.494-95.71-382.841-82.293-526.854-1.79-38.463 21.468-63.51 44.725-94.816 67.087-54.564 38.464-85.871 34.886-68.876 91.238m-1302.377-508.964 43.83-77.821c11.628-27.73 25.045-59.93 37.568-84.977 62.614-127.017 254.035-338.117 361.374-383.736 160.114-68.876 421.305-23.257 241.512 352.43-29.518 62.614-49.197 125.228-113.6 141.329-12.523-90.344 8.05-82.293 90.344-214.678 61.72-99.288 56.353-152.958 5.367-237.934-184.265-25.046-272.82 51.88-395.365 170.847-71.56 68.876-200.366 201.26-217.361 349.746 452.612-108.233 570.685 153.852 712.014-302.338 17.89-57.247 24.151-83.187 19.679-153.852-5.367-73.348-2.684-88.554-55.459-118.073-212.888-120.756-357.796-19.678-496.442 87.66-114.494 89.45-228.989 347.062-233.461 471.397\"/><path fill=\"#eee\" d=\"M506.317 1863.808c16.996-12.523 16.996-2.683 35.78-45.619l71.559-199.47c-140.435 11.627-140.435 153.851-107.339 245.09z\"/><path fill=\"#efebe9\" d=\"M653.014 2910.362c-12.523-50.092-166.376-94.816-225.412-89.45 8.05 92.133 129.701 101.078 225.412 89.45\"/></svg>", Ha = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#9575cd\" d=\"M12.173 22.681c-3.86 0-6.99-3.64-6.99-8.13 0-3.678 2.773-8.172 4.916-10.91 1.014-1.296 2.93-2.322 2.93-2.322s-.982 5.239 1.683 7.319c2.366 1.847 4.106 4.25 4.106 6.363 0 4.232-2.784 7.68-6.645 7.68\"/></svg>", Ua = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 323 323\"><path fill=\"#ffb300\" d=\"m106.716 99.763 54.785 54.782 54.779-54.782z\"/><path fill=\"#64dd17\" d=\"M96.881 89.93H216.83l-55.18-55.184H41.7zm131.546 11.593 59.705 59.704L228.16 221.2l-59.705-59.704z\"/><path fill=\"#00b8d4\" d=\"m175.552 34.746 112.703 112.695V34.746z\"/><path fill=\"#455a64\" d=\"m34.746 281.3 119.8-119.8-119.8-119.8z\"/><path fill=\"#ffb300\" d=\"m288.255 175.01-53.148 53.149 53.148 53.14z\"/><path fill=\"#00b8d4\" d=\"M281.3 288.254 161.5 168.455l-119.8 119.8z\"/></svg>", Wa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 30 30\"><path fill=\"#f44336\" d=\"M5.207 4.33q-.072.075-.143.153Q1.5 8.476 1.5 15.33c0 4.418 1.155 7.862 3.459 10.34h19.415c2.553-1.152 4.127-3.43 4.127-3.43l-3.147-2.52L23.9 21.1c-.867.773-.845.931-2.315 1.78-1.495.674-3.04.966-4.634.966-2.515 0-4.423-.909-5.723-2.059-1.286-1.15-1.985-4.511-2.096-6.68l17.458.067-.183-1.472s-.847-7.129-2.541-9.372zm8.76.846c1.565 0 3.22.535 3.961 1.471.74.937.931 1.667.973 3.524H9.11c.112-1.955.436-2.81 1.373-3.698.936-.887 2.03-1.297 3.484-1.297\"/></svg>", Ga = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#3f51b5\" d=\"M22.713 4H9.287a.5.5 0 0 0-.432.248l-6.708 11.5a.5.5 0 0 0 0 .504l6.708 11.5a.5.5 0 0 0 .432.248h13.426a.5.5 0 0 0 .432-.248l6.708-11.5a.5.5 0 0 0 0-.504l-6.708-11.5A.5.5 0 0 0 22.713 4m-6.937 20.888-7.5-3.75A.5.5 0 0 1 8 20.691v-9.382a.5.5 0 0 1 .276-.447l7.5-3.75a.5.5 0 0 1 .448 0l7.5 3.75a.5.5 0 0 1 .276.447v9.382a.5.5 0 0 1-.276.447l-7.5 3.75a.5.5 0 0 1-.448 0\"/><path fill=\"#7986cb\" d=\"M22 19.441v-6.882a.5.5 0 0 0-.276-.447l-5.5-2.75a.5.5 0 0 0-.448 0l-5.5 2.75a.5.5 0 0 0-.276.447v6.882a.5.5 0 0 0 .276.447l5.5 2.75a.5.5 0 0 0 .448 0l5.5-2.75a.5.5 0 0 0 .276-.447\"/></svg>", Ka = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M28 4H4a2 2 0 0 0-2 2v20a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 22H4V10h24Z\"/></svg>", qa = "<svg viewBox=\"0 0 16 16\" xmlns=\"http://www.w3.org/2000/svg\"><path d=\"m8.668 6h3.6641l-3.6641-3.668v3.668m-4.668-4.668h5.332l4 4v8c0 0.73828-0.59375 1.3359-1.332 1.3359h-8c-0.73828 0-1.332-0.59766-1.332-1.3359v-10.664c0-0.74219 0.59375-1.3359 1.332-1.3359m3.332 1.3359h-3.332v10.664h8v-6h-4.668z\" fill=\"#90a4ae\" /></svg>", Ja = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M24 28h4L18 4h-4L4 28h4l8-19.422\"/><path fill=\"#f44336\" d=\"M8 20h16v4H8z\"/></svg>", Ya = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><path fill=\"#0288d1\" d=\"m236.249 36.066-213.94 213.94 213.94 213.94v-84.36l-129.7-129.7 129.7-129.7z\"/><path fill=\"#0288d1\" d=\"m236.249 156.017-93.622 93.62 93.622 93.622z\"/><path fill=\"#00b8d4\" d=\"m263.759 36.047 213.94 213.94-213.94 213.94v-84.36l129.7-129.7-129.7-129.7z\"/></svg>", Xa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e64a19\" d=\"M13.172 2.828 11.78 4.22l1.91 1.91 2 2A2.986 2.986 0 0 1 20 10.81a3.25 3.25 0 0 1-.31 1.31l2.06 2a2.68 2.68 0 0 1 3.37.57 2.86 2.86 0 0 1 .88 2.117 3.02 3.02 0 0 1-.856 2.109A2.9 2.9 0 0 1 23 19.81a2.93 2.93 0 0 1-2.13-.87 2.694 2.694 0 0 1-.56-3.38l-2-2.06a3 3 0 0 1-.31.12V20a3 3 0 0 1 1.44 1.09 2.92 2.92 0 0 1 .56 1.72 2.88 2.88 0 0 1-.878 2.128 2.98 2.98 0 0 1-2.048.871 2.981 2.981 0 0 1-2.514-4.719A3 3 0 0 1 16 20v-6.38a2.96 2.96 0 0 1-1.44-1.09 2.9 2.9 0 0 1-.56-1.72 2.9 2.9 0 0 1 .31-1.31l-3.9-3.9-7.579 7.572a4 4 0 0 0-.001 5.658l10.342 10.342a4 4 0 0 0 5.656 0l10.344-10.344a4 4 0 0 0 0-5.656L18.828 2.828a4 4 0 0 0-5.656 0\"/></svg>", Za = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#78909c\" d=\"M26 18h-6a2 2 0 0 0-2 2v2h-6a2 2 0 0 1-2-2v-6h2a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2v6a4 4 0 0 0 4 4h6v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2M6.5 12a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5v5a.5.5 0 0 1-.5.5ZM26 25.5a.5.5 0 0 1-.5.5h-5a.5.5 0 0 1-.5-.5v-5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 .5.5Z\"/></svg>", Qa = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"m29.532 13.083-.037-.105-3.811-10.322a1 1 0 0 0-.392-.49.985.985 0 0 0-1.39.316 1 1 0 0 0-.122.28L21.208 10H10.792L8.22 2.762a1.004 1.004 0 0 0-1.246-.721 1 1 0 0 0-.266.124 1 1 0 0 0-.392.491L2.507 12.98l-.04.103a7.52 7.52 0 0 0 2.348 8.491l.015.012.032.026 5.797 4.511 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257 5.838-4.537.016-.013a7.52 7.52 0 0 0 2.35-8.49Z\"/><path fill=\"#ef6c00\" d=\"m29.532 13.083-.037-.105a12.6 12.6 0 0 0-5.123 2.394l-8.367 6.57 5.327 4.181 5.839-4.537.016-.013a7.52 7.52 0 0 0 2.345-8.49\"/><path fill=\"#f9a825\" d=\"m10.659 26.123 2.876 2.257 1.747 1.372a1.146 1.146 0 0 0 1.424 0l1.747-1.372 2.876-2.257L16 21.943Z\"/><path fill=\"#ef6c00\" d=\"M7.628 15.371a12.6 12.6 0 0 0-5.12-2.39l-.04.102a7.52 7.52 0 0 0 2.347 8.491l.015.012.032.026 5.797 4.511 5.331-4.18Z\"/></svg>", $a = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#ec407a\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", eo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00acc1\" d=\"M2 12h4v2H2zm-2 4h6v2H0zm4 4h2v2H4zm16.954-5H14v3h3.239a4.42 4.42 0 0 1-3.531 2 2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 15.292 13a2.73 2.73 0 0 1 1.749.584l2.962-1.185A5.6 5.6 0 0 0 15.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 6.4 6.4 0 0 0 .003-1.5\"/><path fill=\"#00acc1\" d=\"M26.292 10a7.526 7.526 0 0 0-7.243 6.5 5.614 5.614 0 0 0 5.659 6.5 7.526 7.526 0 0 0 7.243-6.5 5.614 5.614 0 0 0-5.659-6.5m2.681 6.137A4.515 4.515 0 0 1 24.708 20a2.65 2.65 0 0 1-2.053-.858 2.86 2.86 0 0 1-.628-2.28A4.515 4.515 0 0 1 26.292 13a2.65 2.65 0 0 1 2.053.858 2.86 2.86 0 0 1 .628 2.28Z\"/></svg>", to = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0097a7\" d=\"M16 10v2h6c-2 0-3-2-6-2\"/><path fill=\"#0097a7\" d=\"M26 4h-2a4 4 0 0 0-4 4h4a1 1 0 0 1 2 0v4H16v-2h-5.317A2.683 2.683 0 0 0 8 12.683v2.634A2.683 2.683 0 0 0 10.683 18H16v2h-5.98A4.02 4.02 0 0 1 6 16v-2c-2 0-4 4-4 8 0 5 1 6 2 6h4v-4h4v4h4v-4h4v4h4v-6a2 2 0 0 0 2-2v-2a4 4 0 0 0 4-4V8a4 4 0 0 0-4-4m-4 12h-2a2 2 0 0 1-2-2h6a2 2 0 0 1-2 2\"/></svg>", no = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M6 20h20v2H6z\"/><circle cx=\"7\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"27\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"21\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 10h20v2H6z\"/><circle cx=\"7\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"16\" cy=\"5\" r=\"3\" fill=\"#ec407a\"/><circle cx=\"25\" cy=\"11\" r=\"3\" fill=\"#ec407a\"/><path fill=\"#ec407a\" d=\"M6 12h2v10H6zm18-2h2v12h-2z\"/><path fill=\"#ec407a\" d=\"m5.014 19.41 11.674 6.866L15.674 28 4 21.134z\"/><path fill=\"#ec407a\" d=\"M26.688 21.724 15.014 28.59 14 26.866 25.674 20zM5.124 10.382l11.415-7.29 1.077 1.686L6.2 12.068z\"/><path fill=\"#ec407a\" d=\"m25.798 12.067-11.415-7.29 1.077-1.685 11.415 7.29zM6.2 19.932l11.416 7.29-1.077 1.686-11.415-7.29z\"/><path fill=\"#ec407a\" d=\"m26.875 21.619-11.415 7.29-1.077-1.687 11.415-7.289zM5.877 22.6 16.04 3.686l1.762.946L7.638 23.546z\"/><path fill=\"#ec407a\" d=\"M24.361 23.545 14.197 4.633l1.761-.947 10.165 18.913z\"/></svg>", ro = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26c6da\" d=\"M19.322 2a6.5 6.5 0 0 1 4.352 1.419 4.55 4.55 0 0 1 1.685 3.662 5.82 5.82 0 0 1-1.886 4.275 6.04 6.04 0 0 1-4.34 1.846 4.15 4.15 0 0 1-2.385-.649 1.91 1.91 0 0 1-.936-1.603 1.6 1.6 0 0 1 .356-1.024 1.1 1.1 0 0 1 .861-.447q.469 0 .468.504a.79.79 0 0 0 .358.693 1.43 1.43 0 0 0 .826.245 3.1 3.1 0 0 0 2.39-1.573 5.66 5.66 0 0 0 1.154-3.39 2.64 2.64 0 0 0-.891-2.064 3.28 3.28 0 0 0-2.293-.812 6.18 6.18 0 0 0-4.086 1.736 12.9 12.9 0 0 0-3.215 4.557 13.4 13.4 0 0 0-1.233 5.36 5.86 5.86 0 0 0 1.091 3.723 3.53 3.53 0 0 0 2.905 1.372q3.058 0 5.848-4.002l2.935-.388q.546-.07.545.246a8 8 0 0 1-.423 1.24q-.421 1.097-1.152 3.668A12.7 12.7 0 0 0 26 17.72v1.66a14.2 14.2 0 0 1-4.055 2.57 10.38 10.38 0 0 1-2.764 5.931 6.7 6.7 0 0 1-4.806 2.11 3.3 3.3 0 0 1-2.012-.55 1.8 1.8 0 0 1-.718-1.514q0-2.685 5.634-5.212.532-1.766 1.152-3.507a8.6 8.6 0 0 1-2.853 2.323 7.4 7.4 0 0 1-3.48 1.01 5.46 5.46 0 0 1-4.366-2.093A8.1 8.1 0 0 1 6 15.122a11.6 11.6 0 0 1 1.966-6.426 14.7 14.7 0 0 1 5.162-4.862A12.44 12.44 0 0 1 19.322 2m-2.407 22.17q-4.055 1.875-4.054 3.695a.87.87 0 0 0 .999.97q1.964 0 3.055-4.665\"/></svg>", io = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M18.5 11a5.49 5.49 0 0 0-4.5 2.344V4H8v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", ao = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"M12.023 12a4 4 0 0 0-3.94 3.182 1 1 0 0 1-.972.818H5.229C4.446 16 4 15.552 4 15v-1H3a1 1 0 0 0-1 1v1c0 3.866 3.134 6 7 6 3.425 0 6.275-1.675 6.881-4.745.545-2.764-1.041-5.24-3.858-5.255\"/><path fill=\"#ff7043\" d=\"M29 14h-1v1c0 .552-.446 1-1.229 1H24.89a1 1 0 0 1-.973-.818A4 4 0 0 0 19.977 12c-2.817.016-4.403 2.491-3.858 5.255C16.725 20.325 19.575 22 23 22c3.866 0 7-2.134 7-6v-1a1 1 0 0 0-1-1\"/></svg>", oo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><g stroke-width=\"2.422\"><path fill=\"#ef5350\" d=\"m23.928 240.5 59.94-89.852-59.94-89.855h44.955l59.94 89.855-59.94 89.852z\"/><path fill=\"#ffa726\" d=\"m83.869 240.5 59.94-89.852-59.94-89.855h44.955l119.88 179.71h-44.95l-37.46-56.156-37.468 56.156z\"/><path fill=\"#ffee58\" d=\"m228.72 188.08-19.98-29.953h69.93v29.956h-49.95zm-29.97-44.924-19.98-29.953h99.901v29.953z\"/></g></svg>", so = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#eceff1\" d=\"M18 1.2V14h-4v-4l-4 2v16.37l4 2.43V18h4v4l4-2V3.63z\"/><path fill=\"#eceff1\" d=\"M14 1.2 2 8.49v15.02l4 2.43v-15.2l8-4.86zm12 4.86v15.2l-8 4.86v4.68l12-7.29V8.49z\"/></svg>", co = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M4 8v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2m4 14V10h4v12Zm11.999-6L18 18.001 21 21l-3 3.001L19.999 26l3.003-3 3 2.999L28 24l-3-2.999 3-3L26.001 16l-3 3z\"/></svg>", lo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M28 6V2h-2v4h-6V2h-2v4h-4v2h4v4h2V8h6v4h2V8h4V6zm-15.5 5A5.49 5.49 0 0 0 8 13.344V4H2v24h6V17a2 2 0 0 1 4 0v11h6V16.5a5.5 5.5 0 0 0-5.5-5.5\"/></svg>", uo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e65100\" d=\"m4 4 2 22 10 2 10-2 2-22Zm19.72 7H11.28l.29 3h11.86l-.802 9.335L15.99 25l-6.635-1.646L8.93 19h3.02l.19 2 3.86.77 3.84-.77.29-4H8.84L8 8h16Z\"/></svg>", fo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#26a69a\" d=\"M8.5 6h4l-4-4zM3.875 1H9.5l4 4v8.6c0 .773-.616 1.4-1.375 1.4h-8.25c-.76 0-1.375-.627-1.375-1.4V2.4c0-.777.612-1.4 1.375-1.4M4 13.6h8V8l-2.625 2.8L8 9.4zm1.25-7.7c-.76 0-1.375.627-1.375 1.4s.616 1.4 1.375 1.4c.76 0 1.375-.627 1.375-1.4S6.009 5.9 5.25 5.9\"/></svg>", po = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M22 10h2v4h-2z\"/><path fill=\"#f44336\" d=\"M28 2H4a2 2 0 0 0-2 2v24a2 2 0 0 0 2 2h24a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2m-2 12a2 2 0 0 1-2 2h-2v4a4 4 0 0 1-4 4h-8a4 4 0 0 1-4-4V8h18a2 2 0 0 1 2 2Z\"/></svg>", mo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", ho = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#1e88e5\" d=\"M4 26h24v2H4zM28 4H7a1 1 0 0 0-1 1v13a4 4 0 0 0 4 4h10a4 4 0 0 0 4-4v-4h4a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2m0 8h-4V6h4Z\"/></svg>", go = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ffca28\" d=\"M2 2v12h12V2zm6 6h1v4a1.003 1.003 0 0 1-1 1H7a1.003 1.003 0 0 1-1-1v-1h1v1h1zm3 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", _o = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 -960 960 960\"><path fill=\"#f9a825\" d=\"M560-160v-80h120q17 0 28.5-11.5T720-280v-80q0-38 22-69t58-44v-14q-36-13-58-44t-22-69v-80q0-17-11.5-28.5T680-720H560v-80h120q50 0 85 35t35 85v80q0 17 11.5 28.5T840-560h40v160h-40q-17 0-28.5 11.5T800-360v80q0 50-35 85t-85 35zm-280 0q-50 0-85-35t-35-85v-80q0-17-11.5-28.5T120-400H80v-160h40q17 0 28.5-11.5T160-600v-80q0-50 35-85t85-35h120v80H280q-17 0-28.5 11.5T240-680v80q0 38-22 69t-58 44v14q36 13 58 44t22 69v80q0 17 11.5 28.5T280-240h120v80z\"/></svg>", vo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 50 50\"><g transform=\"translate(.21 -247.01)\"><circle cx=\"13.497\" cy=\"281.63\" r=\"9.555\" fill=\"#c62828\"/><circle cx=\"36.081\" cy=\"281.63\" r=\"9.555\" fill=\"#7e57c2\"/><circle cx=\"24.722\" cy=\"262.39\" r=\"9.555\" fill=\"#388e3c\"/></g></svg>", yo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f57c00\" d=\"M6.2 18a22.7 22.7 0 0 0 9.8 2 22.7 22.7 0 0 0 9.8-2 10.002 10.002 0 0 1-19.6 0m19.6-4a22.7 22.7 0 0 0-9.8-2 22.7 22.7 0 0 0-9.8 2 10.002 10.002 0 0 1 19.6 0\"/><circle cx=\"27\" cy=\"5\" r=\"3\" fill=\"#757575\"/><circle cx=\"5\" cy=\"27\" r=\"3\" fill=\"#9e9e9e\"/><circle cx=\"5\" cy=\"5\" r=\"3\" fill=\"#616161\"/></svg>", bo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#26a69a\" d=\"M30 14H17.738a8 8 0 1 0 0 4H24v4h4v-4h2Zm-20 5a3 3 0 1 1 3-3 3.003 3.003 0 0 1-3 3\"/></svg>", xo = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\"1.725\" x2=\"22.185\" y1=\"22.67\" y2=\"1.982\" gradientTransform=\"translate(1.306 1.129)scale(.89324)\" gradientUnits=\"userSpaceOnUse\"><stop offset=\"0\" stop-color=\"#7c4dff\"/><stop offset=\".5\" stop-color=\"#d500f9\"/><stop offset=\"1\" stop-color=\"#ef5350\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M2.975 2.976v18.048h18.05v-.03l-4.478-4.511-4.48-4.515 4.48-4.515 4.443-4.477z\"/></svg>", So = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#448aff\" d=\"M12.074 1.424a.638.638 0 0 0-.686.691v.173c.015.2.044.402.087.588.058.358.085.73.07 1.102a.65.65 0 0 1-.201.33l-.014.258a7 7 0 0 0-1.117.17 7.9 7.9 0 0 0-4.012 2.292l-.213-.157a.56.56 0 0 1-.374-.042 6 6 0 0 1-.829-.747c-.129-.143-.26-.299-.403-.428l-.128-.1a.8.8 0 0 0-.431-.171c-.2 0-.372.07-.501.212-.2.301-.127.675.16.904l.013.014c.03.029.087.072.115.1q.258.172.515.3c.33.186.631.403.918.647a.63.63 0 0 1 .114.358l.2.17a7.82 7.82 0 0 0-1.232 5.546l-.271.07a.84.84 0 0 1-.275.274c-.358.086-.73.17-1.102.17-.186 0-.387 0-.588.057l-.156.03h-.014v.015c-.043 0-.086.014-.115.014a.62.62 0 0 0-.4.789.625.625 0 0 0 .772.386 1 1 0 0 0 .188-.045c.186-.057.37-.127.528-.213a7.4 7.4 0 0 1 1.103-.316c.114 0 .244.057.33.129l.285-.042a8.04 8.04 0 0 0 3.54 4.426l-.1.258a.8.8 0 0 1 .044.358c-.143.344-.33.687-.56.987-.114.172-.215.33-.344.501 0 .043.001.117-.056.16-.014.043-.044.072-.059.114a.615.615 0 0 0 .372.787.62.62 0 0 0 .79-.372c.028-.043.055-.143.083-.143.072-.2.131-.387.174-.574a5.4 5.4 0 0 1 .473-1.102.5.5 0 0 1 .271-.129l.143-.257c1.82.702 3.84.701 5.688.014l.115.23a.53.53 0 0 1 .3.198c.186.33.301.674.43 1.032.043.187.102.373.174.588.028 0 .055.086.084.129.014.043.03.071.044.114a.61.61 0 0 0 .845.216.614.614 0 0 0 .213-.845c-.014-.057-.056-.13-.056-.174-.115-.157-.23-.329-.344-.486-.215-.316-.371-.63-.543-.974a.48.48 0 0 1 .042-.372 1.2 1.2 0 0 1-.1-.244c1.661-1.002 2.951-2.577 3.539-4.454.086.014.17.028.271.042.086-.115.201-.115.33-.115.387.057.73.16 1.103.302q.235.128.514.213c.058.014.116.03.202.03v.015c0 .014.058.013.1.028.344.043.617-.202.689-.532a.617.617 0 0 0-.532-.7c-.057-.014-.127-.03-.17-.072h-.588a7 7 0 0 1-1.102-.202.6.6 0 0 1-.274-.257l-.272-.07a7.8 7.8 0 0 0-1.262-5.531l.23-.2a.44.44 0 0 1 .114-.343c.273-.244.589-.46.918-.647a3.6 3.6 0 0 0 .5-.3 1 1 0 0 0 .13-.1c.043-.028.086-.058.086-.087.258-.243.273-.63 0-.859-.214-.257-.601-.257-.845 0-.043 0-.1.059-.142.087a11 11 0 0 0-.403.428c-.244.272-.53.532-.831.747a.55.55 0 0 1-.372.042l-.23.171a7.98 7.98 0 0 0-5.098-2.462l-.014-.274a.5.5 0 0 1-.201-.314 5.6 5.6 0 0 1 .07-1.102 4 4 0 0 0 .087-.588v-.316a.62.62 0 0 0-.546-.548m-.842 4.773-.174 3.223h-.014a.56.56 0 0 1-.114.302.543.543 0 0 1-.745.13h-.014L7.536 7.973a6.23 6.23 0 0 1 3.035-1.662c.23-.043.446-.086.66-.115zm1.544 0a6.38 6.38 0 0 1 3.682 1.777L13.837 9.85h-.014a.66.66 0 0 1-.3.073.535.535 0 0 1-.56-.518zm-6.2 2.938 2.406 2.19v.015c.086.071.157.16.157.274a.523.523 0 0 1-.372.657v.014l-3.095.89a6.4 6.4 0 0 1 .904-4.04m10.842.042c.73 1.189 1.032 2.595.932 3.984l-3.109-.89-.014-.014a.5.5 0 0 1-.257-.17.53.53 0 0 1 .056-.761l-.014-.042zm-5.915 2.322h.988l.615.758-.215.96-.887.431-.887-.43-.23-.96zm-2.308 2.65h.115c.243 0 .46.17.545.414 0 .1.001.23-.056.302v.042l-1.22 2.966a6.33 6.33 0 0 1-2.563-3.195zm5.274 0h.344l3.193.515a6.34 6.34 0 0 1-2.563 3.223l-1.234-3.022c-.115-.258.002-.558.26-.716m-2.521 1.298a.55.55 0 0 1 .529.277h.014l1.561 2.823a5 5 0 0 1-.615.171 6.4 6.4 0 0 1-3.481-.17l1.561-2.824h.014c.043-.1.115-.144.216-.215a.5.5 0 0 1 .201-.062\"/></svg>", Co = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0277bd\" d=\"M8 3a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2H3v2h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2v-2H8v-5a2 2 0 0 0-2-2 2 2 0 0 0 2-2V5h2V3m6 0a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1v2h-1a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-5a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5h-2V3z\"/></svg>", wo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#ff5722\" d=\"M8 1a5.5 5.5 0 0 0-4 9.26V15l4-1.5 4 1.5v-4.74A5.49 5.49 0 0 0 8 1m0 1.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8m0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4\"/></svg>", To = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffd54f\" d=\"M25 12h-3V8a6 6 0 0 0-12 0v4H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h18a1 1 0 0 0 1-1V13a1 1 0 0 0-1-1M14 8a2 2 0 0 1 4 0v4h-4Zm2 17a4 4 0 1 1 4-4 4 4 0 0 1-4 4\"/></svg>", Eo = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#afb42b\" d=\"M19 5v9h-5v5H5V5zm0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h10l6-6V5c0-1.1-.9-2-2-2m-7 11H7v-2h5zm5-4H7V8h10z\"/></svg>", Do = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"M30 6a3.86 3.86 0 0 1-1.167 2.833 4.024 4.024 0 0 1-5.666 0A3.86 3.86 0 0 1 22 6a3.86 3.86 0 0 1 1.167-2.833 4.024 4.024 0 0 1 5.666 0A3.86 3.86 0 0 1 30 6m-9.208 5.208A10.6 10.6 0 0 0 13 8a10.6 10.6 0 0 0-7.792 3.208A10.6 10.6 0 0 0 2 19a10.6 10.6 0 0 0 3.208 7.792A10.6 10.6 0 0 0 13 30a10.6 10.6 0 0 0 7.792-3.208A10.6 10.6 0 0 0 24 19a10.6 10.6 0 0 0-3.208-7.792m-1.959 7.625a4.024 4.024 0 0 1-5.666 0 4.024 4.024 0 0 1 0-5.666 4.024 4.024 0 0 1 5.666 0 4.024 4.024 0 0 1 0 5.666\"/></svg>", Oo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ef5350\" d=\"m29.5 24.02-1.6-.92a4.4 4.4 0 0 0 .09-.9A1.3 1.3 0 0 0 28 22a5.6 5.6 0 0 0-.1-1.1l1.6-.92a.493.493 0 0 0 .18-.68l-1.5-2.6a.45.45 0 0 0-.18-.18V6.01a2.006 2.006 0 0 0-2-2H4a2.006 2.006 0 0 0-2 2V22a2.006 2.006 0 0 0 2 2h10.53l-.03.02a.493.493 0 0 0-.18.68l1.5 2.6a.493.493 0 0 0 .68.18l1.6-.92a5.9 5.9 0 0 0 1.9 1.09v1.85a.495.495 0 0 0 .5.5h3a.495.495 0 0 0 .5-.5v-1.85a5.9 5.9 0 0 0 1.9-1.09l1.6.92a.493.493 0 0 0 .68-.18l1.5-2.6a.493.493 0 0 0-.18-.68M24 22.01a1.99 1.99 0 0 1-.88 1.65l-.18.11a2.04 2.04 0 0 1-1.88 0l-.18-.11a1.99 1.99 0 0 1-.88-1.65V22a2 2 0 0 1 .88-1.66l.18-.11a2.04 2.04 0 0 1 1.88 0l.18.11A2 2 0 0 1 24 22Zm2-4.63-.1.06a5.9 5.9 0 0 0-1.9-1.09V14.5a.495.495 0 0 0-.5-.5h-3a.495.495 0 0 0-.5.5v1.85a5.9 5.9 0 0 0-1.9 1.09l-1.6-.92a.493.493 0 0 0-.68.18l-1.5 2.6a.493.493 0 0 0 .18.68l1.6.92A5.6 5.6 0 0 0 16 22v.01L4 22V10.01h22Z\"/></svg>", ko = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#42a5f5\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", Ao = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" viewBox=\"0 0 24 24\"><defs><linearGradient id=\"a\" x1=\".125\" x2=\"0\" y1=\"1\" y2=\"0\"><stop offset=\"0%\" stop-color=\"#ab47bc\"/><stop offset=\"37.5%\" stop-color=\"#ab47bc\"/><stop offset=\"37.501%\" stop-color=\"#d32f2f\"/><stop offset=\"54.25%\" stop-color=\"#d32f2f\"/><stop offset=\"54.251%\" stop-color=\"#ff7043\"/><stop offset=\"69.75%\" stop-color=\"#ff7043\"/><stop offset=\"69.751%\" stop-color=\"#ffa726\"/><stop offset=\"100%\" stop-color=\"#ffa726\"/></linearGradient></defs><path fill=\"url(#a)\" d=\"M22 2s-7.64-.37-13.66 7.88C3.72 16.21 2 22 2 22l1.94-1c1.44-2.5 2.19-3.53 3.6-5 2.53.74 5.17.65 7.46-2-2-.56-3.6-.43-5.96-.19C11.69 12 13.5 11.6 16 12l1-2c-1.8-.34-3-.37-4.78.04C14.19 8.65 15.56 7.87 18 8l1.11-1.73c-1.53-.06-2.4-.02-4.19.3 1.61-1.46 3.08-2.12 5.22-2.25 0 0 1.05-1.89 1.86-2.32\"/></svg>", jo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"m14 10-4 3.5L6 10H4v12h4v-6l2 2 2-2v6h4V10zm12 6v-6h-4v6h-4l6 8 6-8z\"/></svg>", Mo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M16 0 2 8v16l14 8 14-8V8Zm8 23a1 1 0 0 1-1 1h-2.52a1 1 0 0 1-.78-.375L12 14v9a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1h2.52a1 1 0 0 1 .78.375L20 18V9a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1Z\"/></svg>", No = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M6 24h20v2a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2zM30 6l-9 9-5-11-5 11-9-9 4 14h20z\"/></svg>", Po = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 500 500\"><g stroke-width=\".395\"><path fill=\"#1976d2\" d=\"M133.347 451.499c0-.295-2.752-5.283-6.116-11.084s-6.116-10.776-6.116-11.055 9.514-16.889 21.143-36.912c11.629-20.022 21.323-36.798 21.542-37.279.346-.76-1.608-4.363-14.896-27.466-8.412-14.625-15.294-26.785-15.294-27.023 0-.5 24.46-43.501 25.206-44.31.414-.45.592-.384 1.078.395.32.513 16.876 29.256 36.791 63.87 62.62 108.85 74.852 130.01 75.41 130.46.3.242.544.554.544.694s-11.836.21-26.302.154c-23.023-.09-26.313-.175-26.393-.694-.11-.714-27.662-48.825-28.86-50.392-.746-.978-.906-1.035-1.426-.51-.688.696-28.954 49.323-29.49 50.733l-.364.96h-13.23c-10.895 0-13.228-.095-13.228-.538zm167.58-125.61c-.134-.216 1.189-2.863 2.939-5.882 6.924-11.944 84.29-145.75 96.49-166.88 7.143-12.371 13.143-22.465 13.334-22.433.362.062 25.86 43.105 25.86 43.655 0 .174-6.761 11.952-15.025 26.173-8.46 14.557-14.932 26.104-14.81 26.421.185.483 4.563.564 30.213.564h29.996l.957 1.48c.527.814 3.296 5.547 6.155 10.518s5.45 9.29 5.757 9.597c.705.705.703.724-.16 1.572-.396.388-3.36 5.323-6.588 10.965-3.228 5.643-6.056 10.387-6.285 10.543s-19.695.171-43.256.034l-42.84-.249-.803 1.15c-.442.632-7.505 12.736-15.696 26.897l-14.892 25.747h-15.486c-8.518 0-20.015.116-25.551.259-6.55.168-10.15.121-10.308-.135zm-133.75-157.86c-56.373-.055-102.5-.182-102.5-.282s5.617-10.132 12.481-22.294L89.64 123.34h30.332c27.113 0 30.332-.065 30.332-.611 0-.336-6.659-12.228-14.797-26.427s-14.797-25.917-14.797-26.04 2.682-4.853 5.96-10.51 6.003-10.578 6.056-10.934c.086-.586 1.375-.648 13.572-.648 7.412 0 13.463.143 13.446.317-.018.174.22.707.53 1.184.31.476 9.763 16.937 21.007 36.578 11.244 19.64 20.71 36.022 21.036 36.4.554.647 2.549.691 31.428.691h30.837l12.896 22.145c7.093 12.18 12.8 22.301 12.682 22.492-.117.19-4.776.303-10.352.249-5.575-.054-56.26-.143-112.63-.198z\"/><path fill=\"#64b5f6\" d=\"M23.046 238.939c-6.098 10.563-6.69 11.711-6.224 12.078.282.224 3.18 5.044 6.44 10.712s6.016 10.355 6.123 10.417c.106.061 13.585.153 29.95.204 16.367.052 29.994.23 30.285.399.473.273-1.08 3.094-14.637 26.574l-15.166 26.269 12.907 21.865c7.1 12.026 12.982 21.906 13.068 21.956s23.257-39.831 51.492-88.624c11.352-19.617 21.214-36.64 30.37-52.442 23.308-40.452 30.68-53.468 30.73-54.132-1.096-.11-6.141-.187-13.006-.216-3.945-.01-7.82-.02-12.75-.002l-25.341.092-15.42 26.706c-14.256 24.693-15.445 26.663-16.278 26.86l-.023.037c-.012.003-1.622-.001-1.826 0-4.29.062-20.453.063-40.226-.01-22.632-.082-41.615-.125-42.183-.096-.567.03-1.147-.03-1.29-.132-.141-.102-3.29 5.066-6.996 11.485zm205.16-190.3c-.123.149 5.62 10.392 12.761 22.763 12.2 21.131 89.393 155.03 96.276 167 1.503 2.613 2.92 4.803 3.443 5.348.9-1.249 3.532-5.63 7.954-13.219a1343 1343 0 0 1 10.05-17.76l6.606-11.443c.691-1.403.753-1.818.652-2.117-.161-.48-6.903-12.332-14.982-26.337-8.078-14.005-14.824-25.849-14.99-26.32a.73.73 0 0 1-.01-.366l-.426-.913 21.636-36.976c3.69-6.307 6.425-11.042 9.471-16.29 9.158-15.948 12.036-21.189 11.895-21.55-.126-.324-2.7-4.83-5.72-10.017-3.021-5.185-5.845-10.148-6.275-11.026-.483-.987-.734-1.364-1.1-1.456-.054.014-.083.018-.144.035-.42.112-5.455.195-11.19.185s-11.22.024-12.187.073l-1.76.089-14.998 25.978c-12.824 22.212-15.084 25.964-15.595 25.883-.024-.004-.15-.189-.235-.301-.109.066-.2.09-.271.05-.256-.148-7.144-11.902-15.306-26.119L279.4 48.817c-.116-.186-.444-.744-.458-.752-.476-.275-50.502.287-50.737.57zm-18.646 283.09c-.047.109-.026.262.043.48.328 1.05 25.338 43.735 25.772 43.985.206.119 14.178.239 31.05.266 26.65.044 30.749.152 31.234.832.307.43 9.987 17.214 21.513 37.296s21.152 36.627 21.394 36.767 5.926.243 12.633.23c6.705-.013 12.4.099 12.657.246.131.076.381-.141.851-.795l6.008-10.406c5.234-9.065 6.62-11.684 6.294-11.888-.575-.36-15.597-26.643-23.859-41.482-3.09-5.45-5.37-9.516-5.44-9.774-.196-.712-.066-.822 1.155-.98 1.956-.252 57.397-.057 58.071.205.237.092.79-.569 2.593-3.497 1.866-3.067 5.03-8.524 11.001-18.866 7.22-12.505 13.043-22.784 12.941-22.843s-.77-.051-1.489.016l-.046.001c-4.451.204-33.918.203-149.74.025-38.96-.06-69.786-.09-71.912-.072-1.12.01-2.095.076-2.66.172a.3.3 0 0 0-.062.083z\"/></g></svg>", Fo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#8bc34a\" d=\"M16 20.003v2h4a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2v-2h4v-2h-4a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v2Z\"/><path fill=\"#8bc34a\" d=\"m16 3.003-12 7v14l4 2h6v-13.5a.5.5 0 0 0-.5-.5h-1a.5.5 0 0 0-.5.5v11.5H8l-2-1.034V11.15l10-5.833 10 5.833v11.703l-10 5.833-1.745-1.022L13 29.253l3 1.75 12-7v-14Z\"/></svg>", Io = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e53935\" d=\"M4 4v24h24V4Zm20 20h-4V12h-4v12H8V8h16Z\"/></svg>", Lo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M19.563 22A5.57 5.57 0 0 1 14 16.437v-2.873A5.57 5.57 0 0 1 19.563 8H24V2h-4.437A11.563 11.563 0 0 0 8 13.563v2.873A11.564 11.564 0 0 0 19.563 28H24v-6Z\"/></svg>", Ro = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffab40\" d=\"M28 14v-4h-2v4h-6v-4h-2v4h-4v2h4v4h2v-4h6v4h2v-4h4v-2z\"/><path fill=\"#ffab40\" d=\"M13.563 22A5.57 5.57 0 0 1 8 16.437v-2.873A5.57 5.57 0 0 1 13.563 8H18V2h-4.437A11.563 11.563 0 0 0 2 13.563v2.873A11.564 11.564 0 0 0 13.563 28H18v-6Z\"/></svg>", zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path d=\"m12.019 15.021.003-.008c-.005-.021-.006-.026-.003.008\"/><path fill=\"#ff9800\" d=\"M4.51 3.273a2.523 2.523 0 0 0-2.524 2.523V11.3c.361-.13.88-.898 1.043-1.085.285-.327.337-.743.478-1.006C3.83 8.612 3.886 8.2 4.62 8.2c.342 0 .478.08.71.39.16.216.438.615.568.882.15.307.396.724.503.808q.122.095.233.137c.119.044.218-.037.297-.1.102-.082.145-.247.24-.467.135-.317.283-.697.367-.83.146-.23.195-.501.352-.633.232-.195.535-.208.618-.225.466-.092.677.225.907.43.15.133.355.403.5.765.114.283.26.544.32.707.059.158.203.41.289.713.077.275.286.486.365.616 0 0 .121.34.858.65.16.067.482.176.674.246.32.116.63.101 1.025.054.281 0 .434-.408.562-.734.075-.193.148-.745.197-.902.048-.153-.064-.27.031-.405.112-.156.178-.164.242-.368.138-.436.936-.458 1.384-.458.374 0 .327.363.96.239.364-.072.714.046 1.1.149.324.086.63.184.812.398.119.139.412.834.113.863.029.035.05.099.104.134-.067.262-.357.075-.518.041-.217-.045-.37.007-.583.101-.363.162-.894.143-1.21.407-.27.223-.269.721-.394 1 0 0-.348.895-1.106 1.443-.194.14-.574.477-1.4.605a5.3 5.3 0 0 1-1.1.043c-.186-.009-.362-.018-.549-.02-.11-.002-.48-.013-.461.022l-.041.103.024.138c.015.083.019.149.022.225.006.157-.013.32-.005.478.017.328.138.627.154.958.017.368.199.758.375 1.059.067.114.169.128.213.269.052.161.003.333.028.505.1.668.292 1.366.592 1.97l.008.014c.371-.062.743-.196 1.226-.267.885-.132 2.115-.064 2.906-.138 2-.188 3.085.82 4.882.407V5.796a2.523 2.523 0 0 0-2.523-2.523zm-.907 11.144q-.022 0-.046.003c-.159.025-.313.08-.412.24-.08.13-.108.355-.164.505-.064.175-.176.338-.274.505-.18.305-.504.581-.644.879-.028.06-.053.13-.076.2v3.402c.163.028.333.062.524.113 1.407.375 1.75.407 3.13.25l.13-.018c.105-.22.187-.968.255-1.2.054-.178.127-.32.155-.5.026-.173-.003-.337-.017-.493-.04-.393.285-.533.44-.87.14-.304.22-.651.336-.963.11-.298.284-.721.579-.872-.036-.041-.617-.06-.772-.076a5 5 0 0 1-.5-.07c-.314-.064-.656-.126-.965-.2a10 10 0 0 1-.947-.328c-.298-.138-.503-.497-.732-.507m5.737.83c-.74.149-.97.876-1.32 1.451-.192.319-.396.59-.548.928-.14.312-.128.657-.368.924a2.55 2.55 0 0 0-.528.922c-.023.067-.088.776-.158.943l1.101-.078c1.026.07.73.464 2.332.378l2.529-.078a7 7 0 0 0-.228-.588c-.07-.147-.16-.434-.218-.56a3.5 3.5 0 0 0-.309-.526c-.184-.215-.227-.23-.28-.503-.095-.473-.344-1.33-.637-1.923-.151-.306-.403-.562-.634-.784-.2-.195-.655-.522-.734-.505z\"/></svg>", Bo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ef5350\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m4.93 10.44c.41.9.93 1.64 1.53 2.15l.41.32c-.87.16-2.07.44-3.34.93l-.11.04.5-1.04c.45-.87.78-1.66 1.01-2.4m6.48 3.81c.18-.18.27-.41.28-.66.03-.2-.02-.39-.12-.55-.29-.47-1.04-.69-2.28-.69l-1.29.07-.87-.58c-.63-.52-1.2-1.43-1.6-2.56l.04-.14c.33-1.33.64-2.94-.02-3.6a.85.85 0 0 0-.61-.24h-.24c-.37 0-.7.39-.79.77-.37 1.33-.15 2.06.22 3.27v.01c-.25.88-.57 1.9-1.08 2.93l-.96 1.8-.89.49c-1.2.75-1.77 1.59-1.88 2.12-.04.19-.02.36.05.54l.03.05.48.31.44.11c.81 0 1.73-.95 2.97-3.07l.18-.07c1.03-.33 2.31-.56 4.03-.75 1.03.51 2.24.74 3 .74.44 0 .74-.11.91-.3m-.41-.71.09.11c-.01.1-.04.11-.09.13h-.04l-.19.02c-.46 0-1.17-.19-1.9-.51.09-.1.13-.1.23-.1 1.4 0 1.8.25 1.9.35M7.83 17c-.65 1.19-1.24 1.85-1.69 2 .05-.38.5-1.04 1.21-1.69zm3.02-6.91c-.23-.9-.24-1.63-.07-2.05l.07-.12.15.05c.17.24.19.56.09 1.1l-.03.16-.16.82z\"/></svg>", Vo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ba68c8\" d=\"M11.057 2.981c.537.735.028 1.653.141 2.472a3.42 3.42 0 0 1-1.03 2.415c-1.414 1.625-3.165 3.038-4.097 5.03a5.28 5.28 0 0 0 1.412 5.847c.706.735 1.54 1.342 2.472 1.738.17.805-1.088.184-1.455 0A6.7 6.7 0 0 1 4.361 16.4a5.44 5.44 0 0 1 .904-5.368c1.272-1.61 3.136-2.543 4.662-3.857.565-.55 1.003-1.3.932-2.119.156-.678-.254-1.469.212-2.09zm-.07 18.929c-.17.198-.467.325-.495.24-.042-.085.212-.127.381-.325.17-.183.127-.522.24-.522.1 0 .043.395-.14.607zm2.16 0c.17.198.453.31.495.24.028-.085-.212-.141-.395-.339-.156-.184-.113-.523-.24-.523-.085 0-.029.41.14.608zm-1.03.48c-.1 0-.071-.296-.071-.65 0-.367-.028-.663.07-.663.085 0 .057.296.057.663 0 .354.014.65-.057.65m-.495-20.765c.34.24.254 2.077.254 3.136 0 1.653.184 3.376-.805 4.916-.96 1.497-2.048 3.108-1.95 4.972.1 1.837.99 3.504 2.148 5.043.664.876-.353.509-.876.085a7.2 7.2 0 0 1-2.755-5.664c.142-1.907 1.597-3.348 2.628-4.803.805-1.13 1.186-1.879 1.215-3.645.028-1.412-.142-3.531.042-3.983.014-.043.07-.1.099-.057m.537 2.232c-.085 0-.043.396.028.72.424 2.26-.198 4.52-.749 6.682a12.77 12.77 0 0 0 .283 7.826c.607 1.568 1.71.791 2.161 1.568.34.593 1.272.198 1.978-.141 2.232-1.102 4.012-3.108 4.11-5.566.029-.494 0-.989-.07-1.497-.283-1.837-1.78-3.065-3.15-4.083-1.215-.89-2.74-1.483-3.659-2.613-.523-.65-.297-1.638-.381-2.458-.043-.452-.255-.042-.382-.268-.084-.127-.14-.17-.17-.17zm.72 3.616c.057 0 .17.071.325.226a20 20 0 0 0 2.161 1.921c1.272.961 2.43 2.091 2.967 3.504.339.875.339 1.836.226 2.74-.184 1.384-1.187 2.444-2.119 3.404-.339.354-1.06.791-1.074.678-.084-.367.763-1.172 1.159-1.695A5.93 5.93 0 0 0 16 10.962c-1.102-1.214-2.317-1.907-2.995-3.08-.14-.253-.183-.409-.113-.409z\"/></svg>", Ho = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1e88e5\" d=\"M12 18.08c-6.63 0-12-2.72-12-6.08s5.37-6.08 12-6.08S24 8.64 24 12s-5.37 6.08-12 6.08m-5.19-7.95c.54 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.58 1.09q-.42.33-1.29.33h-.87l.53-2.76zm-3.5 5.55h1.44l.34-1.75h1.23c.54 0 .98-.06 1.33-.17.35-.12.67-.31.96-.58.24-.22.43-.46.58-.73.15-.26.26-.56.31-.88.16-.78.05-1.39-.33-1.82-.39-.44-.99-.65-1.82-.65H4.59zm7.25-8.33-1.28 6.58h1.42l.74-3.77h1.14c.36 0 .6.06.71.18s.13.34.07.66l-.57 2.93h1.45l.59-3.07c.13-.62.03-1.07-.27-1.36-.3-.27-.85-.4-1.65-.4h-1.27L12 7.35zM18 10.13c.55 0 .91.1 1.09.31.18.2.22.56.13 1.03-.1.53-.29.87-.57 1.09-.29.22-.72.33-1.3.33h-.85l.5-2.76zm-3.5 5.55h1.44l.34-1.75h1.22c.55 0 1-.06 1.35-.17.35-.12.65-.31.95-.58.24-.22.44-.46.58-.73.15-.26.26-.56.32-.88.15-.78.04-1.39-.34-1.82-.36-.44-.99-.65-1.82-.65h-2.75z\"/></svg>", Uo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#e0e0e0\" d=\"M2 22h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zM12 12h8v8h-8z\"/><path fill=\"#ffb300\" d=\"M2 2h8v8H2zm10 0h8v8h-8zm10 0h8v8h-8zm0 10h8v8h-8z\"/></svg>", Wo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#e64a19\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM8 11v2h1v6H8v1h4v-1h-1v-2h2a3 3 0 0 0 3-3 3 3 0 0 0-3-3zm5 2a1 1 0 0 1 1 1 1 1 0 0 1-1 1h-2v-2z\"/></svg>", Go = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#03a9f4\" d=\"M29.07 6H7.677A1.535 1.535 0 0 0 6.24 7.113l-4.2 17.774A.852.852 0 0 0 2.93 26h21.393a1.535 1.535 0 0 0 1.436-1.113L29.96 7.112A.852.852 0 0 0 29.07 6M8.626 23.797a1.4 1.4 0 0 1-1.814-.31l-.007-.009a1.075 1.075 0 0 1 .315-1.599l9.6-6.061-6.102-5.852-.01-.01a1.068 1.068 0 0 1 .084-1.625l.037-.03a1.38 1.38 0 0 1 1.8.07l7.233 6.957a1.1 1.1 0 0 1 .236.739 1.08 1.08 0 0 1-.412.79c-.074.04-.146.119-10.951 6.935ZM24 22.94A1.135 1.135 0 0 1 22.803 24h-5.634a1.061 1.061 0 1 1 .001-2.112h5.633A1.134 1.134 0 0 1 24 22.938Z\"/></svg>", Ko = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#f44336\" d=\"M2 8h4v1H2zm0 6h4v1H2zm9-10h3v1h-3zM2 2h3v1H2z\"/><path fill=\"#f9a825\" d=\"M9 2h3v1H9zm1 4h4v1h-4zm-5 6h1v1H5zm-3-2h6v1H2z\"/><path fill=\"#26a69a\" d=\"M2 12h3v1H2zm7-4h5v1H9zM2 4h4v1H2zm3-2h4v1H5z\"/><path fill=\"#ba68c8\" d=\"M2 6h3v1H2zm7-2h2v1H9zm-1 6h4v1H8z\"/></svg>", qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"m27.777 22.617-.459-.946L18.43 3.26a2.25 2.25 0 0 0-1.914-1.256A2 2 0 0 0 16.379 2a2.23 2.23 0 0 0-1.891 1.042L4.348 19.056a2.2 2.2 0 0 0 .025 2.417l4.957 7.488A2.34 2.34 0 0 0 11.29 30a2.4 2.4 0 0 0 .655-.092l14.387-4.149a2.32 2.32 0 0 0 1.458-1.234 2.21 2.21 0 0 0-.013-1.908m-3.538.604-11.268 3.25 4.075-19.033 7.568 15.671-.376.098Z\"/></svg>", Jo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bfa5\" d=\"M16 27 2 19v-5l14 8z\"/><path fill=\"#ffeb3b\" d=\"m30 14-14 8v5l14-8z\"/><path fill=\"#ff5722\" d=\"M16 6 2 14v5l14-8z\"/><path fill=\"#00e676\" d=\"m30 19-14-8V6l14 8z\"/><path fill=\"#03a9f4\" d=\"M16 27 2 19v-5l14 8z\"/></svg>", Yo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 128 128\"><g transform=\"translate(-.25 -1.71)\"><path fill=\"#ffe0b2\" d=\"M107.4 50.9c-.2-4.4.4-8.3-1.6-11.6-4.8-8.2-16.8-13-40.8-13v.7h-.5.5v-.7c-24 0-36.6 4.8-41.4 13.1-1.9 3.4-1.7 7.2-2 11.6-.2 3.5-1.8 7.2-1.1 11.2.8 5.2 1.1 10.4 1.9 15.2.6 3.9 6 7.2 6.5 10.9 1.4 10.2 12 14.9 36 14.9v.8h-.6.7v-.8c24 0 34.2-4.7 35.5-14.9.5-3.8 5.5-7 6.1-10.9.8-4.8 1.1-10 1.9-15.2.7-4-.9-7.8-1.1-11.3\"/><path fill=\"#ffe0b2\" d=\"M64.6 54.5c4.3.1 7.3 2.8 10.1 5.3 3.3 2.9 8.9 4.9 11.2 7.4s5.3 5 6.4 8.9 1.4 8.9 1.4 10.2.7 1 2.7 0c4.7-2.3 9.9-8.5 9.9-8.5-.6 3.9-5.7 7.4-6.2 11.1C98.9 99.1 89 104 64.5 104h-.1.6\"/><path fill=\"#ffe0b2\" d=\"M80.4 46.7c.9 3.1 4.1 13.6-2.1 10.1 0 0 2.6 1.5 4.2 7.2 1.7 5.7 5.8 6.4 5.8 6.4s6.7 1.3 11.7-3c4.2-3.6 4.9-10 3.1-14.9-1.8-4.8-5-6.3-9.7-7.3-4.7-1.1-14.1-2-13 1.5\"/><circle cx=\"92.3\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"90\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#ffe0b2\" d=\"M78.9 57.7s7.9 5.4 12.2 10.7 4.2 6.3 4.2 6.3l-3.1 1.4s-4.4-8.3-9.8-11.4c-5.5-3.1-6.1-5.7-6.1-5.7zm-14-3.2c-4.3.1-7.5 2.8-10.4 5.3-3.3 2.9-9.1 4.9-11.4 7.4s-5.4 5-6.5 8.9-1.5 8.9-1.5 10.2.2 1.4-2.7 0c-4.7-2.2-9.9-8.5-9.9-8.5.6 3.9 5.7 7.4 6.2 11.1C30.1 99.1 40 104 64.5 104h.5\"/><path fill=\"#4e342e\" d=\"M88.1 71.4C83.3 65.5 75.6 60 64.9 60h-.1c-10.7 0-18.4 5.5-23.2 11.4-5 6.1-4.6 8.5-4.6 14.3 0 21 7.4 15 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.7 12.3-17.3.1-5.8.4-8.4-4.6-14.5\"/><path fill=\"#3e2723\" d=\"M64.4 65.2s-.7 9.7-2.1 11.6l2.6-.6z\"/><path fill=\"#3e2723\" d=\"M65.1 65.2s.7 9.7 2.1 11.6l-2.6-.6z\"/><path fill=\"#4e342e\" d=\"M56.7 62.9c-1-2.3 2.6-6 8.3-6.1 5.7 0 9.3 3.7 8.3 6.1S68.7 66 65 66.1c-3.6-.1-7.3-.8-8.3-3.2\"/><path d=\"M65 65.2c0-.4 3.4-.5 5.2-1.7 0 0-3.7 1.2-4.5.7-.8-.4-1-1.6-1-1.6s-.3 1.2-.9 1.6c-.7.4-4.9-.7-4.9-.7s5.6 1.4 5.6 1.7-.1 1.3-.1 2c0 2.5 0 8.7.4 9.2.6.9.4-6.7.4-9.2-.1-.8-.1-1.6-.2-2\"/><path fill=\"#795548\" d=\"M65.2 78.6c1.7 0 4.7 1.2 7.4 3.1-2.6-2.9-5.7-4.9-7.4-4.9-1.8 0-5.6 2.2-8.3 5.4 2.8-2.2 6.4-3.6 8.3-3.6\"/><g fill=\"#3e2723\"><path d=\"M64.5 96.3c-3.8 0-7.5-1.2-10.9-2.1-.7-.2-1.4.3-2.1.1-6.3-2-11.4-5.4-14.5-9.7v1c0 21 7.4 15.1 12.3 17.6 5 2.5 10.2 1.7 15.5 1.7h.1c5.4 0 10.5.7 15.5-1.8 4.9-2.5 12.3 3.6 12.3-17.4 0-.8 0-1.6.1-2.3-2.9 4.7-8.2 8.4-14.8 10.6-.6.2-2-.3-2.6-.2-3.6 1.2-6.8 2.5-10.9 2.5\"/><path d=\"M55 85s-2.5 7.5-.8 10.8l-2.3-1s1.7-7.6 3.1-9.8m19.8 0s2.5 7.5.8 10.8l2.3-1s-1.8-7.6-3.1-9.8\"/></g><path fill=\"#ffe0b2\" d=\"M48.6 46.7c-.9 3.1-4.1 13.6 2.1 10.1 0 0-2.6 1.5-4.2 7.2s-5.8 6.4-5.8 6.4-6.7 1.3-11.7-3c-4.2-3.6-4.9-10-3.1-14.9s5-6.3 9.7-7.3c4.7-1.1 14-2 13 1.5\"/><path d=\"M64.9 76.8c2.7 0 11.1 5.8 11.2 12.9v-.4c0-7.4-6.8-13.3-11.2-13.3s-11.2 6-11.2 13.3v.4c.1-7.1 8.5-12.9 11.2-12.9\"/><g fill=\"#3e2723\"><ellipse cx=\"66.7\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(-14.465 66.71 61.469)\"/><ellipse cx=\"62.4\" cy=\"61.5\" rx=\".8\" ry=\"1.5\" transform=\"rotate(17.235 62.372 61.463)\"/></g><circle cx=\"37.2\" cy=\"58.1\" r=\"8.8\"/><circle cx=\"39.5\" cy=\"54.2\" r=\"2.3\" fill=\"#fafafa\"/><path fill=\"#795548\" d=\"M67.5 58.2c0-.1-2.3 1-2.9 1.1-.6-.1-2.9-1.2-2.9-1.1z\"/><path fill=\"#ffe0b2\" d=\"M50 57.7s-7.9 5.4-12.2 10.7-4.2 6.3-4.2 6.3l3.1 1.4s4.4-8.3 9.8-11.4 6.1-5.7 6.1-5.7z\"/><path fill=\"#ffe0b2\" d=\"M32.7 41.7S30 49.1 24 52.2c0 0 9.4-1.1 8.7-10.5m63.1 0s2.7 7.4 8.7 10.5c0 0-9.4-1.1-8.7-10.5M78.7 55.5s-5.9-6.2-13.8-6.4h.2c-8 .2-13.8 6.4-13.8 6.4 6.9-4.8 12.8-4.7 13.8-4.7-.1 0 6.7-.1 13.6 4.7m-6.9-13s-3-4.2-7-4.3h.2c-3 .1-6.9 4.3-6.9 4.3 3.4-3.3 6.9-3.2 6.9-3.2s3.3-.1 6.8 3.2M37.2 73.2s-4.7 2.3-8.1.9H29c-3-1.7-4.5-6.8-4.5-6.8s3 9 12.7 5.9m54.8 0s4.7 2.3 8.1.9c4-1.7 4.6-6.8 4.6-6.8s-3 9-12.7 5.9\"/><path fill=\"#ffe0b2\" d=\"M42.6 41.2c2.6-.5 6.9-.6 10.3.5 4.3 1.5.8 7 1.7 7.3s2.1-3.8 10.1-3.4c8.1.4 9 4 10.1 3.4s-1.1-10 11-7.8c0 0-12.7-3.4-12.1 5.8 0 0-7.3-5.6-17.5-.6.1 0 2.7-8.6-13.6-5.2m44.3 0c.2 0 .3.1.4.1s-.1-.1-.4-.1M39.1 28.9S28.3 42.5 26.7 47.7c-1.6 5.3-2.8 27-4.2 30.1l-5-21.4 9.2-22.3zm50.8 0s10.8 13.6 12.4 18.8c1.6 5.3 2.8 27 4.2 30.1l5-21.4-9.2-22.3z\"/><path fill=\"#4e342e\" d=\"M89.4 28.9s11.6 9.7 15 20.9 2 24.8 4.6 26.5c3.7 2.4 7.9-11.9 9.3-13.4 2.2-2.4 9.5-8.5 10-9.6s-14.8-17.8-21.5-21.1c-8.1-3.8-18.1-4.1-17.4-3.3\"/><path fill=\"#3e2723\" d=\"M99.3 34.9s13.7 17.5 13.5 39.3l5.5-11.2c-.1 0-4.9-14.3-19-28.1\"/><path fill=\"#4e342e\" d=\"M39.1 28.9s-11.6 9.7-15 20.9-2 24.8-4.6 26.5c-3.7 2.4-7.9-11.9-9.3-13.4C8 60.5.7 54.4.2 53.3S15 35.5 21.7 32.2c8.1-3.8 18.1-4.1 17.4-3.3\"/><path fill=\"#3e2723\" d=\"M29.2 34.9S15.5 52.4 15.7 74.2L10.3 63s4.8-14.3 18.9-28.1\"/><path fill=\"#ffe0b2\" d=\"M21.8 74.6s1 5.4 2.6 7.1.5-1.3.5-1.3-1.7-.9-1.4-7.8-1.7 2-1.7 2m85.3 0s-1 5.4-2.6 7.1-.5-1.3-.5-1.3 1.7-.9 1.4-7.8 1.7 2 1.7 2\"/><g fill=\"#3e2723\"><circle cx=\"54.5\" cy=\"70.5\" r=\".8\"/><circle cx=\"49.9\" cy=\"75.3\" r=\".8\"/><circle cx=\"48.4\" cy=\"70.5\" r=\".8\"/></g><g fill=\"#3e2723\"><circle cx=\"74\" cy=\"70.5\" r=\".8\"/><circle cx=\"78.6\" cy=\"75.3\" r=\".8\"/><circle cx=\"80.1\" cy=\"70.5\" r=\".8\"/></g></g></svg>", Xo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#0288d1\" d=\"M9.86 2A2.86 2.86 0 0 0 7 4.86v1.68h4.29c.39 0 .71.57.71.96H4.86A2.86 2.86 0 0 0 2 10.36v3.781a2.86 2.86 0 0 0 2.86 2.86h1.18v-2.68a2.85 2.85 0 0 1 2.85-2.86h5.25c1.58 0 2.86-1.271 2.86-2.851V4.86A2.86 2.86 0 0 0 14.14 2zm-.72 1.61c.4 0 .72.12.72.71s-.32.891-.72.891c-.39 0-.71-.3-.71-.89s.32-.711.71-.711\"/><path fill=\"#fdd835\" d=\"M17.959 7v2.68a2.85 2.85 0 0 1-2.85 2.859H9.86A2.85 2.85 0 0 0 7 15.389v3.75a2.86 2.86 0 0 0 2.86 2.86h4.28A2.86 2.86 0 0 0 17 19.14v-1.68h-4.291c-.39 0-.709-.57-.709-.96h7.14A2.86 2.86 0 0 0 22 13.64V9.86A2.86 2.86 0 0 0 19.14 7zM8.32 11.513l-.004.004.038-.004zm6.54 7.276c.39 0 .71.3.71.89a.71.71 0 0 1-.71.71c-.4 0-.72-.12-.72-.71s.32-.89.72-.89\"/></svg>", Zo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#1976d2\" d=\"M11.956 4.05c-5.694 0-10.354 3.106-10.354 6.947 0 3.396 3.686 6.212 8.531 6.813v2.205h3.53V17.82c.88-.093 1.699-.259 2.475-.497l1.43 2.692h3.996l-2.402-4.048c1.936-1.263 3.147-3.034 3.147-4.97 0-3.841-4.659-6.947-10.354-6.947m1.584 2.712c4.349 0 7.558 1.45 7.558 4.753 0 1.77-.952 3.013-2.505 3.779a1 1 0 0 1-.228-.156c-.373-.165-.994-.352-.994-.352s3.085-.227 3.085-3.302-3.23-3.127-3.23-3.127h-7.092v7.413c-2.64-.766-4.462-2.392-4.462-4.255 0-2.63 3.52-4.753 7.868-4.753m.156 4.12h2.143s.983-.05.983.974c0 1.004-.983 1.004-.983 1.004h-2.143v-1.977m-.031 4.566h.952c.186 0 .28.052.445.207.135.103.28.3.404.476-.57.073-1.17.104-1.801.104z\"/></svg>", Qo = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#00bcd4\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#00bcd4\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#00bcd4\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#00bcd4\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", $o = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M16 12c7.444 0 12 2.59 12 4s-4.556 4-12 4-12-2.59-12-4 4.556-4 12-4m0-2c-7.732 0-14 2.686-14 6s6.268 6 14 6 14-2.686 14-6-6.268-6-14-6\"/><path fill=\"#0288d1\" d=\"M16 14a2 2 0 1 0 2 2 2 2 0 0 0-2-2\"/><path fill=\"#0288d1\" d=\"M10.458 5.507c2.017 0 5.937 3.177 9.006 8.493 3.722 6.447 3.757 11.687 2.536 12.392a.9.9 0 0 1-.457.1c-2.017 0-5.938-3.176-9.007-8.492C8.814 11.553 8.779 6.313 10 5.608a.9.9 0 0 1 .458-.1m-.001-2A2.87 2.87 0 0 0 9 3.875C6.13 5.532 6.938 12.304 10.804 19c3.284 5.69 7.72 9.493 10.74 9.493A2.87 2.87 0 0 0 23 28.124c2.87-1.656 2.062-8.428-1.804-15.124-3.284-5.69-7.72-9.493-10.74-9.493Z\"/><path fill=\"#0288d1\" d=\"M21.543 5.507a.9.9 0 0 1 .457.1c1.221.706 1.186 5.946-2.536 12.393-3.07 5.316-6.99 8.493-9.007 8.493a.9.9 0 0 1-.457-.1C8.779 25.686 8.814 20.446 12.536 14c3.07-5.316 6.99-8.493 9.007-8.493m0-2c-3.02 0-7.455 3.804-10.74 9.493C6.939 19.696 6.13 26.468 9 28.124a2.87 2.87 0 0 0 1.457.369c3.02 0 7.455-3.804 10.74-9.493C25.061 12.304 25.87 5.532 23 3.876a2.87 2.87 0 0 0-1.457-.369\"/></svg>", es = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 16 16\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M8 1C4.136 1 1 4.136 1 8s3.136 7 7 7 7-3.136 7-7-3.136-7-7-7m1 11H7V7.5h2zm0-6H7V4h2z\"/></svg>", ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#f44336\" d=\"M18.041 3.177c2.24.382 2.879 1.919 2.843 3.527V6.67l-1.013 13.266-13.132.897h.008c-1.093-.044-3.518-.151-3.634-3.545l1.217-2.222 2.462 5.74 2.097-6.77-.045.009.018-.018 6.85 2.186L13.945 9.3l6.53-.409-5.144-4.212 2.71-1.51v.009M3.113 17.252v.017zM6.916 6.874c2.63-2.622 6.033-4.168 7.34-2.844 1.297 1.306-.072 4.523-2.702 7.135-2.666 2.613-6.015 4.248-7.322 2.933-1.306-1.324.036-4.612 2.675-7.224z\"/></svg>", ns = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff7043\" d=\"m30 12-4-2V6h-4l-2-4-4 2-4-2-2 4H6v4l-4 2 2 4-2 4 4 2v4h4l2 4 4-2 4 2 2-4h4v-4l4-2-2-4ZM6 16a9.9 9.9 0 0 1 .842-4H10v8H6.842A9.9 9.9 0 0 1 6 16m10 10a9.98 9.98 0 0 1-7.978-4H16v-2h-2v-2h4c.819.819.297 2.308 1.179 3.37a1.89 1.89 0 0 0 1.46.63h3.34A9.98 9.98 0 0 1 16 26m-2-12v-2h4a1 1 0 0 1 0 2Zm11.158 6H24a2.006 2.006 0 0 1-2-2 2 2 0 0 0-2-2 3 3 0 0 0 3-3q0-.08-.004-.161A3.115 3.115 0 0 0 19.83 10H8.022a9.986 9.986 0 0 1 17.136 10\"/></svg>", rs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ec407a\" d=\"M27.837 5.673a4.33 4.33 0 0 0-2.293-2.701c-2.362-1.261-6.11-1.298-9.548-.092a26.3 26.3 0 0 0-8.76 4.966c-2.752 2.542-3.438 4.925-3.189 6.194.523 2.668 3.274 4.539 5.485 6.042.418.284.822.559 1.175.816-1.429.76-4.261 2.444-5.088 4.248a3.88 3.88 0 0 0-.118 3.332A2.37 2.37 0 0 0 6.869 29.8a5.6 5.6 0 0 0 1.49.2 6.35 6.35 0 0 0 5.19-2.856 6.74 6.74 0 0 0 .864-5.382 7.3 7.3 0 0 1 2.044-.03 3.92 3.92 0 0 1 2.816 1.311 1.82 1.82 0 0 1 .423 1.262 1.55 1.55 0 0 1-.772 1.05c-.234.14-.586.355-.504.803.036.194.198.633.894.512a2.93 2.93 0 0 0 2.145-2.651 4 4 0 0 0-1.197-2.904 5.94 5.94 0 0 0-4.396-1.626 10.6 10.6 0 0 0-2.672.304 20 20 0 0 0-2.203-1.846c-1.712-1.3-3.33-2.529-3.235-4.26.125-2.263 2.468-4.532 6.964-6.744 4.016-1.976 7.254-2.037 8.944-1.438a2 2 0 0 1 1.204.883 2.77 2.77 0 0 1-.36 2.47 9.71 9.71 0 0 1-7.425 4.304 3.86 3.86 0 0 1-3.238-.757c-.278-.302-.593-.645-1.074-.383q-.565.31-.225 1.189a3.9 3.9 0 0 0 2.407 1.92 11.7 11.7 0 0 0 7.128-.671c3.527-1.35 6.681-5.202 5.756-8.787M11.895 24.475a4 4 0 0 1-.192.468 4.5 4.5 0 0 1-.753 1.081 2.83 2.83 0 0 1-2.533 1.107c-.056-.032-.078-.146-.085-.193a3.28 3.28 0 0 1 1.076-2.284 11.3 11.3 0 0 1 2.644-1.933 3.85 3.85 0 0 1-.157 1.754\"/></svg>", is = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#0277bd\" d=\"M105.46 209.517c-7.875 0-13.452-7.521-13.452-15.37v-.327c0-7.848 5.578-13.735 13.452-13.735h164.05c1.476-4.905 2.625-11.446 3.281-17.986h-137.81c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h137.31c-.82-6.54-1.969-13.081-3.773-17.986h-104.01c-7.875 0-14.273-6.05-14.273-13.898s6.398-13.898 14.273-13.898h91.87c-21.327-37.607-60.864-61.315-106.14-61.315-67.918 0-123.04 54.448-123.04 122.3 0 67.856 55.122 123.28 123.04 123.28 46.59 0 87.112-25.507 107.95-63.114h-152.73z\"/></svg>", as = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f44336\" d=\"m6.457 9.894 12.523 5.163-.456 1.211L6 11.105Zm7.02-3.091L26 11.966l-.457 1.21L13.02 8.015ZM6.465 18.885l12.524 5.163-.457 1.21L6.01 20.097Zm7.007-3.086 12.524 5.163-.456 1.21-12.524-5.162Z\"/><path fill=\"#f44336\" d=\"M6 24.07V30l19.997-3.106V20.96zM6 5.11v5.99l20-3.11V2zm0 9.96v5.03l20-3.11v-5.03z\"/></svg>", os = "<svg xmlns=\"http://www.w3.org/2000/svg\" fill=\"none\" viewBox=\"0 0 24 24\"><path d=\"M0 0h24v24H0z\"/><path fill=\"#42a5f5\" d=\"M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1a.6.6 0 0 0-.18-.03c-.17 0-.34.09-.43.25l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1q.09.03.18.03c.17 0 .34-.09.43-.25l2-3.46c.12-.22.07-.49-.12-.64zm-1.98-1.71c.04.31.05.52.05.73s-.02.43-.05.73l-.14 1.13.89.7 1.08.84-.7 1.21-1.27-.51-1.04-.42-.9.68c-.43.32-.84.56-1.25.73l-1.06.43-.16 1.13-.2 1.35h-1.4l-.19-1.35-.16-1.13-1.06-.43c-.43-.18-.83-.41-1.23-.71l-.91-.7-1.06.43-1.27.51-.7-1.21 1.08-.84.89-.7-.14-1.13c-.03-.31-.05-.54-.05-.74s.02-.43.05-.73l.14-1.13-.89-.7-1.08-.84.7-1.21 1.27.51 1.04.42.9-.68c.43-.32.84-.56 1.25-.73l1.06-.43.16-1.13.2-1.35h1.39l.19 1.35.16 1.13 1.06.43c.43.18.83.41 1.23.71l.91.7 1.06-.43 1.27-.51.7 1.21-1.07.85-.89.7zM12 8c-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4-1.79-4-4-4m0 6c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2\"/></svg>", ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><g fill=\"#0288d1\"><path d=\"m5.747 14.046 6.254 8.61 6.252-8.61-6.254 3.807z\"/><path d=\"M11.999 1.343 5.747 11.83l6.252 3.807 6.253-3.807z\"/></g></svg>", cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff4081\" d=\"m24.95 28.948-18-.9a1 1 0 0 1-.95-1V6.906a1 1 0 0 1 .9-.995l18-1.905A1 1 0 0 1 26 5v22.949a1 1 0 0 1-1.05.998Z\"/><path fill=\"#fafafa\" d=\"m20 8.52.19-4.242 3.649-.275.16 4.37a.28.28 0 0 1-.276.283.3.3 0 0 1-.188-.063L22.123 7.52l-1.668 1.23a.29.29 0 0 1-.398-.055A.27.27 0 0 1 20 8.52m-2.128 6.647c0 .487 3.448.25 3.912-.094 0-3.324-1.87-5.073-5.298-5.073-3.421 0-5.345 1.774-5.345 4.436 0 4.642 6.561 4.735 6.561 7.266a1.022 1.022 0 0 1-1.164 1.13c-1.047 0-1.459-.512-1.413-2.242 0-.375-3.984-.494-4.101 0-.308 4.198 2.426 5.41 5.56 5.41C19.619 26 22 24.45 22 21.658c0-4.973-6.653-4.842-6.653-7.31a1.08 1.08 0 0 1 1.243-1.13c.478 0 1.354.08 1.282 1.949\"/></svg>", ls = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 200 200\"><path fill=\"#c0ca33\" d=\"M127.22 155.91c14.639-17.51 16.362-35.594 5.023-69.178-7.176-21.241-19.089-37.603-10.334-50.807 9.33-14.065 29.135-.43 12.63 18.371l3.301 2.296c19.806 2.297 29.566-24.83 14.783-32.58-39.038-20.38-73.197 18.802-58.127 64.155 6.459 19.232 15.501 39.613 8.181 55.831-6.315 13.922-18.515 22.103-26.695 22.39-17.079.862-5.74-38.32 13.922-48.08 1.722-.86 4.162-2.009 1.866-4.88-24.255-2.726-38.464 8.468-46.645 24.113-23.825 45.497 45.21 62.289 82.096 18.37z\"/></svg>", us = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 300 300\"><path fill=\"#ff5722\" d=\"M175.94 24.328c-13.037.252-26.009 3.872-37.471 11.174L79.912 72.818a67.13 67.13 0 0 0-30.355 44.906 70.8 70.8 0 0 0 6.959 45.445 67.2 67.2 0 0 0-10.035 25.102 71.54 71.54 0 0 0 12.236 54.156c23.351 33.41 69.468 43.311 102.81 22.07l58.559-37.158a67.36 67.36 0 0 0 30.355-44.906 70.77 70.77 0 0 0-6.982-45.422 67.65 67.65 0 0 0 10.059-25.102 71.63 71.63 0 0 0-12.236-54.156v-.18c-15.324-21.925-40.453-33.727-65.342-33.246zm5.137 28.68a46.5 46.5 0 0 1 36.09 19.969 42.98 42.98 0 0 1 7.365 32.557 45 45 0 0 1-1.393 5.455l-1.123 3.37-2.986-2.247a75.9 75.9 0 0 0-22.902-11.45l-2.244-.651.201-2.246a13.16 13.16 0 0 0-2.379-8.711 13.99 13.99 0 0 0-14.953-5.412 12.8 12.8 0 0 0-3.594 1.572l-58.578 37.25a12.24 12.24 0 0 0-5.502 8.15 13.1 13.1 0 0 0 2.246 9.834 14.03 14.03 0 0 0 14.93 5.569 13.5 13.5 0 0 0 3.594-1.573l22.453-14.234a41.8 41.8 0 0 1 11.898-5.232 46.48 46.48 0 0 1 49.914 18.502 43.02 43.02 0 0 1 7.363 32.557 40.42 40.42 0 0 1-18.254 27.078l-58.58 37.316a43 43 0 0 1-11.898 5.23A46.545 46.545 0 0 1 82.81 227.14a42.98 42.98 0 0 1-7.341-32.557 38 38 0 0 1 1.39-5.41l1.102-3.37 3.008 2.246a75.9 75.9 0 0 0 22.836 11.361l2.244.65-.201 2.247a13.25 13.25 0 0 0 2.447 8.644 14.03 14.03 0 0 0 15.043 5.569 13.1 13.1 0 0 0 3.592-1.573l58.467-37.316a12.17 12.17 0 0 0 5.502-8.173 12.96 12.96 0 0 0-2.246-9.811 14.03 14.03 0 0 0-15.043-5.568 12.8 12.8 0 0 0-3.592 1.57l-22.453 14.258a42.9 42.9 0 0 1-11.877 5.209 46.52 46.52 0 0 1-49.846-18.5 43.02 43.02 0 0 1-7.297-32.557A40.42 40.42 0 0 1 96.798 96.98l58.646-37.316a42.8 42.8 0 0 1 11.811-5.21 46.5 46.5 0 0 1 13.822-1.444z\"/></svg>", ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffb300\" d=\"M29.168 14.03a2.7 2.7 0 0 0-1.968-.83 2.51 2.51 0 0 0-1.929.8h-4.443l3.078-3.078a2.835 2.835 0 0 0 2.857-2.842 2.6 2.6 0 0 0-.831-1.969 2.82 2.82 0 0 0-2.014-.788 2.67 2.67 0 0 0-1.968.788 2.36 2.36 0 0 0-.812 1.922L18 11.17V6.726a2.51 2.51 0 0 0 .8-1.929 2.7 2.7 0 0 0-.832-1.968 2.745 2.745 0 0 0-3.936 0 2.7 2.7 0 0 0-.832 1.968 2.51 2.51 0 0 0 .8 1.93v4.443l-3.138-3.138a2.36 2.36 0 0 0-.812-1.922 2.66 2.66 0 0 0-1.968-.788 2.83 2.83 0 0 0-2.014.788 2.6 2.6 0 0 0-.831 1.969 2.74 2.74 0 0 0 .831 2.013 2.8 2.8 0 0 0 2.026.829l3.078 3.078H6.729a2.51 2.51 0 0 0-1.929-.8 2.7 2.7 0 0 0-1.968.831 2.745 2.745 0 0 0 0 3.937 2.7 2.7 0 0 0 1.968.832 2.51 2.51 0 0 0 1.929-.8h4.443l-3.078 3.077a2.835 2.835 0 0 0-2.857 2.842 2.6 2.6 0 0 0 .831 1.969 2.82 2.82 0 0 0 2.014.788 2.67 2.67 0 0 0 1.968-.788 2.36 2.36 0 0 0 .812-1.922L14 20.827v4.444a2.51 2.51 0 0 0-.8 1.929 2.784 2.784 0 0 0 4.768 1.968A2.7 2.7 0 0 0 18.8 27.2a2.51 2.51 0 0 0-.8-1.929v-4.444l3.138 3.138a2.36 2.36 0 0 0 .812 1.922 2.66 2.66 0 0 0 1.968.788 2.83 2.83 0 0 0 2.014-.788 2.6 2.6 0 0 0 .831-1.969 2.74 2.74 0 0 0-.831-2.013 2.8 2.8 0 0 0-2.026-.829L20.828 18h4.443a2.51 2.51 0 0 0 1.93.8 2.784 2.784 0 0 0 1.967-4.769Z\"/></svg>", fs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff6e40\" d=\"M17.087 19.721c-2.36 1.36-5.59 1.5-8.86.1a13.8 13.8 0 0 1-6.23-5.32c.67.55 1.46 1 2.3 1.4 3.37 1.57 6.73 1.46 9.1 0-3.37-2.59-6.24-5.96-8.37-8.71-.45-.45-.78-1.01-1.12-1.51 8.28 6.05 7.92 7.59 2.41-1.01 4.89 4.94 9.43 7.74 9.43 7.74.16.09.25.16.36.22.1-.25.19-.51.26-.78.79-2.85-.11-6.12-2.08-8.81 4.55 2.75 7.25 7.91 6.12 12.24-.03.11-.06.22-.05.39 2.24 2.83 1.64 5.78 1.35 5.22-1.21-2.39-3.48-1.65-4.62-1.17\"/></svg>", ps = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zm4 7.5h-4v2h1l-2 1.67L10 13h1v-2H7v2h1l3 2.5L8 18H7v2h4v-2h-1l2-1.67L14 18h-1v2h4v-2h-1l-3-2.5 3-2.5h1z\"/></svg>", ms = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#5c6bc0\" d=\"m2 10 8 4V6L2 2zm10 5 8 4v-8l-8-4zm0 11 8 4v-8l-8-4zm10-14v8l8-4V8z\"/></svg>", hs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ffca28\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#ffca28\"/><path fill=\"#ffca28\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", gs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M20 4v2h-2v4.531l.264.461 7.473 13.078a2 2 0 0 1 .263.992V26a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-.938a2 2 0 0 1 .264-.992l7.473-13.078.263-.46V6h-2V4zm0-2h-8a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2v2L4.527 23.078A4 4 0 0 0 4 25.062V26a4 4 0 0 0 4 4h16a4 4 0 0 0 4-4v-.938a4 4 0 0 0-.527-1.984L20 10V8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2\"/><circle cx=\"17\" cy=\"17\" r=\"1\" fill=\"#0288d1\"/><path fill=\"#0288d1\" d=\"M19.72 20.715a1 1 0 0 0-1.134-.318 5 5 0 0 1-1.18.262 3.95 3.95 0 0 1-1.862-.292 2.74 2.74 0 0 0-3.371.489 2 2 0 0 0-.237.35L10 24h12Z\"/></svg>", _s = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\"><path fill=\"#2196f3\" d=\"M80 192 64 320h32c16-80 16-96 63.242-96H176c8.837 0 16 7.163 16 16v352c0 8.837 0 16-32 16h-32v32h192v-32h-32c-32 0-32-7.163-32-16V240c0-8.837 7.163-16 16-16h16c48 0 48 16 64 96h32l-16-128zm560 0v32c16 0 45.713 0 52.57 16L776 434.666 708.57 592c-6.857 16-52.57 16-68.57 16v32h128v-32s-34.285 0-27.428-16L792 472l51.428 120c3.103 7.24-1.52 16-11.428 16v32h128v-32c-16 0-45.713 0-52.57-16L824 397.334 891.43 240c6.857-16 52.57-16 68.57-16v-32H832v32s34.285 0 27.428 16L808 360l-51.428-120c-3.103-7.24 1.52-16 11.428-16v-32zM320 384v32h32c32 0 32 7.163 32 16v352c0 8.837 0 16-32 16h-32v32h304l16-128h-32c-16 80-16 96-64 96h-64c-32 0-32-7.163-32-16V624h80c8.837 0 16 0 16 32v16h32V544h-32v16c0 32-7.163 32-16 32h-80V432c0-8.837 0-16 32-16h64c48 0 48 16 64 96h32l-16-128z\"/></svg>", vs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7cb342\" d=\"M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2m-1.667 22.143L6.92 16.73l3.293-3.293 4.12 4.107 7.455-7.44 3.294 3.293Z\"/></svg>", ys = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><path fill=\"#cfd8dc\" d=\"M4 6V4h8v2H9v7H7V6z\"/><path fill=\"#ef5350\" d=\"M4 1v1H2v12h2v1H1V1zm8 0v1h2v12h-2v1h3V1z\"/></svg>", bs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#757575\" d=\"M15 2H6a2.006 2.006 0 0 0-2 2v22a2.006 2.006 0 0 0 2 2h6v-4H6v-2h6v-2H6v-2h6v-2H6v-2h6v-2h2V4l8 8h2v-1Z\" data-mit-no-recolor=\"true\"/><path fill=\"#0288d1\" d=\"M12 12v18h18V12Zm8 6h-2v8h-2v-8h-2v-2h6Zm8 0h-4v2h2a2.006 2.006 0 0 1 2 2v2a2.006 2.006 0 0 1-2 2h-4v-2h4v-2h-2a2.006 2.006 0 0 1-2-2v-2a2.006 2.006 0 0 1 2-2h4Z\"/></svg>", xs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#fbc02d\" d=\"M12 10h10v2H12z\"/><path fill=\"#fbc02d\" d=\"M16 4h2v8h-2zm4 18h10v2H20zm4 2h2v4h-2zm0-20h2v14h-2zM2 18h10v2H2z\"/><path fill=\"#fbc02d\" d=\"M6 18h2v10H6zM6 4h2v10H6zm10 12h2v12h-2z\"/></svg>", Ss = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"><g fill=\"#0288d1\"><path d=\"M2 2v12h12V2zm1 1h10v10H3z\"/><path d=\"M5 7v1h1v4h1V8h1V7zm5 0a1.003 1.003 0 0 0-1 1v1a1.003 1.003 0 0 0 1 1h1v1H9v1h2a1.003 1.003 0 0 0 1-1v-1a1.003 1.003 0 0 0-1-1h-1V8h2V7z\"/></g></svg>", Cs = "<svg xmlns=\"http://www.w3.org/2000/svg\" xml:space=\"preserve\" viewBox=\"0 0 16 16\"><path fill=\"#0288d1\" d=\"M2 2v12h12V2zm4 6h3v1H8v4H7V9H6zm5 0h2v1h-2v1h1a1.003 1.003 0 0 1 1 1v1a1.003 1.003 0 0 1-1 1h-2v-1h2v-1h-1a1.003 1.003 0 0 1-1-1V9a1.003 1.003 0 0 1 1-1\"/></svg>", ws = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ff9800\" d=\"m24 6 2 6h-4l-2-6h-3l2 6h-4l-2-6h-3l2 6H8L6 6H5a3 3 0 0 0-3 3v14a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3V6Z\"/></svg>", Ts = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#43a047\" d=\"M22.19 4H16v4h2.19L12 14.19V8h2V4H2v4h2v20h4v-.01l.01.01L28 8V4z\"/></svg>", Es = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#ab47bc\" d=\"m22 11.8-5.7 4.584L22 20.8zM7.24 23.68 4 21.64v-10.8l3.6-1.2 5.16 3.996L23.2 4 28 7v18.6L22 28l-9.192-8.808zm.36-5.28 2.232-2.064L7.6 14.2Z\"/></svg>", Ds = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#a0f\" d=\"M29.313 12h-6.664a1.427 1.427 0 0 1-1.1-2.24l4.398-6.676A.703.703 0 0 0 25.397 2H8.428a.62.62 0 0 0-.55.289l-5.77 8.627A.703.703 0 0 0 2.658 12h8.175a1.427 1.427 0 0 1 1.099 2.24l-4.48 6.676A.702.702 0 0 0 8 22l6.695.002A1.34 1.34 0 0 1 16 23.375v5.934a.652.652 0 0 0 1.168.433l12.694-16.586a.725.725 0 0 0-.55-1.156\"/></svg>", Os = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#41b883\" d=\"M1.791 3.851 12 21.471 22.209 3.936V3.85H18.24l-6.18 10.616L5.906 3.851z\"/><path fill=\"#35495e\" d=\"m5.907 3.851 6.152 10.617L18.24 3.851h-3.723L12.084 8.03 9.66 3.85z\"/></svg>", ks = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#7c4dff\" d=\"M22 18h4v4h-4z\"/><path fill=\"#7c4dff\" d=\"M20 2a4 4 0 0 1-8 0H2v28h28V2Zm-2 24h-2v2h-4v-2h-2v2H6v-2H4V16h2v10h4V16h2v10h4V16h2Zm10 2h-2v-4h-4v4h-2V18h2v-2h4v2h2Z\"/></svg>", As = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#fafafa\" fill-opacity=\".785\" d=\"m19.376 15.988-7.708 4.45-7.709-4.45v-8.9l7.709-4.451 7.708 4.45z\"/><path fill=\"#90caf9\" d=\"M12.286 1.98c-.21 0-.41.059-.57.179l-7.9 4.44c-.32.17-.53.5-.53.88v9c0 .38.21.711.53.881l7.9 4.44c.16.12.36.18.57.18s.41-.06.57-.18l7.9-4.44c.32-.17.53-.5.53-.88v-9c0-.38-.21-.712-.53-.882l-7.9-4.44a.95.95 0 0 0-.57-.179zm0 2.15 7 3.94v2.103h-.016v5.177h.016v.54l-7 3.939-7-3.94V8.07zm0 2.08-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/><path fill=\"#0277bd\" d=\"m12.286 6.21-4.9 2.83 4.9 2.83 4.9-2.83zm-5 5.08v3.58l4 2.309v-3.58l-4-2.31zm10 0-4 2.308v3.58l4-2.308z\"/></svg>", js = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#01579b\" d=\"M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2m7 1.5V9h5.5zM7 13l1.5 7h2l1.5-3 1.5 3h2l1.5-7h1v-2h-4v2h1l-.9 4.2L13 15h-2l-1.1 2.2L9 13h1v-2H6v2z\"/></svg>", Ms = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#8bc34a\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4c0-1.11.89-2 2-2m.12 13.5 3.74 3.74 1.42-1.41-2.33-2.33 2.33-2.33-1.42-1.41zm11.16 0-3.74-3.74-1.42 1.41 2.33 2.33-2.33 2.33 1.42 1.41z\"/></svg>", Ns = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#ff5252\" d=\"M13 9h5.5L13 3.5zM6 2h8l6 6v12c0 1.1-.9 2-2 2H6c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2m12 16v-2H9v2zm-4-4v-2H6v2z\"/></svg>", Ps = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#0288d1\" d=\"M27.575 23.967a9.9 9.9 0 0 0-3.751 1.726 22.6 22.6 0 0 1-5.537 2.504 1.55 1.55 0 0 1-.931.52 59 59 0 0 1-6.11.548c-1.102.008-1.777-.282-1.965-.735a1.49 1.49 0 0 1 .82-1.965 3.6 3.6 0 0 1-.486-.359c-.163-.162-.334-.487-.385-.367-.213.52-.324 1.794-.897 2.366-.786.795-2.273.53-3.153.069-.965-.513.069-1.718.069-1.718a.69.69 0 0 1-.94-.324 4.6 4.6 0 0 1-.632-2.794 5.2 5.2 0 0 1 1.674-2.76 8.84 8.84 0 0 1 .624-4.17 9.9 9.9 0 0 1 3-3.469S7.136 11.015 7.82 9.177c.444-1.196.623-1.187.769-1.239a3.44 3.44 0 0 0 1.375-.811 4.99 4.99 0 0 1 4.178-1.607s1.094-3.357 2.12-2.7a17.4 17.4 0 0 1 1.452 2.735s1.213-.71 1.35-.445a10.74 10.74 0 0 1 .495 5.81 13.3 13.3 0 0 1-2.46 5.127c-.129.214 1.47.889 2.477 3.683.932 2.554.103 4.699.248 4.938.026.043.034.06.034.06s1.068.085 3.213-1.24a8.05 8.05 0 0 1 4.05-1.52 1.026 1.026 0 0 1 .453 2Z\"/></svg>", Fs = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 32 32\"><path fill=\"#f9a825\" d=\"M2 8h6v4H2zm8 0h12v4H10zm0 12h12v4H10zm14 0h2v4h-2zM8 20l-3 4H2V12h4v8zm14-8h-6l-6 8h6z\"/><path fill=\"#f9a825\" d=\"M16 20h-6l-6 8m12-16h6l6-8m2 4v16h-4V12h-2l3-4z\"/></svg>", Is = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\"><path fill=\"#afb42b\" d=\"M14 17h-2v-2h-2v-2h2v2h2m0-6h-2v2h2v2h-2v-2h-2V9h2V7h-2V5h2v2h2m5-4H5c-1.11 0-2 .89-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2\"/></svg>", Ls = "file", Rs = {
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
}, zs = {
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
}, Bs = new Map(Object.entries(/* @__PURE__ */ Object.assign({
	"./icons/asciidoc.svg": ba,
	"./icons/assembly.svg": xa,
	"./icons/astro.svg": Sa,
	"./icons/audio.svg": Ca,
	"./icons/bicep.svg": wa,
	"./icons/c.svg": Ta,
	"./icons/cabal.svg": Ea,
	"./icons/certificate.svg": Da,
	"./icons/clojure.svg": Oa,
	"./icons/cmake.svg": ka,
	"./icons/console.svg": Aa,
	"./icons/cpp.svg": ja,
	"./icons/crystal.svg": Ma,
	"./icons/csharp.svg": Na,
	"./icons/css.svg": Pa,
	"./icons/dart.svg": Fa,
	"./icons/database.svg": Ia,
	"./icons/diff.svg": La,
	"./icons/dll.svg": Ra,
	"./icons/docker.svg": za,
	"./icons/document.svg": Ba,
	"./icons/editorconfig.svg": Va,
	"./icons/elixir.svg": Ha,
	"./icons/elm.svg": Ua,
	"./icons/erlang.svg": Wa,
	"./icons/eslint.svg": Ga,
	"./icons/exe.svg": Ka,
	"./icons/file.svg": qa,
	"./icons/font.svg": Ja,
	"./icons/fsharp.svg": Ya,
	"./icons/git.svg": Xa,
	"./icons/github-actions-workflow.svg": Za,
	"./icons/gitlab.svg": Qa,
	"./icons/go-mod.svg": $a,
	"./icons/go.svg": eo,
	"./icons/gradle.svg": to,
	"./icons/graphql.svg": no,
	"./icons/groovy.svg": ro,
	"./icons/h.svg": io,
	"./icons/handlebars.svg": ao,
	"./icons/haskell.svg": oo,
	"./icons/hcl.svg": so,
	"./icons/hex.svg": co,
	"./icons/hpp.svg": lo,
	"./icons/html.svg": uo,
	"./icons/image.svg": fo,
	"./icons/jar.svg": po,
	"./icons/java.svg": mo,
	"./icons/javaclass.svg": ho,
	"./icons/javascript.svg": go,
	"./icons/json.svg": _o,
	"./icons/julia.svg": vo,
	"./icons/jupyter.svg": yo,
	"./icons/key.svg": bo,
	"./icons/kotlin.svg": xo,
	"./icons/kubernetes.svg": So,
	"./icons/less.svg": Co,
	"./icons/license.svg": wo,
	"./icons/lock.svg": To,
	"./icons/log.svg": Eo,
	"./icons/lua.svg": Do,
	"./icons/makefile.svg": Oo,
	"./icons/markdown.svg": ko,
	"./icons/maven.svg": Ao,
	"./icons/mdx.svg": jo,
	"./icons/nginx.svg": Mo,
	"./icons/nim.svg": No,
	"./icons/nix.svg": Po,
	"./icons/nodejs.svg": Fo,
	"./icons/npm.svg": Io,
	"./icons/objective-c.svg": Lo,
	"./icons/objective-cpp.svg": Ro,
	"./icons/ocaml.svg": zo,
	"./icons/pdf.svg": Bo,
	"./icons/perl.svg": Vo,
	"./icons/php.svg": Ho,
	"./icons/pnpm.svg": Uo,
	"./icons/powerpoint.svg": Wo,
	"./icons/powershell.svg": Go,
	"./icons/prettier.svg": Ko,
	"./icons/prisma.svg": qo,
	"./icons/proto.svg": Jo,
	"./icons/pug.svg": Yo,
	"./icons/python.svg": Xo,
	"./icons/r.svg": Zo,
	"./icons/react.svg": Qo,
	"./icons/react_ts.svg": $o,
	"./icons/readme.svg": es,
	"./icons/ruby.svg": ts,
	"./icons/rust.svg": ns,
	"./icons/sass.svg": rs,
	"./icons/sbt.svg": is,
	"./icons/scala.svg": as,
	"./icons/settings.svg": os,
	"./icons/solidity.svg": ss,
	"./icons/storybook.svg": cs,
	"./icons/stylus.svg": ls,
	"./icons/svelte.svg": us,
	"./icons/svg.svg": ds,
	"./icons/swift.svg": fs,
	"./icons/table.svg": ps,
	"./icons/terraform.svg": ms,
	"./icons/test-js.svg": hs,
	"./icons/test-ts.svg": gs,
	"./icons/tex.svg": _s,
	"./icons/todo.svg": vs,
	"./icons/toml.svg": ys,
	"./icons/tsconfig.svg": bs,
	"./icons/tune.svg": xs,
	"./icons/typescript-def.svg": Ss,
	"./icons/typescript.svg": Cs,
	"./icons/video.svg": ws,
	"./icons/vim.svg": Ts,
	"./icons/visualstudio.svg": Es,
	"./icons/vite.svg": Ds,
	"./icons/vue.svg": Os,
	"./icons/webassembly.svg": ks,
	"./icons/webpack.svg": As,
	"./icons/word.svg": js,
	"./icons/xml.svg": Ms,
	"./icons/yaml.svg": Ns,
	"./icons/yarn.svg": Ps,
	"./icons/zig.svg": Fs,
	"./icons/zip.svg": Is
})).map(([e, t]) => [e.slice(8, -4), t]));
function Vs(e) {
	let t = e.slice(e.lastIndexOf("/") + 1).toLowerCase(), n = Rs[t];
	if (n) return n;
	let r = t.split(".");
	for (let e = 1; e < r.length; e++) {
		let t = zs[r.slice(e).join(".")];
		if (t) return t;
	}
	return Ls;
}
var Hs = /* @__PURE__ */ new Map(), Us = (e) => {
	let t = Hs.get(e);
	if (t) return t;
	let n = Bs.get(e) ?? Bs.get("file") ?? "", r = `data:image/svg+xml,${encodeURIComponent(n)}`;
	return Hs.set(e, r), r;
};
function Ws({ path: e, size: t = 16, className: n }) {
	return /* @__PURE__ */ J("img", {
		src: Us(Vs(e)),
		alt: "",
		"aria-hidden": !0,
		width: t,
		height: t,
		className: d("shrink-0", n)
	});
}
//#endregion
//#region src/app/atoms/fork-session-item/index.tsx
function Gs(e) {
	return e.replace(/-/g, "").slice(0, 12);
}
var Ks = ({ sessionId: e, title: t, deleted: n = !1, onOpen: r, onDismiss: i }) => {
	let a = n ? "No fork found" : t?.trim() || "Fork", o = `ID: ${Gs(e)}`;
	return n ? /* @__PURE__ */ J("div", {
		className: d("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] max-w-[540px]", "border-l-2 border-tertiary bg-elevation-sublevel-variant-A text-basic-tertiary"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ J(z, {
						iconName: V.Scheme,
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
						children: /* @__PURE__ */ J(z, {
							iconName: V.Close,
							size: 20
						})
					}) : /* @__PURE__ */ J(z, {
						iconName: V.Close,
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
		className: d("flex items-start gap-4 w-full min-w-0 pl-4 pr-2 py-4 rounded-r-[4px] text-left max-w-[540px]", "border-l-2 border-accent-primary bg-btn-ghost-accent-highlighted text-btn-accent", "hover:bg-btn-ghost-accent-highlighted-hovered", "active:bg-btn-ghost-accent-highlighted-pressed"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 items-start min-w-0",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex gap-1.5 items-start min-w-0",
				children: [
					/* @__PURE__ */ J(z, {
						iconName: V.Scheme,
						size: 20,
						className: "shrink-0"
					}),
					/* @__PURE__ */ J("span", {
						className: "header-micro",
						children: a
					}),
					/* @__PURE__ */ J(z, {
						iconName: V.Right,
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
}, qs = ({ icon: e, title: t, description: n, onClick: r, className: i = "" }) => /* @__PURE__ */ Y("button", {
	type: "button",
	onClick: r,
	className: d("group relative flex h-[100px] w-full flex-col items-start overflow-hidden", "rounded-[4px] bg-elevation-level-1 text-left shadow-convex", "focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--blue-500)]", i),
	children: [
		/* @__PURE__ */ J("span", {
			"aria-hidden": !0,
			className: "absolute inset-0 bg-btn-ghost transition-colors duration-200 ease-out group-hover:bg-btn-ghost-hovered group-active:bg-btn-ghost-pressed"
		}),
		/* @__PURE__ */ Y("span", {
			className: "relative flex w-full items-center gap-[10px] px-4 pb-2 pt-4",
			children: [/* @__PURE__ */ J(z, {
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
}({}), Js = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Ys = /* @__PURE__ */ function(e) {
	return e.None = "none", e.Icon = "icon", e.Button = "button", e;
}({}), Xs = {
	"input-small": L.Small,
	"input-medium": L.Medium,
	"input-large": L.Large
}, Zs = {
	"input-small": 16,
	"input-medium": 20,
	"input-large": 24
}, Qs = {
	"input-small": "pl-1",
	"input-medium": "pl-2",
	"input-large": "pl-3"
}, $s = {
	"input-small": "pr-1",
	"input-medium": "pr-2",
	"input-large": "pr-3"
}, ec = {
	"input-small": "pl-6",
	"input-medium": "pl-9",
	"input-large": "pl-12"
}, tc = {
	"input-small": "pr-7",
	"input-medium": "pr-11",
	"input-large": "pr-14"
}, nc = {
	"input-small": "top-1 left-1",
	"input-medium": "top-2 left-2",
	"input-large": "top-3 left-3"
}, rc = {
	"input-small": "top-1 right-1",
	"input-medium": "top-2 right-2",
	"input-large": "top-3 right-3"
}, Z = ({ inputSize: e = "input-large", leading: t = "none", leadingOnClick: n, leadingSlot: r, trailing: i = "none", trailingOnClick: a, leadingIconName: o = V.Add, trailingIconName: s = V.Search, inputClassName: c = "", label: l = "", required: u = !1, rounded: f = !1, placeholder: p = "", isDisabled: m = !1, validation: h = !1, validationText: g = "", hintText: _, className: v = "", ref: y, ...b }) => {
	let x = d("w-full input font-normal", e, c, f ? "rounded-full" : "rounded-[4px]", t === "none" && !r ? Qs[e] : ec[e], i === "none" ? $s[e] : tc[e], m && "input-disabled", h && "input-validation"), S = m ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)";
	return /* @__PURE__ */ J(fa, {
		label: l,
		required: u,
		validation: h,
		validationText: g,
		hintText: _,
		className: v,
		children: /* @__PURE__ */ Y("div", {
			className: "input-wrapper relative w-full h-fit",
			children: [
				r ? /* @__PURE__ */ J("div", {
					className: d("absolute flex items-center justify-center", nc[e]),
					style: {
						width: Zs[e],
						height: Zs[e]
					},
					children: r
				}) : null,
				!r && t === "icon" ? /* @__PURE__ */ J(z, {
					iconName: o,
					size: Zs[e],
					className: d("absolute", nc[e]),
					color: S
				}) : null,
				!r && t === "button" ? /* @__PURE__ */ J(B, {
					size: Xs[e],
					variant: R.Ghost,
					content: I.Icon,
					onClick: n,
					className: d("input-btn-leading", !f && "rounded-lg"),
					children: /* @__PURE__ */ J(z, { iconName: o })
				}) : null,
				/* @__PURE__ */ J("input", {
					ref: y,
					className: x,
					placeholder: p,
					disabled: m,
					...b
				}),
				i === "icon" ? /* @__PURE__ */ J(z, {
					iconName: s,
					size: Zs[e],
					className: d("absolute", rc[e]),
					color: S
				}) : null,
				i === "button" ? /* @__PURE__ */ J(B, {
					size: Xs[e],
					variant: R.Ghost,
					content: I.Icon,
					onClick: a,
					className: d("input-btn-trailing", !f && "rounded-lg"),
					children: /* @__PURE__ */ J(z, { iconName: s })
				}) : null
			]
		})
	});
};
Z.Size = X, Z.Leading = Js, Z.Trailing = Ys;
//#endregion
//#region src/app/atoms/input/StickyInput.tsx
var ic = /* @__PURE__ */ function(e) {
	return e.Default = "default", e.Search = "search", e;
}({}), ac = ({ variant: e = "default", leading: t = Js.None, leadingOnClick: n, trailing: r = Ys.None, trailingOnClick: i, leadingIconName: a = V.Add, trailingIconName: o = V.Search, inputClassName: s = "", className: c = "", rounded: l = !0, isDisabled: u = !1, validation: f = !1, onClear: p, value: m, ref: h, ...g }) => {
	let _ = e === "search", v = m != null && String(m).length > 0, y = _ ? Js.Icon : t, b = _ ? V.Search : a, x = _ ? v ? Ys.Button : Ys.None : r, S = _ ? V.Close : o, C = _ ? p : i, w = c.includes("flex-grow") || c.includes("flex-1"), T = l ? "rounded-full" : "rounded-[4px]", E = u ? "var(--color-fill-basic-muted)" : "var(--color-fill-btn-secondary)", D = {
		[Js.None]: "pl-3",
		[Js.Icon]: "pl-10",
		[Js.Button]: "pl-12"
	}[y], ee = {
		[Ys.None]: "pr-3",
		[Ys.Icon]: "pr-10",
		[Ys.Button]: "pr-12"
	}[x];
	return /* @__PURE__ */ J("div", {
		className: d("bg-elevation-level-3 shadow-2xl overflow-hidden h-10", w ? "flex w-full" : "inline-flex w-fit", T, c),
		children: /* @__PURE__ */ Y("div", {
			className: "input-wrapper relative w-full h-full",
			children: [
				y === Js.Icon ? /* @__PURE__ */ J(z, {
					iconName: b,
					size: 24,
					className: "absolute top-2 left-2",
					color: E
				}) : null,
				y === Js.Button ? /* @__PURE__ */ J(B, {
					size: L.Large,
					variant: R.Ghost,
					content: I.Icon,
					onClick: n,
					className: "btn-sticky input-btn-leading",
					children: /* @__PURE__ */ J(z, { iconName: b })
				}) : null,
				/* @__PURE__ */ J("input", {
					ref: h,
					className: d("w-full input input-sticky font-normal", T, D, ee, u && "input-disabled", f && "input-validation", s),
					disabled: u,
					value: m,
					...g
				}),
				x === Ys.Icon ? /* @__PURE__ */ J(z, {
					iconName: S,
					size: 24,
					className: "absolute top-2 right-2",
					color: E
				}) : null,
				x === Ys.Button ? /* @__PURE__ */ J(B, {
					size: L.Large,
					variant: R.Ghost,
					content: I.Icon,
					onClick: C,
					"aria-label": _ ? "Clear search" : void 0,
					className: "btn-sticky input-btn-trailing",
					children: /* @__PURE__ */ J(z, { iconName: S })
				}) : null
			]
		})
	});
};
ac.Variant = ic, ac.Leading = Js, ac.Trailing = Ys;
//#endregion
//#region src/app/atoms/input/TextArea.tsx
var oc = /* @__PURE__ */ function(e) {
	return e.Small = "p-2 text-micro", e.Medium = "p-3 text-small", e.Large = "p-4 text-medium", e;
}({}), sc = ({ textAreaSize: e = "p-3 text-small", label: t = "", required: n = !1, isDisabled: r = !1, validation: i = !1, validationText: a = "", hintText: o, className: s = "", textAreaClassName: c = "", ref: l, ...u }) => /* @__PURE__ */ J(fa, {
	label: t,
	required: n,
	validation: i,
	validationText: a,
	hintText: o,
	className: s,
	children: /* @__PURE__ */ J("textarea", {
		ref: l,
		className: d("w-full input font-normal rounded-[4px]", e, r && "input-disabled", i && "input-validation", c),
		disabled: r,
		...u
	})
});
sc.Size = oc;
//#endregion
//#region src/app/atoms/loader/CircularLoader.tsx
var cc = /* @__PURE__ */ function(e) {
	return e.Brand = "stroke-[var(--color-fill-accent-primary)]", e.Neutral = "stroke-[var(--color-fill-basic-primary)]", e.Destructive = "stroke-[var(--color-fill-error-primary)]", e;
}({}), lc = ({ size: e = M.Medium, variant: t = "stroke-[var(--color-fill-basic-primary)]", strokeWidth: n = 2, className: r = "", ...i }) => {
	let a = Qr().replace(/:/g, ""), o = `circular-loader-mask-${a}`, s = `circular-loader-gradient-${a}`, c = 12 - n / 2;
	return /* @__PURE__ */ J("div", {
		className: d("inline-flex w-fit h-fit animate-spin", r),
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
lc.Size = M, lc.Variant = cc;
//#endregion
//#region src/app/atoms/loader/ProgressLoader.tsx
var uc = ({ active: e = !1, className: t = "" }) => /* @__PURE__ */ J("div", {
	className: d("h-px w-full overflow-hidden transition-opacity duration-150", e ? "opacity-100" : "opacity-0", t),
	children: /* @__PURE__ */ J("div", { className: "h-full w-full rounded-full bg-accent-inverse animate-progress" })
}), dc = "M121.021 9.70276e-06C121.635 0.00562721 122.201 0.336563 122.507 0.870577L135.925 24.2549C136.063 24.7077 136.011 25.2039 135.77 25.6245C123.798 46.5422 95.5972 95.432 95.5972 95.432C95.2748 95.7673 94.8263 95.9633 94.35 95.9633C94.35 95.9633 41.4186 95.9998 14.9471 96C14.327 96 13.7541 95.6678 13.4452 95.1289L0.251482 72.1142C-0.109585 71.4843 -0.0743152 70.5531 0.308855 69.8878C0.308855 69.8878 26.8205 24.1272 39.9734 1.1421C40.3239 0.529539 40.9631 0.0326747 41.6869 0.0326651C41.6869 0.0331171 121.021 9.70276e-06 121.021 9.70276e-06ZM17.9867 92.5287H38.3062L28.0888 74.8628L17.9867 92.5287ZM71.4405 92.4921H91.3571L81.3833 75.1488L71.4405 92.4921ZM44.4776 92.3253H64.8395L54.7068 74.6392L44.4776 92.3253ZM94.3943 90.7219L104.699 72.9047H84.1208L94.3943 90.7219ZM31.4008 73.0222L41.4435 90.5842L51.4972 73.0222H31.4008ZM84.704 69.3835H104.622L94.6593 51.9934L84.704 69.3835ZM31.5361 69.3112H51.9053L41.7633 51.595L31.5361 69.3112ZM107.678 67.7382L117.965 49.7693H97.3917L107.678 67.7382ZM98.0384 46.2393H117.945L107.94 28.9421L98.0384 46.2393ZM120.957 44.5242L131.277 26.4965H110.637L120.957 44.5242ZM68.3422 44.1304L78.6021 26.3231H58.0823L68.3422 44.1304ZM110.648 23.0128H131.258L120.976 5.23426L110.648 23.0128ZM58.1921 22.8519H78.4107L68.3014 5.46138L58.1921 22.8519ZM55.0653 21.3342L65.4303 3.50386H44.7004L55.0653 21.3342ZM81.5178 21.3003L91.8827 3.46996H71.1528L81.5178 21.3003Z", fc = "M153.045 9.30753e-05C153.475 0 153.734 0.165348 153.935 0.513892C156.659 5.22122 159.463 9.99634 162.212 14.7289L170.478 0.496114C170.663 0.188622 170.997 1.01676e-06 171.357 0C189.161 0.00012553 206.964 0.0226173 224.768 0.0226173C225.263 0.0226173 225.641 0.126836 225.863 0.498976L234.863 16.1296C235.046 16.4462 235.045 16.8479 234.863 17.1649L208.298 63.4387C208.131 63.7127 207.797 64 207.444 64C207.444 64 171.362 63.9773 153.308 63.9774C152.95 63.9774 152.567 63.7127 152.417 63.4632L144.303 49.3669L136.244 63.3367C136.08 63.5817 135.817 63.9484 135.411 63.9484C135.411 63.9484 96.8361 63.9773 81.4848 63.9773C81.4838 63.9773 81.4828 63.9773 81.4819 63.9773C81.479 63.9773 81.4762 63.9774 81.4734 63.9774C81.1058 63.9774 80.7662 63.7813 80.5831 63.4632L72.7738 49.8976L64.8804 63.4892C64.6968 63.8053 64.3583 64 63.9921 64C63.9921 64 27.959 63.9802 9.97191 63.9803C9.6043 63.9803 9.26474 63.7841 9.08163 63.4661L0.136438 47.9273C-0.0460772 47.6102 -0.0454374 47.2201 0.138117 46.9037C0.13793 46.9037 26.9095 0.698576 26.9095 0.698576C27.1378 0.308359 27.4681 0.0248531 27.9419 0.0248511C45.8728 0.0248511 81.7347 0 81.7347 0C82.1599 1.62705e-08 82.6177 0.296445 82.8391 0.692247L90.6841 14.2006L98.6433 0.496114C98.8288 0.188622 99.1624 1.01676e-06 99.5229 0C117.363 0.000125786 135.204 2.31608e-05 153.045 9.30753e-05ZM48.0609 61.9748H61.9268L54.9897 49.9265L48.0609 61.9748ZM191.465 61.9508H205.669L198.567 49.6279L191.465 61.9508ZM11.7777 61.9311H26.0793L18.9273 49.4798L11.7777 61.9311ZM83.2587 61.9282H97.5671L90.4129 49.5006L83.2587 61.9282ZM101.147 61.9282H115.448L108.296 49.4771L101.147 61.9282ZM29.906 61.7949H43.9006L36.9004 49.6222L29.906 61.7949ZM119.275 61.7921H133.27L126.269 49.6193L119.275 61.7921ZM63.9921 60.9321L71.1556 48.5974H56.8286L63.9921 60.9321ZM99.3581 60.8662L106.512 48.4386H92.2039L99.3581 60.8662ZM135.263 60.8448L142.361 48.5974H128.218L135.263 60.8448ZM27.8172 60.7005L34.7728 48.6002H20.7913L27.8172 60.7005ZM207.524 60.6894L214.566 48.4386H200.481L207.524 60.6894ZM20.8834 46.3924H35.0459L27.9937 34.1242L20.8834 46.3924ZM182.087 46.3895H196.249L189.197 34.1219L182.087 46.3895ZM164.037 46.3895H178.359L171.198 34.0343L164.037 46.3895ZM57.0693 46.2307H70.9708L64.0186 34.1364L57.0693 46.2307ZM128.29 46.2307H142.191L135.239 34.1364L128.29 46.2307ZM200.484 46.1626H214.258L207.38 34.1969L200.484 46.1626ZM180.223 45.5056L187.395 33.0359H173.05L180.223 45.5056ZM198.194 45.3711L205.285 33.0359H191.041L198.194 45.3711ZM216.337 45.3669L223.425 33.0359H209.23L216.337 45.3669ZM144.355 45.1453L151.299 33.0359H137.389L144.355 45.1453ZM72.8971 44.7322L79.6799 33.0359H66.1684L72.8971 44.7322ZM65.8535 30.9867H79.973L72.9494 18.7682L65.8535 30.9867ZM101.228 30.9867H115.536L108.378 18.7232L101.228 30.9867ZM137.09 30.9867H151.194L144.196 18.813L137.09 30.9867ZM173.063 30.9867H187.369L180.212 18.7239L173.063 30.9867ZM191.078 30.9867H205.279L198.165 18.6904L191.078 30.9867ZM209.219 30.9867H223.294L216.257 18.7753L209.219 30.9867ZM45.8569 29.9615L52.9107 17.7693H38.8302L45.8569 29.9615ZM207.059 29.9591L214.112 17.7693H200.034L207.059 29.9591ZM153.161 29.9309L160.23 17.6333H146.019L153.161 29.9309ZM117.363 29.9065L124.388 17.7693H110.287L117.363 29.9065ZM189.197 29.9058L196.222 17.7693H182.121L189.197 29.9058ZM225.16 29.8901L232.198 17.6787H218.122L225.16 29.8901ZM81.7234 29.5569L88.6482 17.6333H74.7987L81.7234 29.5569ZM38.6257 15.587H52.7652L45.7468 3.38717L38.6257 15.587ZM74.7873 15.5841H89.1142L81.9508 3.24932L74.7873 15.5841ZM146.008 15.5841H160.335L153.171 3.24932L146.008 15.5841ZM217.88 15.4026H232.084L224.982 3.0797L217.88 15.4026ZM164.21 15.3754L174.931 9.22166L171.357 3.06792L164.21 15.3754ZM92.4047 15.3247L103.071 9.17803L99.5229 3.06792L92.4047 15.3247ZM215.969 14.4006L223.101 2.07176H208.836L215.969 14.4006ZM54.7173 14.3916L61.9217 2.04914H47.5129L54.7173 14.3916ZM144.055 14.3915L151.259 2.04905H136.85L144.055 14.3915ZM36.917 14.3898L43.9936 2.07399H29.7281L36.917 14.3898ZM176.746 8.2023L187.531 2.04914H173.155L176.746 8.2023ZM104.85 8.15332L115.695 2.0491H101.305L104.85 8.15332Z", pc = ({ height: e = 20, markOnly: t = !1, className: n = "" }) => t ? /* @__PURE__ */ J("svg", {
	height: e,
	viewBox: "0 0 136 96",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	className: n,
	role: "img",
	"aria-label": "NAC",
	children: /* @__PURE__ */ J("path", {
		fill: "currentColor",
		d: dc
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
		d: fc
	})
}), mc = /* @__PURE__ */ function(e) {
	return e.Info = "info", e.Error = "error", e.Danger = "danger", e.Success = "success", e;
}({}), hc = /* @__PURE__ */ function(e) {
	return e.Small = "small", e.Medium = "medium", e.Large = "large", e;
}({}), gc = {
	info: "bg-info-primary text-info-primary border-info-primary",
	error: "bg-error-primary text-error-primary border-error-primary",
	danger: "bg-danger-primary text-danger-primary border-danger-primary",
	success: "bg-success-primary text-success-primary border-success-primary"
}, _c = {
	info: V.Info,
	error: V.Danger,
	danger: V.Danger,
	success: V.CheckCircle
}, vc = {
	info: "var(--color-fill-info-primary)",
	error: "var(--color-fill-error-primary)",
	danger: "var(--color-fill-danger-primary)",
	success: "var(--color-fill-success-primary)"
}, yc = {
	small: "p-2 gap-2",
	medium: "p-3 gap-2",
	large: "p-4 gap-3"
}, bc = {
	small: "label-micro",
	medium: "label-small",
	large: "label-medium"
}, xc = {
	small: "text-micro",
	medium: "text-small",
	large: "text-medium"
}, Sc = {
	small: 16,
	medium: 20,
	large: 24
}, Cc = ({ title: e, variant: t = "info", size: n = "small", className: r = "", children: i, ...a }) => /* @__PURE__ */ Y("div", {
	className: d("flex rounded-[4px] border", gc[t], yc[n], r),
	...a,
	children: [/* @__PURE__ */ J(z, {
		iconName: _c[t],
		size: Sc[n],
		color: vc[t],
		className: "shrink-0"
	}), /* @__PURE__ */ Y("div", {
		className: "flex-1 min-w-0 flex flex-col gap-1",
		children: [e ? /* @__PURE__ */ J("div", {
			className: bc[n],
			children: e
		}) : null, i ? /* @__PURE__ */ J("div", {
			className: d("opacity-80", xc[n]),
			children: i
		}) : null]
	})]
});
Cc.Variant = mc, Cc.Size = hc;
//#endregion
//#region src/app/atoms/model-pill/index.tsx
var wc = /* @__PURE__ */ function(e) {
	return e[e.Small = 24] = "Small", e[e.Medium = 32] = "Medium", e;
}({}), Tc = {
	32: 16,
	24: 18
}, Ec = {
	32: M.Large,
	24: M.Small
}, Dc = ({ size: e = 32, active: t = !1, className: n = "", ...r }) => /* @__PURE__ */ Y("div", {
	className: d("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full", "border", t ? "border-transparent" : "border-secondary", n),
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
		/* @__PURE__ */ J(z, {
			iconName: V.Brain,
			size: Tc[e],
			color: "var(--color-fill-basic-primary)",
			className: "relative"
		}),
		t ? /* @__PURE__ */ J(lc, {
			size: Ec[e],
			className: "absolute inset-0 m-auto"
		}) : null
	]
});
Dc.Size = wc;
//#endregion
//#region src/app/atoms/number-input/index.tsx
var Oc = {
	[X.Small]: L.Small,
	[X.Medium]: L.Medium,
	[X.Large]: L.Large
}, kc = (e, t, n) => Math.min(Math.max(e, t), n), Ac = ({ value: e, onChange: t, min: n = 0, max: r = 2 ** 53 - 1, step: i = 1, size: a = X.Medium, disabled: o = !1, className: s = "", "aria-label": c }) => {
	let [l, u] = K(String(e)), [f, p] = K(e);
	f !== e && (p(e), u(String(e)));
	let m = () => {
		let i = Number(l);
		if (l.trim() === "" || Number.isNaN(i)) {
			u(String(e));
			return;
		}
		let a = kc(i, n, r);
		u(String(a)), a !== e && t(a);
	}, h = (i) => {
		let a = kc(e + i, n, r);
		a !== e && t(a);
	};
	return /* @__PURE__ */ Y("div", {
		className: d("flex items-center gap-2 w-fit", s),
		children: [
			/* @__PURE__ */ J(B, {
				variant: R.Secondary,
				size: Oc[a],
				content: I.Icon,
				disabled: o || e <= n,
				"aria-label": "Decrease",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => h(-i),
				children: /* @__PURE__ */ J(z, { iconName: V.Remove })
			}),
			/* @__PURE__ */ J("input", {
				type: "text",
				inputMode: "numeric",
				role: "spinbutton",
				"aria-label": c,
				"aria-valuenow": e,
				"aria-valuemin": n,
				"aria-valuemax": r,
				className: d("input rounded-[4px] text-center w-16 px-1 font-normal", a, o && "input-disabled"),
				value: l,
				disabled: o,
				onChange: (e) => u(e.target.value),
				onBlur: m,
				onKeyDown: (e) => {
					e.key === "Enter" && (e.preventDefault(), m()), e.key === "ArrowUp" && (e.preventDefault(), h(i)), e.key === "ArrowDown" && (e.preventDefault(), h(-i));
				}
			}),
			/* @__PURE__ */ J(B, {
				variant: R.Secondary,
				size: Oc[a],
				content: I.Icon,
				disabled: o || e >= r,
				"aria-label": "Increase",
				onMouseDown: (e) => e.preventDefault(),
				onClick: () => h(i),
				children: /* @__PURE__ */ J(z, { iconName: V.Add })
			})
		]
	});
}, jc = ({ page: e, pageSize: t, totalItems: n, onPageChange: r, itemLabel: i = "items", className: a = "" }) => {
	let o = jr(), s = Math.max(1, Math.ceil(n / t)), c = n === 0 ? 0 : (e - 1) * t + 1, l = Math.min(e * t, n);
	return /* @__PURE__ */ Y("div", {
		className: d("flex items-center w-full gap-4 px-4 py-3", o ? "justify-center" : "justify-between", a),
		children: [o ? null : /* @__PURE__ */ Y("div", {
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
		}), /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-3",
			children: [
				/* @__PURE__ */ J(B, {
					variant: R.Tertiary,
					size: L.Small,
					content: I.Icon,
					disabled: e <= 1,
					"aria-label": "Previous page",
					onClick: () => r(e - 1),
					children: /* @__PURE__ */ J(z, { iconName: V.Left })
				}),
				/* @__PURE__ */ Y("div", {
					className: "label-small text-basic-secondary",
					children: [
						"Page ",
						e,
						" of ",
						s
					]
				}),
				/* @__PURE__ */ J(B, {
					variant: R.Tertiary,
					size: L.Small,
					content: I.Icon,
					disabled: e >= s,
					"aria-label": "Next page",
					onClick: () => r(e + 1),
					children: /* @__PURE__ */ J(z, { iconName: V.Right })
				})
			]
		})]
	});
}, Mc = 6, Nc = 36;
function Pc(e) {
	let t = String(e ?? ""), n = 2166136261;
	for (let e = 0; e < t.length; e += 1) n ^= t.charCodeAt(e), n = Math.imul(n, 16777619) >>> 0;
	return n >>> 0;
}
function Fc(e) {
	let t = e >>> 0 || 2654435769;
	return () => (t = (t ^ t << 13) >>> 0, t = (t ^ t >>> 17) >>> 0, t = (t ^ t << 5) >>> 0, t);
}
function Ic(e) {
	return `hsl(${Pc(e) % 360} 75% 50%)`;
}
function Lc(e) {
	let t = e % Mc, n = (e - t) / Mc, r = [];
	return n > 0 && r.push(e - Mc), n < 5 && r.push(e + Mc), t > 0 && r.push(e - 1), t < 5 && r.push(e + 1), r;
}
function Rc(e) {
	let t = Array.from({ length: Nc }, () => !1), n = [];
	for (let e = 0; e < Nc; e += 1) {
		let t = e % Mc, r = (e - t) / Mc;
		(r === 0 || t === 0 || r === 5 || t === 5) && n.push(e);
	}
	let r = 4 + e() % 5, i = 0;
	for (; i < r && n.length > 0;) {
		let r = e() % 2 == 0 ? n.length - 1 : e() % n.length, a = n.splice(r, 1)[0];
		if (!t[a]) {
			t[a] = !0, i += 1;
			for (let e of Lc(a)) !t[e] && !n.includes(e) && n.push(e);
		}
	}
	return t;
}
function zc(e) {
	let t = Fc(Pc(e)), n = Rc(t), r = [];
	for (let e = 0; e < Nc; e += 1) r.push(n[e] ? 0 : t() % 7 < 4 ? 1 : 2);
	return r;
}
var Bc = 40, Vc = 1.5;
function Hc(e) {
	let t = Math.max(1, Vc * e / Bc);
	return t * Mc / (e - t);
}
var Uc = ({ id: e, size: t = 40, isRunning: n = !1, className: r = "", ...i }) => {
	let a = Ic(e), o = zc(e), s = Hc(t), c = s / 2;
	return /* @__PURE__ */ J("svg", {
		className: d("block shrink-0", n && "pulse-dim", r),
		width: t,
		height: t,
		viewBox: `${-c} ${-c} ${Mc + s} ${Mc + s}`,
		fill: "none",
		xmlns: "http://www.w3.org/2000/svg",
		"aria-hidden": "true",
		...i,
		children: o.map((e, t) => e === 0 ? null : /* @__PURE__ */ J("rect", {
			x: t % Mc,
			y: Math.floor(t / Mc),
			width: "1",
			height: "1",
			fill: e === 2 ? a : "none",
			stroke: a,
			strokeWidth: s
		}, t))
	});
}, Wc = /* @__PURE__ */ function(e) {
	return e.Project = "project", e.Orphan = "orphan", e;
}({}), Gc = ({ entityId: e, name: t, variant: n = "project", active: r = !1, running: i = !1, trailing: a, isMobile: o = !1, actions: s, className: c = "", type: l = "button", ...u }) => /* @__PURE__ */ Y("div", {
	className: d("group flex items-center min-w-0 rounded-[4px] hover:bg-btn-ghost-hovered", o ? "h-12 gap-3 px-3 py-2" : "h-9 gap-1.5 px-2 py-1", r && "bg-btn-ghost-highlighted", c),
	children: [
		/* @__PURE__ */ Y("button", {
			type: l,
			className: d("flex flex-1 items-center min-w-0 text-left", o ? "gap-3" : "gap-1.5"),
			...u,
			children: [n === "orphan" ? /* @__PURE__ */ J(Li, {
				size: 24,
				isRunning: i
			}) : /* @__PURE__ */ J(Uc, {
				id: e,
				size: 24,
				isRunning: i,
				className: "rounded-[2px]"
			}), /* @__PURE__ */ J("span", {
				className: d("flex-1 truncate", o ? "text-medium" : "label-small", i ? "text-shimmer-basic" : "text-basic-primary"),
				children: t
			})]
		}),
		a ? /* @__PURE__ */ J("span", {
			className: d("shrink-0 label-micro text-basic-muted", s && !o && "group-hover:hidden group-has-[:focus-visible]:hidden"),
			children: a
		}) : null,
		s ? /* @__PURE__ */ J("div", {
			className: d("items-center shrink-0", o ? "flex gap-3" : "hidden gap-1.5 group-hover:flex group-has-[:focus-visible]:flex"),
			children: s
		}) : null
	]
});
Gc.Variant = Wc;
//#endregion
//#region src/app/atoms/radio/index.tsx
var Kc = ({ checked: e, onChange: t, disabled: n = !1, children: r, className: i = "", ...a }) => /* @__PURE__ */ Y("label", {
	className: d("flex items-start gap-2 w-fit", n ? "cursor-not-allowed opacity-60" : "", i),
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
			className: d("flex items-center justify-center shrink-0 mt-[1px] w-4 h-4 rounded-full border transition-colors duration-150", "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-accent-primary", n ? "bg-btn-secondary-disabled border-muted" : "bg-btn-secondary border-secondary hover:bg-btn-secondary-hovered hover:border-tertiary"),
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
}), qc = 8, Jc = (e, t, n) => Math.min(Math.max(e, t), n), Yc = ({ min: e, max: t, value: n, onChange: r, step: i = 1, disabled: a = !1, label: o, className: s = "" }) => {
	let c = G(null), l = H((a) => {
		let o = Jc(Math.round(a / i) * i, e, t), s = Number(o.toFixed(4));
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
		let a = Jc((n - i.left) / i.width, 0, 1);
		l(e + a * (t - e));
	}, [
		l,
		e,
		t
	]), f = (e) => {
		a || (e.currentTarget.setPointerCapture(e.pointerId), u(e.clientX));
	}, p = (e) => {
		a || e.currentTarget.hasPointerCapture(e.pointerId) && u(e.clientX);
	}, m = (r) => {
		if (a) return;
		let o = r.key === "ArrowLeft" || r.key === "ArrowDown" ? -i : r.key === "ArrowRight" || r.key === "ArrowUp" ? i : 0;
		if (o) {
			r.preventDefault(), l(n + o);
			return;
		}
		r.key === "Home" && (r.preventDefault(), l(e)), r.key === "End" && (r.preventDefault(), l(t));
	}, h = t === e ? 0 : (n - e) / (t - e) * 100, g = qc * (1 - 2 * h / 100);
	return /* @__PURE__ */ Y("div", {
		ref: c,
		role: "slider",
		tabIndex: a ? -1 : 0,
		"aria-label": o ?? "Range",
		"aria-valuemin": e,
		"aria-valuemax": t,
		"aria-valuenow": n,
		"aria-disabled": a,
		className: d("group relative h-1 w-full rounded-full outline-none touch-none select-none", a ? "bg-input-progress-bar-disabled cursor-not-allowed" : "bg-input-progress-bar cursor-auto", s),
		onPointerDown: f,
		onPointerMove: p,
		onKeyDown: m,
		children: [/* @__PURE__ */ J("div", {
			className: d("absolute inset-y-0 left-0 rounded-full", a ? "bg-input-progress-disabled" : "bg-input-progress"),
			style: { width: `${h}%` }
		}), /* @__PURE__ */ J("div", {
			className: d("absolute top-1/2 w-4 h-4 rounded-full shadow-md -translate-y-1/2 -translate-x-1/2", a ? "bg-input-knob-disabled" : "bg-input-knob group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-accent-primary"),
			style: { left: `calc(${h}% + ${g}px)` }
		})]
	});
}, Xc = /* @__PURE__ */ function(e) {
	return e.Large = "btn-large", e.Medium = "btn-medium", e.Small = "btn-small", e;
}({}), Zc = /* @__PURE__ */ function(e) {
	return e.Regular = "btn-ghost", e.Accent = "btn-ghost-accent", e.Destructive = "btn-ghost-destructive", e;
}({}), Qc = ({ size: e = "btn-medium", variant: t = "btn-ghost", active: n = !1, disabled: r, className: i = "", children: a, hoverHint: o, trailing: c, ...l }) => {
	let u = [
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
		className: u,
		disabled: r,
		...l,
		children: [
			a,
			c,
			o ? /* @__PURE__ */ J("span", {
				className: "inline-flex shrink-0",
				onClick: (e) => e.stopPropagation(),
				onMouseDown: (e) => e.stopPropagation(),
				onKeyDown: (e) => e.stopPropagation(),
				children: /* @__PURE__ */ J(sa, {
					title: o.title,
					description: o.description,
					muted: o.muted,
					position: s.CenterRight
				})
			}) : null
		]
	});
};
Qc.Size = Xc, Qc.Variant = Zc;
//#endregion
//#region src/app/atoms/select/index.tsx
var $c = {
	[L.Small]: Xc.Small,
	[L.Medium]: Xc.Medium,
	[L.Large]: Xc.Large
}, el = ({ items: e = [], value: t, onValueChange: n, size: r = L.Medium, itemSize: i, variant: a = R.Secondary, placement: o = s.BottomRight, placeholder: c = "Select...", disabled: l = !1, sticky: u = !1, className: f = "", trailingIcon: p = V.Down, triggerClassName: m = "", panelClassName: h = "", onOpenChange: g }) => {
	let [_, v] = K(!1), y = e.find((e) => e.id === t), b = i ?? $c[r], x = (e) => {
		v(e), g?.(e);
	}, S = (e) => {
		n?.(e), x(!1);
	};
	return /* @__PURE__ */ J(pn, {
		open: _,
		onClose: () => x(!1),
		placement: o,
		size: u ? cn.Fit : "min-w-full",
		sticky: u,
		className: f,
		panelClassName: h,
		content: /* @__PURE__ */ J("div", {
			className: "flex flex-col gap-1 px-2 md:px-0",
			children: e.map((e) => /* @__PURE__ */ Y(Qc, {
				size: b,
				variant: Zc.Regular,
				active: e.id === t,
				hoverHint: e.hoverHint,
				onClick: () => S(e.id),
				children: [e.icon ? /* @__PURE__ */ J(z, { iconName: e.icon }) : null, /* @__PURE__ */ J("span", {
					className: "text-left flex-grow",
					children: e.label
				})]
			}, e.id))
		}),
		children: /* @__PURE__ */ Y(B, {
			variant: a,
			size: r,
			disabled: l,
			content: I.IconRight,
			className: `${m} overflow-hidden max-w-full`,
			onClick: () => !l && x(!_),
			"aria-expanded": _,
			children: [
				y?.icon ? /* @__PURE__ */ J(z, { iconName: y.icon }) : null,
				/* @__PURE__ */ J("span", {
					className: "text-left flex-grow truncate md:max-w-full",
					children: y?.label ?? c
				}),
				/* @__PURE__ */ J(z, {
					iconName: p,
					className: d(p === V.Down && "transition-transform duration-150 ease-out", p === V.Down && (_ ? "rotate-180" : "rotate-0"))
				})
			]
		})
	});
}, tl = "M95 64.7797H79.5544V78.0484H95V96H0V31.2203H61.7894V0H95V64.7797ZM33.2129 93.6586H46.3415V80.3898H33.2129V93.6586ZM48.6585 93.6586H61.7894V80.3898H48.6585V93.6586ZM79.5544 93.6586H92.6829V80.3898H79.5544V93.6586ZM2.31707 78.0484H15.4479V64.7797H2.31707V78.0484ZM17.765 78.0484H30.8936V49.1718H17.765V78.0484ZM33.2106 78.0484H46.3415V64.7797H33.2106V78.0484ZM2.31707 62.4383H15.4479V49.1718H2.31707V62.4383ZM48.6585 62.4383H61.7894V49.1718H48.6585V62.4383ZM64.1064 62.4383H77.235V49.1718H64.1064V62.4383ZM79.5544 62.4383H92.6829V49.1718H79.5544V62.4383ZM17.765 46.8304H30.8936V33.5617H17.765V46.8304ZM33.2129 46.8282H46.3415V33.5617H33.2129V46.8282ZM79.5544 46.8282H92.6829V33.5617H79.5544V46.8282ZM64.1064 31.2203H77.235V17.9516H64.1064V31.2203ZM64.1064 15.6101H77.235V2.34141H64.1064V15.6101ZM79.5544 15.6101H92.6829V2.34141H79.5544V15.6101Z", nl = "M48.6585 17.9516H0V0H48.6585V17.9516ZM2.31707 15.6101H15.4479V2.34141H2.31707V15.6101ZM17.765 15.6101H30.8936V2.34141H17.765V15.6101Z", rl = ({ className: e = "" }) => /* @__PURE__ */ Y("svg", {
	width: 95,
	height: 96,
	viewBox: "0 0 95 96",
	xmlns: "http://www.w3.org/2000/svg",
	className: d("fill-basic-muted", e),
	"aria-hidden": !0,
	children: [/* @__PURE__ */ J("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: tl
	}), /* @__PURE__ */ J("path", {
		fillRule: "evenodd",
		clipRule: "evenodd",
		d: nl
	})]
}), il = /* @__PURE__ */ function(e) {
	return e.Muted = "muted", e.Tertiary = "tertiary", e.Secondary = "secondary", e.Primary = "primary", e;
}({}), al = /* @__PURE__ */ function(e) {
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
Q.Variant = il, Q.Orientation = al;
//#endregion
//#region src/app/atoms/switch/index.tsx
var ol = /* @__PURE__ */ function(e) {
	return e.Medium = "medium", e.Large = "large", e;
}({}), sl = {
	medium: "w-9 h-5",
	large: "w-11 h-6"
}, cl = {
	medium: "w-4 h-4",
	large: "w-5 h-5"
}, ll = {
	medium: "translate-x-4",
	large: "translate-x-5"
}, ul = ({ checked: e = !1, disabled: t = !1, onChange: n, size: r = "medium", className: i = "", ...a }) => /* @__PURE__ */ J("button", {
	type: "button",
	role: "switch",
	"aria-checked": e,
	disabled: t,
	onClick: () => !t && n?.(!e),
	className: d("relative shrink-0 rounded-full transition-colors duration-150", sl[r], t ? "bg-input-switcher-disabled cursor-not-allowed" : e ? "bg-input-switcher-active cursor-auto" : "bg-input-switcher cursor-auto", i),
	...a,
	children: /* @__PURE__ */ J("span", { className: d("absolute top-0.5 left-0.5 rounded-full transition-transform duration-150", cl[r], t ? "bg-input-knob-disabled" : "bg-input-knob", e ? ll[r] : "translate-x-0") })
}), dl = ({ tags: e, selected: t, onChange: n, disabled: r = !1, className: i = "" }) => {
	let a = (e) => {
		n(t.includes(e) ? t.filter((t) => t !== e) : [...t, e]);
	};
	return /* @__PURE__ */ J("div", {
		className: d("flex flex-wrap gap-2", i),
		children: e.map((e) => {
			let n = t.includes(e);
			return /* @__PURE__ */ J(B, {
				size: L.Small,
				variant: n ? R.SecondaryAccent : R.Secondary,
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
function fl({ title: e, pinned: t = !1, onPin: n, onRename: r, onDelete: i }) {
	return /* @__PURE__ */ Y(q, { children: [
		n ? /* @__PURE__ */ J(B, {
			variant: R.Ghost,
			size: L.Small,
			content: I.Icon,
			title: t ? "Unpin chat" : "Pin chat",
			"aria-label": `${t ? "Unpin" : "Pin"} ${e}`,
			onClick: n,
			children: /* @__PURE__ */ J(z, { iconName: t ? V.Unpin : V.Pin })
		}) : null,
		r ? /* @__PURE__ */ J(B, {
			variant: R.Ghost,
			size: L.Small,
			content: I.Icon,
			title: "Rename chat",
			"aria-label": `Rename ${e}`,
			onClick: r,
			children: /* @__PURE__ */ J(z, { iconName: V.Edit })
		}) : null,
		i ? /* @__PURE__ */ J(B, {
			variant: R.GhostDestructive,
			size: L.Small,
			content: I.Icon,
			title: "Delete chat",
			"aria-label": `Delete ${e}`,
			onClick: i,
			children: /* @__PURE__ */ J(z, { iconName: V.Trash })
		}) : null
	] });
}
//#endregion
//#region src/app/components/projects/GroupLabel.tsx
function pl({ children: e, className: t }) {
	return /* @__PURE__ */ Y("div", {
		className: d("flex items-baseline gap-2", t),
		children: [/* @__PURE__ */ J("span", {
			className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
			children: e
		}), /* @__PURE__ */ J(Q, { className: "shrink" })]
	});
}
//#endregion
//#region node_modules/effect/dist/esm/Layer.js
var ml = tr;
//#endregion
//#region src/app/hooks/useSessionTitle.ts
function hl() {
	let { data: e = [] } = Jt(), t = zr(e);
	return (e) => m(e, t);
}
//#endregion
//#region src/app/lib/projects.ts
function gl(e) {
	return e.filter((e) => e.lineage == null);
}
function _l(e, t) {
	let n = t;
	for (let t of gl(e)) Ft(t.summary.updated_at) > Ft(n) && (n = t.summary.updated_at);
	return n;
}
function vl(e, t) {
	return Ft(t.summary.updated_at) - Ft(e.summary.updated_at);
}
function yl(e, t) {
	return gl(e).filter((e) => e.summary.project_id === t).sort(vl)[0] ?? null;
}
function bl(e, t) {
	return gl(e).filter((e) => e.summary.project_id === t).sort((e, t) => Ft(t.summary.created_at) - Ft(e.summary.created_at))[0] ?? null;
}
function xl(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let e of gl(t)) {
		let t = e.summary.project_id;
		if (!t) continue;
		let r = n.get(t);
		r ? r.push(e) : n.set(t, [e]);
	}
	return e.map((e) => {
		let t = (n.get(e.project_id) ?? []).sort(vl);
		return {
			project: e,
			sessions: t,
			running: t.filter((e) => wr(e.active_run)).length,
			totalCostMicros: t.reduce((e, t) => e + (t.summary.total_cost_micros ?? 0), 0),
			updatedAt: _l(t, e.updated_at)
		};
	});
}
function Sl(e) {
	return e.filter((e) => e.lineage == null && !e.summary.project_id).sort((e, t) => S(e.summary, t.summary));
}
function Cl(e) {
	return e.kind === "project" ? e.entry.project.project_id : e.session.summary.session_id;
}
function wl(e, t) {
	return [...xl(e, t).map((e) => ({
		kind: "project",
		entry: e
	})), ...Sl(t).map((e) => ({
		kind: "orphan",
		session: e
	}))];
}
function Tl(e, t) {
	return t ? e.find((e) => e.project_id === t) ?? null : null;
}
function El(e, t) {
	return e.cwd === t.cwd && (e.ssh_host ?? null) === (t.ssh_host ?? null) && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function Dl(e) {
	return {
		cwd: e.cwd,
		ssh_host: e.ssh_host ?? null,
		ssh_port: e.ssh_port ?? null,
		ssh_identity_file: e.ssh_identity_file ?? null
	};
}
function Ol(e, t) {
	return t ? e.find((e) => El(e, t)) ?? null : null;
}
var kl = [
	"Pinned",
	"Today",
	"Yesterday",
	"This week",
	"This month",
	"Older"
];
function Al(e) {
	let t = new Date(e);
	return t.setHours(0, 0, 0, 0), t;
}
function jl(e, t) {
	let n = new Date(e);
	return n.setDate(n.getDate() - t), n.getTime();
}
function Ml(e, t) {
	let n = Ft(e);
	if (!Number.isFinite(n)) return "Older";
	let r = Al(t);
	return n >= r.getTime() ? "Today" : n >= jl(r, 1) ? "Yesterday" : n >= jl(r, 7) ? "This week" : n >= jl(r, 30) ? "This month" : "Older";
}
function Nl(e, t, n) {
	let r = /* @__PURE__ */ new Map();
	for (let i of e) {
		let { updatedAt: e, pinned: a } = t(i), o = a ? "Pinned" : Ml(e, n), s = r.get(o);
		s ? s.push(i) : r.set(o, [i]);
	}
	return kl.flatMap((e) => {
		let t = r.get(e);
		return t && t.length > 0 ? [{
			label: e,
			items: t
		}] : [];
	});
}
//#endregion
//#region src/app/lib/sessionBehavior.ts
var Pl = [
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
function Fl(e) {
	return Pl.find((t) => t.id === e) ?? Pl[0];
}
function Il(e) {
	switch (e) {
		case "direct": return V.Plane;
		case "direct-with-orchestrator": return V.PlaneAdd;
		default: return V.Orchestrator;
	}
}
var Ll = {
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
}, Rl = {
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
}, zl = {
	widePanels: ["files"],
	mobilePanels: ["files", "history"],
	defaultPanel: "files",
	readOnly: !0
}, Bl = {
	...Ll,
	readOnly: !0
};
function Vl(e, t) {
	return t === "traditional-child" ? zl : t === "managed-orchestrator" ? Bl : Fl(e).id === "orchestrator" ? Ll : Rl;
}
//#endregion
//#region src/app/components/projects/ChatSessionList.tsx
var Hl = 6e4;
function Ul({ sessions: e, activeSessionId: t = null, onOpen: n, onRename: r, onDelete: i, onPin: a, isMobile: o = !1, emptyLabel: s = "No chats" }) {
	let c = se(), l = gn(Hl), u = hl(), d = W(() => Nl(e, (e) => ({
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
			children: [/* @__PURE__ */ J(pl, {
				className: "px-2",
				children: e.label
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let s = u(e.summary), l = Fl(e.summary.behavior);
					return /* @__PURE__ */ J(ki, {
						title: s,
						icon: Il(e.summary.behavior),
						badge: c.orchestrationEnabled ? l.navigationLabel : void 0,
						badgeLabel: c.orchestrationEnabled ? l.label : void 0,
						active: e.summary.session_id === t,
						running: wr(e.active_run),
						forkedFromTitle: e.summary.forked_from?.title,
						isMobile: o,
						onClick: () => n(e),
						actions: a || r || i ? /* @__PURE__ */ J(fl, {
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
var Wl = 6e4;
function Gl({ items: e, activeId: t = null, onOpenProject: n, onOpenSession: r, isMobile: i = !1, renderActions: a, emptyLabel: o = "No projects" }) {
	let s = gn(Wl), c = hl(), l = W(() => Nl(e, (e) => e.kind === "project" ? {
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
			children: [/* @__PURE__ */ J(pl, {
				className: i ? "px-3" : "px-2",
				children: e.label
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1",
				children: e.items.map((e) => {
					let o = Cl(e), s = a?.(e);
					return e.kind === "project" ? /* @__PURE__ */ J(Gc, {
						entityId: o,
						name: e.entry.project.name,
						active: o === t,
						running: e.entry.running > 0,
						trailing: String(e.entry.sessions.length),
						isMobile: i,
						actions: s,
						onClick: () => n(o)
					}, o) : /* @__PURE__ */ J(Gc, {
						entityId: o,
						name: c(e.session.summary),
						variant: Wc.Orphan,
						active: o === t,
						running: wr(e.session.active_run),
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
function Kl(e) {
	return Object(e) === e && !Array.isArray(e);
}
//#endregion
//#region src/app/lib/providerError.ts
function $(e) {
	return e instanceof Error || e == null || Ee(e) ? e : Object(e) === e ? { status: e.status } : String(e);
}
var ql = "/api/wallet", Jl = "/admin/workspace/workspace-settings", Yl = "platform.arcee.ai";
function Xl(e) {
	return e instanceof Error ? e.message : String(e);
}
function Zl(e, t) {
	let n = e.match(/https:\/\/[^\s"'),]+/), r = Yl;
	if (n) try {
		let { hostname: e } = new URL(n[0]);
		e.endsWith(".arcee.ai") && /^api\d*\./.test(e) && (r = e.replace(/^api(\d*)\./, "platform$1."));
	} catch {}
	return `https://${r}${t}`;
}
function Ql(e, t) {
	let n = /* @__PURE__ */ new Set();
	for (let t of [
		/HTTP (\d{3})/g,
		/\((\d{3}) [A-Z]/g,
		/"code":\s*(\d{3})/g,
		/status[ _]code["']?[:=]\s*(\d{3})/gi
	]) for (let r of e.matchAll(t)) n.add(Number(r[1]));
	return t !== null && n.add(t), n;
}
function $l(e) {
	let t = e.indexOf("{");
	if (t === -1) return e;
	let n = e.slice(t), r = eu(n) ?? tu(n);
	if (r === null) return e;
	let i = e.slice(0, t).trim().replace(/:$/, "");
	return i ? `${i} — ${r}` : r;
}
function eu(e) {
	try {
		return nu(JSON.parse(e));
	} catch {
		return null;
	}
}
function tu(e) {
	let t = e.match(/"(?:message|detail|error_description)"\s*:\s*"((?:[^"\\]|\\.)*)/);
	if (!t) return null;
	try {
		return JSON.parse(`"${t[1]}"`);
	} catch {
		return t[1];
	}
}
function nu(e) {
	if (Ee(e)) return e;
	if (!Kl(e)) return null;
	for (let t of [
		"message",
		"detail",
		"error",
		"error_description"
	]) {
		let n = nu(e[t]);
		if (n !== null) return n;
	}
	return null;
}
var ru = {
	title: "There was a problem with authentication",
	description: "Please sign back in to continue using the API.",
	fix: {
		kind: "login",
		label: "Sign in again"
	}
};
function iu(e, t) {
	let n = Xl(e), r = cu(e) ? e.status : null, i = n.toLowerCase(), a = (...e) => e.some((e) => i.includes(e)), o = Ql(n, r), s = n.match(/invalid model configuration:\s*(.+)/is);
	if (s) return {
		title: "Configuration needs repair",
		description: ou(s[1]),
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
			url: Zl(n, Jl)
		}
	};
	if (a("insufficient_credits", "insufficient credits", "insufficient_quota", "top up your wallet") || o.has(402)) return {
		title: "Not enough credits for this request",
		description: "The provider reserved more than the remaining balance allows. The wallet can still show a balance. Top up, or retry.",
		fix: {
			kind: "link",
			label: "Open wallet",
			url: Zl(n, ql)
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
	} : ru : a("permission_error") || o.has(403) ? {
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
	} : { title: ou($l(n)) };
}
function au(e, t) {
	let { title: n, description: r } = iu(e, t);
	return r ? `${n}. ${r}` : n;
}
function ou(e) {
	let t = e.trim();
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function su(e) {
	return e != null && !(e instanceof Error) && !Ee(e);
}
function cu(e) {
	return su(e) ? Number.isFinite(e.status) : !1;
}
//#endregion
//#region src/app/components/modals/AssignToProjectModal.tsx
function lu({ open: e, onClose: t, summary: n }) {
	let r = hn(), i = jr(), a = hl(), { data: o } = it(), s = ve(), c = Ve(), [l, u] = K(""), [d, f] = K(null), p = W(() => Ol(o?.projects ?? [], n), [o, n]), m = s.isPending || c.isPending;
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: t,
		title: "Assign to Project",
		size: Mn.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(B, {
			variant: R.Tertiary,
			content: I.Text,
			onClick: t,
			disabled: m,
			children: "Cancel"
		}), /* @__PURE__ */ J(B, {
			variant: R.Primary,
			content: I.Text,
			onClick: async () => {
				if (!(!n || m)) {
					f(null);
					try {
						let e = p ?? await c.mutateAsync({
							name: l.trim() || null,
							...Dl(n)
						});
						await s.mutateAsync({
							projectId: e.project_id,
							sessionId: n.session_id
						}), r.success(`Assigned to ${e.name}`), t();
					} catch (e) {
						f(au($(e)));
					}
				}
			},
			loading: m,
			children: p ? "Assign" : "Create and assign"
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
				p ? /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-3 rounded-[8px] border border-muted p-3",
					children: [/* @__PURE__ */ J(Uc, {
						id: p.project_id,
						size: 32,
						className: "rounded-[4px]"
					}), /* @__PURE__ */ Y("div", {
						className: "flex flex-col min-w-0",
						children: [/* @__PURE__ */ J("span", {
							className: "label-medium text-basic-primary truncate",
							children: p.name
						}), /* @__PURE__ */ J("span", {
							className: "text-micro text-basic-muted truncate",
							children: p.cwd
						})]
					})]
				}) : /* @__PURE__ */ J(q, { children: /* @__PURE__ */ J(Z, {
					label: "Project name",
					inputSize: i ? X.Large : X.Medium,
					placeholder: "Taken from the git remote",
					value: l,
					onChange: (e) => {
						f(null), u(e.target.value);
					}
				}) }),
				d ? /* @__PURE__ */ J("p", {
					className: "text-error-primary text-micro",
					children: d
				}) : null
			]
		})
	});
}
//#endregion
//#region src/app/components/modals/ConfigRow.tsx
var uu = "w-full md:w-[280px]";
function du({ label: e, hint: t, required: n = !1, invalid: r = !1 }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-1 w-full",
		children: [/* @__PURE__ */ Y("div", {
			className: d("label-small", r ? "text-error-primary" : "text-basic-primary"),
			children: [e, n ? "*" : ""]
		}), t ? /* @__PURE__ */ J(sa, {
			title: t,
			position: s.TopCenter
		}) : null]
	});
}
function fu({ label: e, hint: t, required: n = !1, invalid: r = !1, secondary: i = !1, muted: a = !1, verticalOnMobile: o = !1, labelClassName: c = "", control: l }) {
	return /* @__PURE__ */ Y("div", {
		className: d("flex w-full min-h-9 md:flex-row items-center md:justify-between md:min-h-5", o ? "flex-col items-stretch justify-center gap-1" : "flex-row items-center justify-between"),
		children: [/* @__PURE__ */ Y("div", {
			className: d("flex items-center gap-1 min-w-0 md:flex-1 md:max-w-[220px]", o ? "max-w-none" : "flex-1 max-w-[220px]", c),
			children: [/* @__PURE__ */ Y("div", {
				className: d(o ? "md:truncate" : "truncate", i ? "text-small" : "label-small", r ? "text-error-primary" : a ? "text-basic-muted" : i ? "text-basic-secondary" : "text-basic-primary"),
				children: [e, n ? "*" : ""]
			}), t ? /* @__PURE__ */ J(sa, {
				title: t,
				position: s.TopCenter
			}) : null]
		}), /* @__PURE__ */ J("div", {
			className: d("shrink-0", o && "w-full md:w-auto"),
			children: l
		})]
	});
}
//#endregion
//#region src/app/lib/catalog.ts
function pu(e) {
	return e.connection?.base_url ?? e.managed_base_url ?? e.default_base_url ?? "";
}
var mu = "deepseek/deepseek-v4-flash-latest", hu = ["arcee-auth", "arcee-api"];
function gu(e) {
	let t = hu.flatMap((t) => {
		let n = yu(e, t);
		if (!n) return [];
		let r = pu(n);
		return r ? [{
			provider: n,
			baseUrl: r
		}] : [];
	}), n = t.find((e) => e.provider.auth_status === "ready") ?? t[0];
	return n ? {
		backend: n.provider.id,
		model: mu,
		baseUrl: n.baseUrl
	} : null;
}
var _u = {
	provider: null,
	model: null,
	contextWindow: null,
	supportedEfforts: [],
	estimated: !1
};
function vu(e) {
	let t = e.lastIndexOf("-");
	if (t <= 0) return null;
	let n = e.slice(t + 1);
	return n.length === 8 && /^\d{8}$/.test(n) ? e.slice(0, t) : null;
}
function yu(e, t) {
	return e?.providers?.find((e) => e.id === t) ?? null;
}
function bu(e, t) {
	let n = e.models.find((e) => e.id === t);
	if (n) return n;
	let r = vu(t);
	return r ? e.models.find((e) => e.id === r) ?? null : null;
}
function xu(e, t, n) {
	let r = (n ?? "").trim(), i = yu(e, (t ?? "").trim());
	if (!i || !r) return _u;
	let a = bu(i, r);
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
function Su(e, t) {
	let n = t.trim();
	if (!n) return null;
	let r = (e?.providers ?? []).filter((e) => e.models.some((e) => e.id === n));
	if (r.length === 0) return null;
	let i = r.find((e) => e.id === "openai-responses"), a = r.find((e) => e.managed_base_url === null);
	return (i ?? a ?? r[0]).id;
}
//#endregion
//#region src/app/components/modals/catalogModelOverlay.ts
var Cu = {
	input: 0,
	output: 0,
	cache_read: 0,
	cache_write: 0
};
function wu(e, t) {
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
			cost: Cu,
			reasoning: !1,
			supported_efforts: e.default_limits.supported_efforts,
			source: "fallback"
		};
	});
}
//#endregion
//#region src/app/components/modals/CatalogModelPicker.tsx
function Tu(e, t, n) {
	let r = t.trim().toLowerCase(), i = [...e?.providers ?? []].sort((e, t) => {
		let n = e.auth_status === "ready" ? 0 : 1, r = t.auth_status === "ready" ? 0 : 1;
		return n === r ? Bn(e.id) - Bn(t.id) : n - r;
	}), a = [];
	for (let e of i) for (let t of wu(e, n.get(e.id))) r && !`${t.id} ${t.display_name ?? ""} ${e.id}`.toLowerCase().includes(r) || a.push({
		provider: e,
		model: t
	});
	return a;
}
function Eu(e) {
	return Number.isFinite(e) && e > 0 ? `$${Number(e.toFixed(2))}` : null;
}
function Du(e) {
	let t = Eu(e.input), n = Eu(e.output);
	return t && n ? `${t}/${n} per 1M` : "pricing unknown";
}
function Ou(e) {
	return [e.context_window > 0 ? `${on(e.context_window)} ctx` : "", Du(e.cost)].filter(Boolean).join(" · ");
}
var ku = (e) => e.display_name || e.id;
function Au({ provider: e }) {
	return e.auth_status === "ready" ? /* @__PURE__ */ J(Ci, {
		text: "available",
		color: Si.Green,
		className: "shrink-0 whitespace-nowrap"
	}) : /* @__PURE__ */ J(Ci, {
		text: e.managed_base_url ? "login required" : "no credential detected",
		color: Si.Yellow,
		className: "shrink-0 whitespace-nowrap"
	});
}
function ju({ catalog: e, loading: t, failed: n, disabled: r = !1, compact: i = !1, liveByBackend: a, value: o, onSelect: c }) {
	let l = jr(), [u, f] = K(!1), [p, m] = K(""), [h, g] = K(null), [_, v] = K(null), y = G(null), b = l ? Xc.Large : Xc.Medium, x = W(() => Tu(e, p, a), [
		e,
		p,
		a
	]), S = h === null ? null : Math.min(h, Math.max(x.length - 1, 0)), C = _ !== null && _ < x.length ? _ : S, w = (e) => {
		m(e), g(null), v(null);
	};
	U(() => {
		!u || S === null || y.current?.querySelector(`[data-row="${S}"]`)?.scrollIntoView({ block: "nearest" });
	}, [u, S]);
	let T = x.find((e) => e.provider.id === o?.backend && e.model.id === o?.model), E = () => {
		f(!1), g(null), v(null);
	}, D = (e) => {
		c({
			backend: e.provider.id,
			model: e.model.id,
			baseUrl: pu(e.provider)
		}), f(!1), w("");
	}, ee = (e) => {
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
	}, O = o ? T ? ku(T.model) : o.model : t ? "Loading models…" : n ? "Model catalog unavailable" : "Select a model";
	return /* @__PURE__ */ J(pn, {
		open: u,
		onClose: E,
		placement: i ? s.TopRight : s.BottomLeft,
		size: "w-[520px]",
		sticky: !0,
		className: d(i ? "min-w-0" : "shrink-0", l && "w-full"),
		panelClassName: "p-2 overflow-hidden",
		sheetClassName: "h-[70dvh] max-h-[70dvh] min-h-[70dvh] overflow-hidden [&>*]:min-h-0 [&>*]:h-full [&>*]:flex [&>*]:flex-col",
		content: /* @__PURE__ */ Y("div", {
			className: d("flex flex-col min-h-0", l ? "h-full" : "h-[340px]"),
			children: [/* @__PURE__ */ J("div", {
				className: "shrink-0 p-4 pt-0 md:p-0 md:pb-2",
				children: /* @__PURE__ */ J(Z, {
					inputSize: l ? X.Large : X.Medium,
					leading: Js.Icon,
					leadingIconName: V.Search,
					placeholder: "Search models…",
					autoFocus: !0,
					autoComplete: "off",
					spellCheck: !1,
					value: p,
					onChange: (e) => w(e.target.value),
					onKeyDown: ee
				})
			}), /* @__PURE__ */ J("div", {
				ref: y,
				className: "flex flex-col flex-1 gap-1 min-h-0 overflow-auto [&>*]:shrink-0",
				children: x.length === 0 ? /* @__PURE__ */ J("p", {
					className: "px-4 md:px-2 py-3 text-micro text-basic-muted",
					children: t ? "Reading the catalog…" : n ? "The model catalog could not be read." : `No model matches "${p.trim()}".`
				}) : x.map((e, t) => {
					let n = t === 0 || x[t - 1].provider.id !== e.provider.id, r = e.provider.id === o?.backend && e.model.id === o?.model;
					return /* @__PURE__ */ Y("div", {
						className: "px-2 md:px-0",
						children: [n ? /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2 px-2 pt-6 pb-2",
							children: [
								/* @__PURE__ */ J("span", {
									className: "tag-label text-basic-muted whitespace-nowrap shrink-0",
									children: mr(e.provider.id)
								}),
								/* @__PURE__ */ J(Q, { className: "shrink" }),
								/* @__PURE__ */ J(Au, { provider: e.provider })
							]
						}) : null, /* @__PURE__ */ Y(Qc, {
							size: b,
							variant: Zc.Regular,
							active: r,
							"data-row": t,
							onMouseEnter: () => v(t),
							onMouseLeave: () => v((e) => e === t ? null : e),
							onClick: () => D(e),
							children: [
								/* @__PURE__ */ J("span", {
									className: "flex-1 min-w-0 text-left truncate",
									children: ku(e.model)
								}),
								l ? null : /* @__PURE__ */ J("span", {
									className: "code-small text-basic-muted truncate md:max-w-[180px]",
									children: e.model.id
								}),
								/* @__PURE__ */ J("span", {
									className: "text-micro text-basic-muted shrink-0",
									children: Ou(e.model)
								})
							]
						})]
					}, `${e.provider.id}/${e.model.id}`);
				})
			})]
		}),
		children: /* @__PURE__ */ Y(B, {
			variant: i ? R.Ghost : R.Secondary,
			size: i ? L.Small : l ? L.Large : L.Medium,
			content: i ? I.IconLeft : I.IconRight,
			disabled: !e || r,
			onClick: () => u ? E() : f(!0),
			"aria-expanded": u,
			"aria-label": i ? "Model" : void 0,
			className: i ? "min-w-0 max-w-full !gap-1.5 !pr-3" : "w-full md:w-[280px]",
			children: [
				i ? /* @__PURE__ */ J(z, { iconName: V.Brain }) : null,
				/* @__PURE__ */ J("span", {
					className: d("min-w-0 text-left truncate", i ? "label-micro max-w-[96px]" : "flex-1"),
					children: O
				}),
				o && mr(o.backend) !== O ? /* @__PURE__ */ J("span", {
					className: d("truncate", i ? "label-micro max-w-[72px] text-basic-tertiary" : "text-micro text-basic-muted max-w-[110px]"),
					children: mr(o.backend)
				}) : null,
				i ? null : /* @__PURE__ */ J(z, {
					iconName: V.Down,
					className: d("transition-transform duration-150 ease-out", u ? "rotate-180" : "rotate-0")
				})
			]
		})
	});
}
//#endregion
//#region src/app/components/modals/KeyStatus.tsx
function Mu({ status: e }) {
	return e === "validating" ? /* @__PURE__ */ J(A, { size: M.Micro }) : e === "ready" ? /* @__PURE__ */ J(z, {
		iconName: V.CheckCircle,
		size: 16,
		className: "text-success-primary"
	}) : /* @__PURE__ */ J(z, {
		iconName: e === "error" ? V.Danger : V.Key,
		size: 16,
		className: d(e === "error" ? "text-error-primary" : "text-basic-muted")
	});
}
//#endregion
//#region src/app/features/setup/lifetime.ts
function Nu() {
	let e = u(xt()), t = new AbortController(), n = !0;
	return u(N(e, tt(() => {
		n = !1, t.abort();
	}))), {
		signal: t.signal,
		current: () => n,
		close: () => u(_t(e, Hn))
	};
}
function Pu(e = !0) {
	let t = G(null);
	return U(() => {
		let n = Nu();
		return t.current = n, e || n.close(), n.close;
	}, [e]), t;
}
//#endregion
//#region src/app/features/managed/controller/deviceLoginOperation.ts
var Fu = (e) => ["provider-device-login-attempt", e];
async function Iu(e, t) {
	let { api: n } = St(e), r = Fu(t), i = e.getQueryData(r);
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
		let i = await b(T({ command: () => n.startManagedLogin(t) }));
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
		], l = new ni(e, {
			queryKey: c,
			queryFn: async ({ signal: r }) => {
				let a = await n.pollManagedLogin(t, i.login_id, r);
				return a.state === "complete" && o() && await hr(e), a;
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
				message: ir($(e.error))
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
			message: ir($(e))
		}), {
			attempt: a,
			fresh: !1
		};
	}
}
async function Lu(e, t) {
	let { api: n } = St(e), r = Fu(t), i = e.getQueryData(r);
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
function Ru(e, t) {
	let n = oi(), r = Pu(), [i, a] = K(t ?? null), [o, s] = K(null), c = t ?? i, l = G(c);
	$r(() => {
		l.current = c;
	}, [c]);
	let u = Fu(c), d = ai({
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
		let i = await Iu(n, e);
		!t.current() || l.current !== e || n.getQueryData(Fu(e))?.attempt !== i.attempt || (s({
			attempt: i.attempt,
			current: t.current
		}), i.fresh && i.attempt.prompt && !i.attempt.cancelled && window.open(i.attempt.prompt.verification_uri, "_blank", "noopener,noreferrer"));
	}, [n, r]), h = H(async () => {
		c && await Lu(n, c);
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
function zu(e) {
	let t = Yt(e), { data: n } = Pn(!!t);
	return {
		provider: t,
		signedIn: !!(t && n?.providers.find((e) => e.provider === t)?.signed_in)
	};
}
//#endregion
//#region src/app/features/managed/presentation/ManagedAuthCallout.tsx
var Bu = {
	arcee: V.Arcee,
	codex: V.ChatGpt
};
function Vu({ backend: e, className: t = "" }) {
	let { provider: r, signedIn: i } = zu(e), { state: a, start: o, cancel: s } = Ru(void 0, r), c = Ct(), l = wt(e, !!r && i);
	if (!r) return null;
	let u = n(r), f = a.status === "failed", p = i && l.isError, m = f || p, h = a.status === "waiting", g = i && !m, _ = h ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2",
		children: [
			/* @__PURE__ */ J(A, { size: M.Micro }),
			a.prompt.user_code ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
				className: "text-micro text-basic-muted",
				children: "Code"
			}), /* @__PURE__ */ J("span", {
				className: "label-small text-basic-primary tabular-nums",
				children: a.prompt.user_code
			})] }) : /* @__PURE__ */ J("span", {
				className: "text-micro text-basic-muted",
				children: "Waiting for the browser"
			}),
			/* @__PURE__ */ J(B, {
				variant: R.Ghost,
				size: L.Medium,
				content: I.Text,
				onClick: () => void s(),
				children: "Cancel"
			})
		]
	}) : g ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
			children: [/* @__PURE__ */ J(z, {
				iconName: V.CheckCircle,
				className: "text-success-primary"
			}), /* @__PURE__ */ J("span", {
				className: "label-small text-success-primary",
				children: "Signed in"
			})]
		}), /* @__PURE__ */ J(B, {
			variant: R.Ghost,
			size: L.Medium,
			content: I.Text,
			loading: c.isPending,
			onClick: () => void c.mutateAsync(r).catch(() => {}),
			children: "Sign out"
		})]
	}) : /* @__PURE__ */ Y(B, {
		variant: R.Primary,
		size: L.Medium,
		content: I.IconRight,
		loading: a.status === "starting",
		onClick: () => void o(r),
		children: [/* @__PURE__ */ Y("span", { children: ["Sign in with ", u] }), /* @__PURE__ */ J(z, { iconName: V.External })]
	}), v = h ? `Approve the request in the ${u} tab NAC opened.` : g ? "NAC holds this login and every session on this provider uses it." : `This provider authenticates with ${u} in your browser instead of with an API key.`;
	return /* @__PURE__ */ Y("div", {
		className: d("flex flex-col gap-3 rounded-[8px] border bg-elevation-level-2 p-3 md:flex-row md:items-center md:justify-between md:gap-4", m ? "border-error-primary" : "border-muted", t),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-start gap-2 min-w-0",
			children: [/* @__PURE__ */ J(z, {
				iconName: Bu[r],
				className: d("shrink-0", m ? "text-error-primary" : "text-basic-secondary")
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-0.5 min-w-0",
				children: [/* @__PURE__ */ Y("span", {
					className: d("label-small", m ? "text-error-primary" : "text-basic-primary"),
					children: [u, " sign-in"]
				}), /* @__PURE__ */ J("span", {
					className: "text-micro text-basic-muted",
					children: v
				})]
			})]
		}), /* @__PURE__ */ Y("div", {
			className: "flex flex-col items-stretch md:items-end gap-1 shrink-0",
			children: [_, m ? /* @__PURE__ */ J("p", {
				className: "label-micro !text-[10px] !leading-[12px] text-error-primary max-w-[280px] md:text-right pt-1 opacity-70",
				children: au(f ? a.message : l.error, e)
			}) : null]
		})]
	});
}
//#endregion
//#region src/app/lib/modelConfig.ts
function Hu(e, t, n, r = null) {
	return {
		...e,
		api_key_env: e.backend === t && (!e.api_key_env || e.api_key_env === r) ? n : e.api_key_env
	};
}
function Uu(e, t) {
	return {
		...e,
		api_key_env: t !== null && e.api_key_env === t ? null : e.api_key_env
	};
}
function Wu(e, t) {
	return e === t ? !0 : !e || !t ? !1 : e.model === t.model && (e.backend ?? null) === (t.backend ?? null) && (e.base_url ?? null) === (t.base_url ?? null) && (e.api_key_env ?? null) === (t.api_key_env ?? null) && (e.reasoning_effort ?? null) === (t.reasoning_effort ?? null);
}
var Gu = {
	"arcee-auth": "https://api.arcee.ai/api/v1",
	"chatgpt-codex-responses": "https://chatgpt.com/backend-api"
}, Ku = "__clear__";
function qu(e) {
	return Gu[(e ?? "").trim()] ?? null;
}
function Ju(e) {
	return e === "arcee-auth" || e === "chatgpt-codex-responses";
}
function Yu(e) {
	return (e ?? "").trim() || null;
}
function Xu(e) {
	return (e ?? "").split(",").map((e) => e.trim()).filter(Boolean);
}
function Zu(e, t) {
	if (e !== "inherit") {
		if (e === "none") return null;
		if (e !== "variable") throw Error("Choose how credentials are selected");
		if (!t) throw Error("API key environment variable is required when Environment variable is selected");
		if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) throw Error("API key environment variable must match [A-Za-z_][A-Za-z0-9_]* exactly (no whitespace)");
		return t;
	}
}
function Qu(e, t) {
	if (!e) return;
	let n = Ju(e);
	if (n && t !== "none") throw Error(`${e} uses ${e === "arcee-auth" ? "stored Arcee login" : "stored Codex OAuth"} and does not accept an API key environment variable`);
	if (!n && t !== "variable") throw Error(`${e} requires an API key environment variable; explicitly select Environment variable`);
}
function $u(e, t) {
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
	for (let [e, t] of Object.entries(i)) if (!Ee(t)) throw Error(`Extra Headers value for "${e}" must be a string`);
	return i;
}
function ed(e, t) {
	let n = e.trim();
	if (!n) throw Error(`${t} is required and cannot be cleared`);
	return n;
}
function td(e, t) {
	let n = Object.keys(e).sort(), r = Object.keys(t).sort();
	return n.length === r.length && n.every((n, i) => n === r[i] && e[n] === t[n]);
}
function nd(e, t, n = !1) {
	let r = ed(e.backend, "Backend"), i = qu(r), a, o;
	if (i) a = Yu(e.base_url) ?? i, o = null;
	else {
		a = ed(e.base_url, "Base URL");
		let t = Zu(e.credential_mode, e.api_key_env);
		if (t === void 0) throw Error("Select an API key environment variable or explicitly choose none");
		o = t, n && e.credential_mode === "none" || Qu(r, e.credential_mode);
	}
	let s = {
		model: ed(e.model, "Model"),
		base_url: a,
		allow_insecure_http: e.allow_insecure_http,
		backend: r,
		reasoning_effort: e.reasoning_effort === "__clear__" ? null : e.reasoning_effort || null,
		api_key_env: o
	}, c = {};
	s.model !== t.model && (c.model = s.model), s.base_url !== t.base_url && (c.base_url = s.base_url), s.allow_insecure_http !== t.allow_insecure_http && (c.allow_insecure_http = s.allow_insecure_http), s.backend !== t.backend && (c.backend = s.backend), s.reasoning_effort !== t.reasoning_effort && (c.reasoning_effort = s.reasoning_effort), s.api_key_env !== t.api_key_env && (c.api_key_env = s.api_key_env);
	let l = $u(e.extra_headers, {});
	(t.extra_headers_invalid || !td(l, t.extra_headers)) && (c.extra_headers = l);
	let u = e.orchestrator_compaction_threshold.trim();
	if (u !== "" && !/^\d+$/.test(u)) throw Error("Context Limit must be a non-negative integer");
	let d = u === "" ? null : Number(u);
	return d !== t.orchestrator_compaction_threshold && (c.orchestrator_compaction_threshold = d), c;
}
[...ze.map((e) => ({
	id: e,
	label: mr(e)
}))];
var rd = ze.map((e) => ({
	id: e,
	label: mr(e)
})), id = [
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
], ad = [
	{
		id: "",
		label: "Inherit config"
	},
	{
		id: Ku,
		label: "Clear configured effort"
	},
	...id
], od = /* @__PURE__ */ new Set(["", Ku]);
function sd(e, t, n = ad) {
	if (e.length === 0) return n;
	let r = new Set(e);
	return n.filter((e) => od.has(String(e.id)) || r.has(String(e.id)) || e.id === t);
}
//#endregion
//#region src/app/hooks/useExitTransition.ts
var cd = 300;
function ld(e, t = cd) {
	let [n, r] = K(e);
	return e && !n && r(!0), U(() => {
		if (e) return;
		let n = setTimeout(() => r(!1), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
//#endregion
//#region src/app/components/modals/PathPickerModal.tsx
function ud({ open: e, ssh: t, ...n }) {
	return ld(e) ? /* @__PURE__ */ J(dd, {
		open: e,
		ssh: t ?? null,
		...n
	}) : null;
}
function dd({ open: e, kind: t, initialPath: n, ssh: r, title: i, showHidden: a = !1, clearLabel: o, onClear: s, onClose: c, onSelect: l }) {
	let u = t !== "directory", f = jr(), [p, m] = K(n.trim()), [h, g] = K(n.trim()), [_, v] = K(null), [y, b] = K(a), x = Vn(p || null, t, y, !r), S = Br(r ?? null, p || null, y, !!r), { data: C, error: w, isFetching: T } = r ? S : x, E = (e) => {
		m(e), g(e), v(null);
	}, D = u ? _ : C?.path ?? p;
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: c,
		title: i ?? (t === "toml" ? "Select Config File" : t === "file" ? "Select File" : r ? `Select Working Folder on ${r.ssh_host}` : "Select Working Folder"),
		size: Mn.Wide,
		flush: !0,
		className: "h-[560px]",
		footer: /* @__PURE__ */ Y(q, { children: [
			s ? f ? /* @__PURE__ */ J(Ti, {
				variant: R.Secondary,
				content: I.Text,
				onClick: s,
				children: o ?? "Clear"
			}) : /* @__PURE__ */ J(B, {
				variant: R.Ghost,
				size: L.Large,
				content: I.Text,
				className: "mr-auto",
				onClick: s,
				children: o ?? "Clear"
			}) : null,
			f ? /* @__PURE__ */ J(Ti, {
				variant: R.Secondary,
				content: I.Text,
				onClick: c,
				children: "Cancel"
			}) : /* @__PURE__ */ J(B, {
				variant: R.Secondary,
				size: L.Large,
				content: I.Text,
				onClick: c,
				children: "Cancel"
			}),
			f ? /* @__PURE__ */ J(Ti, {
				variant: R.Primary,
				content: I.Text,
				disabled: !D,
				onClick: () => {
					D && l(D);
				},
				children: "Select"
			}) : /* @__PURE__ */ J(B, {
				variant: R.Primary,
				size: L.Large,
				content: I.Text,
				disabled: !D,
				onClick: () => {
					D && l(D);
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
						/* @__PURE__ */ J(B, {
							variant: R.Secondary,
							size: L.Medium,
							content: I.Icon,
							disabled: !C?.parent,
							onClick: () => C?.parent && E(C.parent),
							"aria-label": "Parent directory",
							children: /* @__PURE__ */ J(z, { iconName: V.Top })
						}),
						/* @__PURE__ */ J(B, {
							variant: R.Secondary,
							size: L.Medium,
							content: I.Icon,
							disabled: !C?.home,
							onClick: () => C?.home && E(C.home),
							"aria-label": "Home directory",
							children: /* @__PURE__ */ J(z, { iconName: V.Home })
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
						/* @__PURE__ */ J(B, {
							variant: y ? R.SecondaryHighlighted : R.Secondary,
							size: L.Medium,
							content: I.Icon,
							onClick: () => b((e) => !e),
							"aria-pressed": y,
							title: y ? "Hide dot-prefixed entries" : "Show hidden entries",
							"aria-label": y ? "Hide dot-prefixed entries" : "Show hidden entries",
							children: /* @__PURE__ */ J(z, { iconName: y ? V.Eye : V.EyeStrikethrough })
						})
					]
				}),
				w ? /* @__PURE__ */ J("p", {
					className: "label-micro text-error-primary shrink-0",
					children: ir(w)
				}) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex-1 min-h-0 overflow-auto rounded-[4px] bg-input shadow-concave p-1 flex flex-col [&>*]:shrink-0",
					children: [
						T && !C ? /* @__PURE__ */ J("div", {
							className: "flex items-center justify-center py-6",
							children: /* @__PURE__ */ J(A, { size: M.Small })
						}) : null,
						C?.entries.length === 0 ? /* @__PURE__ */ Y("p", {
							className: "text-micro text-basic-muted px-2 py-3",
							children: [t === "toml" ? "No directories or .toml files here." : t === "file" ? "Nothing here." : "No subdirectories here.", y ? "" : " Hidden entries are not listed."]
						}) : null,
						C?.entries.map((e) => /* @__PURE__ */ Y("button", {
							type: "button",
							className: d("flex items-center gap-3 md:gap-2 w-full px-2 md:px-2 py-3 md:py-1.5 rounded-[4px] text-left", "hover:bg-elevation-sublevel-variant-A", _ === e.path && "bg-elevation-sublevel-variant-A"),
							onClick: () => e.is_directory ? E(e.path) : v(e.path),
							onDoubleClick: () => {
								e.is_directory || l(e.path);
							},
							children: [/* @__PURE__ */ J(z, {
								iconName: e.is_directory ? V.Folder : V.File,
								size: f ? 20 : 16,
								className: "shrink-0 text-basic-muted"
							}), /* @__PURE__ */ J("span", {
								className: d("text-basic-primary truncate", f ? "text-small" : "text-small "),
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
function fd({ items: e, value: t, onValueChange: n, placeholder: r, disabled: i = !1, size: a = L.Medium, trailingIcon: o, triggerClassName: c, placement: l = s.CenterLeft, onOpenChange: u }) {
	let d = jr();
	return /* @__PURE__ */ J(el, {
		items: e,
		value: t,
		onValueChange: n,
		placeholder: r,
		disabled: i,
		size: a,
		trailingIcon: o,
		triggerClassName: c,
		itemSize: d ? Xc.Large : Xc.Medium,
		variant: R.Ghost,
		placement: l,
		onOpenChange: u,
		sticky: !0,
		panelClassName: "max-h-[200px] overflow-auto min-w-[220px] max-w-[calc(100vw-16px)]"
	});
}
//#endregion
//#region src/app/lib/apiKey.ts
var pd = "*".repeat(32);
function md(e) {
	return e.map((e) => ({
		id: e.id,
		label: e.display_name ?? e.id
	}));
}
//#endregion
//#region src/app/components/modals/ResolvedRows.tsx
function hd({ resolving: e, resolved: t, backend: n, onBackend: r, baseUrl: i, onBaseUrl: a, model: o, onModel: s, failed: c }) {
	if (e) return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 py-1",
		children: [/* @__PURE__ */ J(A, { size: M.Micro }), /* @__PURE__ */ J("span", {
			className: "text-micro text-basic-muted",
			children: "Checking the key and reading the model list…"
		})]
	});
	if (!t || !n) return c ? null : /* @__PURE__ */ J("p", {
		className: "text-micro text-basic-muted py-1",
		children: "Pick a configuration to see its provider and models."
	});
	let l = ar(n), u = t.models.length > 0, d = !!t.models_error, f = u ? md(t.models) : o ? [{
		id: o,
		label: o
	}] : [];
	return /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ J(fu, {
			label: "Model Provider",
			required: !0,
			hint: "Service that provides the models for this session.",
			control: /* @__PURE__ */ J(fd, {
				items: rd,
				value: n,
				onValueChange: (e) => r(e)
			})
		}),
		l ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(fu, {
			label: "API Key",
			required: !0,
			hint: "Held by NAC for this configuration; save a new setup to use a different key.",
			control: /* @__PURE__ */ J(Z, {
				inputSize: X.Medium,
				className: uu,
				value: pd,
				isDisabled: !0,
				readOnly: !0,
				leadingSlot: /* @__PURE__ */ J(Mu, { status: "ready" })
			})
		})] }) : null,
		/* @__PURE__ */ J(Q, {}),
		u || d ? /* @__PURE__ */ J(fu, {
			label: "Default Model",
			invalid: d,
			hint: "The NAC session will start with this default and may switch to another.",
			control: /* @__PURE__ */ J(fd, {
				items: d ? [] : f,
				value: d ? "" : o,
				onValueChange: s,
				disabled: d,
				placeholder: "–"
			})
		}) : /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(fu, {
				label: "Model",
				required: !0,
				hint: "Model identifier the endpoint expects.",
				control: /* @__PURE__ */ J(Z, {
					inputSize: X.Medium,
					className: uu,
					placeholder: "gpt-5.5",
					value: o,
					onChange: (e) => s(e.target.value)
				})
			}),
			/* @__PURE__ */ J(Q, {}),
			/* @__PURE__ */ J(fu, {
				label: "Base URL",
				required: !0,
				hint: "Endpoint the session sends its requests to.",
				control: /* @__PURE__ */ J(Z, {
					inputSize: X.Medium,
					className: uu,
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
function gd({ label: e, configurations: t, activeId: n, source: r, onSelect: i, onDelete: a }) {
	let o = jr(), [c, l] = K(!1), u = o ? Xc.Large : Xc.Medium, f = o ? L.Large : L.Medium, p = (e) => {
		i(e), l(!1);
	}, m = /* @__PURE__ */ Y("div", {
		className: d("flex flex-col min-h-0", o ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col shrink-0 [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ Y(Qc, {
					size: u,
					variant: Zc.Regular,
					active: r === "catalog",
					onClick: () => p({ kind: "catalog" }),
					children: [/* @__PURE__ */ J(z, { iconName: V.Search }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Browse Models"
					})]
				}),
				/* @__PURE__ */ Y(Qc, {
					size: u,
					variant: Zc.Regular,
					active: r === "new",
					onClick: () => p({ kind: "new" }),
					children: [/* @__PURE__ */ J(z, { iconName: V.Add }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Create New"
					})]
				}),
				/* @__PURE__ */ Y(Qc, {
					size: u,
					variant: Zc.Regular,
					active: r === "file",
					onClick: () => p({ kind: "file" }),
					children: [/* @__PURE__ */ J(z, { iconName: V.File }), /* @__PURE__ */ J("span", {
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
					children: [/* @__PURE__ */ Y(Qc, {
						size: u,
						variant: Zc.Regular,
						active: n === e.id,
						className: "flex-1 min-w-0",
						onClick: () => p({
							kind: "saved",
							configId: e.id
						}),
						children: [/* @__PURE__ */ J(z, { iconName: V.Gear }), /* @__PURE__ */ J("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						})]
					}), /* @__PURE__ */ J(B, {
						variant: R.TertiaryDestructive,
						size: f,
						content: I.Icon,
						"aria-label": `Remove ${e.name}`,
						onClick: () => a(e.id, e.name),
						children: /* @__PURE__ */ J(z, { iconName: V.Trash })
					})]
				}, e.id))
			})]
		}) : null]
	});
	return /* @__PURE__ */ J(pn, {
		open: c,
		onClose: () => l(!1),
		placement: s.BottomLeft,
		size: "w-auto",
		className: "shrink-0",
		panelClassName: "max-h-72 overflow-hidden",
		sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
		content: m,
		children: /* @__PURE__ */ Y(B, {
			variant: R.Secondary,
			size: L.Medium,
			content: I.IconRight,
			onClick: () => l((e) => !e),
			"aria-expanded": c,
			children: [/* @__PURE__ */ J("span", {
				className: "text-left flex-grow truncate max-w-[96px] md:max-w-[220px]",
				children: e
			}), /* @__PURE__ */ J(z, {
				iconName: V.Down,
				className: d("transition-transform duration-150 ease-out", c ? "rotate-180" : "rotate-0")
			})]
		})
	});
}
//#endregion
//#region src/app/hooks/useDebouncedValue.ts
function _d(e, t) {
	let [n, r] = K(e);
	return U(() => {
		let n = setTimeout(() => r(e), t);
		return () => clearTimeout(n);
	}, [e, t]), n;
}
//#endregion
//#region src/app/features/managed/controller/useManagedModelProfile.ts
function vd() {
	let e = an(), t = e.data ?? null, n = W(() => Te(t), [t]), r = H((e) => ee(t, e), [t]);
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
function yd({ ready: e }) {
	return /* @__PURE__ */ J(fu, {
		label: "Credential",
		verticalOnMobile: !0,
		hint: "This managed host supplies the credential securely; it is not stored in this configuration or exposed to commands.",
		control: /* @__PURE__ */ Y("div", {
			className: d("flex items-center gap-1.5 rounded-[4px] py-2 pl-2 pr-4", e ? "bg-success-secondary" : "bg-error-tertiary"),
			children: [/* @__PURE__ */ J(z, {
				iconName: e ? V.CheckCircle : V.Repair,
				className: e ? "text-success-primary" : "text-error-primary"
			}), /* @__PURE__ */ J("span", {
				className: d("label-small", e ? "text-success-primary" : "text-error-primary"),
				children: e ? "Detected" : "Host needs attention"
			})]
		})
	});
}
//#endregion
//#region src/app/components/modals/ConfigurationsPanel.tsx
var bd = "custom", xd = [...ze.map((e) => ({
	id: e,
	label: mr(e)
})), {
	id: bd,
	label: "Custom"
}], Sd = 400;
function Cd(e, t) {
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => e[n] === t[n]);
}
function wd({ invalid: e, errorText: t, onChange: n, initial: r, children: i }) {
	let a = hn(), o = vd(), { data: s, isPending: c } = In(), l = Zn(), u = Nr(l.data), f = dr(), p = W(() => s?.configurations ?? [], [s]), [m, h] = K(null), [g, _] = K(null), v = r?.backend ?? "arcee-api", [y, b] = K(ze.includes(v) ? v : bd), [x, S] = K(v), [C, w] = K(null), [T, E] = K(""), [D, ee] = K(r?.model ?? ""), [O, k] = K(r?.base_url ?? ""), [A, te] = K(r?.allow_insecure_http ?? !1), [j, ne] = K(r?.model ?? ""), [re, ie] = K(""), [ae, oe] = K(!1), [se, ce] = K(null), [le, ue] = K(null), [de, M] = K(null), fe = o.defaultPick, pe = fe ? u.get(fe.backend) : void 0, N = o.configured && o.credentialReady && l.isPending, P = pe === null, F = m === null && g === null && (c || o.initializing || N || P), me = W(() => fe ? pe === void 0 ? fe : pe === null ? null : pe.some((e) => e.id === fe.model) ? fe : null : null, [fe, pe]), he = r ? p.find((e) => (!r.config_id || e.config_id === r.config_id) && r.orchestrator_compaction_threshold !== void 0 && r.light_model !== void 0 && e.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && Wu(e.light_model ?? null, r.light_model) && e.backend === r.backend && e.model === r.model && e.base_url === r.base_url && e.allow_insecure_http === (r.allow_insecure_http ?? !1) && e.api_key_env === r.api_key_env && (e.reasoning_effort ?? null) === r.reasoning_effort && Cd(e.extra_headers, r.extra_headers)) : null, ge = p.at(-1), _e = m ?? (r ? he ? {
		kind: "saved",
		configId: he.config_id
	} : { kind: "new" } : ge ? {
		kind: "saved",
		configId: ge.config_id
	} : { kind: "catalog" }), ve = W(() => _e.kind === "catalog" && !F ? o.configured ? me : gu(l.data) : null, [
		_e.kind,
		l.data,
		o.configured,
		me,
		F
	]), ye = g ?? ve, be = _e.kind === "catalog" && ye ? ye.backend : y === bd ? x : y, xe = ar(be), Se = y !== bd && xe, Ce = W(() => {
		let e = _e.kind === "catalog" ? ye?.backend ?? "catalog" : y === bd ? "custom" : y, t = new Set(p.map((e) => e.name));
		for (let n = 1;; n += 1) {
			let r = `${e}-config-${n}`;
			if (!t.has(r)) return r;
		}
	}, [
		_e.kind,
		ye,
		y,
		p
	]), we = C ?? Ce, Te = _d(T.trim(), 600), Ee = _d(re.trim(), Sd), De = _e.kind === "saved" ? _e.configId : null, Oe = _e.kind === "file" ? Ee : "", ke = jr(), { signedIn: Ae } = zu(be), je = l.data?.providers.find((e) => e.id === be) ?? null, Me = _e.kind === "catalog" && o.matches(ye), Ne = Me ? o.credentialReady : xe ? je?.auth_status === "ready" : Ae, Pe = _e.kind === "catalog" && !!ye && xe && !Me && !Ne, Fe = _e.kind === "new" && Se || Pe, Ie = fn(be, Te, null, Fe), Le = wt(be, _e.kind === "new" && y !== bd && !xe && Ae), Re = sn(De, Oe), Be = Fe && Te ? Ie.isFetching ? { status: "validating" } : Ie.error ? {
		status: "error",
		message: au(Ie.error, be)
	} : Ie.data ? {
		status: "ready",
		models: Ie.data.models,
		baseUrl: Ie.data.base_url
	} : { status: "validating" } : { status: "idle" }, Ve = Be.status === "ready", He = Ie.data?.base_url ?? "", Ue = !!(De ?? Oe), We = Ue && Re.isFetching, Ge = Ue && !Re.error ? Re.data ?? null : null, Ke = Ue && Re.error ? au(Re.error, be) : "", qe = se ?? Ge?.backend ?? null, Je = le ?? Ge?.base_url ?? "", Ye = _e.kind === "new" ? (xe ? Ie.data?.models : Le.data?.models) ?? [] : Ge?.models ?? [], Xe = _e.kind === "new" ? "" : Ge?.model ?? "", Ze = _e.kind === "new" ? Ye.some((e) => e.id === j) ? j : Ye[0]?.id ?? de ?? j : j || de || Xe || Ye[0]?.id || "", Qe = (e) => {
		h(e), E(""), ne(""), ce(null), ue(null), M(null), e?.kind !== "file" && ie(""), e?.kind !== "catalog" && _(null), e?.kind !== "new" && e?.kind !== "catalog" && w(null);
	}, $e = De ? p.find((e) => e.config_id === De) ?? null : null, et = !!(r && m === null && _e.kind === "new" && be === r.backend && O.trim() === r.base_url && A === (r.allow_insecure_http ?? !1) && !T.trim()), tt = W(() => {
		if (F) return null;
		if (r && et) {
			let e = y === bd ? D.trim() : Ze;
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
					base_url: He || ye.baseUrl,
					allow_insecure_http: !1,
					api_key: T.trim()
				}
			};
		}
		if (_e.kind === "new") {
			let e = we.trim();
			if (!e) return null;
			let t = T.trim();
			if (xe && !t) return null;
			if (y === bd) {
				let n = O.trim(), r = D.trim();
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
			return xe ? !Ve || !Ze || !He ? null : {
				kind: "save",
				request: {
					name: e,
					backend: be,
					model: Ze,
					base_url: He,
					allow_insecure_http: !1,
					api_key: t
				}
			} : !Ae || !Ze ? null : {
				kind: "save",
				request: {
					name: e,
					backend: be,
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
		_e.kind,
		F,
		r,
		et,
		ye,
		Ne,
		Me,
		je,
		we,
		T,
		xe,
		y,
		be,
		O,
		A,
		D,
		Ae,
		Ve,
		He,
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
			await f.mutateAsync(e), De === e && Qe(null), a.success(`Configuration ${t} removed`);
		} catch (e) {
			a.error(`Failed to remove the configuration: ${au($(e))}`);
		}
	}, rt = et ? !0 : _e.kind === "catalog" ? !!ye && (Ne || Ve) : _e.kind === "new" ? y === bd ? !!(O.trim() && D.trim()) : xe ? Ve : Ae : !!Ge, it = Be.status === "error", at = Le.isError ? au(Le.error, be) : Ge?.models_error ?? "", ot = e || it || !!Ke || !!at, st = Le.isError || !!(Ge && !ar(Ge.backend) && Ge.models_error), ct = t ?? (it ? Be.message : Ke || (st ? "" : at)), lt = Ke || Ge?.models_error && ar(Ge.backend) ? Re.refetch : null, ut = _e.kind === "catalog" ? ye && !xe ? be : null : _e.kind === "new" ? y !== bd && !xe ? be : null : qe && !ar(qe) ? qe : null, dt = _e.kind === "catalog" ? "Browse Models" : _e.kind === "new" ? "Create New" : _e.kind === "file" ? "From a .toml file" : $e?.name ?? "Configuration";
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1",
		children: [
			/* @__PURE__ */ Y("div", {
				className: d("flex flex-col rounded-[8px] bg-elevation-level-2 border border-muted overflow-visible", ot && "border border-error-primary"),
				children: [
					/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-4 px-3 py-2 bg-elevation-level-3 rounded-t-[8px] border-b border-muted",
						children: [/* @__PURE__ */ J("div", {
							className: d("flex-1 min-w-0 truncate", ke ? "label-medium" : "label-small", ot ? "text-error-primary" : "text-basic-primary"),
							children: "Configurations"
						}), /* @__PURE__ */ J(gd, {
							label: dt,
							configurations: p.map((e) => ({
								id: e.config_id,
								name: e.name
							})),
							activeId: De,
							source: _e.kind,
							onSelect: Qe,
							onDelete: (e, t) => void nt(e, t)
						})]
					}),
					/* @__PURE__ */ J(Q, {}),
					/* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-4 md:gap-2 p-3",
						children: [
							_e.kind === "catalog" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(fu, {
								label: "Model",
								required: !0,
								verticalOnMobile: !0,
								hint: "Every model this build knows about; picking one names its provider.",
								control: /* @__PURE__ */ J(ju, {
									catalog: l.data,
									loading: l.isLoading,
									failed: l.isError,
									disabled: F,
									liveByBackend: u,
									value: ye,
									onSelect: (e) => {
										h({ kind: "catalog" }), _(e), E(""), w(null);
									}
								})
							}), ye ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(fu, {
									label: "Base URL",
									hint: "Endpoint the catalog names for this provider.",
									verticalOnMobile: !0,
									control: /* @__PURE__ */ J(Z, {
										inputSize: ke ? X.Large : X.Medium,
										className: uu,
										value: ye.baseUrl,
										isDisabled: !0,
										readOnly: !0
									})
								}),
								xe ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), Me ? /* @__PURE__ */ J(yd, { ready: Ne }) : Ne ? /* @__PURE__ */ J(fu, {
									label: "Credential",
									verticalOnMobile: !0,
									hint: "This provider's conventional environment variable is set on the server; the session reuses it.",
									control: /* @__PURE__ */ Y("div", {
										className: "flex items-center gap-1.5 rounded-[4px] bg-success-secondary py-2 pl-2 pr-4",
										children: [/* @__PURE__ */ J(z, {
											iconName: V.CheckCircle,
											className: "text-success-primary"
										}), /* @__PURE__ */ J("span", {
											className: "label-small text-success-primary",
											children: "Detected"
										})]
									})
								}) : /* @__PURE__ */ Y(q, { children: [
									/* @__PURE__ */ J(fu, {
										label: "Name",
										required: !0,
										verticalOnMobile: !0,
										hint: "How this setup is listed the next time a session is created.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: ke ? X.Large : X.Medium,
											className: uu,
											value: we,
											onChange: (e) => w(e.target.value)
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "API Key",
										required: !0,
										verticalOnMobile: !0,
										invalid: it,
										hint: je?.auth_hint ? `Stored in NAC once the setup is saved, or set ${je.auth_hint} on the server instead.` : "Stored in NAC under a generated name once the setup is saved.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: ke ? X.Large : X.Medium,
											className: uu,
											type: "password",
											autoComplete: "off",
											placeholder: "Paste the provider key",
											leadingSlot: /* @__PURE__ */ J(Mu, { status: Be.status }),
											validation: it,
											value: T,
											onChange: (e) => E(e.target.value)
										})
									})
								] })] }) : null
							] }) : null] }) : null,
							_e.kind === "file" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(fu, {
								label: "Config File",
								required: !0,
								hint: "A config.toml on this machine; its [model] section is read.",
								invalid: !!Ke,
								verticalOnMobile: !0,
								control: /* @__PURE__ */ J(Z, {
									inputSize: ke ? X.Large : X.Medium,
									className: uu,
									placeholder: "Select Config File",
									trailing: Ys.Button,
									trailingIconName: V.Folder,
									trailingOnClick: () => oe(!0),
									value: re,
									onChange: (e) => ie(e.target.value)
								})
							}), re.trim() ? /* @__PURE__ */ J(Q, {}) : null] }) : null,
							_e.kind === "new" ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(fu, {
									label: "Model Provider",
									required: !0,
									hint: "Service that provides the models for this session.",
									control: /* @__PURE__ */ J(fd, {
										items: xd,
										value: y,
										onValueChange: (e) => {
											b(e), E(""), ne("");
										}
									})
								}),
								/* @__PURE__ */ J(Q, {}),
								y === bd ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(fu, {
									label: "Protocol",
									required: !0,
									hint: "Wire format the endpoint speaks; a URL alone cannot say.",
									control: /* @__PURE__ */ J(fd, {
										items: rd,
										value: x,
										onValueChange: (e) => S(e)
									})
								}), /* @__PURE__ */ J(Q, {})] }) : null,
								/* @__PURE__ */ J(fu, {
									label: "Name",
									required: !0,
									hint: "How this setup is listed the next time a session is created.",
									control: /* @__PURE__ */ J(Z, {
										inputSize: X.Medium,
										className: uu,
										value: we,
										onChange: (e) => w(e.target.value)
									})
								}),
								xe ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(fu, {
									label: "API Key",
									required: !0,
									invalid: it,
									hint: "Stored in NAC under a generated name once the setup is saved.",
									control: /* @__PURE__ */ J(Z, {
										inputSize: X.Medium,
										className: uu,
										type: "password",
										autoComplete: "off",
										placeholder: "Paste the provider key",
										leadingSlot: /* @__PURE__ */ J(Mu, { status: Be.status }),
										validation: it,
										value: T,
										onChange: (e) => E(e.target.value)
									})
								})] }) : null,
								y === bd ? /* @__PURE__ */ Y(q, { children: [
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "Model",
										required: !0,
										hint: "Model identifier the endpoint expects.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: uu,
											placeholder: "gpt-5.5",
											value: D,
											onChange: (e) => ee(e.target.value)
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "Base URL",
										required: !0,
										hint: "Endpoint the session sends its requests to.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: uu,
											placeholder: "https://api.openai.com/v1",
											value: O,
											onChange: (e) => k(e.target.value)
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "Allow insecure HTTP",
										control: /* @__PURE__ */ Y("div", {
											className: `${uu} flex flex-col items-start gap-1`,
											children: [/* @__PURE__ */ J(ul, {
												"aria-label": "Allow insecure HTTP",
												checked: A,
												onChange: te
											}), /* @__PURE__ */ J("p", {
												className: "body-small text-basic-secondary",
												children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
											})]
										})
									})
								] }) : xe ? Be.status === "ready" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(fu, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									control: /* @__PURE__ */ J(fd, {
										items: md(Be.models),
										value: Ze,
										onValueChange: ne,
										placeholder: "No models offered"
									})
								})] }) : null : Ae ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(fu, {
									label: "Default Model",
									hint: "The NAC session will start with this default and may switch to another.",
									invalid: !!at,
									control: /* @__PURE__ */ J(fd, {
										items: at ? [] : md(Ye),
										value: at ? "" : Ze,
										onValueChange: ne,
										disabled: !!at,
										placeholder: Le.isFetching ? "Reading the model list…" : at ? "–" : "No models offered"
									})
								})] }) : null
							] }) : null,
							_e.kind === "saved" || _e.kind === "file" ? /* @__PURE__ */ J(hd, {
								resolving: We,
								resolved: Ge,
								backend: qe,
								onBackend: ce,
								baseUrl: Je,
								onBaseUrl: ue,
								model: Ze,
								onModel: (e) => Ge?.models.length ? ne(e) : M(e),
								failed: !!Ke
							}) : null,
							i && rt ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), i] }) : null
						]
					})
				]
			}),
			ut ? /* @__PURE__ */ J(Vu, {
				backend: ut,
				className: "mt-1"
			}) : null,
			ct ? /* @__PURE__ */ Y("div", {
				className: "flex items-start gap-2",
				children: [/* @__PURE__ */ J("p", {
					className: "label-micro text-error-primary flex-1 min-w-0",
					children: ct
				}), lt ? /* @__PURE__ */ J(B, {
					variant: R.Ghost,
					size: L.Medium,
					content: I.Text,
					onClick: () => void lt(),
					children: "Try again"
				}) : null]
			}) : null,
			/* @__PURE__ */ J("p", {
				className: "text-micro text-basic-muted",
				children: "* Required fields"
			}),
			/* @__PURE__ */ J(ud, {
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
//#endregion
//#region src/app/components/modals/LightModelSection.tsx
var Td = [{
	id: "",
	label: "Model default"
}, ...id];
function Ed(e, t) {
	if (!e?.model) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let n = e.backend ?? Su(t, e.model);
	if (!n) return {
		pick: null,
		effort: "",
		apiKeyEnv: null
	};
	let r = t?.providers?.find((e) => e.id === n), i = e.base_url ?? (r ? pu(r) : "");
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
function Dd(e) {
	return e.pick ? {
		model: e.pick.model,
		backend: e.pick.backend,
		base_url: e.pick.baseUrl || null,
		api_key_env: e.apiKeyEnv,
		reasoning_effort: e.effort || null
	} : null;
}
function Od({ initial: e, onChange: t, behavior: n = "orchestrator" }) {
	let r = Zn(), i = Nr(r.data), [a, o] = K(e ? "dual" : "single"), [c, l] = K(() => Ed(e, r.data)), u = W(() => {
		if (c.pick) return c;
		let t = Ed(e, r.data);
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
		light: Dd(u)
	}, [a, u]);
	U(() => {
		t(d);
	}, [d, t]);
	let f = sd(xu(r.data, u.pick?.backend, u.pick?.model).supportedEfforts, u.effort, Td), p = n === "direct" ? {
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
			children: [/* @__PURE__ */ J(du, {
				label: p.label,
				hint: p.hint
			}), /* @__PURE__ */ J("div", {
				className: "flex items-center gap-2",
				children: ["single", "dual"].map((e) => /* @__PURE__ */ J(B, {
					variant: a === e ? R.Primary : R.Secondary,
					size: L.Medium,
					content: I.Text,
					onClick: () => o(e),
					"aria-pressed": a === e,
					children: e === "single" ? "Single" : "Dual"
				}, e))
			})]
		}), a === "dual" ? /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
			children: [/* @__PURE__ */ J(fu, {
				label: "Light model",
				required: !0,
				verticalOnMobile: !0,
				hint: p.modelHint,
				control: /* @__PURE__ */ J(ju, {
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
			}), /* @__PURE__ */ J(fu, {
				label: "Light effort",
				secondary: !0,
				hint: "Reasoning effort the light model runs with.",
				control: /* @__PURE__ */ J(el, {
					items: f,
					value: u.effort,
					onValueChange: (e) => l({
						...u,
						effort: e
					}),
					disabled: !u.pick,
					size: L.Medium,
					variant: R.Ghost,
					placement: s.BottomLeft,
					panelClassName: "max-h-64 overflow-auto"
				})
			})]
		}) : null]
	});
}
//#endregion
//#region src/app/components/modals/SshConnectionBox.tsx
var kd = "__new__", Ad = ".ssh/config";
function jd(e) {
	let t = e.trim();
	return t ? t.replace(/\/[^/]*$/, "") || "/" : "~/.ssh";
}
function Md(e) {
	let t = e.trim();
	if (!t) return null;
	let n = Number(t);
	return !Number.isInteger(n) || n < 1 || n > 65535 ? "Port must be an integer between 1 and 65535." : null;
}
function Nd(e) {
	return e.trim() || null;
}
function Pd(e, t, n) {
	let r = Nd(e);
	if (!r) return { error: "An SSH host is required." };
	let i = Md(t);
	return i ? { error: i } : {
		ssh_host: r,
		ssh_port: Nd(t) ? Number(t.trim()) : null,
		ssh_identity_file: Nd(n)
	};
}
function Fd(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function Id(e, t) {
	return e.ssh_host === t.ssh_host && (e.ssh_port ?? null) === (t.ssh_port ?? null) && (e.ssh_identity_file ?? null) === (t.ssh_identity_file ?? null);
}
function Ld({ mode: e, connection: t, onConnectionChange: n, seedTarget: r = null, name: i, onNameChange: a, host: o, onHostChange: c, port: l, onPortChange: u, identityFile: f, onIdentityFileChange: p, onTest: m, testing: h = !1, locked: g = !1, className: _ }) {
	let { markSshDisconnected: v, markSshConnected: y } = P().stores.sshConnectionStore, b = hn(), { data: x } = It(), S = W(() => x?.configurations ?? [], [x]), C = jt(), w = Fr(), T = e === "manage", E = W(() => T || !r?.ssh_host.trim() ? null : S.find((e) => Id(r, e))?.config_id ?? null, [
		T,
		r,
		S
	]), [D, ee] = K(null), O = D ?? E ?? kd, [k, te] = K(!1), [j, ne] = K(() => Fd(S)), [re, ie] = K(r?.ssh_host ?? ""), [ae, oe] = K(r?.ssh_port ? String(r.ssh_port) : ""), [se, ce] = K(r?.ssh_identity_file ?? ""), [le, ue] = K(null), [de, fe] = K(!1), pe = jr(), N = !!t, F = w.isPending || C.isPending || h, me = g || N || F, he = O === kd ? null : S.find((e) => e.config_id === O) ?? null, ge = T ? i ?? "" : j, _e = T ? o ?? "" : N ? t?.ssh_host ?? "" : re, ve = T ? l ?? "" : N ? t?.ssh_port ? String(t.ssh_port) : "" : ae, ye = T ? f ?? "" : N ? t?.ssh_identity_file ?? "" : se, be = (e) => {
		T ? a?.(e) : ne(e);
	}, xe = (e) => {
		T ? c?.(e) : ie(e);
	}, Se = (e) => {
		T ? u?.(e) : oe(e);
	}, Ce = (e) => {
		T ? p?.(e) : ce(e);
	}, I = O === kd ? "Create New" : he?.name ?? "SSH config", we = (e) => {
		if (ee(e), te(!1), ue(null), e === kd) {
			ne(Fd(S)), ie(r?.ssh_host ?? ""), oe(r?.ssh_port ? String(r.ssh_port) : ""), ce(r?.ssh_identity_file ?? "");
			return;
		}
		let t = S.find((t) => t.config_id === e);
		t && (ne(t.name), ie(t.ssh_host), oe(t.ssh_port ? String(t.ssh_port) : ""), ce(t.ssh_identity_file ?? ""));
	}, Te = async () => {
		ue(null);
		let e = Pd(_e, ve, ye);
		if ("error" in e) {
			ue(e.error);
			return;
		}
		if (O === kd && !Nd(ge)) {
			ue("An SSH config name is required.");
			return;
		}
		try {
			let t = await w.mutateAsync(e);
			if (y(e), O === kd) {
				let t = await C.mutateAsync({
					name: ge.trim(),
					ssh_host: e.ssh_host,
					ssh_port: e.ssh_port ?? null,
					ssh_identity_file: e.ssh_identity_file ?? null
				});
				ee(t.config_id);
			}
			n(e, t.path);
		} catch (t) {
			v(e);
			let n = ir($(t));
			ue(n), b.error(`SSH connect failed: ${n}`);
		}
	}, Ee = () => {
		t && v(t), n(null), ue(null);
	}, De = async () => {
		if (m) {
			ue(null);
			try {
				await m();
			} catch (e) {
				let t = ir($(e));
				ue(t);
			}
		}
	}, Oe = T || !N && O === kd, ke = !T;
	return /* @__PURE__ */ Y("div", {
		className: d("relative flex flex-col rounded-[8px] overflow-hidden shadow-convex", N ? "bg-info-primary" : "bg-elevation-sublevel-variant-A", _),
		children: [
			ke ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-4 h-12 pl-3 pr-1.5 py-1 border-b border-muted bg-elevation-sublevel-variant-A",
				children: [
					/* @__PURE__ */ J("p", {
						className: "label-small text-basic-primary flex-1 min-w-0",
						children: "SSH config"
					}),
					N ? /* @__PURE__ */ J(Ci, {
						text: "Connected",
						color: Si.Blue,
						className: "!py-0.5 !px-1"
					}) : null,
					/* @__PURE__ */ J(pn, {
						open: k && !me,
						onClose: () => te(!1),
						placement: s.BottomLeft,
						size: "w-auto",
						className: "shrink-0",
						panelClassName: "max-h-72 overflow-hidden",
						sheetClassName: "overflow-hidden [&>*]:min-h-0 [&>*]:flex-1 [&>*]:flex [&>*]:flex-col",
						content: /* @__PURE__ */ Y("div", {
							className: d("flex flex-col min-h-0", pe ? "w-full flex-1 px-2" : "w-[280px] max-h-72"),
							children: [/* @__PURE__ */ J("div", {
								className: "flex flex-col shrink-0 [&>*]:shrink-0",
								children: /* @__PURE__ */ Y(Qc, {
									size: pe ? Xc.Large : Xc.Medium,
									variant: O === kd ? Zc.Accent : Zc.Regular,
									active: O === kd,
									onClick: () => we(kd),
									children: [/* @__PURE__ */ J(z, { iconName: V.Add }), /* @__PURE__ */ J("span", {
										className: "text-left flex-grow",
										children: "Create New"
									})]
								})
							}), S.length > 0 ? /* @__PURE__ */ Y("div", {
								className: "flex flex-col flex-1 min-h-0 min-w-0",
								children: [/* @__PURE__ */ J("div", { className: "h-px w-full bg-divider-muted my-1 shrink-0" }), /* @__PURE__ */ J("div", {
									className: "flex flex-col flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
									children: S.map((e) => /* @__PURE__ */ Y(Qc, {
										size: pe ? Xc.Large : Xc.Medium,
										variant: O === e.config_id ? Zc.Accent : Zc.Regular,
										active: O === e.config_id,
										onClick: () => we(e.config_id),
										children: [/* @__PURE__ */ J(z, { iconName: V.Globe }), /* @__PURE__ */ J("span", {
											className: "text-left flex-grow truncate",
											children: e.name
										})]
									}, e.config_id))
								})]
							}) : null]
						}),
						children: /* @__PURE__ */ Y(B, {
							size: L.Medium,
							variant: R.Secondary,
							disabled: me,
							onClick: () => te((e) => !e),
							"aria-expanded": k,
							children: [/* @__PURE__ */ J("span", {
								className: "truncate max-w-[140px]",
								children: I
							}), /* @__PURE__ */ J(z, {
								iconName: V.Down,
								className: d("shrink-0 transition-transform duration-150 ease-out", k ? "rotate-180" : "rotate-0")
							})]
						})
					})
				]
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-4 p-3",
				children: [
					Oe ? /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 w-full",
						children: [/* @__PURE__ */ J(du, {
							label: "SSH config name",
							required: !0
						}), /* @__PURE__ */ J(Z, {
							inputSize: pe ? X.Large : X.Medium,
							value: ge,
							isDisabled: me,
							onChange: (e) => be(e.target.value),
							placeholder: "SSH-config-1"
						})]
					}) : null,
					/* @__PURE__ */ Y("div", {
						className: "flex flex-col md:flex-row gap-4 items-start w-full",
						children: [/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 w-full md:flex-1 min-w-0",
							children: [/* @__PURE__ */ J(du, {
								label: "SSH Host",
								required: !0,
								hint: "user@host, a host alias from ~/.ssh/config, or an IP."
							}), /* @__PURE__ */ J(Z, {
								inputSize: pe ? X.Large : X.Medium,
								value: _e,
								isDisabled: me,
								onChange: (e) => xe(e.target.value),
								placeholder: "example@192.0.2.10 or build-box"
							})]
						}), /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 w-full md:w-[98px] shrink-0",
							children: [/* @__PURE__ */ J(du, {
								label: "Port",
								hint: "Blank uses OpenSSH's default (usually 22)."
							}), /* @__PURE__ */ J(Z, {
								inputSize: pe ? X.Large : X.Medium,
								value: ve,
								isDisabled: me,
								onChange: (e) => Se(e.target.value),
								placeholder: "22"
							})]
						})]
					}),
					/* @__PURE__ */ Y("div", {
						className: "flex gap-4 items-end w-full",
						children: [/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 flex-1 min-w-0",
							children: [/* @__PURE__ */ J(du, {
								label: "Private Key",
								hint: "A key file on this machine. The default leaves the choice to your ~/.ssh/config and ssh agent."
							}), /* @__PURE__ */ Y(B, {
								size: L.Medium,
								variant: R.Secondary,
								className: "w-full",
								disabled: me,
								onClick: () => fe(!0),
								children: [/* @__PURE__ */ J("span", {
									className: "flex-1 min-w-0 truncate text-left",
									children: ye.trim() || Ad
								}), /* @__PURE__ */ J(z, {
									iconName: V.FolderOpen,
									size: 20
								})]
							})]
						}), /* @__PURE__ */ J("div", {
							className: "md:w-[128px] shrink-0 relative",
							children: T ? /* @__PURE__ */ Y(B, {
								size: L.Medium,
								variant: R.Secondary,
								className: "w-full",
								disabled: F,
								onClick: () => void De(),
								children: [h ? /* @__PURE__ */ J(A, { size: M.Small }) : /* @__PURE__ */ J(z, {
									iconName: V.Bolt,
									size: 20
								}), "Test"]
							}) : N ? /* @__PURE__ */ J(B, {
								size: L.Medium,
								variant: R.Ghost,
								className: "w-full",
								onClick: Ee,
								children: "Disconnect"
							}) : /* @__PURE__ */ Y(B, {
								size: L.Medium,
								variant: R.Primary,
								className: "w-full",
								disabled: F,
								onClick: () => void Te(),
								children: [F ? /* @__PURE__ */ J(A, { size: M.Small }) : null, "Connect"]
							})
						})]
					}),
					le ? /* @__PURE__ */ J("p", {
						className: "text-micro text-error-primary",
						children: le
					}) : null
				]
			}),
			/* @__PURE__ */ J(ud, {
				open: de,
				kind: "file",
				title: "Select Private Key",
				showHidden: !0,
				initialPath: jd(ye),
				clearLabel: `Use ${Ad}`,
				onClear: () => {
					Ce(""), fe(!1);
				},
				onClose: () => fe(!1),
				onSelect: (e) => {
					Ce(e), fe(!1);
				}
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/SessionBehaviorPicker.tsx
function Rd({ value: e, onChange: t, disabled: n = !1 }) {
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
				children: Pl.map((r, i) => {
					let a = r.id === e;
					return /* @__PURE__ */ Y("button", {
						type: "button",
						role: "radio",
						"aria-checked": a,
						tabIndex: a ? 0 : -1,
						disabled: n,
						className: d("flex min-h-[196px] cursor-pointer flex-col gap-2 rounded-[6px] border p-3 text-left transition-colors", a ? "border-accent-primary bg-accent-secondary" : "border-border-primary bg-elevation-level-1 hover:bg-elevation-level-2", n && "cursor-not-allowed opacity-60"),
						onClick: () => t(r.id),
						onKeyDown: (e) => {
							let n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0, r = e.key === "Home" ? 0 : e.key === "End" ? Pl.length - 1 : n ? (i + n + Pl.length) % Pl.length : null;
							r != null && (e.preventDefault(), t(Pl[r].id), (e.currentTarget.parentElement?.querySelectorAll("[role=\"radio\"]"))?.[r]?.focus());
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
function zd(e) {
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
function Bd(e, t) {
	if (e === t) return !0;
	if (e == null || t == null) return !1;
	let n = Object.keys(e);
	return n.length === Object.keys(t).length && n.every((n) => Object.hasOwn(t, n) && e[n] === t[n]);
}
function Vd(e, t) {
	return e === void 0 || t === void 0 ? e === t : Wu(e ?? null, t ?? null);
}
function Hd(e, t) {
	if (e === t) return !0;
	if (!e || !t) return !1;
	if (e.kind === "resolved" && t.kind === "resolved") return e.backend === t.backend && e.model === t.model && e.base_url === t.base_url && e.allow_insecure_http === t.allow_insecure_http && e.api_key_env === t.api_key_env && e.reasoning_effort === t.reasoning_effort && Bd(e.extra_headers, t.extra_headers) && e.orchestrator_compaction_threshold === t.orchestrator_compaction_threshold && Vd(e.light_model, t.light_model);
	if (e.kind !== "save" || t.kind !== "save") return !1;
	let n = e.request, r = t.request;
	return n.name === r.name && n.backend === r.backend && n.model === r.model && n.base_url === r.base_url && n.allow_insecure_http === r.allow_insecure_http && n.api_key === r.api_key && n.reasoning_effort === r.reasoning_effort && n.initial_prompt === r.initial_prompt && Bd(n.extra_headers, r.extra_headers) && n.orchestrator_compaction_threshold === r.orchestrator_compaction_threshold && Vd(n.light_model, r.light_model);
}
//#endregion
//#region src/app/components/modals/PrimaryModelSection.tsx
var Ud = [{
	id: "",
	label: "Model default"
}, ...id];
function Wd({ initial: e, inheritSavedDefault: t = !1, existingSession: n = !1, onChange: r }) {
	let i = Zn(), a = vd(), o = Nr(i.data), [s, c] = K(null), l = In(t && !e), u = t && !e ? l.data?.configurations.at(-1) : void 0, d = W(() => e ?? (u ? {
		...zd(u),
		extra_headers: u.extra_headers
	} : void 0), [e, u]), f = sn(u && !s ? u.config_id : null, ""), p = t && !e && !s && (l.isPending || u && !f.data), m = W(() => d ? {
		pick: {
			backend: d.backend,
			model: d.model,
			baseUrl: d.base_url
		},
		effort: d.reasoning_effort ?? ""
	} : null, [d]), h = a.defaultPick ? o.get(a.defaultPick.backend) : void 0, g = a.configured && a.credentialReady && (i.isPending || h === null), _ = h === void 0 || a.defaultPick && h?.some((e) => e.id === a.defaultPick?.model) ? a.defaultPick : null, v = W(() => gu(i.data), [i.data]), y = W(() => s ?? m ?? (a.configured ? _ ? {
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
		return !e && !ar(y.pick.backend) && !S ? null : x && d ? {
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
	let E = sd(xu(i.data, y?.pick.backend, y?.pick.model).supportedEfforts, y?.effort ?? "", Ud);
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2 rounded-[8px] border border-muted bg-elevation-level-2 p-3",
		children: [
			/* @__PURE__ */ J(du, {
				label: "Primary model",
				hint: "Search one catalog across every connected provider. Provider accounts and advanced presets are managed separately below."
			}),
			/* @__PURE__ */ J(fu, {
				label: "Model",
				required: !0,
				verticalOnMobile: !0,
				control: /* @__PURE__ */ J(ju, {
					catalog: i.data,
					loading: i.isLoading,
					failed: i.isError,
					liveByBackend: o,
					value: y?.pick ?? null,
					onSelect: (e) => {
						let t = xu(i.data, e.backend, e.model).supportedEfforts, n = y?.effort ?? "";
						c({
							pick: e,
							effort: n && !t.includes(n) ? "" : n
						});
					}
				})
			}),
			/* @__PURE__ */ J(fu, {
				label: "Reasoning",
				hint: "Stored with this chat and switchable independently of provider setup.",
				control: /* @__PURE__ */ J(fd, {
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
					mr(y.pick.backend),
					" in Provider connections or Advanced before selecting this model."
				]
			}) : null
		]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ProviderConnections.tsx
function Gd() {
	return /* @__PURE__ */ Y("section", {
		"aria-label": "Provider connections",
		className: "flex flex-col gap-3",
		children: [
			/* @__PURE__ */ J("p", {
				className: "text-micro text-basic-muted",
				children: "Connect another account without changing this chat or signing out of your current provider. API keys and custom endpoints are available in Advanced provider setup."
			}),
			/* @__PURE__ */ J(Vu, { backend: "arcee-auth" }),
			/* @__PURE__ */ J(Vu, { backend: "chatgpt-codex-responses" })
		]
	});
}
//#endregion
//#region src/app/features/setup/ModelSetupSection.tsx
function Kd({ initial: e, onChange: t, invalid: n, errorText: r, children: i, simple: a = !0, inheritSavedDefault: o = !1, existingSession: s = !1 }) {
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
			c ? /* @__PURE__ */ J(wd, {
				initial: h,
				invalid: n,
				onChange: _,
				children: i
			}) : /* @__PURE__ */ J(Wd, {
				inheritSavedDefault: o,
				existingSession: s,
				initial: h,
				onChange: v
			}),
			/* @__PURE__ */ J(B, {
				variant: R.Secondary,
				"aria-expanded": u,
				onClick: () => d((e) => !e),
				children: "Provider connections"
			}),
			u ? /* @__PURE__ */ J(Gd, {}) : null,
			/* @__PURE__ */ J(B, {
				variant: R.Secondary,
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
var qd = class extends he("SetupFailure") {};
function Jd(e) {
	return e instanceof qd && (e.kind === "unknown" || e.kind === "conflict" || e.completed.length > 0);
}
function Yd(e, t) {
	return oe(() => {
		let n = [];
		return t((t, r, i = !0) => De(function* () {
			if (!e.current()) return yield* Ce(new qd({
				phase: t,
				kind: "cancelled",
				cause: null,
				completed: [...n]
			}));
			let a = yield* ne({
				try: r,
				catch: (r) => {
					let i = e.classify(r, t);
					return new qd({
						phase: t,
						kind: t === "read" && i === "unknown" ? "rejected" : i,
						cause: r,
						completed: [...n]
					});
				}
			}).pipe(lt(() => i ? de(() => e.reconcile(t)) : je));
			return i && (n.push(t), yield* de(() => e.reconcile(t))), a;
		}));
	});
}
function Xd(e) {
	return Yd(e, (t) => De(function* () {
		let n = yield* t("preset", e.model, e.persistsModel ?? !0), r = yield* t("project", () => e.project(n));
		return {
			model: n,
			project: r,
			chat: yield* t("chat", () => e.chat(n, r))
		};
	}));
}
function Zd(e) {
	return Yd(e, (t) => De(function* () {
		if (e.existing) {
			let n = yield* t("read", e.existing, !1);
			if (n !== null) return n;
		}
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("chat", () => e.chat(n));
	}));
}
function Qd(e) {
	return Yd(e, (t) => De(function* () {
		yield* t("read", e.check, !1);
		let n = yield* t("preset", e.model, e.persistsModel ?? !0);
		return yield* t("configuration", () => e.configuration(n), e.configurationSaved ?? !0), e.title && (yield* t("title", e.title)), e.projectDefault && (yield* t("default", () => e.projectDefault(n))), n;
	}));
}
async function $d(e) {
	let n = await Wr(e);
	if (gr(n)) return n.value;
	let r = Re(n.cause);
	throw vn(r) ? r.value : t(n.cause);
}
//#endregion
//#region src/app/features/setup/useSetupAction.ts
function ef(e = !0) {
	let t = Pu(e), n = G(!1), r = G(!1), [i, a] = K(!1), [o, s] = K(!1);
	return {
		busy: i,
		needsReview: o,
		run: async (e) => {
			let i = t.current;
			if (!(!i?.current() || n.current || r.current)) {
				n.current = !0, a(!0);
				try {
					let t = await $d(e(i));
					return i.current() ? t : void 0;
				} catch (e) {
					if (!i.current()) return;
					throw Jd(e) && (r.current = !0, s(!0)), e;
				} finally {
					n.current = !1, i.current() && a(!1);
				}
			}
		}
	};
}
//#endregion
//#region src/app/features/setup/browserAdapters.ts
var tf = class extends Error {}, nf = class extends Error {
	constructor() {
		super("This chat's settings changed. Reopen settings to review the current values before saving.");
	}
};
function rf(e, t) {
	return e instanceof tf ? "rejected" : e instanceof nf ? "conflict" : e instanceof ue ? t === "project" && e.status === 409 ? "rejected" : e.status === 409 ? "conflict" : e.status >= 500 ? "unknown" : "rejected" : "unknown";
}
function af(e) {
	if (!(e instanceof qd)) return au($(e));
	if (e.kind === "cancelled") return "This setup view was closed.";
	let t = e.completed.includes("configuration") ? "Chat settings were saved. " : e.completed.includes("project") ? "The project was saved. " : e.completed.includes("preset") ? "The preset was saved. " : "";
	return e.kind === "unknown" ? `${t}The ${e.phase} save outcome is unknown. Refresh and review the saved values before trying again.` : e.kind === "conflict" ? `${t}The ${e.phase} changed or is busy. Refresh and review before saving again. ${au($(e.cause))}` : `${t}${au($(e.cause))}${e.completed.length ? " Reopen setup to review the saved values before continuing." : ""}`;
}
function of(e, t) {
	return async (n) => {
		let r = n === "preset" ? [
			Mt.modelConfigs,
			Mt.modelCatalog,
			Mt.credentials
		] : n === "project" || n === "default" ? [Mt.projects] : t ? [
			Mt.sessionConfig(t),
			Mt.sessionSnapshot(t),
			Mt.sessionsAll
		] : [Mt.sessionsAll];
		await Promise.all(r.map((t) => e.invalidateQueries({ queryKey: t })));
	};
}
//#endregion
//#region src/app/features/setup/projectLaunch.ts
function sf(e) {
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
		light_model: n.orchestrationEnabled ? r.mode === "dual" && r.light ? Hu(r.light, t.backend, t.api_key_env) : null : e.savedLight ?? null
	}, o = e.headers ?? t.extra_headers ?? void 0;
	return o !== void 0 && (a.extra_headers = o), e.presetCompaction && t.orchestrator_compaction_threshold !== void 0 ? a.orchestrator_compaction_threshold = t.orchestrator_compaction_threshold : Yu(e.compaction) !== null && (a.orchestrator_compaction_threshold = Number(e.compaction)), e.execution !== "ssh" && (a.sandbox = {
		enabled: e.execution === "sandbox",
		no_mount_cwd: i.noMount,
		image: Yu(i.image),
		gpus: Xu(i.gpu),
		workdir: Yu(i.workdir),
		shm_size: Yu(i.shm),
		mounts: Xu(i.mounts),
		mounts_ro: [],
		activity_key: e.activityKey
	}), a;
}
//#endregion
//#region src/app/components/modals/CreateProjectModal.tsx
var cf = [
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
], lf = ad.map((e) => e.id === "" ? {
	...e,
	label: "From configuration"
} : e), uf = { paddingInline: "8px" }, df = {
	noMount: !1,
	image: "",
	gpu: "",
	workdir: "",
	shm: "",
	mounts: ""
};
function ff({ open: e, onClose: t }) {
	let { data: n } = Xt();
	return ld(e) ? /* @__PURE__ */ J(pf, {
		open: e,
		defaultCwd: n?.root_cwd ?? "",
		onClose: t
	}, e ? "open" : "closing") : null;
}
function pf({ open: e, defaultCwd: t, onClose: n }) {
	let { loadLastLight: i, storeLastLight: a } = P().stores.lastLight, o = pi(), c = hn(), l = ef(e), u = oi(), f = Ve(), p = Qt(), m = _n(), [h, g] = K("local"), _ = se(), [v, y] = K(_.orchestrationEnabled ? "orchestrator" : "direct"), [b, x] = K(t), [S, C] = K(""), [w, T] = K(""), [E, D] = K(""), [ee, O] = K(""), [k, A] = K(df), [te, j] = K(!1), [ne, re] = K(!1), [ie, ae] = K(!1), [oe, ce] = K(null), [le, ue] = K({
		mode: "single",
		light: null
	}), [de, M] = K(null), [fe, pe] = K(""), [N, F] = K(null), me = G(""), he = G(!0), ge = G(!1), _e = Zn(), ve = oe?.kind === "save" ? oe.request : oe ?? null, ye = sd(xu(_e.data, ve?.backend, ve?.model).supportedEfforts, w, lf), be = jr(), xe = h === "ssh", Se = r(h === "sandbox").data, Ce = xe ? N : null, we = !xe || Ce !== null, Te = l.busy, [Ee, De] = K(null), Oe = p.isPending && h === "sandbox", ke = Be(Oe, Ee).data, Ae = ke?.since_epoch_ms, [je, Me] = K(0);
	U(() => {
		if (!Oe) return;
		let e = setInterval(() => {
			Me(Ae ? Math.max(0, Math.floor((Date.now() - Ae) / 1e3)) : 0);
		}, 1e3);
		return () => clearInterval(e);
	}, [Oe, Ae]);
	let Ne = (e) => (t) => {
		M(null), e(t);
	}, Pe = (e) => {
		M(null), A((t) => ({
			...t,
			...e
		}));
	}, Fe = G(null), Ie = H((e, t) => {
		if (ce(e), !e || Hd(Fe.current, e)) return;
		let n = Fe.current;
		if (Fe.current = e, t === "primary" && n?.kind === "resolved") {
			M((e) => e?.field === "config" ? null : e);
			return;
		}
		if (e?.kind === "resolved" && e.orchestrator_compaction_threshold !== void 0) {
			let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
			ge.current = !0, he.current = !1, me.current = n, D(n);
		} else {
			let e = ge.current;
			ge.current = !1, e && (he.current = !0, me.current = "", D(""));
		}
		M((e) => e?.field === "config" ? null : e);
	}, []), Le = H((e) => {
		ue(e), M((e) => e?.field === "config" ? null : e);
	}, []), Re = W(() => i(), [i]), ze = oe?.kind === "resolved" && oe.light_model !== void 0 ? oe.light_model : Re, He = JSON.stringify(ze), Ue = W(() => {
		let e = xu(_e.data, ve?.backend, ve?.model).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		_e.data,
		ve?.backend,
		ve?.model
	]);
	U(() => {
		!ge.current && Ue !== "auto" && (me.current === "" || he.current) && (he.current = !0, me.current = Ue, D(Ue));
	}, [Ue, oe]);
	let We = (e) => {
		M(null), ge.current = !1, he.current = !1, me.current = e, D(e);
	}, Ge = (e) => {
		e !== h && (M(null), g(e), F(null), x(e === "ssh" ? "" : t));
	}, Ke = (e, t) => {
		M(null), F(e), e ? t && x(t) : x("");
	}, qe = async () => {
		if (l.needsReview || Te) return;
		if (xe && !Ce) {
			M({
				field: "ssh",
				message: "Connect to the SSH host before creating a project."
			});
			return;
		}
		if (!Yu(b)) {
			M({
				field: "cwd",
				message: "A working folder is required."
			});
			return;
		}
		if (!oe) {
			M({
				field: "config",
				message: "Complete the provider configuration before creating a project."
			});
			return;
		}
		if (_.orchestrationEnabled && le.mode === "dual" && !le.light) {
			M({
				field: "config",
				message: "Pick the light model before creating a project."
			});
			return;
		}
		let e;
		try {
			e = $u(ee, void 0);
		} catch (e) {
			M({
				field: "config",
				message: ir($(e))
			});
			return;
		}
		let t = null;
		try {
			let r = await l.run((n) => Xd({
				current: n.current,
				classify: rf,
				reconcile: of(u),
				persistsModel: oe.kind === "save",
				model: async () => {
					if (oe.kind === "save") {
						let e = le.mode === "dual" && le.light ? {
							...oe.request,
							light_model: le.light
						} : oe.request, t = zd(await m.mutateAsync(e));
						return n.current() && ce(t), t;
					}
					return oe;
				},
				project: async (e) => {
					let n = await f.mutateAsync({
						name: Yu(S),
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
					let a = sf({
						selected: t,
						projectId: r.project_id,
						policy: _,
						behavior: v,
						reasoning: w,
						headers: e,
						compaction: E,
						presetCompaction: ge.current,
						savedLight: ze,
						light: le,
						execution: Ce ? "ssh" : h,
						sandbox: k,
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
			let { snapshot: i, launchLight: s, apiKeyEnv: d } = r.chat;
			a(s && Uu(s, d)), c.success("Project created"), o(i.metadata.session_id ? vr.session(i.metadata.session_id) : vr.project(r.project.project_id)), n();
		} catch (e) {
			if (t && e instanceof qd && e.kind !== "unknown") c.error(`Project created, but the first chat failed: ${af(e)}`), o(vr.project(t)), n();
			else {
				let t = af(e);
				Jd(e) && pe(t), M({
					field: e instanceof qd && e.phase === "project" && e.kind === "rejected" ? "cwd" : "config",
					message: t
				});
			}
		}
	}, Je = (e) => de?.field === e;
	return /* @__PURE__ */ Y(Ht, {
		open: e,
		onClose: n,
		title: "New Project",
		size: Mn.Wide,
		flush: !0,
		className: "h-[680px]",
		footer: be ? /* @__PURE__ */ J(Ti, {
			variant: R.Primary,
			content: I.Text,
			onClick: qe,
			loading: Te,
			disabled: Te || l.needsReview || !!de || !oe || !we,
			children: "Create Project"
		}) : /* @__PURE__ */ J(B, {
			variant: R.Primary,
			size: L.Large,
			content: I.Text,
			onClick: qe,
			loading: Te,
			disabled: Te || l.needsReview || !!de || !oe || !we,
			children: "Create Project"
		}),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-8 md:gap-6 [&>*]:shrink-0",
			children: [
				_.orchestrationEnabled ? /* @__PURE__ */ J(Rd, {
					value: v,
					onChange: y,
					disabled: Te
				}) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: [
						/* @__PURE__ */ J(du, {
							label: "Environment",
							hint: "Where NAC runs commands and accesses files."
						}),
						/* @__PURE__ */ J("div", {
							className: "flex items-start gap-3",
							children: cf.map((e) => /* @__PURE__ */ J(B, {
								variant: h === e.id ? R.Primary : R.Secondary,
								size: L.Medium,
								content: I.Text,
								onClick: () => Ge(e.id),
								"aria-pressed": h === e.id,
								className: `${be ? "!rounded-full" : ""}`,
								children: e.label
							}, e.id))
						}),
						/* @__PURE__ */ J("p", {
							className: "pt-1 text-micro text-basic-muted",
							children: cf.find((e) => e.id === h)?.description
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
				xe ? /* @__PURE__ */ J(Ld, {
					mode: "launch",
					connection: N,
					onConnectionChange: Ke
				}) : null,
				we ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col md:flex-row items-start gap-6 md:gap-4",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 flex-1 min-w-0 w-full",
						children: [
							/* @__PURE__ */ J(du, {
								label: "Working Folder",
								hint: xe ? "The project folder NAC works within on the SSH host." : "The project folder NAC works within.",
								required: !0,
								invalid: Je("cwd")
							}),
							/* @__PURE__ */ Y(B, {
								variant: R.Secondary,
								size: be ? L.Large : L.Medium,
								content: I.IconRight,
								className: d("w-full", Je("cwd") && "input-validation"),
								style: uf,
								onClick: () => ae(!0),
								children: [/* @__PURE__ */ J("span", {
									className: d("flex-1 min-w-0 truncate text-left font-normal", b ? "text-basic-primary" : "text-basic-muted"),
									children: b || "/path/to/project"
								}), /* @__PURE__ */ J(z, {
									iconName: V.Folder,
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
						children: [/* @__PURE__ */ J(du, { label: "Project name" }), /* @__PURE__ */ J(Z, {
							inputSize: be ? X.Large : X.Medium,
							placeholder: "Taken from the git remote",
							value: S,
							onChange: (e) => Ne(C)(e.target.value),
							className: `${be ? "w-full" : ""}`
						})]
					})]
				}) : null,
				we ? /* @__PURE__ */ J(Kd, {
					simple: !_.orchestrationEnabled,
					inheritSavedDefault: !0,
					invalid: Je("config"),
					errorText: fe || (Je("config") ? de?.message : void 0),
					onChange: Ie,
					children: /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-2",
						children: [
							_.orchestrationEnabled ? /* @__PURE__ */ J(Od, {
								initial: ze,
								behavior: v,
								onChange: Le
							}, He) : null,
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ J(fu, {
								label: "Reasoning Effort",
								hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
								control: ((e, t, n, r = !1) => /* @__PURE__ */ J(el, {
									items: e,
									value: t,
									onValueChange: n,
									disabled: r,
									size: L.Medium,
									variant: R.Ghost,
									placement: s.BottomLeft,
									sticky: !0,
									panelClassName: "max-h-64 overflow-auto min-w-[220px]"
								}))(ye, w, Ne(T))
							}),
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ J(fu, {
								label: "Context Limit",
								hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
								control: /* @__PURE__ */ Y("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ J(Z, {
										inputSize: be ? X.Large : X.Medium,
										className: "w-full md:w-[120px]",
										inputClassName: "md:text-right",
										placeholder: Ue,
										inputMode: "numeric",
										value: E,
										onChange: (e) => We(e.target.value)
									}), /* @__PURE__ */ J("span", {
										className: "shrink-0 text-micro text-basic-muted",
										children: "tokens"
									})]
								})
							}),
							h === "sandbox" ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(fu, {
									label: "Sandbox options",
									hint: "The container the session runs in: image, GPUs, workdir, shared memory and mounts.",
									control: /* @__PURE__ */ J(ul, {
										checked: ne,
										onChange: re,
										"aria-label": "Sandbox options"
									})
								}),
								ne ? /* @__PURE__ */ Y(q, { children: [
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "Container image",
										hint: "Image the sandbox runs; empty uses the configured default.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "python:3.13-bookworm",
											value: k.image,
											onChange: (e) => Pe({ image: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "GPUs",
										hint: "Comma-separated GPU list, e.g. all.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "all",
											value: k.gpu,
											onChange: (e) => Pe({ gpu: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "Container workdir",
										hint: "Working directory inside the container.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "/workspace",
											value: k.workdir,
											onChange: (e) => Pe({ workdir: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "Shared memory size",
										hint: "Container /dev/shm size, e.g. 1g.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "0",
											value: k.shm,
											onChange: (e) => Pe({ shm: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "Mounts (HOST:GUEST)",
										hint: "Comma-separated bind mounts.",
										control: /* @__PURE__ */ J(Z, {
											inputSize: X.Medium,
											className: "w-[181px]",
											placeholder: "/data:/data",
											value: k.mounts,
											onChange: (e) => Pe({ mounts: e.target.value })
										})
									}),
									/* @__PURE__ */ J(Q, {}),
									/* @__PURE__ */ J(fu, {
										label: "Don't mount the working folder",
										secondary: !0,
										control: /* @__PURE__ */ J(ul, {
											checked: k.noMount,
											onChange: (e) => Pe({ noMount: e }),
											"aria-label": "Don't mount the working folder",
											size: be ? ol.Large : ol.Medium
										})
									})
								] }) : null
							] }) : null,
							/* @__PURE__ */ J(Q, {}),
							/* @__PURE__ */ J(fu, {
								label: "Custom HTTP headers",
								hint: "Turn this on only if you need to send additional request metadata.",
								control: /* @__PURE__ */ J(ul, {
									checked: te,
									onChange: j,
									"aria-label": "Custom HTTP headers"
								})
							}),
							te ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Q, {}), /* @__PURE__ */ J(sc, {
								label: "Extra headers (JSON object)",
								hintText: "Blank keeps the configuration's headers. Enter {} to send none; header values must be strings.",
								placeholder: "{\"X-Title\": \"NAC\"}",
								value: ee,
								onChange: (e) => Ne(O)(e.target.value),
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
		}), /* @__PURE__ */ J(ud, {
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
function mf(e) {
	if (!e) return {};
	try {
		let t = JSON.parse(e);
		return Object(t) !== t || Array.isArray(t) ? {} : t;
	} catch {
		return {};
	}
}
function hf(e) {
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
function gf(e, t) {
	return {
		initial: {
			backend: e.backend ?? t,
			model: e.model,
			base_url: e.base_url,
			allow_insecure_http: e.allow_insecure_http,
			api_key_env: e.api_key_env ?? null,
			reasoning_effort: e.reasoning_effort ?? null,
			extra_headers: mf(e.extra_headers_json),
			orchestrator_compaction_threshold: e.orchestrator_compaction_threshold,
			light_model: e.light_model ?? null
		},
		light: e.light_model ?? null
	};
}
function _f({ projectId: e, firstChat: t = !1, onClose: n }) {
	return !ld(e !== null) || e === null ? null : /* @__PURE__ */ J(vf, {
		projectId: e,
		firstChat: t,
		onClose: n
	}, e);
}
function vf({ projectId: e, firstChat: t, onClose: n }) {
	let { api: r } = P(), i = pi(), a = ef(), o = oi(), s = Qt(), c = _n(), l = it(), u = Jt(), d = In(), f = se(), [p, m] = K(f.orchestrationEnabled ? "orchestrator" : "direct"), [h, g] = K(null), [_, v] = K({
		mode: "single",
		light: null
	}), [y, b] = K(""), x = l.data?.projects.find((t) => t.project_id === e) ?? null, S = bl(u.data ?? [], e), C = x?.default_model_config_id ? d.data?.configurations.find((e) => e.config_id === x.default_model_config_id) ?? null : null, w = Ut(x?.default_model_config_id ? null : S?.summary.session_id ?? null), T = W(() => C ? hf(C) : w.data && S ? gf(w.data, S.summary.backend) : null, [
		C,
		w.data,
		S
	]), E = l.isPending || u.isPending || d.isPending || !!S && !x?.default_model_config_id && w.isPending, D = l.error || u.error || w.error || x?.default_model_config_id && (d.error || !d.isPending && !C ? /* @__PURE__ */ Error("The project default is unavailable. Review the project settings before creating a chat.") : null), ee = a.busy, O = H((e) => {
		g(e), b((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), k = H((e) => {
		v(e), b((e) => /refresh and review|reopen setup|outcome is unknown/i.test(e) ? e : "");
	}, []), te = h?.kind === "resolved" && h.light_model !== void 0 ? h.light_model : T?.light, j = JSON.stringify(te), ne = async () => {
		if (!(ee || a.needsReview || E || D)) {
			if (!h) {
				b("Choose the primary model before creating this chat.");
				return;
			}
			if (f.orchestrationEnabled && _.mode === "dual" && !_.light) {
				b("Pick the light model before creating this chat.");
				return;
			}
			try {
				let l = await a.run((n) => Zd({
					current: n.current,
					classify: rf,
					reconcile: of(o),
					existing: t ? async () => {
						let [t, i] = await Promise.all([r.listProjects(n.signal), r.listSessions({ projectId: e }, n.signal)]);
						if (!t.projects.some((t) => t.project_id === e)) return vr.list();
						let a = yl(ge(f, i), e);
						return a ? vr.session(a.summary.session_id) : null;
					} : void 0,
					persistsModel: h.kind === "save",
					model: async () => {
						let e;
						if (h.kind === "save") {
							let t = await c.mutateAsync({
								...h.request,
								light_model: f.orchestrationEnabled ? _.mode === "dual" ? _.light : null : te ?? null
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
						let r = f.orchestrationEnabled ? _.mode === "dual" && _.light ? Hu(_.light, n.backend, n.api_key_env) : null : te ?? null, i = {
							project_id: e,
							behavior: nt(f, p),
							first_chat: t && ut(f, u.data ?? [], e),
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
						return a.metadata.session_id ? vr.session(a.metadata.session_id) : vr.project(e);
					}
				}));
				l && (n(), i(l, { replace: t }));
			} catch (e) {
				b(af(e));
			}
		}
	};
	return /* @__PURE__ */ Y(Ht, {
		open: !0,
		onClose: n,
		size: Mn.Wide,
		flush: !0,
		className: "h-[700px]",
		title: "New Chat",
		subheader: f.orchestrationEnabled ? "Choose this chat's behavior and models. These settings apply to this chat without changing the project default." : "Choose this chat's model. These settings apply to this chat without changing the project default.",
		footer: /* @__PURE__ */ J(B, {
			variant: R.Primary,
			loading: ee,
			disabled: ee || a.needsReview || E || !!D || !h,
			onClick: () => void ne(),
			children: "Create chat"
		}),
		children: [f.orchestrationEnabled ? /* @__PURE__ */ J(Rd, {
			value: p,
			onChange: m,
			disabled: ee
		}) : null, D ? /* @__PURE__ */ J("p", {
			role: "alert",
			className: "text-micro text-error-primary",
			children: "The inherited settings could not be loaded. Reopen New Chat to refresh and review them."
		}) : E ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 py-6 text-micro text-basic-muted",
			role: "status",
			children: [/* @__PURE__ */ J(A, { size: M.Micro }), "Loading the project's model settings…"]
		}) : /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-3",
			children: [
				/* @__PURE__ */ Y("p", {
					className: "text-micro text-basic-muted",
					children: [
						C ? "Inherited from the project default" : T ? "Inherited from the latest chat" : "No saved project model default",
						T ? `: ${T.initial.model} · ${T.initial.backend} · reasoning ${T.initial.reasoning_effort ?? "model default"}.` : ".",
						" ",
						"Changes below override this chat only."
					]
				}),
				/* @__PURE__ */ J(Kd, {
					initial: T?.initial,
					onChange: O,
					invalid: !!y,
					errorText: y || void 0
				}),
				f.orchestrationEnabled ? /* @__PURE__ */ J(Od, {
					initial: te,
					behavior: p,
					onChange: k
				}, j) : null
			]
		})]
	});
}
//#endregion
//#region src/app/components/modals/DeleteProjectModal.tsx
var yf = (e) => e === 1 ? "chat" : "chats";
function bf({ open: e, onClose: t, project: n }) {
	let r = hn(), i = pi(), a = fi(), o = Ur(), s = jr(), c = async (e) => {
		if (!(!n || o.isPending)) try {
			let s = await o.mutateAsync({
				projectId: n.project_id,
				sessions: e
			}), c = s?.deleted_session_ids ?? [], l = Wt(a.pathname);
			(a.pathname.startsWith(`/project/${encodeURIComponent(n.project_id)}`) || l && c.includes(l)) && i(vr.list(), { replace: !0 });
			let u = s?.released_session_ids?.length ?? 0, d = c.length;
			r.success(d > 0 ? `Project and ${d} ${yf(d)} removed` : u > 0 ? `Project removed; ${u} ${yf(u)} kept` : "Project removed"), t();
		} catch (e) {
			r.error(`Failed to delete: ${ir($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: t,
		title: "Remove Project?",
		size: Mn.Medium,
		footer: /* @__PURE__ */ Y(q, { children: [
			!s && /* @__PURE__ */ J(B, {
				variant: R.Tertiary,
				content: I.Text,
				onClick: t,
				disabled: o.isPending,
				children: "Cancel"
			}),
			/* @__PURE__ */ J(B, {
				variant: R.Secondary,
				content: I.Text,
				onClick: () => void c("keep"),
				disabled: o.isPending,
				children: "Keep Sessions"
			}),
			/* @__PURE__ */ J(B, {
				variant: R.SecondaryDestructive,
				content: I.Text,
				onClick: () => void c("delete"),
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
function xf({ open: e, onClose: t, project: n }) {
	return !ld(e) || !n ? null : /* @__PURE__ */ J(Sf, {
		open: e,
		project: n,
		onClose: t
	}, n.project_id);
}
function Sf({ open: e, project: t, onClose: n }) {
	let r = hn(), i = et(), [a, o] = K(t.name), [s, c] = K(t.description ?? ""), l = async () => {
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
					description: s.trim() || null
				}
			}), r.success("Project saved"), n();
		} catch (e) {
			let t = e instanceof ue && e.status === 409;
			r.error(t ? "Version conflict — the project changed in the meantime" : `Error: ${ir($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: n,
		title: "Rename project",
		size: Mn.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(B, {
			variant: R.Tertiary,
			content: I.Text,
			onClick: n,
			disabled: i.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(B, {
			variant: R.Primary,
			content: I.Text,
			onClick: l,
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
					e.key === "Enter" && l();
				}
			}), /* @__PURE__ */ J(Z, {
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
//#endregion
//#region src/app/hooks/useKeyboardShortcuts.ts
var Cf = /* @__PURE__ */ new Set([
	"INPUT",
	"TEXTAREA",
	"SELECT"
]);
function wf(e) {
	return e instanceof HTMLElement ? Cf.has(e.tagName) || e.isContentEditable : !1;
}
function Tf(e) {
	let { getStackLength: t } = Dn(), n = x(), r = G(e);
	U(() => {
		r.current = e;
	}), U(() => {
		let e = (e) => {
			if (!(e.repeat || !n(e.target))) {
				for (let n of r.current) if (n.enabled !== !1 && qe(e, n.keys)) {
					if (t() > 0 || !Ir(n.keys) && wf(e.target)) return;
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
var Ef = Jr(null);
function Df({ children: e }) {
	let { pruneSessionNavigation: t } = P().stores.sessionNavigationStore, { pruneChatTabs: n } = P().stores.chatTabsStore, r = hn(), { pathname: i } = fi(), a = pi(), o = Jt(), s = se(), c = o.isSuccess, l = W(() => ge(s, o.data ?? []), [o.data, s]), { data: u } = it(), d = ae(), f = ve(), [p, m] = K(null), [h, g] = K(null), [_, v] = K(null), [y, b] = K(null), [x, S] = K(!1), C = d.toggle, w = f.mutateAsync, T = H(async (e, t) => {
		try {
			await w({
				projectId: e.project_id,
				sessionId: t.session_id
			}), r.success(`Assigned to ${e.name}`);
		} catch (e) {
			r.error(`Failed to assign the chat: ${au($(e))}`);
		}
	}, [w, r]), E = H(async (e, t = !1) => {
		S(t), b(e);
	}, []), D = W(() => ({
		create: () => m("create"),
		assign: (e) => {
			let t = Ol(u?.projects ?? [], e);
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
				r.error(`Failed to update pin: ${ir($(e))}`);
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
		!c || !e || !u || (n(e.map((e) => e.summary.session_id), u.projects.map((e) => e.project_id)), t(gl(e).map((e) => e.summary.session_id)));
	}, [
		c,
		o.data,
		u,
		n,
		t
	]);
	let ee = Wt(i), O = kn(i) ?? o.data?.find((e) => e.summary.session_id === ee)?.summary.project_id ?? null;
	Tf([{
		keys: Vr,
		enabled: O != null,
		onTrigger: () => {
			O && E(O);
		}
	}, {
		keys: Lt,
		enabled: O == null,
		onTrigger: () => m("create")
	}]);
	let k = () => m(null);
	return /* @__PURE__ */ Y(Ef.Provider, {
		value: D,
		children: [
			e,
			/* @__PURE__ */ J(ff, {
				open: p === "create",
				onClose: k
			}),
			/* @__PURE__ */ J(_f, {
				projectId: y,
				firstChat: x,
				onClose: () => {
					let e = y;
					b(null), S(!1), e && kn(i) === e && !gl(l).some((t) => t.summary.project_id === e) && a(vr.list(), { replace: !0 });
				}
			}),
			/* @__PURE__ */ J(lu, {
				open: p === "assign",
				onClose: k,
				summary: _
			}),
			/* @__PURE__ */ J(xf, {
				open: p === "rename",
				onClose: k,
				project: h
			}),
			/* @__PURE__ */ J(bf, {
				open: p === "delete",
				onClose: k,
				project: h
			})
		]
	});
}
function Of() {
	let e = Zr(Ef);
	if (!e) throw Error("useProjectActions must be used within ProjectActionsProvider");
	return e;
}
//#endregion
//#region src/app/components/modals/DeleteModal.tsx
function kf(e, t) {
	let n = e.project_id?.trim();
	if (!n) return vr.list();
	let r = t.filter((t) => t.summary.project_id === n && t.summary.session_id !== e.session_id);
	r.sort((e, t) => Ft(t.summary.updated_at) - Ft(e.summary.updated_at));
	let i = r[0];
	return i ? vr.session(i.summary.session_id) : vr.project(n);
}
function Af({ open: e, onClose: t, summary: n }) {
	let r = hn(), i = hl(), a = pi(), o = fi(), s = _r(), { data: c = [] } = Jt();
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: t,
		title: "Delete session",
		size: Mn.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(B, {
			variant: R.Tertiary,
			content: I.Text,
			onClick: t,
			disabled: s.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(B, {
			variant: R.SecondaryDestructive,
			content: I.Text,
			onClick: async () => {
				if (!n || s.isPending) return;
				let e = n.session_id, i = o.pathname, l = Wt(i) === e ? kf(n, c) : null;
				try {
					l && hi(() => {
						a(l, { replace: !0 });
					}), await s.mutateAsync(e), r.success("Session deleted"), t();
				} catch (e) {
					l && a(i, { replace: !0 }), r.error(`Failed to delete: ${ir($(e))}`);
				}
			},
			loading: s.isPending,
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
					kr(n?.session_id),
					")"
				]
			}),
			"? This action cannot be undone."
		] })
	});
}
//#endregion
//#region src/app/components/modals/RenameModal.tsx
function jf({ open: e, onClose: t, summary: n }) {
	return !ld(e) || !n ? null : /* @__PURE__ */ J(Mf, {
		open: e,
		summary: n,
		onClose: t
	}, n.session_id);
}
function Mf({ open: e, summary: t, onClose: n }) {
	let r = hn(), i = hl(), a = Hr(), [o, s] = K(t.title ?? ""), [c, l] = K(!!t.pinned), u = !!t.project_id, d = async () => {
		if (!a.isPending) try {
			await a.mutateAsync({
				id: t.session_id,
				title: o.trim(),
				pinned: u ? c : !1,
				expectedVersion: t.presentation_version ?? 0
			}), r.success("Session presentation saved"), n();
		} catch (e) {
			let t = e instanceof ue && e.status === 409;
			r.error(t ? "Version conflict — the session changed in the meantime" : `Error: ${ir($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: n,
		title: "Rename session",
		size: Mn.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(B, {
			variant: R.Tertiary,
			content: I.Text,
			onClick: n,
			disabled: a.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(B, {
			variant: R.Primary,
			content: I.Text,
			onClick: d,
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
				onChange: (e) => s(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && d();
				}
			}), u ? /* @__PURE__ */ Y("label", {
				className: "flex items-center gap-2 label-small text-basic-secondary select-none",
				children: [/* @__PURE__ */ J("input", {
					type: "checkbox",
					checked: c,
					onChange: (e) => l(e.target.checked),
					className: "accent-[var(--color-fill-accent-primary)]"
				}), "Pin to top of the list"]
			}) : null]
		})
	});
}
//#endregion
//#region src/app/components/SshBadge.tsx
function Nf({ state: e, onReconnect: t, className: n }) {
	let r = e !== "connected";
	return /* @__PURE__ */ Y("div", {
		className: d("flex items-center h-4 shrink-0", r ? "gap-1" : null, n),
		children: [
			r ? /* @__PURE__ */ J(z, {
				iconName: V.Danger,
				size: 16,
				className: "text-error-primary"
			}) : null,
			/* @__PURE__ */ J("span", {
				className: d("tag-label uppercase", r ? "text-error-primary" : "text-info-primary"),
				children: "SSH"
			}),
			e === "reconnect" && t ? /* @__PURE__ */ J(Ln, {
				title: "Reconnect SSH",
				position: s.TopCenter,
				children: /* @__PURE__ */ J(B, {
					size: L.Small,
					variant: R.Ghost,
					content: I.Icon,
					"aria-label": "Reconnect SSH",
					onClick: (e) => {
						e.stopPropagation(), t();
					},
					children: /* @__PURE__ */ J(z, {
						iconName: V.Refresh,
						size: 16
					})
				})
			}) : null
		]
	});
}
//#endregion
//#region src/app/components/modals/SettingsModal.tsx
function Pf(e) {
	return Object.keys(e).length === 0 ? "" : JSON.stringify(e, null, 2);
}
function Ff(e) {
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
function If(e) {
	let t = Ff(e.extra_headers_json);
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
function Lf({ open: e, onClose: t, footer: n, titleExtra: r, children: i }) {
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: t,
		title: r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-4",
			children: [/* @__PURE__ */ J("span", {
				className: "flex-1 min-w-0",
				children: "Session settings"
			}), r]
		}) : "Session settings",
		size: Mn.Wide,
		flush: !0,
		className: "h-[700px]",
		footer: n,
		children: i
	});
}
function Rf({ open: e, id: t, onClose: n }) {
	let r = ld(e), { data: i, isLoading: a } = Sr(r ? t : null), { data: o, isLoading: s } = Ut(r ? t : null);
	if (!r || !t) return null;
	let c = o ? If(o) : null;
	return !c || !i || s ? /* @__PURE__ */ J(Lf, {
		open: e,
		onClose: n,
		children: /* @__PURE__ */ J("p", {
			className: "text-basic-muted text-micro",
			children: s || a ? "Loading session configuration…" : "Session configuration unavailable."
		})
	}) : /* @__PURE__ */ J(zf, {
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
function zf({ open: e, id: t, initial: n, initialLight: r, initialVersion: i, summary: a, diagnostics: o, onClose: s }) {
	let { useSshConnectionStatus: c, sshTargetFromSummary: l } = P().stores.sshConnectionStore, { api: u } = P(), d = jr(), f = hn(), p = oi(), m = ef(e), h = hl(), g = Dr(), _ = et(), [v, y] = K(!1), b = an(), x = b.data ?? null, S = _n(), C = se(), [w] = K(a), [T] = K(i), E = Hr(), D = w.title ?? "", [O, k] = K(D), [A, te] = K(n.model), [j, ne] = K(n.backend), [re, ie] = K(n.reasoning_effort ?? ""), [, ae] = K(n.base_url), [oe, ce] = K(Pf(n.extra_headers)), [le, ue] = K(n.orchestrator_compaction_threshold == null ? "" : String(n.orchestrator_compaction_threshold)), de = G(n.orchestrator_compaction_threshold == null ? "" : String(n.orchestrator_compaction_threshold)), M = G(!1), fe = G(!1), [pe, N] = K(""), [F, me] = K(null), [he, ge] = K({
		mode: r ? "dual" : "single",
		light: r
	}), [_e, ve] = K(r), [ye, be] = K(!1), [xe, Se] = K(!1), Ce = o.some((e) => e.startsWith("malformed stored light model")), we = G(null), Te = H((e, t) => {
		if (me(e), !e || Hd(we.current, e)) return;
		let n = we.current;
		we.current = e;
		let r = e.kind === "resolved" ? e : e.request;
		if (ne(r.backend), te(r.model), ae(r.base_url ?? qu(r.backend) ?? ""), e.kind === "resolved") {
			ie(e.reasoning_effort ?? "");
			let r = t === "primary" && n?.kind === "resolved";
			if (r && n.backend === e.backend && n.base_url === e.base_url && n.api_key_env === e.api_key_env && n.allow_insecure_http === e.allow_insecure_http || ce(Pf(e.extra_headers ?? {})), r) return;
			if (e.orchestrator_compaction_threshold !== void 0) {
				let t = e.orchestrator_compaction_threshold, n = t == null ? "" : String(t);
				fe.current = !0, M.current = !1, de.current = n, ue(n);
			} else {
				let e = fe.current;
				fe.current = !1, e && (M.current = !0, de.current = "", ue(""));
			}
			e.light_model !== void 0 && (ve(e.light_model), ge({
				mode: e.light_model ? "dual" : "single",
				light: e.light_model
			}));
		}
	}, []), Ee = Zn(), De = sd(xu(Ee.data, j, A).supportedEfforts, re), Oe = W(() => {
		let e = xu(Ee.data, j, A).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		Ee.data,
		j,
		A
	]);
	U(() => {
		!fe.current && Oe !== "auto" && M.current && (M.current = !0, de.current = Oe, ue(Oe));
	}, [Oe, F]);
	let ke = !F || m.needsReview || m.busy, Ae = m.busy || b.isPending || g.isPending || E.isPending || S.isPending, je = l(w), Me = c(je), [Ne, Pe] = K(void 0), Fe = Ne === void 0 ? Me === "connected" ? je : null : Ne, Ie = (e) => {
		Pe(e);
	}, Le = () => E.mutateAsync({
		id: t,
		title: O.trim(),
		pinned: !!w.pinned,
		expectedVersion: w.presentation_version ?? 0
	}), Re = (e) => {
		let t;
		try {
			let r = !!(x?.model_ready && ee(x, {
				backend: e.backend,
				model: e.model,
				baseUrl: e.base_url
			}));
			t = nd({
				model: e.model,
				backend: e.backend,
				base_url: e.base_url,
				allow_insecure_http: e.allow_insecure_http,
				reasoning_effort: re,
				credential_mode: e.api_key_env ? "variable" : "none",
				api_key_env: e.api_key_env ?? "",
				extra_headers: oe,
				orchestrator_compaction_threshold: le
			}, n, r);
		} catch (e) {
			throw new tf(e instanceof Error ? e.message : String(e));
		}
		if (C.orchestrationEnabled) if (he.mode === "dual") {
			if (!he.light) throw new tf("Pick the light model before saving.");
			let i = Hu(he.light, e.backend, e.api_key_env, n.api_key_env);
			(Ce || !Wu(i, r)) && (t.light_model = i);
		} else (r || Ce) && (t.light_model = null);
		else xe ? t.light_model = null : Wu(he.light, r) || (t.light_model = he.light);
		return t;
	}, ze = async () => {
		if (Ae || m.needsReview || !F) return;
		if (v && F.kind === "resolved" && !F.config_id) {
			N("Choose a saved preset in Advanced before updating the project default.");
			return;
		}
		if (C.orchestrationEnabled && he.mode === "dual" && !he.light) {
			N("Pick the light model before saving.");
			return;
		}
		let e = !1;
		try {
			let t = F.kind === "save" ? F.request : F, n = Re({
				...t,
				base_url: t.base_url ?? qu(t.backend) ?? "",
				allow_insecure_http: t.allow_insecure_http ?? !1,
				api_key_env: F.kind === "resolved" ? F.api_key_env : F.request.api_key ? "PENDING_SAVED_CREDENTIAL" : null
			});
			e = F.kind === "save" || Object.keys(n).length > 0;
		} catch (e) {
			N(af(e));
			return;
		}
		try {
			if (!await m.run((n) => Qd({
				current: n.current,
				classify: rf,
				reconcile: of(p, t),
				check: async () => {
					let e = await u.getConfig(t, n.signal);
					if (T !== void 0 && e.config_version !== T) throw new nf();
				},
				persistsModel: F.kind === "save",
				model: async () => {
					if (F.kind === "save") {
						let e = zd(await S.mutateAsync({
							...F.request,
							light_model: he.mode === "dual" ? he.light : null
						}));
						return n.current() && me(e), e;
					}
					return F;
				},
				configurationSaved: e,
				configuration: async (e) => {
					let n = Re(e);
					Object.keys(n).length > 0 && await g.mutateAsync({
						id: t,
						patch: n
					});
				},
				title: O.trim() === D.trim() ? void 0 : Le,
				projectDefault: v && w.project_id ? (e) => {
					if (!e.config_id) throw new tf("Choose a saved preset before updating the project default.");
					return _.mutateAsync({
						projectId: w.project_id,
						payload: { default_model_config_id: e.config_id }
					});
				} : void 0
			}))) return;
			f.success("Session settings saved"), s();
		} catch (e) {
			N(af(e));
		}
	}, Be = /* @__PURE__ */ Y(q, { children: [d ? /* @__PURE__ */ J(Ti, {
		variant: R.Tertiary,
		content: I.Text,
		onClick: s,
		disabled: Ae,
		children: "Cancel"
	}) : /* @__PURE__ */ J(B, {
		variant: R.Tertiary,
		size: L.Large,
		content: I.Text,
		onClick: s,
		disabled: Ae,
		children: "Cancel"
	}), d ? /* @__PURE__ */ J(Ti, {
		variant: R.Primary,
		"aria-label": "Save",
		content: I.Text,
		onClick: ze,
		disabled: ke,
		loading: Ae,
		children: "Save"
	}) : /* @__PURE__ */ J(B, {
		variant: R.Primary,
		"aria-label": "Save",
		size: L.Large,
		content: I.Text,
		onClick: ze,
		disabled: ke,
		loading: Ae,
		children: "Save"
	})] });
	return /* @__PURE__ */ J(Lf, {
		open: e,
		onClose: s,
		footer: Be,
		titleExtra: je ? /* @__PURE__ */ J(Nf, { state: Me === "connected" ? "connected" : "disconnected" }) : null,
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
				je ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Ld, {
					mode: "settings",
					connection: Fe,
					seedTarget: je,
					onConnectionChange: Ie
				}), /* @__PURE__ */ J(Q, {})] }) : null,
				/* @__PURE__ */ J(Z, {
					label: "Session title",
					"aria-label": "Session title",
					inputSize: d ? X.Large : X.Medium,
					placeholder: h(w) || "Session name",
					hintText: "Leave empty to restore the automatic title (the last prompt).",
					value: O,
					onChange: (e) => k(e.target.value)
				}),
				/* @__PURE__ */ J(Kd, {
					existingSession: !0,
					simple: !C.orchestrationEnabled,
					invalid: !!pe,
					errorText: pe || void 0,
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
					onChange: Te,
					children: /* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-2",
						children: [
							C.orchestrationEnabled ? /* @__PURE__ */ J(Od, {
								initial: he.light,
								behavior: w.behavior ?? "orchestrator",
								onChange: ge
							}, JSON.stringify(_e)) : null,
							w.project_id ? /* @__PURE__ */ Y("label", {
								className: "flex items-start gap-2 text-micro",
								children: [
									/* @__PURE__ */ J("input", {
										type: "checkbox",
										checked: v,
										onChange: (e) => y(e.target.checked)
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
								"aria-expanded": ye,
								onClick: () => be((e) => !e),
								children: [
									/* @__PURE__ */ J(z, {
										iconName: V.Gear,
										size: 20
									}),
									/* @__PURE__ */ J("span", {
										className: "label-small flex-1 text-left",
										children: "Advanced Configurations"
									}),
									/* @__PURE__ */ J(z, {
										iconName: ye ? V.Down : V.Right,
										size: 20
									})
								]
							}),
							ye ? /* @__PURE__ */ Y(q, { children: [
								Ce && !C.orchestrationEnabled ? /* @__PURE__ */ Y("label", {
									className: "text-micro",
									children: [
										/* @__PURE__ */ J("input", {
											type: "checkbox",
											checked: xe,
											onChange: (e) => Se(e.target.checked)
										}),
										" ",
										"Clear malformed legacy light settings"
									]
								}) : null,
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(fu, {
									label: "Reasoning Effort",
									hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
									control: /* @__PURE__ */ J(fd, {
										items: De,
										value: re,
										onValueChange: ie
									})
								}),
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(fu, {
									label: "Context Limit",
									hint: "Context size that triggers compaction. Defaults to 70% of the model's context length.",
									control: /* @__PURE__ */ Y("div", {
										className: "flex items-center gap-2",
										children: [/* @__PURE__ */ J(Z, {
											inputSize: d ? X.Large : X.Medium,
											className: uu,
											inputClassName: "md:text-right",
											"aria-label": "Context limit",
											placeholder: Oe,
											inputMode: "numeric",
											value: le,
											onChange: (e) => {
												fe.current = !1, M.current = !1, de.current = e.target.value, ue(e.target.value);
											}
										}), /* @__PURE__ */ J("span", {
											className: "shrink-0 text-micro text-basic-muted",
											children: "tokens"
										})]
									})
								}),
								/* @__PURE__ */ J(Q, {}),
								/* @__PURE__ */ J(sc, {
									label: "Extra headers (JSON object)",
									textAreaSize: d ? oc.Large : oc.Medium,
									hintText: "Blank sends none; header values must be strings.",
									placeholder: "{ \"X-Title\": \"NAC\" }",
									value: oe,
									onChange: (e) => ce(e.target.value),
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
var Bf = Jr(null);
function Vf({ children: e }) {
	let { pushLocalEvent: t, captureRuntimeActivation: n } = P().stores.runtimeStore, r = hn(), i = Ot(), a = Le(), [o, s] = K(null), [c, l] = K(null), [u, d] = K(null), f = H((e) => (t) => {
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
				r.error(`Failed to update pin: ${ir($(e))}`);
			}
		},
		stopRun: async (e) => {
			let i = n(e);
			try {
				await a.mutateAsync(e), i() && t("run", "■ run cancellation requested"), r.success("Run cancellation requested");
			} catch (e) {
				r.error(`Failed to stop run: ${ir($(e))}`);
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
	return /* @__PURE__ */ Y(Bf.Provider, {
		value: m,
		children: [
			e,
			/* @__PURE__ */ J(jf, {
				open: o === "rename",
				onClose: h,
				summary: c
			}),
			/* @__PURE__ */ J(Af, {
				open: o === "delete",
				onClose: h,
				summary: c
			}),
			/* @__PURE__ */ J(Rf, {
				open: o === "settings",
				id: u,
				onClose: h
			})
		]
	});
}
function Hf() {
	let e = Zr(Bf);
	if (!e) throw Error("useSessionActions must be used within SessionActionsProvider");
	return e;
}
//#endregion
//#region src/app/components/modals/MobileProjectSessionModal.tsx
function Uf(e, t, n) {
	return e.kind === "project" ? `${e.entry.project.name} ${e.entry.project.cwd}`.toLowerCase().includes(t) : `${n(e.session.summary)} ${e.session.summary.cwd}`.toLowerCase().includes(t);
}
function Wf({ open: e, onClose: t, projectId: n, sessions: r, activeSessionId: i, summary: a }) {
	let o = pi(), s = Of(), c = Hf(), l = hl(), { data: u } = it(), { data: f = [] } = Rt(), p = a != null && !n, m = Tl(u?.projects ?? [], n), [h, g] = K(n || a ? "chats" : "projects"), [_, v] = K(""), y = G(e);
	U(() => {
		e && !y.current && (g(n || a ? "chats" : "projects"), v("")), y.current = e;
	}, [
		e,
		n,
		a
	]);
	let b = a ? l(a) : m?.name ?? "Projects", x = a ? m?.name ?? "Not assigned" : null, S = n ? r : Sl(f), C = W(() => {
		let e = _.trim().toLowerCase();
		return e ? S.filter((t) => l(t.summary).toLowerCase().includes(e)) : S;
	}, [
		S,
		_,
		l
	]), w = W(() => wl(u?.projects ?? [], f), [u, f]), T = W(() => {
		let e = _.trim().toLowerCase();
		return e ? w.filter((t) => Uf(t, e, l)) : w;
	}, [
		w,
		_,
		l
	]), E = (e) => {
		g(e), v("");
	}, D = (e) => {
		t(), e();
	};
	return /* @__PURE__ */ Y(Ht, {
		open: e,
		onClose: t,
		title: /* @__PURE__ */ Y("div", {
			className: "flex flex-col min-w-0 justify-center",
			children: [/* @__PURE__ */ J("span", {
				className: "truncate",
				children: b
			}), x ? /* @__PURE__ */ J("span", {
				className: d("text-micro font-normal truncate", p ? "text-danger-primary" : "text-basic-muted"),
				children: x
			}) : null]
		}),
		bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
		children: [
			h === "assign" ? null : /* @__PURE__ */ Y("div", {
				className: "absolute inset-x-0 top-0 z-10 flex items-start gap-3 px-2 py-4",
				children: [
					/* @__PURE__ */ J(ac, {
						className: "flex-1 min-w-0",
						variant: ic.Search,
						placeholder: h === "chats" ? "Search Sessions..." : "Search projects...",
						value: _,
						onChange: (e) => v(e.target.value),
						onClear: () => v(""),
						"aria-label": h === "chats" ? "Search Sessions" : "Search projects"
					}),
					h === "chats" && n ? /* @__PURE__ */ J(Ti, {
						variant: R.Secondary,
						content: I.Icon,
						"aria-label": "New Session",
						onClick: () => D(() => void s.newChat(n)),
						children: /* @__PURE__ */ J(z, { iconName: V.Add })
					}) : null,
					h === "projects" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Ti, {
						variant: R.Secondary,
						content: I.Icon,
						"aria-label": "New project",
						onClick: () => D(s.create),
						children: /* @__PURE__ */ J(z, { iconName: V.Add })
					}), /* @__PURE__ */ J(Ti, {
						variant: R.Secondary,
						content: I.Icon,
						"aria-label": "All projects",
						onClick: () => D(() => o(vr.list())),
						children: /* @__PURE__ */ J(z, { iconName: V.Grid })
					})] }) : null
				]
			}),
			/* @__PURE__ */ J("div", {
				className: d("flex-1 min-h-0 overflow-auto [&>*]:shrink-0", h === "assign" ? "px-4 py-4" : "px-2 pt-[72px] pb-[96px]"),
				children: h === "assign" && a ? /* @__PURE__ */ J(qf, {
					summary: a,
					onAssigned: t
				}) : h === "chats" ? /* @__PURE__ */ J(Ul, {
					sessions: C,
					activeSessionId: i,
					isMobile: !0,
					emptyLabel: _.trim() ? "No matching chats" : "No chats yet",
					onOpen: (e) => D(() => o(vr.session(e.summary.session_id))),
					onPin: (e) => void c.togglePin(e.summary),
					onRename: (e) => D(() => c.rename(e.summary)),
					onDelete: (e) => D(() => c.remove(e.summary))
				}) : /* @__PURE__ */ J(Gl, {
					items: T,
					activeId: n ?? i,
					isMobile: !0,
					emptyLabel: _.trim() ? "No matching projects" : "No projects yet",
					onOpenProject: (e) => D(() => o(vr.project(e))),
					onOpenSession: (e) => D(() => o(vr.session(e))),
					renderActions: (e) => {
						if (e.kind === "project") {
							let { project: t } = e.entry;
							return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Kf, {
								label: `Rename ${t.name}`,
								icon: V.Edit,
								onClick: () => D(() => s.rename(t))
							}), /* @__PURE__ */ J(Kf, {
								label: `Delete ${t.name}`,
								icon: V.Trash,
								variant: R.GhostDestructive,
								onClick: () => D(() => s.remove(t))
							})] });
						}
						let { summary: t } = e.session, n = l(t);
						return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Kf, {
							label: `Rename ${n}`,
							icon: V.Edit,
							onClick: () => D(() => c.rename(t))
						}), /* @__PURE__ */ J(Kf, {
							label: `Delete ${n}`,
							icon: V.Trash,
							variant: R.GhostDestructive,
							onClick: () => D(() => c.remove(t))
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
						p ? /* @__PURE__ */ J(Gf, {
							active: h === "assign",
							icon: V.FolderOpen,
							label: "Assign",
							onClick: () => E("assign")
						}) : null,
						/* @__PURE__ */ J(Gf, {
							active: h === "chats",
							icon: V.Chat,
							label: "Sessions",
							onClick: () => E("chats")
						}),
						/* @__PURE__ */ J(Gf, {
							active: h === "projects",
							icon: V.Folder,
							label: "Projects",
							onClick: () => E("projects")
						})
					]
				})
			})
		]
	});
}
function Gf({ active: e, icon: t, label: n, onClick: r }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		role: "tab",
		"aria-selected": e,
		className: d("flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]", e ? "btn-primary" : "btn-ghost"),
		onClick: r,
		children: [/* @__PURE__ */ J(z, {
			iconName: t,
			size: 28
		}), /* @__PURE__ */ J("span", {
			className: d("label-micro font-bold truncate max-w-full", e ? null : "text-basic-primary"),
			children: n
		})]
	});
}
function Kf({ label: e, icon: t, onClick: n, variant: r = R.Ghost }) {
	return /* @__PURE__ */ J(B, {
		variant: r,
		size: L.Small,
		content: I.Icon,
		title: e,
		"aria-label": e,
		onClick: n,
		children: /* @__PURE__ */ J(z, { iconName: t })
	});
}
function qf({ summary: e, onAssigned: t }) {
	let n = hn(), { data: r } = it(), i = ve(), a = Ve(), [o, s] = K(""), [c, l] = K(null), u = W(() => Ol(r?.projects ?? [], e), [r, e]), d = i.isPending || a.isPending, f = async () => {
		if (!d) {
			l(null);
			try {
				let r = u ?? await a.mutateAsync({
					name: o.trim() || null,
					...Dl(e)
				});
				await i.mutateAsync({
					projectId: r.project_id,
					sessionId: e.session_id
				}), n.success(`Assigned to ${r.name}`), t();
			} catch (e) {
				l(au($(e)));
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
			u ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-4 min-w-0",
				children: [/* @__PURE__ */ J(Uc, {
					id: u.project_id,
					size: 40,
					className: "rounded-[4px] shrink-0"
				}), /* @__PURE__ */ Y("div", {
					className: "flex flex-col min-w-0",
					children: [/* @__PURE__ */ J("span", {
						className: "header-md truncate",
						children: u.name
					}), /* @__PURE__ */ J("span", {
						className: "code-micro text-basic-tertiary truncate",
						children: u.cwd
					})]
				})]
			}) : /* @__PURE__ */ J(Z, {
				label: "Project name",
				inputSize: X.Large,
				placeholder: "Taken from the git remote",
				value: o,
				onChange: (e) => {
					l(null), s(e.target.value);
				}
			}),
			c ? /* @__PURE__ */ J("p", {
				className: "text-error-primary text-micro",
				children: c
			}) : null,
			/* @__PURE__ */ J(B, {
				variant: R.Primary,
				size: L.Large,
				content: I.Text,
				className: "w-full",
				onClick: () => void f(),
				loading: d,
				children: u ? "Assign" : "Create and assign"
			})
		]
	});
}
//#endregion
//#region src/app/components/projects/ProjectPopover.tsx
function Jf({ tooltip: e, label: t, icon: n, onClick: r, variant: i = R.Ghost }) {
	return /* @__PURE__ */ J(B, {
		variant: i,
		size: L.Small,
		content: I.Icon,
		title: e,
		"aria-label": t,
		onClick: r,
		children: /* @__PURE__ */ J(z, { iconName: n })
	});
}
function Yf(e, t, n) {
	return (e.kind === "project" ? `${e.entry.project.name} ${e.entry.project.cwd}` : `${n(e.session.summary)} ${e.session.summary.cwd}`).toLowerCase().includes(t);
}
function Xf({ activeId: e, onClose: t }) {
	let n = pi(), r = Of(), i = Hf(), a = hl(), o = jr(), [s, c] = K(""), { data: l } = it(), { data: u = [] } = Rt(), f = W(() => wl(l?.projects ?? [], u), [l, u]), p = W(() => {
		let e = s.trim().toLowerCase();
		return e ? f.filter((t) => Yf(t, e, a)) : f;
	}, [
		f,
		s,
		a
	]);
	return /* @__PURE__ */ Y("div", {
		className: d("flex flex-col", o ? "h-[calc(70dvh)]" : "max-h-[520px]"),
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2 shrink-0",
			children: [/* @__PURE__ */ J(Z, {
				inputSize: o ? X.Large : X.Medium,
				leading: Js.Icon,
				leadingIconName: V.Search,
				placeholder: "Search Projects",
				"aria-label": "Search projects",
				value: s,
				onChange: (e) => c(e.target.value)
			}), /* @__PURE__ */ J(Q, {})]
		}), /* @__PURE__ */ J("div", {
			className: "flex-1 min-h-0 overflow-auto [&>*]:shrink-0",
			children: /* @__PURE__ */ J(Gl, {
				items: p,
				activeId: e,
				isMobile: o,
				emptyLabel: s.trim() ? "No matching projects" : "No projects yet",
				onOpenProject: (e) => {
					t(), n(vr.project(e));
				},
				onOpenSession: (e) => {
					t(), n(vr.session(e));
				},
				renderActions: (e) => {
					if (e.kind === "project") {
						let { project: n } = e.entry;
						return /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ J(Jf, {
								tooltip: n.pinned ? "Unpin project" : "Pin project",
								label: `${n.pinned ? "Unpin" : "Pin"} ${n.name}`,
								icon: n.pinned ? V.Unpin : V.Pin,
								onClick: () => void r.togglePin(n)
							}),
							/* @__PURE__ */ J(Jf, {
								tooltip: "Rename project",
								label: `Rename ${n.name}`,
								icon: V.Edit,
								onClick: () => {
									t(), r.rename(n);
								}
							}),
							/* @__PURE__ */ J(Jf, {
								tooltip: "Remove project",
								label: `Remove ${n.name}`,
								icon: V.Trash,
								variant: R.GhostDestructive,
								onClick: () => {
									t(), r.remove(n);
								}
							})
						] });
					}
					let { summary: n } = e.session, o = a(n);
					return /* @__PURE__ */ Y(q, { children: [
						/* @__PURE__ */ J(Jf, {
							tooltip: "Rename chat",
							label: `Rename ${o}`,
							icon: V.Edit,
							onClick: () => {
								t(), i.rename(n);
							}
						}),
						/* @__PURE__ */ J(Jf, {
							tooltip: "Delete chat",
							label: `Delete ${o}`,
							icon: V.Trash,
							variant: R.GhostDestructive,
							onClick: () => {
								t(), i.remove(n);
							}
						}),
						/* @__PURE__ */ J(Jf, {
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
//#endregion
//#region src/app/components/Breadcrumbs.tsx
function Zf() {
	let { pathname: e } = fi(), t = Wt(e), n = kn(e), r = pi(), i = Of(), a = jr(), o = hl(), { data: c } = it(), { data: l = [] } = Rt(), [u, f] = K(!1), p = t ? l.find((e) => e.summary.session_id === t) : void 0, m = n ?? p?.summary.project_id ?? null, h = Tl(c?.projects ?? [], m), g = m ? gl(l).filter((e) => e.summary.project_id === m).sort((e, t) => Ft(t.summary.updated_at) - Ft(e.summary.updated_at)) : [], _ = !!(m || t), v = h?.name ?? o(p?.summary) ?? t ?? "", y = p ? o(p.summary) : null, b = h?.project_id ?? t ?? "", x = m ? g.some((e) => wr(e.active_run)) : wr(p?.active_run), S = !a || !_;
	return /* @__PURE__ */ Y("nav", {
		className: d("flex items-center min-w-0 gap-1", a && _ && "flex-1"),
		"aria-label": "Breadcrumb",
		children: [S ? a ? /* @__PURE__ */ J("button", {
			type: "button",
			className: "label-medium text-btn-secondary rounded-[8px] truncate",
			onClick: () => r(vr.list()),
			"aria-current": _ ? void 0 : "page",
			children: "All Projects"
		}) : /* @__PURE__ */ J(B, {
			variant: R.Ghost,
			size: L.Medium,
			content: I.Text,
			onClick: () => r(vr.list()),
			"aria-current": _ ? void 0 : "page",
			children: "All Projects"
		}) : null, _ ? /* @__PURE__ */ Y(q, { children: [
			S ? /* @__PURE__ */ J(z, {
				iconName: V.Right,
				className: "text-basic-muted shrink-0"
			}) : null,
			a ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("button", {
				type: "button",
				className: "flex flex-1 min-w-0 items-center gap-2 rounded-[8px] text-btn-secondary",
				onClick: () => f(!0),
				"aria-expanded": u,
				"aria-label": "Switch chat or project",
				children: [/* @__PURE__ */ Y("span", {
					className: "flex flex-col flex-1 min-w-0 text-left",
					children: [/* @__PURE__ */ J("span", {
						className: d("label-medium truncate !leading-[20px]", x ? "text-shimmer-basic" : "text-basic-primary"),
						children: y ?? v
					}), y ? /* @__PURE__ */ J("span", {
						className: d("text-micro truncate", h ? "text-basic-muted" : "text-danger-primary"),
						children: h?.name ?? "Not assigned"
					}) : null]
				}), /* @__PURE__ */ J(z, {
					iconName: V.Right,
					size: 24,
					className: "shrink-0"
				})]
			}), /* @__PURE__ */ J(Wf, {
				open: u,
				onClose: () => f(!1),
				projectId: m,
				sessions: g,
				activeSessionId: t,
				summary: p?.summary ?? null
			})] }) : /* @__PURE__ */ J(pn, {
				open: u,
				onClose: () => f(!1),
				placement: s.BottomRight,
				size: cn.Medium,
				className: "min-w-0",
				content: /* @__PURE__ */ J(Xf, {
					activeId: m ?? t,
					onClose: () => f(!1)
				}),
				children: /* @__PURE__ */ Y(B, {
					variant: R.Ghost,
					size: L.Medium,
					content: I.Text,
					className: "!px-2 max-w-[320px]",
					onClick: () => f((e) => !e),
					"aria-expanded": u,
					"aria-label": "Switch project",
					children: [
						h ? /* @__PURE__ */ J(Uc, {
							id: b,
							size: 24,
							isRunning: x,
							className: "rounded-[2px]"
						}) : /* @__PURE__ */ J(Li, {
							size: 24,
							isRunning: x
						}),
						/* @__PURE__ */ J("span", {
							className: d("truncate max-w-[120px]", x && "text-shimmer-basic"),
							children: v
						}),
						/* @__PURE__ */ J(z, {
							iconName: V.Down,
							className: d("transition-transform", u ? "rotate-180" : void 0)
						})
					]
				})
			}),
			a ? null : /* @__PURE__ */ J(Ln, {
				title: "New project",
				keyboardShortcuts: h ? void 0 : Lt,
				position: Ln.Position.BottomCenter,
				children: /* @__PURE__ */ J(B, {
					variant: R.Ghost,
					size: L.Small,
					content: I.Icon,
					"aria-label": "New project",
					onClick: i.create,
					children: /* @__PURE__ */ J(z, { iconName: V.AddCircle })
				})
			})
		] }) : null]
	});
}
//#endregion
//#region src/app/components/HeaderMenu.tsx
var Qf = "https://github.com/arcee-ai/nac", $f = "https://github.com/arcee-ai/nac#readme";
function ep({ onConfigurations: e, onSshConfigs: t, onManagedHost: n }) {
	let [r, i] = K(!1), a = jr(), { data: o } = Xt(), c = o?.store_path ?? "store path pending", l = a ? Xc.Large : Xc.Medium, u = (e) => () => {
		i(!1), e();
	}, f = (e) => u(() => window.open(e, "_blank", "noopener"));
	return /* @__PURE__ */ J(pn, {
		open: r,
		onClose: () => i(!1),
		placement: s.BottomLeft,
		size: "w-[280px]",
		panelClassName: "p-1",
		sheetClassName: "px-2",
		content: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-2",
			children: [
				/* @__PURE__ */ Y("div", {
					className: d("flex items-center", a ? "h-16 gap-2 pl-4 pr-2" : "h-9 gap-1 pl-2"),
					children: [
						/* @__PURE__ */ J("span", {
							className: d("text-basic-primary shrink-0", a ? "label-medium" : "label-small"),
							children: "Store:"
						}),
						/* @__PURE__ */ J("span", {
							className: d("code text-info-primary flex-1 min-w-0 truncate", a ? "code-medium" : "code-small"),
							title: c,
							children: c
						}),
						/* @__PURE__ */ J(Qn, {
							value: c,
							size: L.Medium,
							variant: R.Ghost,
							title: "Copy the store path"
						})
					]
				}),
				/* @__PURE__ */ J(Q, {}),
				/* @__PURE__ */ Y(Qc, {
					size: l,
					onClick: u(e),
					children: [/* @__PURE__ */ J(z, { iconName: V.Gear }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Configurations"
					})]
				}),
				/* @__PURE__ */ Y(Qc, {
					size: l,
					onClick: u(t),
					children: [/* @__PURE__ */ J(z, { iconName: V.Globe }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "SSH configs"
					})]
				}),
				n ? /* @__PURE__ */ Y(Qc, {
					size: l,
					onClick: u(n),
					children: [/* @__PURE__ */ J(z, { iconName: V.Server }), /* @__PURE__ */ J("span", {
						className: "text-left flex-grow",
						children: "Managed host"
					})]
				}) : null,
				/* @__PURE__ */ J(Q, {}),
				/* @__PURE__ */ Y(Qc, {
					size: l,
					onClick: f($f),
					children: [
						/* @__PURE__ */ J(z, { iconName: V.Book }),
						/* @__PURE__ */ J("span", {
							className: "text-left flex-grow",
							children: "See docs"
						}),
						/* @__PURE__ */ J(z, { iconName: V.External })
					]
				}),
				/* @__PURE__ */ Y(Qc, {
					size: l,
					onClick: f(Qf),
					children: [
						/* @__PURE__ */ J(z, { iconName: V.Github }),
						/* @__PURE__ */ J("span", {
							className: "text-left flex-grow",
							children: "See Github"
						}),
						/* @__PURE__ */ J(z, { iconName: V.External })
					]
				})
			]
		}),
		children: /* @__PURE__ */ J(B, {
			variant: R.Ghost,
			size: L.Medium,
			content: I.Icon,
			className: d(a && "btn-round"),
			onClick: () => i((e) => !e),
			"aria-expanded": r,
			"aria-label": r ? "Close the menu" : "Open the menu",
			children: /* @__PURE__ */ J(z, { iconName: r ? V.Close : V.Hamburger })
		})
	});
}
//#endregion
//#region src/app/components/McpServersButton.tsx
function tp({ onOpen: e }) {
	let t = jr(), { data: n } = tn(), r = n?.servers.filter((e) => e.enabled).length ?? 0, i = r ? `MCP servers, ${r} active` : "MCP servers";
	return /* @__PURE__ */ Y("div", {
		className: "relative shrink-0",
		children: [t ? /* @__PURE__ */ J(Ti, {
			variant: R.Ghost,
			content: I.Icon,
			"aria-label": i,
			onClick: e,
			children: /* @__PURE__ */ J(z, { iconName: V.Toolbox })
		}) : /* @__PURE__ */ Y(B, {
			variant: R.Secondary,
			size: L.Medium,
			content: I.IconLeft,
			"aria-label": i,
			onClick: e,
			children: [/* @__PURE__ */ J(z, { iconName: V.Toolbox }), "MCP"]
		}), r ? /* @__PURE__ */ J("span", {
			"aria-hidden": !0,
			className: "label-micro pointer-events-none absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 bg-btn-primary text-btn-primary",
			children: r
		}) : null]
	});
}
//#endregion
//#region src/app/components/SessionHeaderActions.tsx
function np() {
	let { toggleSidePanelExpanded: e } = P().stores.sessionLayoutStore, { pathname: t } = fi(), n = Wt(t);
	return !jr() || !n ? null : /* @__PURE__ */ J(B, {
		variant: R.Ghost,
		size: L.Medium,
		content: I.Icon,
		className: "btn-round",
		"aria-label": "Open panel",
		onClick: e,
		children: /* @__PURE__ */ J(z, { iconName: V.OpenMobileModal })
	});
}
//#endregion
//#region src/app/components/modals/ConfigListNav.tsx
function rp({ draftLabel: e, draftSelected: t, onSelectDraft: n, entries: r, selectedId: i, onSelect: a, isLoading: o = !1 }) {
	let c = jr(), [l, u] = K(!1), f = t ? e : r.find((e) => e.id === i)?.name ?? e, p = () => {
		n(), u(!1);
	}, m = (e) => {
		a(e), u(!1);
	}, h = /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ Y(Qc, {
			size: c ? Xc.Large : Xc.Medium,
			variant: Zc.Regular,
			active: t,
			onClick: p,
			children: [/* @__PURE__ */ J(z, { iconName: V.Add }), /* @__PURE__ */ J("span", {
				className: "text-left flex-grow truncate",
				children: e
			})]
		}),
		r.length ? /* @__PURE__ */ J(Q, {}) : null,
		r.map((e) => /* @__PURE__ */ J(Qc, {
			size: c ? Xc.Large : Xc.Medium,
			active: i === e.id,
			onClick: () => m(e.id),
			children: /* @__PURE__ */ J("span", {
				className: "text-left flex-grow truncate",
				children: e.name
			})
		}, e.id)),
		o ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 px-2 py-1",
			children: [/* @__PURE__ */ J(A, { size: M.Micro }), /* @__PURE__ */ J("span", {
				className: "text-micro text-basic-muted",
				children: "Loading…"
			})]
		}) : null
	] });
	return c ? /* @__PURE__ */ J("div", {
		className: "shrink-0 border-b border-muted px-2 py-2",
		children: /* @__PURE__ */ J(pn, {
			open: l,
			onClose: () => u(!1),
			placement: s.BottomLeft,
			size: "min-w-full",
			className: "w-full",
			panelClassName: "max-h-[50dvh] overflow-auto",
			content: /* @__PURE__ */ J("div", {
				className: "flex flex-col gap-1 px-2",
				children: h
			}),
			children: /* @__PURE__ */ Y(B, {
				variant: R.Ghost,
				size: L.Large,
				content: I.Icon,
				className: "w-full",
				"aria-expanded": l,
				"aria-label": "Choose configuration",
				onClick: () => u((e) => !e),
				children: [
					t ? /* @__PURE__ */ J(z, {
						iconName: V.Add,
						className: "shrink-0"
					}) : null,
					/* @__PURE__ */ J("span", {
						className: "text-left flex-grow truncate",
						children: f
					}),
					/* @__PURE__ */ J(z, {
						iconName: V.Down,
						className: d("shrink-0 transition-transform duration-150 ease-out", l ? "rotate-180" : "rotate-0")
					})
				]
			})
		})
	}) : /* @__PURE__ */ J("div", {
		className: "flex flex-col shrink-0 gap-2 w-[240px] overflow-y-auto border-r border-muted px-2 py-4 [&>*]:shrink-0",
		children: h
	});
}
//#endregion
//#region src/app/components/modals/ConfigurationsModal.tsx
var ip = ze.map((e) => ({
	id: e,
	label: mr(e)
})), ap = ad.filter((e) => e.id !== Ku).map((e) => e.id === "" ? {
	...e,
	label: "Not set"
} : e), op = "__new__";
function sp({ open: e, onClose: t }) {
	return ld(e) ? /* @__PURE__ */ J(cp, {
		open: e,
		onClose: t
	}) : null;
}
function cp({ open: e, onClose: t }) {
	let n = jr(), { data: r, isLoading: i } = In(), a = W(() => r?.configurations ?? [], [r]), [o, s] = K(null), [c, l] = K(null), u = c ?? a.at(-1)?.config_id ?? op, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: t,
		title: "Configurations",
		size: Mn.Large,
		flush: !0,
		className: "max-w-[820px] md:h-[720px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: o,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ J(rp, {
				draftLabel: "New configuration",
				draftSelected: u === op,
				onSelectDraft: () => l(op),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: l,
				isLoading: i
			}), /* @__PURE__ */ J(lp, {
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
function lp({ record: e, takenNames: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: o }) {
	let s = hn(), c = _n(), l = Ar(), u = dr(), f = e?.backend, [p, m] = K(f ?? "openai-responses"), [h, g] = K(e?.name ?? null), [_, v] = K(e?.base_url ?? ""), [y, b] = K(e?.allow_insecure_http ?? !1), [x, S] = K(""), [C, w] = K(e?.model ?? ""), [T, E] = K(e?.reasoning_effort ?? ""), [D, ee] = K(e?.orchestrator_compaction_threshold?.toString() ?? ""), O = G(e?.orchestrator_compaction_threshold?.toString() ?? ""), k = G(e?.orchestrator_compaction_threshold == null), [A, te] = K(() => e && Object.keys(e.extra_headers).length ? JSON.stringify(e.extra_headers, null, 2) : ""), [j, ne] = K(e?.initial_prompt ?? ""), [re, ie] = K({
		mode: e?.light_model ? "dual" : "single",
		light: e?.light_model ?? null
	}), [ae, oe] = K(""), se = h ?? up(p, t), ce = ar(p), le = Zn(), ue = sd(xu(le.data, p, C).supportedEfforts, T, ap), de = W(() => {
		let e = xu(le.data, p, C).contextWindow;
		return e ? String(Math.round(e * .7)) : "auto";
	}, [
		le.data,
		p,
		C
	]);
	U(() => {
		de !== "auto" && (O.current === "" || k.current) && (k.current = !0, O.current = de, ee(de));
	}, [de]);
	let { signedIn: M } = zu(p), fe = _d(x.trim(), 600), pe = fn(p, fe, null, ce && !!fe), N = wt(p, !ce && M), P = sn(e && p === f ? e.config_id : null, ""), F = ce && fe ? pe.isFetching ? { status: "validating" } : pe.error ? {
		status: "error",
		message: au(pe.error, p)
	} : pe.data ? {
		status: "ready",
		models: pe.data.models,
		baseUrl: pe.data.base_url
	} : { status: "validating" } : { status: "idle" }, me = pe.data?.models ?? N.data?.models ?? P.data?.models ?? [], he = me.some((e) => e.id === C) ? C : C ?? "", ge = F.status === "idle" ? e?.api_key_env ? "ready" : "idle" : F.status, _e = c.isPending || l.isPending || u.isPending, ve = (e) => (t) => {
		oe(""), e(t);
	}, ye = async () => {
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
			t = $u(A, {});
		} catch (e) {
			oe(ir($(e)));
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
					backend: p,
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
					backend: p,
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
			oe(au($(e), p));
		}
	}, be = async () => {
		if (!(!e || _e)) try {
			await u.mutateAsync(e.config_id), i(), s.success(`Configuration ${e.name} removed`);
		} catch (e) {
			oe(au($(e)));
		}
	}, xe = G(ye), Se = G(be);
	return $r(() => {
		xe.current = ye, Se.current = be;
	}), $r(() => {
		let t = c.isPending || l.isPending;
		return a(/* @__PURE__ */ Y(q, { children: [
			e ? o ? /* @__PURE__ */ J(Ti, {
				variant: R.SecondaryDestructive,
				content: I.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: _e,
				loading: u.isPending,
				onClick: () => void Se.current(),
				children: /* @__PURE__ */ J(z, { iconName: V.Trash })
			}) : /* @__PURE__ */ J(B, {
				variant: R.SecondaryDestructive,
				size: L.Large,
				content: I.Icon,
				className: "mr-auto",
				"aria-label": "Delete configuration",
				disabled: _e,
				loading: u.isPending,
				onClick: () => void Se.current(),
				children: /* @__PURE__ */ J(z, { iconName: V.Trash })
			}) : null,
			o ? /* @__PURE__ */ J(Ti, {
				variant: R.Secondary,
				content: I.Text,
				onClick: n,
				children: "Cancel"
			}) : /* @__PURE__ */ J(B, {
				variant: R.Ghost,
				size: L.Large,
				content: I.Text,
				onClick: n,
				children: "Cancel"
			}),
			o ? /* @__PURE__ */ J(Ti, {
				variant: R.Primary,
				content: I.Text,
				disabled: _e,
				loading: t,
				onClick: () => void xe.current(),
				children: "Save"
			}) : /* @__PURE__ */ J(B, {
				variant: R.Primary,
				size: L.Large,
				content: I.Text,
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
	]), /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: /* @__PURE__ */ Y("div", {
			className: d("flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", o && "pb-[88px]"),
			children: [
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col md:rounded-[8px] md:bg-elevation-level-2 md:border md:border-muted md:p-3 gap-4 md:gap-2",
					children: [
						/* @__PURE__ */ J(fu, {
							label: "Model Provider",
							required: !0,
							hint: "Service that provides the models for this session.",
							control: /* @__PURE__ */ J(fd, {
								items: ip,
								value: p,
								onValueChange: (e) => {
									ve(m)(e), S(""), w("");
								}
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(fu, {
							label: "Name",
							required: !0,
							hint: "How this setup is listed the next time a session is created.",
							verticalOnMobile: !0,
							control: /* @__PURE__ */ J(Z, {
								inputSize: o ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								"aria-label": "Configuration name",
								value: se,
								onChange: (e) => ve(g)(e.target.value)
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						ce ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(fu, {
							label: "API Key",
							required: !0,
							invalid: F.status === "error",
							verticalOnMobile: !0,
							hint: e ? "Held by NAC for this configuration; type a new key to replace it." : "Stored in NAC under a generated name once the setup is saved.",
							control: /* @__PURE__ */ J(Z, {
								inputSize: o ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								type: "password",
								autoComplete: "off",
								placeholder: e?.api_key_env ? pd : "Paste the provider key",
								leadingSlot: /* @__PURE__ */ J(Mu, { status: ge }),
								validation: F.status === "error",
								value: x,
								onChange: (e) => ve(S)(e.target.value)
							})
						}), /* @__PURE__ */ J(Q, {})] }) : null,
						/* @__PURE__ */ J(fu, {
							label: "Base URL",
							hint: "Endpoint the session sends its requests to; blank uses the provider's own.",
							control: /* @__PURE__ */ J(Z, {
								inputSize: o ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "https://api.openai.com/v1",
								value: _,
								onChange: (e) => ve(v)(e.target.value)
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(fu, {
							label: "Allow insecure HTTP",
							control: /* @__PURE__ */ Y("div", {
								className: "w-full md:w-[280px] flex flex-col items-start gap-1",
								children: [/* @__PURE__ */ J(ul, {
									"aria-label": "Allow insecure HTTP",
									checked: y,
									onChange: ve(b)
								}), /* @__PURE__ */ J("p", {
									className: "body-small text-basic-secondary",
									children: "Your API key, prompts, source code, tool output, and model responses may be read or modified in transit."
								})]
							}),
							verticalOnMobile: !0
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(fu, {
							label: "Default Model",
							required: !0,
							hint: "Sessions started from this setup begin with this default and may switch to another.",
							verticalOnMobile: !me.length,
							control: me.length ? /* @__PURE__ */ J(fd, {
								items: md(me),
								value: he,
								onValueChange: ve(w),
								placeholder: "No models offered"
							}) : /* @__PURE__ */ J(Z, {
								inputSize: o ? X.Large : X.Medium,
								className: "w-full md:w-[280px]",
								placeholder: "gpt-5.5",
								value: C,
								onChange: (e) => ve(w)(e.target.value)
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(fu, {
							label: "Reasoning Effort",
							hint: "Higher effort for deeper reasoning and lower effort for faster responses.",
							control: /* @__PURE__ */ J(fd, {
								items: ue,
								value: T,
								onValueChange: ve(E)
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(fu, {
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
									placeholder: de,
									inputMode: "numeric",
									value: D,
									onChange: (e) => {
										oe(""), k.current = !1, O.current = e.target.value, ee(e.target.value);
									}
								}), /* @__PURE__ */ J("span", {
									className: "shrink-0 text-micro text-basic-muted",
									children: "tokens"
								})]
							})
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(Od, {
							initial: e?.light_model ?? null,
							onChange: ie
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(sc, {
							label: "Extra headers (JSON object)",
							hintText: "Blank sends none; header values must be strings.",
							placeholder: "{\"X-Title\": \"NAC\"}",
							value: A,
							onChange: (e) => ve(te)(e.target.value),
							textAreaClassName: "h-[108px] resize-none"
						}),
						/* @__PURE__ */ J(Q, {}),
						/* @__PURE__ */ J(sc, {
							label: "Initial prompt",
							hintText: "Pre-fills the first message of a session started from this setup.",
							placeholder: "Send a message",
							value: j,
							onChange: (e) => ve(ne)(e.target.value),
							textAreaClassName: "h-[92px] resize-none"
						})
					]
				}),
				/* @__PURE__ */ J(Vu, {
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
function up(e, t) {
	let n = new Set(t);
	for (let t = 1;; t += 1) {
		let r = `${e}-config-${t}`;
		if (!n.has(r)) return r;
	}
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpEntryDetails.tsx
function dp({ entry: e }) {
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
function fp({ entry: e }) {
	let [t, n] = K(!1), [r, i] = K(!1), a = G(null), o = e.description.replace(/\bDocs:\s*https?:\/\/\S+/g, "").replace(/\s{2,}/g, " ").trim();
	return $r(() => {
		let e = a.current;
		e && i(e.scrollHeight > e.clientHeight);
	}, [o]), /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2 rounded-lg border border-muted p-3 bg-elevation-sublevel-variant-A",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 min-w-0",
			children: [
				/* @__PURE__ */ J(dp, { entry: e }),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col min-w-0 flex-grow",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-2 min-w-0",
						children: [/* @__PURE__ */ J("span", {
							className: "header-small text-basic-primary truncate",
							children: e.name
						}), e.auth === "required_header" ? /* @__PURE__ */ J(Ci, {
							text: "Key required",
							color: Si.Yellow
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
					children: [/* @__PURE__ */ J(z, { iconName: V.BookOpen }), "Docs"]
				})
			]
		}), o ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
			ref: a,
			className: d("text-small text-basic-muted", !t && "line-clamp-3"),
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
function pp({ isMobile: e, variant: t, content: n, className: r, disabled: i, onClick: a, children: o, ariaLabel: s }) {
	return e ? /* @__PURE__ */ J(Ti, {
		variant: t,
		content: n ?? I.Text,
		className: r,
		disabled: i,
		"aria-label": s,
		onClick: a,
		children: o
	}) : /* @__PURE__ */ J(B, {
		size: L.Large,
		variant: t === R.Secondary ? R.Ghost : t,
		content: n,
		className: r,
		disabled: i,
		"aria-label": s,
		onClick: a,
		children: o
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpLibraryPicker.tsx
function mp({ onPick: e, onCustom: t, onClose: n, setFooter: r }) {
	let i = jr(), { data: a } = jn(), { data: o } = tn(), [s, c] = K(""), [l, u] = K(null), f = W(() => {
		let e = [];
		for (let t of a?.entries ?? []) e.includes(t.category) || e.push(t.category);
		return e;
	}, [a]), p = W(() => {
		let e = /* @__PURE__ */ new Set(), t = /* @__PURE__ */ new Set();
		for (let n of o?.servers ?? []) n.library_id && e.add(n.library_id), t.add(n.name);
		return (n) => e.has(n.id) || t.has(n.name);
	}, [o]), m = W(() => {
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
	return $r(() => {
		if (!(!n || !r)) return r(/* @__PURE__ */ J(pp, {
			isMobile: i,
			variant: R.Secondary,
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
					leading: Js.Icon,
					leadingIconName: V.Search,
					placeholder: "Search the library",
					value: s,
					onChange: (e) => c(e.target.value)
				}), /* @__PURE__ */ J(B, {
					size: L.Medium,
					variant: R.Secondary,
					content: I.Text,
					className: "shrink-0",
					onClick: t,
					children: i ? "Custom" : "Custom server"
				})]
			}), f.length > 1 ? /* @__PURE__ */ J("div", {
				className: "overflow-x-auto scrollbar-none [&>*]:shrink-0",
				children: /* @__PURE__ */ J("div", {
					className: "flex gap-1.5 px-4 py-2",
					children: [null, ...f].map((e) => /* @__PURE__ */ J(B, {
						size: i ? L.Medium : L.Small,
						variant: l === e ? R.Primary : R.Secondary,
						content: I.Text,
						"aria-pressed": l === e,
						onClick: () => u(e),
						className: i ? "!rounded-full" : "",
						children: e ?? "All"
					}, e ?? "all"))
				})
			}) : null]
		}), /* @__PURE__ */ J("div", {
			className: d("flex-1 overflow-auto px-4 pb-4 flex flex-col gap-2 [&>*]:shrink-0", i && n && "pb-[88px]"),
			children: m.map((t) => /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-2 [&>*]:shrink-0",
				children: [t.category === null ? null : /* @__PURE__ */ J("span", {
					className: "tag-label text-basic-muted pt-6 px-1",
					children: t.category
				}), t.entries.map((t) => {
					let n = p(t);
					return /* @__PURE__ */ Y(Qc, {
						size: Xc.Large,
						disabled: n,
						className: d(n && "opacity-50", "!px-2"),
						onClick: () => e(t),
						children: [
							/* @__PURE__ */ J(dp, { entry: t }),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col items-start text-left min-w-0 flex-grow py-1",
								children: [/* @__PURE__ */ Y("div", {
									className: "flex items-center gap-2",
									children: [/* @__PURE__ */ J("span", {
										className: "label-small text-basic-primary",
										children: t.name
									}), n ? /* @__PURE__ */ J(Ci, {
										text: "Added",
										color: Si.Green
									}) : t.auth === "required_header" ? /* @__PURE__ */ J(Ci, {
										text: "Key required",
										color: Si.Yellow
									}) : null]
								}), /* @__PURE__ */ J("span", {
									className: "text-micro text-basic-muted truncate w-full",
									children: t.description
								})]
							}),
							n ? null : /* @__PURE__ */ J(z, {
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
//#endregion
//#region src/app/components/modals/MCPServersModal/McpKvEditor.tsx
function hp({ label: e, hint: t, keyPlaceholder: n, rows: r, onChange: i }) {
	let a = jr(), o = (e, t) => {
		i(r.map((n, r) => r === e ? {
			...n,
			...t
		} : n));
	};
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-4 md:gap-2",
		children: [
			/* @__PURE__ */ J(du, {
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
					/* @__PURE__ */ Y(B, {
						size: L.Medium,
						variant: R.GhostDestructive,
						content: a ? I.IconLeft : I.Icon,
						"aria-label": "Remove entry",
						onClick: () => i(r.filter((e, n) => n !== t)),
						className: a ? "self-end" : "",
						children: [a ? "Remove" : null, /* @__PURE__ */ J(z, { iconName: V.Trash })]
					})
				]
			}, t)),
			/* @__PURE__ */ Y(Qc, {
				size: a ? Xc.Large : Xc.Medium,
				className: "!border !border-tertiary !border-dashed",
				onClick: () => i([...r, {
					key: "",
					value: ""
				}]),
				children: [/* @__PURE__ */ J(z, { iconName: V.Add }), "Add entry"]
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpOAuthPanel.tsx
function gp(e) {
	switch (e) {
		case "connected": return "Connected";
		case "connecting": return "Waiting for authorization";
		case "failed": return "Authorization failed";
		case "needs_authorization": return "Ready to connect";
		case "needs_configuration": return "Not configured";
		default: return "Checking…";
	}
}
function _p({ serverName: e }) {
	let { api: t } = P(), n = jr(), [r, i] = K(null), [a, o] = K(null), [s, c] = K(!1), [l, u] = K(null), [d, f] = K(!1), [p, m] = K(""), [h, g] = K(""), [_, v] = K("pre_registered"), [y, b] = K(""), [x, S] = K("NAC MCP Client"), [C, w] = K("channels:history\nchat:write"), [T, E] = K(""), D = H(async (n = !1) => {
		try {
			let n = await t.getMcpOAuthStatus(e);
			i(n.status), o(n.message ?? null), u(n.authorization_url ?? null);
		} catch {
			n || i("failed"), o(n ? "OAuth status is temporarily unavailable. Retrying…" : "OAuth status is unavailable.");
		}
	}, [t, e]);
	U(() => {
		let e = window.setTimeout(() => void D(), 0);
		return () => window.clearTimeout(e);
	}, [D]), U(() => {
		if (r !== "connecting" && r !== "connected") return;
		let e = !1, t, n = async () => {
			await D(!0), e || (t = window.setTimeout(() => void n(), 1e3));
		};
		return t = window.setTimeout(() => void n(), 1e3), () => {
			e = !0, t !== void 0 && window.clearTimeout(t);
		};
	}, [D, r]);
	let ee = async () => {
		if (_ === "pre_registered" && !p.trim()) {
			o("A protected client ID credential name is required.");
			return;
		}
		if (_ === "client_metadata" && !y.trim()) {
			o("A client metadata document URL is required.");
			return;
		}
		let n;
		try {
			n = T.trim() ? JSON.parse(T) : void 0;
		} catch {
			o("The authorization metadata override must be valid JSON.");
			return;
		}
		let r = _ === "pre_registered" ? {
			type: "pre_registered",
			client_id_credential: p.trim(),
			client_secret_credential: h.trim() || void 0
		} : _ === "client_metadata" ? {
			type: "client_metadata",
			url: y.trim()
		} : {
			type: "dynamic",
			client_name: x.trim() || void 0
		};
		c(!0), o(null);
		try {
			let a = await t.configureMcpOAuth(e, {
				registration: r,
				scopes: C.split("\n").map((e) => e.trim()).filter(Boolean),
				authorization_metadata: n
			});
			i(a.status), u(a.authorization_url ?? null), f(!1), m(""), g("");
		} catch {
			o("OAuth configuration was rejected. Check the protected credential names.");
		} finally {
			c(!1);
		}
	}, O = async () => {
		c(!0), o(null), u(null);
		try {
			let n = await t.authenticateMcpOAuth(e);
			i(n.status), u(n.authorization_url);
		} catch {
			i("failed"), o("OAuth authentication could not start.");
		} finally {
			c(!1);
		}
	}, k = async () => {
		c(!0), o(null), u(null);
		try {
			let n = await t.logoutMcpOAuth(e);
			i(n.status);
		} catch {
			o("OAuth logout could not complete.");
		} finally {
			c(!1);
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
					children: gp(r)
				})]
			}),
			r === "needs_configuration" || d ? /* @__PURE__ */ Y(q, { children: [
				/* @__PURE__ */ Y("div", {
					className: "grid md:grid-cols-2 gap-3",
					children: [
						/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ J(du, {
								label: "Client registration",
								required: !0
							}), /* @__PURE__ */ Y("select", {
								className: "h-10 rounded-md border border-border-subtle bg-elevation-surface px-3 text-small text-basic-primary",
								value: _,
								onChange: (e) => v(e.target.value),
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
						_ === "pre_registered" ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ J(du, {
								label: "Client ID credential",
								required: !0
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: p,
								placeholder: "SLACK_MCP_CLIENT_ID",
								onChange: (e) => m(e.target.value)
							})]
						}), /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ J(du, {
								label: "Client secret credential",
								hint: "Optional for public clients."
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: h,
								placeholder: "SLACK_MCP_CLIENT_SECRET",
								onChange: (e) => g(e.target.value)
							})]
						})] }) : null,
						_ === "client_metadata" ? /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ J(du, {
								label: "Client metadata URL",
								required: !0
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: y,
								placeholder: "https://nac.example.com/.well-known/oauth-client.json",
								onChange: (e) => b(e.target.value)
							})]
						}) : null,
						_ === "dynamic" ? /* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1 md:col-span-2",
							children: [/* @__PURE__ */ J(du, {
								label: "Client name",
								hint: "Sent to the authorization server."
							}), /* @__PURE__ */ J(Z, {
								inputSize: n ? X.Large : X.Medium,
								value: x,
								onChange: (e) => S(e.target.value)
							})]
						}) : null
					]
				}),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ J(du, {
						label: "Scopes",
						hint: "One scope per line."
					}), /* @__PURE__ */ J(sc, {
						textAreaClassName: "min-h-[64px] font-mono text-small",
						value: C,
						onChange: (e) => w(e.target.value)
					})]
				}),
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-1",
					children: [/* @__PURE__ */ J(du, {
						label: "Authorization metadata override",
						hint: "Optional JSON for servers without discovery metadata."
					}), /* @__PURE__ */ J(sc, {
						textAreaClassName: "min-h-[72px] font-mono text-small",
						value: T,
						placeholder: _ === "client_metadata" ? "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\",\"client_id_metadata_document_supported\":true}" : "{\"authorization_endpoint\":\"https://…\",\"token_endpoint\":\"https://…\"}",
						onChange: (e) => E(e.target.value)
					})]
				}),
				/* @__PURE__ */ J("div", {
					className: "flex justify-end",
					children: /* @__PURE__ */ J(B, {
						size: L.Medium,
						variant: R.Secondary,
						content: I.Text,
						disabled: s,
						onClick: () => void ee(),
						children: "Configure OAuth"
					})
				})
			] }) : null,
			r && r !== "needs_configuration" && r !== "connecting" && !d ? /* @__PURE__ */ J("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ J(B, {
					size: L.Medium,
					variant: R.Ghost,
					content: I.Text,
					disabled: s,
					onClick: () => f(!0),
					children: "Edit OAuth configuration"
				})
			}) : null,
			r === "needs_authorization" || r === "failed" ? /* @__PURE__ */ J("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ J(B, {
					size: L.Medium,
					variant: R.Secondary,
					content: I.Text,
					disabled: s,
					onClick: () => void O(),
					children: "Authenticate"
				})
			}) : null,
			l ? /* @__PURE__ */ J("a", {
				className: "text-small text-accent-primary underline self-end",
				href: l,
				target: "_blank",
				rel: "noreferrer",
				children: "Continue OAuth authorization"
			}) : null,
			r === "connected" || r === "connecting" ? /* @__PURE__ */ J("div", {
				className: "flex justify-end",
				children: /* @__PURE__ */ J(B, {
					size: L.Medium,
					variant: R.SecondaryDestructive,
					content: I.Text,
					disabled: s,
					onClick: () => void k(),
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
function vp(e) {
	return Object.entries(e).map(([e, t]) => ({
		key: e,
		value: "",
		storedKey: e,
		placeholder: t
	}));
}
function yp(e) {
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
function bp(e) {
	let t = {};
	for (let [n, r] of Object.entries(e)) r !== null && (t[n] = r);
	return t;
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpServerForm.tsx
var xp = [{
	id: "streamable_http",
	label: "Streamable HTTP"
}, {
	id: "stdio",
	label: "Stdio"
}], Sp = [
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
function Cp(e) {
	return e.split("\n").map((e) => e.trim()).filter(Boolean);
}
function wp(e) {
	return e === "stdio" || e === "streamable_http" ? e : "streamable_http";
}
function Tp(e) {
	return e.trim() ? Number(e) : null;
}
function Ep({ record: e, template: t, libraryEntry: n, onBack: r, onClose: i, onSaved: a, onDeleted: o, setFooter: s }) {
	let c = jr(), l = hn(), u = or(), f = h(), p = Kn(), m = Ke(), g = Kt(), _ = br(), [v, y] = K(e?.name ?? t?.name ?? ""), [b, x] = K(e?.enabled ?? !0), [S, C] = K(e?.required ?? !1), [w, T] = K(e?.protocol ?? "legacy"), [E, D] = K(() => wp(e?.transport ?? t?.transport)), [ee, O] = K(e?.url ?? t?.url ?? ""), [k, A] = K(e?.command ?? ""), [te, j] = K(e?.args.join("\n") ?? ""), [ne, re] = K(e?.cwd ?? ""), [ie, ae] = K(e?.env_vars.join("\n") ?? ""), [oe, se] = K(e?.startup_timeout_ms?.toString() ?? ""), [ce, le] = K(e?.catalog_timeout_ms?.toString() ?? ""), [ue, de] = K(e?.execution_timeout_ms?.toString() ?? ""), [M, fe] = K(() => e ? vp(e.headers) : t?.auth_header ? [{
		key: t.auth_header,
		value: "",
		placeholder: t.auth_hint ?? void 0
	}] : []), [pe, N] = K(e ? vp(e.env) : []), [P, F] = K(() => Object.entries(e?.env_headers ?? {}).map(([e, t]) => ({
		key: e,
		value: t
	}))), [me, he] = K(e?.bearer_token_env_var ?? ""), [ge, _e] = K(e?.header_helper?.command ?? ""), [ve, ye] = K(e?.header_helper?.args?.join("\n") ?? ""), [be, xe] = K(e?.header_helper?.cwd ?? ""), [Se, Ce] = K(() => e?.header_helper ? vp(e.header_helper.env ?? {}) : []), [we, Te] = K(e?.header_helper?.env_vars?.join("\n") ?? ""), [Ee, De] = K(e?.header_helper?.timeout_ms?.toString() ?? ""), [Oe, ke] = K(null), Ae = g.data?.servers.find((t) => t.name === e?.name), je = u.isPending || f.isPending || p.isPending || m.isPending || _.isPending, Me = () => v.trim() ? E === "streamable_http" && !ee.trim() ? "A URL is required." : E === "stdio" && !k.trim() ? "A command is required." : null : "A name is required.", Ne = async () => {
		let n = Me();
		if (n) {
			l.error(n);
			return;
		}
		let r = yp(M), i = yp(pe), o = ge.trim() ? {
			command: ge.trim(),
			args: Cp(ve),
			cwd: be.trim() || null,
			env: yp(Se),
			env_vars: Cp(we),
			timeout_ms: Tp(Ee)
		} : null;
		try {
			e ? (a((await f.mutateAsync({
				serverName: e.name,
				payload: {
					name: v.trim(),
					enabled: b,
					required: S,
					startup_timeout_ms: Tp(oe),
					catalog_timeout_ms: Tp(ce),
					execution_timeout_ms: Tp(ue),
					protocol: w,
					transport: E,
					command: E === "stdio" ? k.trim() : null,
					args: E === "stdio" ? Cp(te) : [],
					env: E === "stdio" ? i : {},
					env_vars: E === "stdio" ? Cp(ie) : [],
					cwd: E === "stdio" && ne.trim() || null,
					url: E === "streamable_http" ? ee.trim() : null,
					headers: E === "streamable_http" ? r : {},
					env_headers: E === "streamable_http" ? bp(yp(P)) : {},
					bearer_token_env_var: E === "streamable_http" && me.trim() || null,
					header_helper: E === "streamable_http" ? o : null
				}
			})).name), l.success("MCP server updated.")) : (a((await u.mutateAsync({
				name: v.trim(),
				enabled: b,
				required: S,
				startup_timeout_ms: Tp(oe),
				catalog_timeout_ms: Tp(ce),
				execution_timeout_ms: Tp(ue),
				protocol: w,
				transport: E,
				command: E === "stdio" ? k.trim() : null,
				args: E === "stdio" ? Cp(te) : [],
				env: E === "stdio" ? bp(i) : {},
				env_vars: E === "stdio" ? Cp(ie) : [],
				cwd: E === "stdio" && ne.trim() || null,
				url: E === "streamable_http" ? ee.trim() : null,
				headers: E === "streamable_http" ? bp(r) : {},
				env_headers: E === "streamable_http" ? bp(yp(P)) : {},
				bearer_token_env_var: E === "streamable_http" && me.trim() || null,
				header_helper: E === "streamable_http" && o ? {
					...o,
					env: bp(o.env)
				} : null,
				library_id: t?.id ?? null
			})).name), l.success("MCP server saved."));
		} catch (e) {
			l.error(`Save failed: ${ir($(e))}`);
		}
	}, Pe = async () => {
		if (e) try {
			await p.mutateAsync(e.name), o(), l.success("MCP server deleted.");
		} catch (e) {
			l.error(`Delete failed: ${ir($(e))}`);
		}
	}, Fe = async (t) => {
		if (e) try {
			let n = await _.mutateAsync({
				serverName: e.name,
				action: t
			});
			n.state === "failed" ? l.error(n.error ?? "MCP runtime operation failed.") : l.success(`MCP server is ${n.state}.`);
		} catch (e) {
			l.error(`Runtime operation failed: ${ir($(e))}`);
		}
	}, Ie = async () => {
		let t = E === "streamable_http" && !ee.trim() ? "A URL is required to test." : E === "stdio" && !k.trim() ? "A command is required to test." : null;
		if (t) {
			l.error(t);
			return;
		}
		ke(null);
		try {
			let t = await m.mutateAsync({
				stored_name: e?.name ?? null,
				name: v.trim() || null,
				transport: E,
				command: E === "stdio" ? k.trim() : null,
				args: E === "stdio" ? Cp(te) : [],
				env: E === "stdio" ? yp(pe) : {},
				env_vars: E === "stdio" ? Cp(ie) : [],
				cwd: E === "stdio" && ne.trim() || null,
				url: E === "streamable_http" ? ee.trim() : null,
				headers: E === "streamable_http" ? yp(M) : {},
				env_headers: E === "streamable_http" ? bp(yp(P)) : {},
				bearer_token_env_var: E === "streamable_http" && me.trim() || null,
				header_helper: E === "streamable_http" && ge.trim() ? {
					command: ge.trim(),
					args: Cp(ve),
					cwd: be.trim() || null,
					env: yp(Se),
					env_vars: Cp(we),
					timeout_ms: Tp(Ee)
				} : null,
				startup_timeout_ms: Tp(oe),
				catalog_timeout_ms: Tp(ce),
				execution_timeout_ms: Tp(ue),
				protocol: w
			});
			if (!t.connected) {
				l.error(`Test failed: ${t.error ?? "connection failed"}`);
				return;
			}
			ke(t.tools), l.success(`Connection succeeded: ${t.tools.length} tool${t.tools.length === 1 ? "" : "s"} found.`);
		} catch (e) {
			l.error(`Test failed: ${ir($(e))}`);
		}
	}, Le = G(Ne), Re = G(Pe), ze = G(i);
	return $r(() => {
		Le.current = Ne, Re.current = Pe, ze.current = i;
	}), $r(() => (s(/* @__PURE__ */ Y(q, { children: [
		e ? /* @__PURE__ */ J(pp, {
			isMobile: c,
			variant: R.SecondaryDestructive,
			content: I.Icon,
			className: "mr-auto",
			ariaLabel: "Delete server",
			disabled: je,
			onClick: () => void Re.current(),
			children: /* @__PURE__ */ J(z, { iconName: V.Trash })
		}) : null,
		/* @__PURE__ */ J(pp, {
			isMobile: c,
			variant: R.Secondary,
			onClick: () => ze.current(),
			children: "Cancel"
		}),
		/* @__PURE__ */ J(pp, {
			isMobile: c,
			variant: R.Primary,
			disabled: je,
			onClick: () => void Le.current(),
			children: "Save"
		})
	] })), () => s(null)), [
		c,
		je,
		e,
		s
	]), /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0",
		children: [r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-1 shrink-0 border-b border-muted px-2 py-2",
			children: [/* @__PURE__ */ J(B, {
				size: L.Medium,
				variant: R.Ghost,
				content: I.Icon,
				"aria-label": "Back to library",
				onClick: r,
				children: /* @__PURE__ */ J(z, { iconName: V.Left })
			}), /* @__PURE__ */ J("span", {
				className: "text-medium text-basic-primary truncate",
				children: v.trim() || "Custom server"
			})]
		}) : null, /* @__PURE__ */ Y("div", {
			className: d("flex-1 overflow-auto p-4 flex flex-col gap-4 [&>*]:shrink-0", c && "pb-[88px]"),
			children: [
				n ? /* @__PURE__ */ J(fp, { entry: n }) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-col md:flex-row gap-4",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex flex-col gap-1 flex-grow",
						children: [/* @__PURE__ */ J(du, {
							label: "Name",
							required: !0
						}), /* @__PURE__ */ J(Z, {
							inputSize: c ? X.Large : X.Medium,
							placeholder: "my_server",
							value: v,
							onChange: (e) => y(e.target.value)
						})]
					}), /* @__PURE__ */ J("div", {
						className: "md:pt-6",
						children: /* @__PURE__ */ Y("div", {
							className: "flex gap-4 items-center px-4 py-2 rounded-md bg-elevation-sublevel-variant-A shadow-convex",
							children: [
								/* @__PURE__ */ J(du, {
									label: "Enabled",
									hint: "Disabled servers are kept but not connected when a session starts."
								}),
								/* @__PURE__ */ J(ul, {
									checked: b,
									size: c ? ol.Large : ol.Medium,
									onChange: x
								}),
								/* @__PURE__ */ J(du, {
									label: "Required",
									hint: "Fail session admission when this enabled server cannot start."
								}),
								/* @__PURE__ */ J(ul, {
									checked: S,
									size: c ? ol.Large : ol.Medium,
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
							children: [/* @__PURE__ */ J(du, { label: "Transport" }), /* @__PURE__ */ J("div", {
								className: "flex gap-2",
								children: xp.map((e) => /* @__PURE__ */ J(B, {
									size: c ? L.Medium : L.Small,
									variant: E === e.id ? R.Primary : R.Secondary,
									content: I.Text,
									"aria-pressed": E === e.id,
									onClick: () => D(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						/* @__PURE__ */ Y("div", {
							className: "flex flex-col gap-1",
							children: [/* @__PURE__ */ J(du, {
								label: "Protocol",
								hint: Sp.find((e) => e.id === w)?.hint
							}), /* @__PURE__ */ J("div", {
								className: "flex flex-wrap gap-2",
								children: Sp.map((e) => /* @__PURE__ */ J(B, {
									size: c ? L.Medium : L.Small,
									variant: w === e.id ? R.Primary : R.Secondary,
									content: I.Text,
									"aria-pressed": w === e.id,
									onClick: () => T(e.id),
									children: e.label
								}, e.id))
							})]
						}),
						E === "streamable_http" ? /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(du, {
									label: "URL",
									required: !0
								}), /* @__PURE__ */ J(Z, {
									inputSize: c ? X.Large : X.Medium,
									placeholder: "https://example.com/mcp",
									value: ee,
									onChange: (e) => O(e.target.value)
								})]
							}),
							/* @__PURE__ */ J(hp, {
								label: "Headers",
								hint: "Sent with every request. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "Authorization",
								rows: M,
								onChange: fe
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(du, {
									label: "Bearer token environment variable",
									hint: "The variable value is sent as a Bearer token without persisting it."
								}), /* @__PURE__ */ J(Z, {
									inputSize: c ? X.Large : X.Medium,
									placeholder: "MCP_TOKEN",
									value: me,
									onChange: (e) => he(e.target.value)
								})]
							}),
							/* @__PURE__ */ J(hp, {
								label: "Environment-backed headers",
								hint: "Map each HTTP header name to the environment variable that supplies its value.",
								keyPlaceholder: "X-API-Key",
								rows: P,
								onChange: F
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(du, {
									label: "Header helper command",
									hint: "Optional bounded command that prints a JSON object of same-origin request headers."
								}), /* @__PURE__ */ J(Z, {
									inputSize: c ? X.Large : X.Medium,
									placeholder: "./refresh-mcp-headers",
									value: ge,
									onChange: (e) => _e(e.target.value)
								})]
							}),
							ge.trim() ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(du, {
										label: "Header helper arguments",
										hint: "One argument per line."
									}), /* @__PURE__ */ J(sc, {
										textAreaClassName: "min-h-[64px] font-mono",
										value: ve,
										onChange: (e) => ye(e.target.value)
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(du, { label: "Header helper working directory" }), /* @__PURE__ */ J(Z, {
										inputSize: c ? X.Large : X.Medium,
										value: be,
										onChange: (e) => xe(e.target.value)
									})]
								}),
								/* @__PURE__ */ J(hp, {
									label: "Header helper environment",
									hint: "Stored literals remain write-only.",
									keyPlaceholder: "TOKEN",
									rows: Se,
									onChange: Ce
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(du, {
										label: "Header helper forwarded environment",
										hint: "One variable name per line."
									}), /* @__PURE__ */ J(sc, {
										textAreaClassName: "min-h-[64px] font-mono",
										value: we,
										onChange: (e) => Te(e.target.value)
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1",
									children: [/* @__PURE__ */ J(du, { label: "Header helper timeout (ms)" }), /* @__PURE__ */ J(Z, {
										inputSize: c ? X.Large : X.Medium,
										type: "number",
										min: 100,
										max: 6e5,
										value: Ee,
										onChange: (e) => De(e.target.value)
									})]
								})
							] }) : null
						] }) : /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(du, {
									label: "Command",
									required: !0
								}), /* @__PURE__ */ J(Z, {
									inputSize: c ? X.Large : X.Medium,
									placeholder: "npx",
									value: k,
									onChange: (e) => A(e.target.value)
								})]
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(du, {
									label: "Arguments",
									hint: "One argument per line."
								}), /* @__PURE__ */ J(sc, {
									textAreaClassName: d("min-h-[72px] font-mono", c ? "text-medium" : "text-small"),
									placeholder: "-y\nsome-mcp-server",
									value: te,
									onChange: (e) => j(e.target.value)
								})]
							}),
							/* @__PURE__ */ J(hp, {
								label: "Environment",
								hint: "Set for the server process. Values may reference an environment variable as ${VAR_NAME}; stored literals never display again.",
								keyPlaceholder: "API_KEY",
								rows: pe,
								onChange: N
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(du, {
									label: "Working directory",
									hint: "Relative paths resolve from the workspace."
								}), /* @__PURE__ */ J(Z, {
									inputSize: c ? X.Large : X.Medium,
									placeholder: "packages/server",
									value: ne,
									onChange: (e) => re(e.target.value)
								})]
							}),
							/* @__PURE__ */ Y("div", {
								className: "flex flex-col gap-1",
								children: [/* @__PURE__ */ J(du, {
									label: "Forward environment variables",
									hint: "One existing host variable name per line."
								}), /* @__PURE__ */ J(sc, {
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
								children: [/* @__PURE__ */ J(du, { label: e }), /* @__PURE__ */ J(Z, {
									inputSize: c ? X.Large : X.Medium,
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
							].map((e) => /* @__PURE__ */ J(B, {
								size: L.Small,
								variant: R.Secondary,
								disabled: je,
								onClick: () => void Fe(e),
								children: e[0].toUpperCase() + e.slice(1)
							}, e))]
						}) : null,
						/* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2 justify-end",
							children: [/* @__PURE__ */ Y(B, {
								size: L.Medium,
								variant: R.Secondary,
								disabled: je,
								onClick: () => void Ie(),
								content: I.IconLeft,
								children: [/* @__PURE__ */ J(z, { iconName: V.Bolt }), m.isPending ? "Testing…" : "Test connection"]
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
				e && E === "streamable_http" ? /* @__PURE__ */ J(_p, { serverName: e.name }) : null,
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
function Dp({ error: e, retrying: t, onRetry: n }) {
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
			/* @__PURE__ */ J(B, {
				variant: R.Secondary,
				size: L.Small,
				content: I.Text,
				loading: t,
				onClick: n,
				children: "Try again"
			})
		]
	});
}
//#endregion
//#region src/app/components/modals/MCPServersModal/McpServersMobile.tsx
function Op({ open: e, onClose: t }) {
	let { data: n } = jn(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = tn(), l = r?.servers ?? [], [u, d] = K(!1), [f, p] = K(null), [m, h] = K(null), [g, _] = K(null), v = l.find((e) => e.name === m) ?? null, y = f?.template ?? null, b = y ?? (v ? n?.entries.find((e) => e.id === v.library_id || e.name === v.name) ?? null : null), x = () => {
		p(null), h(null), d(!1);
	}, S = () => {
		p(null), h(null);
	};
	return /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ J(Ht, {
			open: e,
			onClose: t,
			title: "MCP servers",
			children: a ? /* @__PURE__ */ J(Dp, {
				error: i,
				retrying: o,
				onRetry: () => {
					c();
				}
			}) : /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1 [&>*]:shrink-0",
				children: [
					/* @__PURE__ */ Y(Qc, {
						size: Xc.Large,
						onClick: () => d(!0),
						children: [
							/* @__PURE__ */ J(z, { iconName: V.Add }),
							/* @__PURE__ */ J("span", {
								className: "text-left flex-grow truncate",
								children: "Add server"
							}),
							/* @__PURE__ */ J(z, {
								iconName: V.Right,
								className: "shrink-0"
							})
						]
					}),
					l.length ? /* @__PURE__ */ J(Q, {}) : null,
					l.map((e) => /* @__PURE__ */ Y(Qc, {
						size: Xc.Large,
						onClick: () => h(e.name),
						children: [/* @__PURE__ */ J("span", {
							className: "text-left flex-grow truncate",
							children: e.name
						}), /* @__PURE__ */ J(z, {
							iconName: V.Right,
							className: "shrink-0"
						})]
					}, e.name)),
					s ? /* @__PURE__ */ Y("div", {
						className: "flex items-center gap-2 px-2 py-1",
						children: [/* @__PURE__ */ J(A, { size: M.Micro }), /* @__PURE__ */ J("span", {
							className: "text-micro text-basic-muted",
							children: "Loading…"
						})]
					}) : null
				]
			})
		}),
		/* @__PURE__ */ J(Ht, {
			open: u,
			onClose: () => d(!1),
			title: "Add server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			children: /* @__PURE__ */ J(mp, {
				onPick: (e) => p({ template: e }),
				onCustom: () => p({ template: null })
			})
		}),
		/* @__PURE__ */ J(Ht, {
			open: f !== null || m !== null,
			onClose: S,
			title: v?.name ?? y?.name ?? "Custom server",
			bodyClassName: "p-0 overflow-hidden flex flex-col",
			footer: g,
			children: /* @__PURE__ */ J(Ep, {
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
var kp = "__new__";
function Ap({ open: e, onClose: t }) {
	let n = ld(e), r = jr();
	return n ? J(r ? Op : jp, {
		open: e,
		onClose: t
	}) : null;
}
function jp({ open: e, onClose: t }) {
	let { data: n } = jn(), { data: r, error: i, isError: a, isFetching: o, isLoading: s, refetch: c } = tn(), l = W(() => r?.servers ?? [], [r]), [u, d] = K(null), [f, p] = K(null), [m, h] = K(!1), [g, _] = K(null), v = u ?? l.at(-1)?.name ?? kp, y = l.find((e) => e.name === v) ?? null, b = v === kp, x = (e) => {
		d(e), p(null), h(!1);
	}, S = f ?? (y ? n?.entries.find((e) => e.id === y.library_id || e.name === y.name) ?? null : null);
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: t,
		title: "MCP servers",
		size: Mn.Large,
		flush: !0,
		className: "md:h-[740px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: g,
		children: a ? /* @__PURE__ */ J(Dp, {
			error: i,
			retrying: o,
			onRetry: () => {
				c();
			}
		}) : /* @__PURE__ */ Y("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ J(rp, {
				draftLabel: "Add server",
				draftSelected: b,
				onSelectDraft: () => x(kp),
				entries: l.map((e) => ({
					id: e.name,
					name: e.name
				})),
				selectedId: v,
				onSelect: x,
				isLoading: s
			}), b && !f && !m ? /* @__PURE__ */ J(mp, {
				onPick: (e) => p(e),
				onCustom: () => h(!0),
				onClose: t,
				setFooter: _
			}) : /* @__PURE__ */ J(Ep, {
				record: y,
				template: f,
				libraryEntry: S,
				onBack: () => {
					d(kp), p(null), h(!1);
				},
				onClose: t,
				onSaved: x,
				onDeleted: () => x(kp),
				setFooter: _
			}, y ? y.name : f?.id ?? "custom")]
		})
	});
}
//#endregion
//#region src/app/components/modals/SshConfigsModal.tsx
var Mp = "__new__";
function Np(e) {
	let t = new Set(e.map((e) => e.name)), n = e.length + 1;
	for (; t.has(`SSH-config-${n}`);) n += 1;
	return `SSH-config-${n}`;
}
function Pp({ open: e, onClose: t }) {
	return ld(e) ? /* @__PURE__ */ J(Fp, {
		open: e,
		onClose: t
	}) : null;
}
function Fp({ open: e, onClose: t }) {
	let n = jr(), { data: r, isLoading: i } = It(), a = W(() => r?.configurations ?? [], [r]), [o, s] = K(null), [c, l] = K(null), u = o ?? a.at(-1)?.config_id ?? Mp, d = a.find((e) => e.config_id === u) ?? null;
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: t,
		title: "SSH configs",
		size: Mn.Large,
		flush: !0,
		className: "max-w-[780px] md:h-[480px]",
		bodyClassName: "p-0 overflow-hidden",
		footer: c,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col md:flex-row items-stretch h-full min-h-0",
			children: [/* @__PURE__ */ J(rp, {
				draftLabel: "Create New",
				draftSelected: u === Mp,
				onSelectDraft: () => s(Mp),
				entries: a.map((e) => ({
					id: e.config_id,
					name: e.name
				})),
				selectedId: u,
				onSelect: s,
				isLoading: i
			}), /* @__PURE__ */ J(Ip, {
				record: d,
				defaultName: Np(a),
				onClose: t,
				onSaved: s,
				onDeleted: () => s(Mp),
				setFooter: l,
				isMobile: n
			}, u)]
		})
	});
}
function Ip({ record: e, defaultName: t, onClose: n, onSaved: r, onDeleted: i, setFooter: a, isMobile: o }) {
	let s = hn(), c = jt(), l = Ze(), u = Vt(), f = Fr(), [p, m] = K(e?.name ?? t), [h, g] = K(e?.ssh_host ?? ""), [_, v] = K(e?.ssh_port ? String(e.ssh_port) : ""), [y, b] = K(e?.ssh_identity_file ?? ""), x = c.isPending || l.isPending || u.isPending || f.isPending, S = async () => {
		let t = p.trim(), n = h.trim();
		if (!t || !n) {
			s.error("Name and SSH host are required.");
			return;
		}
		let i = _.trim() ? Number(_.trim()) : null;
		if (_.trim() && (!Number.isInteger(i) || (i ?? 0) < 1 || (i ?? 0) > 65535)) {
			s.error("Port must be an integer between 1 and 65535.");
			return;
		}
		try {
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
			s.error(`Save failed: ${ir($(e))}`);
		}
	}, C = async () => {
		if (e) try {
			await u.mutateAsync(e.config_id), i(), s.success("SSH config deleted.");
		} catch (e) {
			s.error(`Delete failed: ${ir($(e))}`);
		}
	}, w = async () => {
		let e = h.trim();
		if (!e) {
			s.error("An SSH host is required to test.");
			return;
		}
		let t = _.trim() ? Number(_.trim()) : null;
		await f.mutateAsync({
			ssh_host: e,
			ssh_port: t,
			ssh_identity_file: y.trim() || null
		}), s.success("SSH connection succeeded.");
	}, T = G(S), E = G(C);
	return $r(() => {
		T.current = S, E.current = C;
	}), $r(() => (a(/* @__PURE__ */ Y(q, { children: [
		e ? o ? /* @__PURE__ */ J(Ti, {
			variant: R.SecondaryDestructive,
			content: I.Icon,
			className: "mr-auto",
			disabled: x,
			onClick: () => void E.current(),
			children: /* @__PURE__ */ J(z, { iconName: V.Trash })
		}) : /* @__PURE__ */ J(B, {
			size: L.Large,
			variant: R.SecondaryDestructive,
			content: I.Icon,
			className: "mr-auto",
			disabled: x,
			onClick: () => void E.current(),
			children: /* @__PURE__ */ J(z, { iconName: V.Trash })
		}) : null,
		o ? /* @__PURE__ */ J(Ti, {
			variant: R.Secondary,
			content: I.Text,
			onClick: n,
			children: "Cancel"
		}) : /* @__PURE__ */ J(B, {
			size: L.Large,
			variant: R.Ghost,
			onClick: n,
			children: "Cancel"
		}),
		o ? /* @__PURE__ */ J(Ti, {
			variant: R.Primary,
			content: I.Text,
			disabled: x,
			onClick: () => void T.current(),
			children: "Save"
		}) : /* @__PURE__ */ J(B, {
			size: L.Large,
			variant: R.Primary,
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
			className: d("flex-1 overflow-auto p-4 [&>*]:shrink-0", o && "pb-[88px]"),
			children: /* @__PURE__ */ J(Ld, {
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
var Lp = Jr(null);
function Rp() {
	let e = Zr(Lp);
	if (!e) throw Error("useManagedHost must be used within ManagedHostProvider");
	return e;
}
//#endregion
//#region src/app/components/TopBar.tsx
var zp = "linear-gradient(to bottom, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))", Bp = { backgroundImage: `${zp}, ${zp}` };
function Vp() {
	let { useSidebarOffset: e } = P().stores.sidebarLayoutStore, [t, n] = K(!1), [r, i] = K(!1), [a, o] = K(!1), s = jr(), c = Qe(), { pathname: l } = fi(), u = Of(), f = Rp(), p = e(), m = Wt(l) !== null || kn(l) !== null;
	return !s && (Wt(l) !== null || l === vr.list()) ? null : /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ Y("header", {
			className: d("fixed top-0 right-0 z-10 flex items-center justify-between py-2 shrink-0", "transition-[left] duration-500 ease-in-out", s ? "h-16 px-3 gap-4" : c ? "h-[52px] px-3" : "h-[52px] px-4"),
			style: { left: p },
			children: [
				/* @__PURE__ */ J("div", {
					className: d("absolute inset-x-0 top-0 pointer-events-none", s ? "-bottom-[76px]" : "-bottom-[8px]"),
					style: Bp
				}),
				/* @__PURE__ */ Y("div", {
					className: d("relative flex items-center", s ? "flex-1 min-w-0 gap-4" : c ? "shrink-0 gap-4" : "shrink-0 gap-8"),
					children: [p > 0 ? null : /* @__PURE__ */ J(si, {
						to: vr.list(),
						className: "shrink-0",
						"aria-label": "All projects",
						children: /* @__PURE__ */ J(pc, {
							height: 36,
							markOnly: s || c,
							className: "text-basic-primary"
						})
					}), /* @__PURE__ */ J(Zf, {})]
				}),
				/* @__PURE__ */ Y("div", {
					className: "relative flex items-center shrink-0 gap-2",
					children: [
						s && !m ? /* @__PURE__ */ J(B, {
							variant: R.Primary,
							size: L.Medium,
							content: I.Icon,
							className: "btn-round",
							"aria-label": f.isManaged ? "Add repository" : "New project",
							onClick: f.isManaged ? f.addRepository : u.create,
							children: /* @__PURE__ */ J(z, { iconName: V.Add })
						}) : null,
						/* @__PURE__ */ J(np, {}),
						/* @__PURE__ */ J(tp, { onOpen: () => o(!0) }),
						/* @__PURE__ */ J(ep, {
							onConfigurations: () => n(!0),
							onSshConfigs: () => i(!0),
							onManagedHost: f.isManaged ? f.openSettings : void 0
						})
					]
				})
			]
		}),
		/* @__PURE__ */ J(sp, {
			open: t,
			onClose: () => n(!1)
		}),
		/* @__PURE__ */ J(Pp, {
			open: r,
			onClose: () => i(!1)
		}),
		/* @__PURE__ */ J(Ap, {
			open: a,
			onClose: () => o(!1)
		})
	] });
}
//#endregion
//#region src/app/components/AppShell.tsx
function Hp() {
	return /* @__PURE__ */ Y("div", {
		className: "h-full flex flex-col bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ J(Vp, {}), /* @__PURE__ */ J("main", {
			className: "flex-1 min-h-0",
			children: /* @__PURE__ */ J(li, {})
		})]
	});
}
//#endregion
//#region src/app/components/sessions/SessionFilters.tsx
var Up = { paddingInline: "12px" };
function Wp() {
	return /* @__PURE__ */ J("div", { className: "h-px w-full bg-divider-muted shrink-0" });
}
function Gp({ children: e, gap: t }) {
	return /* @__PURE__ */ J("div", {
		className: d("flex flex-col px-4 py-6", t),
		children: e
	});
}
function Kp({ label: e, items: t, value: n, onValueChange: r, stacked: i, sidebar: a = !1 }) {
	return /* @__PURE__ */ Y("div", {
		className: d(i ? "flex flex-col gap-1" : a ? "flex items-center gap-1" : "flex items-center justify-between gap-3"),
		children: [/* @__PURE__ */ J("div", {
			className: d(i ? "label-medium text-basic-primary" : "label-small shrink-0", a || i ? "text-basic-primary" : "text-basic-secondary", a && "flex-1 min-w-0"),
			children: e
		}), /* @__PURE__ */ J(el, {
			items: t,
			value: n,
			onValueChange: r,
			size: i ? L.Large : L.Small,
			variant: R.Secondary,
			placement: s.BottomLeft,
			sticky: a,
			className: i ? "w-full" : "min-w-0",
			triggerClassName: i ? "w-full btn-field" : a ? "!gap-1.5 !pl-3" : ""
		})]
	});
}
function qp({ label: e, options: t, selected: n, onToggle: r, labelOf: i = (e) => e, touch: a, sidebar: o = !1 }) {
	return /* @__PURE__ */ Y("div", {
		className: d("flex flex-col", o ? "gap-2" : "gap-3"),
		children: [/* @__PURE__ */ J("div", {
			className: d(a ? "label-medium text-basic-primary" : "label-small", o || a ? "text-basic-primary" : "text-basic-secondary"),
			children: e
		}), /* @__PURE__ */ J("div", {
			className: "flex flex-wrap gap-2",
			children: t.map((e) => /* @__PURE__ */ J(B, {
				size: a ? L.Medium : L.Small,
				content: I.Text,
				variant: n.includes(e) ? R.Primary : R.Secondary,
				onClick: () => r(e),
				"aria-pressed": n.includes(e),
				style: a ? void 0 : Up,
				children: i(e)
			}, e))
		})]
	});
}
function Jp({ sessions: e, showSearch: t = !0, mobile: n = !1, sidebar: r = !1, onChange: i }) {
	let { useSort: a, useSessionProviders: o, useSessionEnvs: s, useSelectedProviders: c, useSelectedEnvs: l, useModifiedRange: u, useFilterQuery: d, useCreatedRange: f, toggleProvider: p, toggleEnv: m, setSort: h, setQuery: g, setModifiedRange: _, setCreatedRange: v, pruneUnavailableFacets: y, SORT_ITEMS: b, RANGE_ITEMS: x } = P().stores.sessionFiltersStore, S = d(), C = a(), w = f(), T = u(), E = l(), D = c(), ee = s(e), O = o(e);
	U(() => {
		y(ee, O);
	}, [
		ee,
		O,
		y
	]);
	let k = (e) => (t) => {
		e(t), i?.();
	}, A = /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ J(Kp, {
			label: "Sort by",
			items: b,
			value: C,
			onValueChange: k((e) => h(e)),
			stacked: n,
			sidebar: r
		}),
		/* @__PURE__ */ J(Kp, {
			label: "Creation date",
			items: x,
			value: w,
			onValueChange: k((e) => v(e)),
			stacked: n,
			sidebar: r
		}),
		/* @__PURE__ */ J(Kp, {
			label: "Modification date",
			items: x,
			value: T,
			onValueChange: k((e) => _(e)),
			stacked: n,
			sidebar: r
		})
	] });
	return r ? /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ J("div", {
				className: "flex flex-col gap-6 py-2",
				children: A
			}),
			ee.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Wp, {}), /* @__PURE__ */ J("div", {
				className: "py-2",
				children: /* @__PURE__ */ J(qp, {
					label: "Environment",
					options: ee,
					selected: E,
					onToggle: k(m),
					touch: !1,
					sidebar: !0
				})
			})] }) : null,
			O.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Wp, {}), /* @__PURE__ */ J("div", {
				className: "py-2",
				children: /* @__PURE__ */ J(qp, {
					label: "Provider",
					options: O,
					selected: D,
					onToggle: k(p),
					labelOf: mr,
					touch: !1,
					sidebar: !0
				})
			})] }) : null
		]
	}) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col",
		children: [
			t ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Gp, {
				gap: "gap-4",
				children: /* @__PURE__ */ J(Z, {
					inputSize: X.Medium,
					leading: Js.Icon,
					leadingIconName: V.Search,
					placeholder: "Search projects",
					value: S,
					onChange: (e) => g(e.target.value),
					"aria-label": "Search projects"
				})
			}), /* @__PURE__ */ J(Wp, {})] }) : null,
			/* @__PURE__ */ J(Gp, {
				gap: n ? "gap-6" : "gap-4",
				children: A
			}),
			ee.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Wp, {}), /* @__PURE__ */ J(Gp, {
				gap: "gap-4",
				children: /* @__PURE__ */ J(qp, {
					label: "Environment",
					options: ee,
					selected: E,
					onToggle: k(m),
					touch: n
				})
			})] }) : null,
			O.length > 1 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Wp, {}), /* @__PURE__ */ J(Gp, {
				gap: "gap-4",
				children: /* @__PURE__ */ J(qp, {
					label: "Provider",
					options: O,
					selected: D,
					onToggle: k(p),
					labelOf: mr,
					touch: n
				})
			})] }) : null
		]
	});
}
//#endregion
//#region src/app/components/LeftSidebar/NewSessionPopover.tsx
var Yp = [
	{
		behavior: "direct",
		label: "Agent Session",
		icon: V.Plane
	},
	{
		behavior: "direct-with-orchestrator",
		label: "Agent + Orchestrator Session",
		icon: V.PlaneAdd
	},
	{
		behavior: "orchestrator",
		label: "Orchestrator Session",
		icon: V.Orchestrator
	}
];
function Xp(e) {
	let t = Fl(e);
	return [
		t.topLevel,
		t.editing,
		t.delegation,
		t.inspection
	].join(" ");
}
function Zp({ projectId: e, onUnavailable: t, className: n, children: r }) {
	let i = se(), [a, o] = K(!1), c = pi(), l = hn(), u = Qt(), d = () => {
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
		if (!(!e || u.isPending)) try {
			let n = (await u.mutateAsync({
				project_id: e,
				behavior: nt(i, t)
			})).metadata.session_id;
			o(!1), n && c(vr.session(n));
		} catch (e) {
			l.error(`Failed to start a chat: ${au($(e))}`);
		}
	};
	return /* @__PURE__ */ J(pn, {
		open: a,
		onClose: () => o(!1),
		sticky: !0,
		placement: s.RightTop,
		size: cn.Medium,
		panelClassName: "gap-2",
		className: n,
		content: /* @__PURE__ */ J(q, { children: Yp.map((e) => {
			let t = Fl(e.behavior);
			return /* @__PURE__ */ Y(Qc, {
				disabled: u.isPending,
				hoverHint: {
					title: t.label,
					description: Xp(e.behavior),
					muted: !0
				},
				onClick: () => void f(e.behavior),
				children: [/* @__PURE__ */ J(z, { iconName: e.icon }), /* @__PURE__ */ J("span", {
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
var Qp = 6e4, $p = 4;
function em({ projects: e, sessions: t, query: n, activeSessionId: r, activeProjectId: i }) {
	let a = pi(), o = hl(), s = gn(Qp), [c, l] = K(() => /* @__PURE__ */ new Set()), [u, d] = K(() => /* @__PURE__ */ new Map()), [f, p] = K(() => /* @__PURE__ */ new Set()), m = n.trim().toLowerCase(), h = W(() => xl(e, t), [e, t]), g = W(() => t.filter((e) => e.lineage == null && !e.summary.project_id), [t]), _ = (e) => m ? !0 : u.get(e) === r ? !1 : c.has(e) || e === i, v = (e) => {
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
					children: /* @__PURE__ */ J(Gc, {
						entityId: t,
						name: e.project.name,
						running: e.running > 0,
						"aria-expanded": n,
						onClick: () => v(t)
					})
				}), /* @__PURE__ */ J(_a, {
					isOpen: n,
					inert: !n,
					"aria-hidden": !n,
					className: "w-full duration-500 ease-in-out",
					children: /* @__PURE__ */ J(rm, {
						sessions: c,
						activeSessionId: r,
						revealed: m.length > 0 || f.has(t),
						onReveal: () => p((e) => {
							let n = new Set(e);
							return n.add(t), n;
						}),
						now: s,
						onOpen: (e) => a(vr.session(e))
					})
				})]
			}, t);
		}), b.length > 0 ? /* @__PURE__ */ J("section", {
			className: "flex flex-col px-2 py-1",
			children: b.map((e) => /* @__PURE__ */ J(Gc, {
				entityId: e.summary.session_id,
				name: o(e.summary),
				variant: Wc.Orphan,
				active: e.summary.session_id === r,
				running: wr(e.active_run),
				onClick: () => a(vr.session(e.summary.session_id))
			}, e.summary.session_id))
		}) : null]
	});
}
function tm(e, t, n) {
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
function nm(e, t) {
	if (t) return e;
	let n = $p, r = [];
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
function rm({ sessions: e, activeSessionId: t, revealed: n, onReveal: r, now: i, onOpen: a }) {
	let o = hl(), s = se(), c = Hf(), l = W(() => Nl(e, (e) => ({
		updatedAt: e.summary.updated_at,
		pinned: !!e.summary.pinned
	}), i), [e, i]);
	if (e.length === 0) return /* @__PURE__ */ J("p", {
		className: "label-small text-basic-muted px-4 pb-3",
		children: "No chats yet"
	});
	let u = tm(nm(l, n), l, t), d = u.reduce((e, t) => e + t.items.length, 0), f = Math.max(0, e.length - d);
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
					let n = o(e.summary), r = Fl(e.summary.behavior);
					return /* @__PURE__ */ J(ki, {
						title: n,
						icon: Il(e.summary.behavior),
						"aria-label": s.orchestrationEnabled ? `${n}, ${r.navigationLabel}` : n,
						active: e.summary.session_id === t,
						running: wr(e.active_run),
						forkedFromTitle: e.summary.forked_from?.title,
						onClick: () => a(e.summary.session_id),
						actions: /* @__PURE__ */ J(fl, {
							title: n,
							pinned: e.summary.pinned,
							onPin: () => void c.togglePin(e.summary),
							onRename: () => c.rename(e.summary),
							onDelete: () => c.remove(e.summary)
						})
					}, e.summary.session_id);
				})
			})]
		}, e.label)), f > 0 ? /* @__PURE__ */ Y(Qc, {
			onClick: r,
			children: [/* @__PURE__ */ J(z, { iconName: V.MenuHorizontal }), /* @__PURE__ */ Y("span", {
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
function im({ isOpen: e, onToggle: t, toggleKeys: n, commands: r, variant: i }) {
	let { useFilterQuery: a, setQuery: o } = P().stores.sessionFiltersStore, c = i === "projects", [l, u] = K(""), d = a(), { data: f = [] } = Rt(), { data: p } = it(), { data: m } = Xt(), h = m?.store_path ?? "", g = p?.projects ?? [];
	return /* @__PURE__ */ Y("div", {
		className: "flex h-full flex-col bg-elevation-level-2 border-r border-muted",
		style: { boxShadow: "var(--left-sidebar-open)" },
		children: [
			/* @__PURE__ */ Y("div", {
				className: "flex items-center justify-between px-4 py-2 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ J(pc, {
					height: 28,
					className: "text-basic-primary"
				}), /* @__PURE__ */ J(Ln, {
					title: "Hide sidebar",
					keyboardShortcuts: n,
					position: s.CenterLeft,
					sticky: !0,
					disabled: !e,
					children: /* @__PURE__ */ J(B, {
						variant: R.Ghost,
						content: I.Icon,
						"aria-label": "Hide sidebar",
						onClick: t,
						children: /* @__PURE__ */ J(z, { iconName: V.SidebarChevronLeft })
					})
				})]
			}),
			/* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-3 px-2 py-3 border-b border-muted shrink-0",
				children: [/* @__PURE__ */ J("div", {
					className: "px-1",
					children: /* @__PURE__ */ J(Z, {
						inputSize: X.Medium,
						leading: Js.Icon,
						leadingIconName: V.Search,
						placeholder: c ? "Search Projects" : "Search Sessions",
						value: c ? d : l,
						"aria-label": c ? "Search projects" : "Search sessions",
						onChange: (e) => c ? o(e.target.value) : u(e.target.value)
					})
				}), /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-0.5",
					children: [
						c ? /* @__PURE__ */ Y(Qc, {
							onClick: r.newProject,
							children: [/* @__PURE__ */ J(z, { iconName: V.Add }), /* @__PURE__ */ J("span", {
								className: "text-left flex-grow",
								children: r.createLabel
							})]
						}) : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Zp, {
							projectId: r.projectId,
							onUnavailable: r.newSession,
							className: "w-full",
							children: (e) => /* @__PURE__ */ Y(Qc, {
								onClick: e,
								children: [
									/* @__PURE__ */ J(z, { iconName: V.Add }),
									/* @__PURE__ */ J("span", {
										className: "text-left flex-grow",
										children: "New Session"
									}),
									/* @__PURE__ */ J(z, { iconName: V.Right })
								]
							})
						}), /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ Y(Qc, {
								className: "flex-1 !w-auto",
								onClick: r.openProjects,
								children: [/* @__PURE__ */ J(z, { iconName: V.Folders }), /* @__PURE__ */ J("span", {
									className: "text-left flex-grow truncate",
									children: "All projects"
								})]
							}), /* @__PURE__ */ J(Ln, {
								title: "Create a new project",
								position: s.CenterRight,
								sticky: !0,
								children: /* @__PURE__ */ J(B, {
									variant: R.Ghost,
									content: I.Icon,
									"aria-label": "New project",
									onClick: r.newProject,
									children: /* @__PURE__ */ J(z, { iconName: V.AddCircle })
								})
							})]
						})] }),
						/* @__PURE__ */ Y(Qc, {
							onClick: r.openMcp,
							"aria-label": r.mcpLabel,
							children: [
								/* @__PURE__ */ J(z, { iconName: V.Toolbox }),
								/* @__PURE__ */ J("span", {
									className: "text-left flex-grow",
									children: "MCP"
								}),
								r.activeMcp > 0 ? /* @__PURE__ */ J(Ci, {
									text: `${r.activeMcp} ACTIVE`,
									color: Si.Blue
								}) : null
							]
						}),
						/* @__PURE__ */ Y(Qc, {
							onClick: r.openSsh,
							children: [
								/* @__PURE__ */ J(z, { iconName: V.Globe }),
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
				children: /* @__PURE__ */ J(Jp, {
					sessions: f,
					showSearch: !1,
					sidebar: !0
				})
			}) : /* @__PURE__ */ J("div", {
				className: "flex-1 min-h-0 overflow-y-auto",
				children: /* @__PURE__ */ J(em, {
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
						children: [/* @__PURE__ */ Y(Qc, {
							onClick: r.openConfigurations,
							children: [/* @__PURE__ */ J(z, { iconName: V.Gear }), /* @__PURE__ */ J("span", {
								className: "text-left flex-grow",
								children: "Configurations"
							})]
						}), /* @__PURE__ */ Y(Qc, {
							onClick: r.openManaged,
							children: [/* @__PURE__ */ J(z, { iconName: V.Server }), /* @__PURE__ */ J("span", {
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
							/* @__PURE__ */ J(Qn, {
								value: h,
								size: L.Small,
								variant: R.Tertiary,
								title: "Copy the store path",
								disabled: !h,
								position: s.TopLeft,
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
function am({ commands: e, onToggle: t, toggleKeys: n, variant: r }) {
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
					children: /* @__PURE__ */ J(pc, {
						markOnly: !0,
						height: 25
					})
				}),
				/* @__PURE__ */ J(om, {
					label: "Show sidebar",
					keys: n,
					onClick: t,
					children: /* @__PURE__ */ J(z, { iconName: V.SidebarChevronRight })
				}),
				i ? null : /* @__PURE__ */ J(om, {
					label: "All projects",
					onClick: e.openProjects,
					children: /* @__PURE__ */ J(z, { iconName: V.Folders })
				}),
				i ? /* @__PURE__ */ J(om, {
					label: e.createLabel,
					onClick: e.newProject,
					children: /* @__PURE__ */ J(z, { iconName: V.Add })
				}) : /* @__PURE__ */ J(Zp, {
					projectId: e.projectId,
					onUnavailable: e.newSession,
					children: (e) => /* @__PURE__ */ J(om, {
						label: "New session",
						onClick: e,
						children: /* @__PURE__ */ J(z, { iconName: V.Add })
					})
				}),
				/* @__PURE__ */ J(om, {
					label: e.mcpLabel,
					onClick: e.openMcp,
					children: /* @__PURE__ */ J(z, { iconName: V.Toolbox })
				}),
				/* @__PURE__ */ J(om, {
					label: "SSH",
					onClick: e.openSsh,
					children: /* @__PURE__ */ J(z, { iconName: V.Globe })
				})
			]
		}), /* @__PURE__ */ Y("div", {
			className: "flex flex-col items-center gap-1 [&>*]:shrink-0",
			children: [/* @__PURE__ */ J(om, {
				label: "Configurations",
				onClick: e.openConfigurations,
				children: /* @__PURE__ */ J(z, { iconName: V.Gear })
			}), /* @__PURE__ */ J(om, {
				label: "Managed host",
				onClick: e.openManaged,
				children: /* @__PURE__ */ J(z, { iconName: V.Server })
			})]
		})]
	});
}
function om({ label: e, keys: t, onClick: n, children: r }) {
	return /* @__PURE__ */ J(Ln, {
		title: e,
		keyboardShortcuts: t,
		position: s.CenterRight,
		sticky: !0,
		children: /* @__PURE__ */ J(B, {
			variant: R.Ghost,
			content: I.Icon,
			"aria-label": e,
			onClick: n,
			children: r
		})
	});
}
//#endregion
//#region src/app/components/LeftSidebar/useSidebarCommands.tsx
function sm() {
	let [e, t] = K(!1), [n, r] = K(!1), [i, a] = K(!1), { pathname: o } = fi(), s = pi(), c = Of(), l = Rp(), { data: u = [] } = Jt(), { data: d } = tn(), { data: f } = It(), p = Wt(o), m = p != null && u.some((e) => e.summary.session_id === p), h = kn(o) ?? u.find((e) => e.summary.session_id === p)?.summary.project_id ?? null, g = d?.servers.filter((e) => e.enabled).length ?? 0;
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
		openProjects: () => s(vr.list()),
		openMcp: () => a(!0),
		openSsh: () => r(!0),
		openConfigurations: () => t(!0),
		openManaged: l.openSettings,
		modals: /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(sp, {
				open: e,
				onClose: () => t(!1)
			}),
			/* @__PURE__ */ J(Pp, {
				open: n,
				onClose: () => r(!1)
			}),
			/* @__PURE__ */ J(Ap, {
				open: i,
				onClose: () => a(!1)
			})
		] })
	};
}
var cm = [Er, "h"];
function lm({ variant: e = "session" }) {
	let { setSidebarOffset: t, storedOpen: n, storeOpen: r } = P().stores.sidebarLayoutStore, i = jr(), a = g(), [o, s] = K(null), c = o ?? n() ?? a, l = H(() => {
		s((e) => {
			let t = !(e ?? n() ?? a);
			return r(t), t;
		});
	}, [
		a,
		n,
		r
	]), u = sm();
	return $r(() => {
		t(i ? 0 : c ? 320 : 52);
	}, [
		i,
		c,
		t
	]), $r(() => () => t(0), [t]), Tf([{
		keys: cm,
		onTrigger: l,
		enabled: !i
	}]), i ? null : /* @__PURE__ */ Y("div", {
		"data-sidebar": "true",
		className: d("relative h-full shrink-0 transition-[width] duration-500 ease-in-out", c ? "w-[320px]" : "w-[52px]"),
		children: [
			c ? null : /* @__PURE__ */ J("div", {
				className: "absolute inset-y-0 left-0 w-[52px]",
				children: /* @__PURE__ */ J(am, {
					commands: u,
					onToggle: l,
					toggleKeys: cm,
					variant: e
				})
			}),
			/* @__PURE__ */ J("div", {
				className: d("absolute inset-y-0 z-[1] h-full w-[320px] transition-[left] duration-500 ease-in-out", c ? "left-0" : "left-[-320px]"),
				"aria-hidden": !c,
				inert: !c,
				children: /* @__PURE__ */ J(im, {
					isOpen: c,
					commands: u,
					onToggle: l,
					toggleKeys: cm,
					variant: e
				})
			}),
			u.modals
		]
	});
}
//#endregion
//#region src/app/components/pages/DesignPreviewPage.tsx
var um = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
], dm = [
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
], fm = "pub enum AgentEvent {\n    RunStarted { thread_name: Option<String> },\n    AssistantMessage {\n        thread_name: Option<String>,\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { thread_name: Option<String> },\n}";
function pm() {
	let [e, t] = K("sonnet"), [n, r] = K(!0), [i, a] = K(!1), [o, c] = K(!1), [l, u] = K(!0), [d, f] = K("first"), [p, m] = K("Port the ArceeFM atoms"), [h, g] = K(4), [_, v] = K(.7), [y, b] = K(["local"]), [x, S] = K(1), [C, w] = K(null), [T, E] = K({
		from: null,
		to: null
	});
	return /* @__PURE__ */ Y("div", {
		className: "min-h-full bg-elevation-ground text-basic-primary",
		children: [
			/* @__PURE__ */ Y("header", {
				className: "flex items-center gap-4 h-14 px-6 border-b border-secondary",
				children: [/* @__PURE__ */ J(pc, { height: 18 }), /* @__PURE__ */ J("span", {
					className: "text-basic-muted label-small",
					children: "design system"
				})]
			}),
			/* @__PURE__ */ Y("main", {
				className: "p-6 flex flex-col gap-6 max-w-[1100px]",
				children: [
					/* @__PURE__ */ J(wi, {
						title: "Buttons",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-3",
							children: [
								/* @__PURE__ */ J(B, {
									variant: R.Primary,
									children: "Primary"
								}),
								/* @__PURE__ */ J(B, {
									variant: R.Secondary,
									children: "Secondary"
								}),
								/* @__PURE__ */ J(B, {
									variant: R.Tertiary,
									children: "Tertiary"
								}),
								/* @__PURE__ */ J(B, {
									variant: R.Ghost,
									children: "Ghost"
								}),
								/* @__PURE__ */ J(B, {
									variant: R.GhostDestructive,
									children: "Destructive"
								}),
								/* @__PURE__ */ J(B, {
									variant: R.Primary,
									loading: !0,
									children: "Loading"
								}),
								/* @__PURE__ */ J(B, {
									variant: R.Secondary,
									disabled: !0,
									children: "Disabled"
								}),
								/* @__PURE__ */ Y(B, {
									variant: R.Secondary,
									content: I.IconLeft,
									children: [/* @__PURE__ */ J(z, { iconName: V.Add }), "With icon"]
								})
							]
						})
					}),
					/* @__PURE__ */ J(wi, {
						title: "Badges, loader, switch, tooltip",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-4",
							children: [
								/* @__PURE__ */ J(Ci, {
									text: "Running",
									color: Si.Green
								}),
								/* @__PURE__ */ J(Ci, {
									text: "Queued",
									color: Si.Blue
								}),
								/* @__PURE__ */ J(Ci, {
									text: "Failed",
									color: Si.Red
								}),
								/* @__PURE__ */ J(Ci, {
									text: "Idle",
									color: Si.Gray
								}),
								/* @__PURE__ */ J(A, { size: M.Small }),
								/* @__PURE__ */ J(ul, {
									checked: n,
									onChange: r
								}),
								/* @__PURE__ */ J(Ln, {
									title: "Pin session",
									description: "Keeps the card at the top of the board.",
									position: s.BottomCenter,
									sticky: !0,
									showTooltipOnMobile: !0,
									children: /* @__PURE__ */ J(z, { iconName: V.Pin })
								}),
								/* @__PURE__ */ J(z, { iconName: V.Unpin })
							]
						})
					}),
					/* @__PURE__ */ J(wi, {
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
									leading: Js.Icon,
									leadingIconName: V.Search,
									placeholder: "Filter sessions",
									hintText: "Matches name and cwd",
									className: "w-[280px]"
								}),
								/* @__PURE__ */ J(el, {
									items: dm,
									value: e,
									onValueChange: t,
									placeholder: "Pick a model"
								}),
								/* @__PURE__ */ J(B, {
									variant: R.Secondary,
									onClick: () => a(!0),
									children: "Open modal"
								})
							]
						})
					}),
					/* @__PURE__ */ J(wi, {
						title: "Popover, copy, shortcuts",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-4",
							children: [
								/* @__PURE__ */ J(pn, {
									open: o,
									onClose: () => c(!1),
									placement: s.BottomRight,
									sticky: !0,
									content: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("div", {
										className: "label-small text-basic-primary px-2 py-1",
										children: "Anchored panel"
									}), /* @__PURE__ */ J("div", {
										className: "text-micro text-basic-muted px-2 pb-1",
										children: "Closes on Escape or a click outside. On a phone it becomes a bottom sheet instead."
									})] }),
									children: /* @__PURE__ */ J(B, {
										variant: R.Secondary,
										onClick: () => c((e) => !e),
										children: "Open popover"
									})
								}),
								/* @__PURE__ */ J(Qn, { value: "nac" }),
								/* @__PURE__ */ J(Dt, { keys: [
									"cmd",
									"shift",
									"k"
								] })
							]
						})
					}),
					/* @__PURE__ */ J(wi, {
						title: "Choices and multi-line input",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-start gap-6",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2",
									children: [/* @__PURE__ */ J(Bi, {
										checked: l,
										onChange: u,
										children: "Skip permission prompts"
									}), /* @__PURE__ */ J(Bi, {
										checked: !1,
										onChange: () => {},
										disabled: !0,
										children: "Disabled"
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2",
									children: [/* @__PURE__ */ J(Kc, {
										name: "preview-choice",
										checked: d === "first",
										onChange: () => f("first"),
										children: "Working tree"
									}), /* @__PURE__ */ J(Kc, {
										name: "preview-choice",
										checked: d === "second",
										onChange: () => f("second"),
										children: "Latest snapshot"
									})]
								}),
								/* @__PURE__ */ J(sc, {
									label: "System prompt",
									rows: 3,
									placeholder: "Extra instructions for the agent",
									className: "w-[320px]"
								})
							]
						})
					}),
					/* @__PURE__ */ J(wi, {
						title: "Notices and loaders",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-4",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-wrap gap-3",
									children: [
										/* @__PURE__ */ J(Cc, {
											variant: mc.Info,
											title: "Read-only snapshot",
											className: "w-[280px]",
											children: "Pick the working tree to edit files again."
										}),
										/* @__PURE__ */ J(Cc, {
											variant: mc.Error,
											title: "Run failed",
											className: "w-[280px]",
											children: "The provider rejected the request."
										}),
										/* @__PURE__ */ J(Cc, {
											variant: mc.Success,
											title: "Branch switched",
											className: "w-[280px]"
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2 w-[398px]",
									children: [
										/* @__PURE__ */ J(Pi, {
											variant: Ai.Danger,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										}),
										/* @__PURE__ */ J(Pi, {
											variant: Ai.Error,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										}),
										/* @__PURE__ */ J(Pi, {
											variant: Ai.Success,
											title: "Message Title",
											action: {
												label: "Message CTA",
												onClick: () => {}
											},
											children: "Message description"
										}),
										/* @__PURE__ */ J(Pi, {
											variant: Ai.Info,
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
										/* @__PURE__ */ J(lc, { size: M.Medium }),
										/* @__PURE__ */ J(Ri, {
											rows: 3,
											className: "w-[200px]"
										}),
										/* @__PURE__ */ J(uc, {
											active: !0,
											className: "w-[200px]"
										})
									]
								})
							]
						})
					}),
					/* @__PURE__ */ J(wi, {
						title: "Session avatars",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-center gap-4",
							children: [um.map((e) => /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ J(Uc, {
									id: e,
									size: 40
								}), /* @__PURE__ */ J("span", {
									className: "code code-small text-basic-muted",
									children: e
								})]
							}, e)), /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-2",
								children: [/* @__PURE__ */ J(Li, {}), /* @__PURE__ */ J("span", {
									className: "code code-small text-basic-muted",
									children: "unassigned"
								})]
							})]
						})
					}),
					/* @__PURE__ */ J(wi, {
						title: "Project navigation",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-6",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex items-start gap-2",
									children: [
										/* @__PURE__ */ J(zi, {
											title: "Fix the parser",
											active: !0
										}),
										/* @__PURE__ */ J(zi, { title: "Rewrite the store layer" }),
										/* @__PURE__ */ J(zi, {
											title: "Investigating",
											running: !0
										}),
										/* @__PURE__ */ J(zi, {
											title: "Fork: Fix the parser",
											forkedFromTitle: "Fix the parser"
										}),
										/* @__PURE__ */ J(zi, {
											title: "Fork running",
											forkedFromTitle: "Fix the parser",
											running: !0
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1 max-w-[320px]",
									children: [
										/* @__PURE__ */ J(ki, {
											title: "Fix the parser",
											active: !0
										}),
										/* @__PURE__ */ J(ki, { title: "Rewrite the store layer" }),
										/* @__PURE__ */ J(ki, {
											title: "Investigating",
											running: !0
										}),
										/* @__PURE__ */ J(ki, {
											title: "Fork: Fix the parser",
											forkedFromTitle: "Fix the parser"
										}),
										/* @__PURE__ */ J(ki, {
											title: "Fork running",
											forkedFromTitle: "Fix the parser",
											running: !0
										})
									]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-2 max-w-[320px]",
									children: [/* @__PURE__ */ J(Ks, {
										sessionId: "14231vsd7897-aaaa",
										title: "Fork: Session title"
									}), /* @__PURE__ */ J(Ks, {
										sessionId: "14231vsd7897-aaaa",
										title: "Fork: Session title",
										deleted: !0
									})]
								}),
								/* @__PURE__ */ Y("div", {
									className: "flex flex-col gap-1 max-w-[320px]",
									children: [
										/* @__PURE__ */ J(Gc, {
											entityId: um[3],
											name: "arcee-ai/nac",
											trailing: "4",
											active: !0
										}),
										/* @__PURE__ */ J(Gc, {
											entityId: um[4],
											name: "arcee-ai/telos",
											trailing: "1",
											running: !0
										}),
										/* @__PURE__ */ J(Gc, {
											entityId: um[5],
											name: "Unassigned session",
											variant: Wc.Orphan
										})
									]
								})
							]
						})
					}),
					/* @__PURE__ */ J(wi, {
						title: "Avatars and editable header",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-4",
							children: [/* @__PURE__ */ Y("div", {
								className: "flex flex-wrap items-center gap-4",
								children: [
									/* @__PURE__ */ J(xi, {
										name: "Aleksy",
										size: bi.Small
									}),
									/* @__PURE__ */ J(xi, { name: "NAC Orchestrator" }),
									/* @__PURE__ */ J(xi, {
										name: "Opus",
										size: bi.Large
									}),
									/* @__PURE__ */ J(xi, {
										name: "🛠",
										glyph: !0,
										size: bi.Large
									}),
									/* @__PURE__ */ J(xi, {
										name: "Anthropic",
										size: bi.XLarge,
										color: "var(--color-bg-info-primary)"
									})
								]
							}), /* @__PURE__ */ J(ya, {
								value: p,
								onCommit: m,
								size: va.Medium,
								className: "max-w-[360px]"
							})]
						})
					}),
					/* @__PURE__ */ J(wi, {
						title: "Numeric inputs, tags and pagination",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-6",
							children: [
								/* @__PURE__ */ Y("div", {
									className: "flex flex-wrap items-center gap-8",
									children: [/* @__PURE__ */ J(Ac, {
										value: h,
										onChange: g,
										min: 1,
										max: 16,
										"aria-label": "Parallel threads"
									}), /* @__PURE__ */ Y("div", {
										className: "flex items-center gap-4 w-[320px]",
										children: [/* @__PURE__ */ J(Yc, {
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
								/* @__PURE__ */ J(dl, {
									tags: [
										"local",
										"docker",
										"remote",
										"sandbox"
									],
									selected: y,
									onChange: b
								}),
								/* @__PURE__ */ J(jc, {
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
					/* @__PURE__ */ J(wi, {
						title: "Dates",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-wrap items-start gap-6",
							children: [
								/* @__PURE__ */ J(ga, {
									label: "Created after",
									value: C,
									onChange: w,
									className: "w-[240px]"
								}),
								/* @__PURE__ */ J(ga, {
									label: "Window",
									range: T,
									onRangeChange: E,
									hintText: "Two clicks pick the ends.",
									className: "w-[280px]"
								}),
								/* @__PURE__ */ J(aa, {
									selected: C ? /* @__PURE__ */ new Date(`${C}T00:00:00`) : void 0,
									onSelect: (e) => w(`${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`),
									className: "rounded-[8px] border border-muted bg-elevation-level-2"
								})
							]
						})
					}),
					/* @__PURE__ */ J(wi, {
						title: "Code block and chat loader",
						children: /* @__PURE__ */ Y("div", {
							className: "p-4 flex flex-col gap-4",
							children: [/* @__PURE__ */ J(qn, {
								code: fm,
								language: "rust",
								title: "events.rs",
								lineNumbers: !0,
								expandable: !0,
								maxHeight: "220px"
							}), /* @__PURE__ */ J(Di, {})]
						})
					}),
					/* @__PURE__ */ J(wi, {
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
			/* @__PURE__ */ J(Ht, {
				open: i,
				onClose: () => a(!1),
				title: "Delete session",
				footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(B, {
					variant: R.Secondary,
					onClick: () => a(!1),
					children: "Cancel"
				}), /* @__PURE__ */ J(B, {
					variant: R.SecondaryDestructive,
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
var mm = /* @__PURE__ */ new Map();
function hm() {
	let { projectId: e = "" } = mi(), t = Of(), n = se(), r = it(), i = Jt(), [a, o] = K(null), s = r.refetch, c = i.refetch;
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
	let l = W(() => r.data?.projects.find((t) => t.project_id === e) ?? null, [r.data, e]), u = W(() => yl(ge(n, i.data ?? []), e), [
		i.data,
		e,
		n
	]), d = r.isLoading || i.isLoading, f = r.isFetching || i.isFetching, p = r.isError || i.isError, m = r.isSuccess && i.isSuccess, h = a === e && !d && !f && !p && m && l != null && u == null, g = t.newChat;
	U(() => {
		if (!h) return;
		let t = mm.get(e);
		t || (t = g(e, ut(n, i.data ?? [], e)).finally(() => {
			mm.delete(e);
		}), mm.set(e, t));
	}, [
		h,
		g,
		e,
		n,
		i.data
	]);
	let _ = a === e;
	return _ && !d && !l ? /* @__PURE__ */ J(ci, {
		to: vr.list(),
		replace: !0
	}) : _ && u ? /* @__PURE__ */ J(ci, {
		to: vr.session(u.summary.session_id),
		replace: !0
	}) : /* @__PURE__ */ J("div", {
		className: "flex h-full items-center justify-center",
		children: /* @__PURE__ */ J(A, { size: M.Large })
	});
}
//#endregion
//#region src/app/components/projects/ProjectCardActions.tsx
function gm({ title: e, icon: t, onClick: n, variant: r = R.Ghost, disabled: i = !1 }) {
	return /* @__PURE__ */ J(Ln, {
		title: e,
		position: s.TopCenter,
		sticky: !0,
		children: /* @__PURE__ */ J(B, {
			variant: r,
			size: L.Small,
			content: I.Icon,
			"aria-label": e,
			disabled: i,
			onClick: (e) => {
				e.stopPropagation(), n();
			},
			children: /* @__PURE__ */ J(z, { iconName: t })
		})
	});
}
function _m({ orphan: e, pinned: t, onDelete: n, onTogglePin: r, onRename: i, onAssign: a, reorder: o }) {
	return /* @__PURE__ */ Y("div", {
		className: o ? "flex items-center gap-1.5 shrink-0" : "flex items-center gap-4 xl:gap-1.5 shrink-0",
		children: [o ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(gm, {
			title: "Move down",
			icon: V.ArrowDown,
			disabled: !o.canMoveDown,
			onClick: o.onMoveDown
		}), /* @__PURE__ */ J(gm, {
			title: "Move up",
			icon: V.ArrowTop,
			disabled: !o.canMoveUp,
			onClick: o.onMoveUp
		})] }) : null, e ? /* @__PURE__ */ Y(q, { children: [
			i ? /* @__PURE__ */ J(gm, {
				title: "Edit",
				icon: V.Edit,
				onClick: i
			}) : null,
			a ? /* @__PURE__ */ J(gm, {
				title: "Assign to project",
				icon: V.FolderOpen,
				onClick: a
			}) : null,
			/* @__PURE__ */ J(gm, {
				title: "Delete chat",
				icon: V.Trash,
				variant: R.GhostDestructive,
				onClick: n
			})
		] }) : /* @__PURE__ */ Y(q, { children: [
			r ? /* @__PURE__ */ J(gm, {
				title: t ? "Unpin project" : "Pin project",
				icon: t ? V.Unpin : V.Pin,
				onClick: r
			}) : null,
			i ? /* @__PURE__ */ J(gm, {
				title: "Rename project",
				icon: V.Edit,
				onClick: i
			}) : null,
			/* @__PURE__ */ J(gm, {
				title: "Remove project",
				icon: V.Trash,
				variant: R.GhostDestructive,
				onClick: n
			})
		] })]
	});
}
//#endregion
//#region src/app/components/projects/ProjectCard.tsx
var vm = {
	default: "--color-bg-btn-ghost",
	hovered: "--color-bg-btn-ghost-hovered",
	pressed: "--color-bg-btn-ghost-pressed",
	highlighted: "--color-bg-btn-ghost-highlighted",
	highlightedHovered: "--color-bg-btn-ghost-highlighted-hovered",
	highlightedPressed: "--color-bg-btn-ghost-highlighted-pressed"
};
function ym({ highlighted: e, hover: t, pressed: n }) {
	return n ? e ? vm.highlightedPressed : vm.pressed : t ? e ? vm.highlightedHovered : vm.hovered : e ? vm.highlighted : vm.default;
}
function bm(e, t) {
	if (e.kind === "project") {
		let { project: t, sessions: n, running: r, totalCostMicros: i } = e.entry, a = n.find((e) => wr(e.active_run));
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
	let { summary: n, active_run: r } = e.session, i = wr(r);
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
function xm({ facts: e }) {
	let t = e.costMicros > 0 ? en(e.costMicros) : null;
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
function Sm({ facts: e }) {
	let t = mr(e.representative?.backend);
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-wrap items-center gap-2.5 min-w-0 whitespace-nowrap",
		children: [/* @__PURE__ */ J("span", {
			className: "label-micro text-basic-tertiary",
			children: Ge(e.representative)
		}), t ? /* @__PURE__ */ J("span", {
			className: "text-micro text-basic-muted truncate md:max-w-[128px]",
			children: t
		}) : null]
	});
}
function Cm({ getCardElement: e, onReorderStart: t }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		"aria-label": "Drag to reorder",
		className: d("absolute right-1.5 top-1/2 z-1 -translate-y-1/2", "flex h-6 items-center gap-[3px]", "cursor-grab active:cursor-grabbing touch-none", "rounded-sm border-0 bg-transparent p-0"),
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
function wm({ item: e, selected: t, attention: n, onOpen: r, onDelete: i, onTogglePin: a, onRename: o, onAssign: c, reorder: l, dragging: u = !1 }) {
	let f = bm(e, hl()), p = f.representative?.model_config_error, m = jr(), h = g(), [_, v] = K(!1), [y, b] = K(!1), [x, S] = K(!1), C = G(!1), w = G(null), T = !h || _ || y || t, E = !!l && h, D = !!l && !h, ee = h && _, O = () => {
		if (C.current) {
			C.current = !1;
			return;
		}
		r();
	};
	return /* @__PURE__ */ Y("div", {
		ref: w,
		"data-item-id": f.id,
		"data-item-kind": f.orphan ? "orphan" : "project",
		"data-item-pinned": f.pinned ? "true" : "false",
		className: d("group fade relative flex flex-col rounded-[8px] overflow-hidden cursor-default", m ? "gap-4 px-4 pt-4 pb-2" : "gap-4 px-6 pt-5 pb-3", "shadow-convex bg-elevation-level-1", u && "shadow-lg"),
		role: "button",
		tabIndex: 0,
		"aria-pressed": t,
		onClick: O,
		onKeyDown: (e) => {
			e.target === e.currentTarget && (e.key === "Enter" || e.key === " ") && (e.preventDefault(), O());
		},
		onMouseEnter: () => {
			h && v(!0);
		},
		onMouseLeave: () => {
			v(!1), S(!1);
		},
		onFocus: () => b(!0),
		onBlur: () => b(!1),
		onPointerDown: (e) => {
			e.button === 0 && !e.target.closest("button, a, input, textarea") && S(!0);
		},
		onPointerUp: () => S(!1),
		onPointerCancel: () => S(!1),
		children: [
			/* @__PURE__ */ J("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none ease-out",
				style: { backgroundColor: `var(${ym({
					highlighted: f.running,
					hover: ee,
					pressed: x
				})})` }
			}),
			t || y || u ? /* @__PURE__ */ J("div", {
				className: "absolute inset-0 rounded-[8px] pointer-events-none border-2",
				style: { borderColor: "var(--blue-500)" }
			}) : null,
			n ? /* @__PURE__ */ J(Ln, {
				title: "Run finished",
				position: s.BottomLeft,
				sticky: !0,
				className: "absolute left-2 top-2 z-1",
				children: /* @__PURE__ */ J("span", { className: "block size-2 rounded-full bg-accent-primary" })
			}) : null,
			E && l ? /* @__PURE__ */ J(Cm, {
				getCardElement: () => w.current,
				onReorderStart: (e) => {
					C.current = !0, l.onReorderStart(e), window.setTimeout(() => {
						C.current = !1;
					}, 100);
				}
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: "relative flex items-center gap-4 w-full",
				children: [f.orphan ? /* @__PURE__ */ J(Li, { isRunning: f.running }) : /* @__PURE__ */ J(Uc, {
					id: f.id,
					size: 40,
					isRunning: f.running
				}), /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-0.5 flex-1 min-w-0",
					children: [/* @__PURE__ */ Y("div", {
						className: "flex items-center gap-1.5 w-full",
						children: [
							f.pinned ? /* @__PURE__ */ J(z, {
								iconName: V.Pin,
								className: "text-basic-secondary shrink-0"
							}) : null,
							/* @__PURE__ */ J("div", {
								className: d("header-md flex-1 min-w-0 truncate", f.running ? "text-shimmer-basic" : "text-basic-primary"),
								children: f.title
							}),
							p ? /* @__PURE__ */ J(Ln, {
								title: p,
								position: s.BottomRight,
								sticky: !0,
								children: /* @__PURE__ */ J(z, {
									iconName: V.Repair,
									className: "text-error-primary shrink-0"
								})
							}) : null,
							f.running ? f.orphan ? /* @__PURE__ */ J(A, {
								size: M.Micro,
								className: "shrink-0"
							}) : /* @__PURE__ */ Y("div", {
								className: "flex items-center gap-1 shrink-0",
								children: [/* @__PURE__ */ J(A, { size: M.XSmall }), /* @__PURE__ */ Y("span", {
									className: "text-micro text-basic-primary whitespace-nowrap",
									children: [f.runningCount, " Running"]
								})]
							}) : null
						]
					}), /* @__PURE__ */ J("div", {
						className: "code code-micro text-basic-tertiary truncate w-full",
						children: f.cwd
					})]
				})]
			}),
			h ? null : /* @__PURE__ */ J(Sm, { facts: f }),
			/* @__PURE__ */ Y("div", {
				className: "relative flex items-center justify-between w-full h-6 gap-2",
				children: [/* @__PURE__ */ J(xm, { facts: f }), T ? /* @__PURE__ */ J(_m, {
					orphan: f.orphan,
					pinned: f.pinned,
					onTogglePin: a,
					onRename: o,
					onDelete: i,
					onAssign: c,
					reorder: D && l ? {
						canMoveUp: l.canMoveUp,
						canMoveDown: l.canMoveDown,
						onMoveUp: l.onMoveUp,
						onMoveDown: l.onMoveDown
					} : void 0
				}) : /* @__PURE__ */ J(Sm, { facts: f })]
			})
		]
	});
}
//#endregion
//#region src/app/components/projects/ProjectsEmptyState.tsx
function Tm({ onStart: e, onAddRepository: t, onManagedSettings: n, modelReady: r, githubConnected: i, mobile: a }) {
	let o = t != null;
	return /* @__PURE__ */ J("div", {
		className: d("flex h-full flex-col items-center justify-center py-16", a ? "px-4" : "px-6"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex w-[420px] max-w-full flex-col items-center gap-6",
			children: [
				/* @__PURE__ */ J(rl, {}),
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
						/* @__PURE__ */ J(Em, {
							label: "Arcee model",
							value: r ? "Ready" : "Needs attention",
							ready: !!r
						}),
						/* @__PURE__ */ J(Em, {
							label: "GitHub",
							value: i ? "Connected" : "Not connected",
							ready: !!i
						}),
						/* @__PURE__ */ J(Em, {
							label: "Projects",
							value: "None",
							ready: !1
						})
					]
				}) : null,
				/* @__PURE__ */ Y("div", {
					className: "flex flex-wrap justify-center gap-2",
					children: [
						/* @__PURE__ */ J(B, {
							variant: R.Primary,
							size: L.Large,
							content: I.Text,
							onClick: o ? t : e,
							children: o ? "Add repository" : "Get Started"
						}),
						o ? /* @__PURE__ */ J(B, {
							variant: R.Secondary,
							size: L.Large,
							content: I.Text,
							onClick: e,
							children: "Create Project"
						}) : null,
						o && !i && n ? /* @__PURE__ */ J(B, {
							variant: R.Tertiary,
							size: L.Large,
							content: I.Text,
							onClick: n,
							children: "Connect GitHub"
						}) : null
					]
				})
			]
		})
	});
}
function Em({ label: e, value: t, ready: n }) {
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
function Dm({ children: e, single: t }) {
	return /* @__PURE__ */ J("div", {
		className: d("grid gap-2", t ? "grid-cols-1" : "grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]"),
		children: e
	});
}
function Om() {
	return /* @__PURE__ */ J("div", {
		"aria-hidden": !0,
		className: "min-h-[112px] rounded-[8px] border-2",
		style: { borderColor: "var(--blue-500)" }
	});
}
function km(e) {
	return e.kind === "project" ? e.entry.sessions.map((e) => e.summary.session_id) : [e.session.summary.session_id];
}
function Am(e) {
	return e.kind === "project" && e.entry.project.pinned;
}
function jm({ item: e, onOpen: t, reorderable: n, dragging: r, canMoveUp: i, canMoveDown: a, onMoveUp: o, onMoveDown: s, onReorderStart: c }) {
	let { useAnyAttention: l } = P().stores.attentionStore, u = Of(), d = Hf(), f = {
		item: e,
		selected: !1,
		attention: l(km(e)),
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
		return /* @__PURE__ */ J(wm, {
			...f,
			onTogglePin: () => void u.togglePin(t),
			onRename: () => u.rename(t),
			onDelete: () => u.remove(t)
		});
	}
	let { summary: p } = e.session;
	return /* @__PURE__ */ J(wm, {
		...f,
		onRename: () => d.rename(p),
		onDelete: () => d.remove(p),
		onAssign: () => u.assign(p)
	});
}
function Mm(e, t, n, r) {
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
function Nm(e, t) {
	return e.filter((e) => e.pinned === t).sort((e, t) => e.sort_order - t.sort_order);
}
function Pm() {
	let { useVisibleProjectItems: e, useIsDefaultSort: t, useFilterQuery: n, setQuery: r } = P().stores.sessionFiltersStore, { trackAttention: i, clearAttentionAll: a } = P().stores.attentionStore, o = pi(), s = jr(), c = Of(), u = Rp(), f = hn(), p = n(), m = t(), h = l(), g = Nt(), [_, v] = K(!1), [y, b] = K(null), [x, S] = K(null), [C, w] = K(!1), T = G(null), E = G(null), D = G(!1), { data: ee, isLoading: O, error: k, refetch: A } = rn(), te = it(), j = se(), ne = W(() => ge(j, ee ?? []), [ee, j]), re = W(() => te.data?.projects ?? [], [te.data]), ie = W(() => wl(re, ne), [re, ne]), ae = e(ie);
	U(() => {
		ee && i(ee, null);
	}, [ee, i]);
	let oe = (e) => {
		let t = Cl(e);
		a(km(e)), o(e.kind === "project" ? vr.project(t) : vr.session(t));
	}, ce = ae.filter(Am), le = ae.filter((e) => e.kind === "project" && !Am(e)), ue = ae.filter((e) => e.kind === "orphan"), de = W(() => Nm(re, !0), [re]), M = W(() => Nm(re, !1), [re]), fe = W(() => Sl(ne), [ne]), pe = W(() => Me(ne, !1), [ne]), N = H(() => {
		T.current = null, E.current = null, D.current = !1, b(null), S(null), w(!1);
	}, []), F = H(async (e, t, n) => {
		let r = Nm(re, t).findIndex((t) => t.project_id === e), i = re.find((t) => t.project_id === e);
		if (i && i.pinned === t && r === n) {
			N();
			return;
		}
		try {
			await h.mutateAsync({
				projects: re,
				projectId: e,
				targetPinned: t,
				targetIndex: n
			});
		} catch (e) {
			f.error(`Failed to reorder projects: ${ir($(e))}`);
		} finally {
			N();
		}
	}, [
		re,
		N,
		h,
		f
	]), me = H(async (e, t) => {
		try {
			await g.mutateAsync({
				sessions: ne,
				sessionId: e,
				targetPinned: !1,
				targetIndex: t
			});
		} catch (e) {
			f.error(`Failed to reorder chats: ${ir($(e))}`);
		} finally {
			N();
		}
	}, [
		ne,
		N,
		g,
		f
	]), he = H(async (e, t) => {
		let n = ne.find((t) => t.summary.session_id === e), r = re.find((e) => e.project_id === t);
		if (!n || !r) {
			N();
			return;
		}
		if (Ol(re, n.summary)?.project_id !== r.project_id) {
			f.error("That chat does not run in this project's location"), N();
			return;
		}
		try {
			c.assign(n.summary);
		} finally {
			N();
		}
	}, [
		ne,
		N,
		c,
		re,
		f
	]), _e = H((e, t) => {
		let n = e.pinned ? de : M, r = n.findIndex((t) => t.project_id === e.project_id);
		if (r < 0) return;
		let i = r + t;
		i < 0 || i >= n.length || F(e.project_id, e.pinned, i);
	}, [
		de,
		M,
		F
	]), ve = H((e, t) => {
		let n = fe.findIndex((t) => t.summary.session_id === e), r = n < 0 ? void 0 : fe[n + t];
		if (!r) return;
		let i = On(pe, r.summary.session_id, t === -1 ? "before" : "after", e);
		me(e, i);
	}, [
		fe,
		pe,
		me
	]), ye = H((e, t, n) => {
		if (t === "orphan") {
			let t = re.find((e) => e.project_id === n.itemId);
			if (t) {
				he(e, t.project_id);
				return;
			}
			if (n.itemId === e) {
				N();
				return;
			}
			let r = On(pe, n.itemId, n.edge, e);
			me(e, r);
			return;
		}
		let r = re.find((e) => e.project_id === n.itemId);
		if (!r || n.itemId === e) {
			N();
			return;
		}
		let i = Nm(re, r.pinned).map((e) => e.project_id).filter((t) => t !== e).indexOf(n.itemId);
		if (i < 0) {
			N();
			return;
		}
		F(e, r.pinned, n.edge === "before" ? i : i + 1);
	}, [
		he,
		N,
		pe,
		me,
		F,
		re
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
		T.current = t, b(t);
	}, []);
	U(() => {
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
			let r = Mm(e.clientX, e.clientY, t.itemId, t.kind);
			if (r === "pin-zone") {
				D.current = !0, E.current = null, w(!0), S(null);
				return;
			}
			D.current = !1, w(!1), r && (E.current = r, S((e) => e?.itemId === r.itemId && e.edge === r.edge ? e : r));
		}, t = () => {
			let e = T.current;
			if (!e) {
				N();
				return;
			}
			if (D.current && e.kind === "project") {
				F(e.itemId, !0, 0);
				return;
			}
			let t = E.current;
			if (t) {
				ye(e.itemId, e.kind, t);
				return;
			}
			N();
		};
		return window.addEventListener("pointermove", e), window.addEventListener("pointerup", t), window.addEventListener("pointercancel", t), () => {
			window.removeEventListener("pointermove", e), window.removeEventListener("pointerup", t), window.removeEventListener("pointercancel", t);
		};
	}, [
		ye,
		N,
		y,
		F
	]);
	let xe = (e) => {
		let t = Cl(e), n = e.kind === "project" ? e.entry.project : null, r = n ? n.pinned ? de : M : [], i = n ? r.findIndex((e) => e.project_id === n.project_id) : -1, a = e.kind === "orphan" ? fe.findIndex((e) => e.summary.session_id === t) : -1, o = n ? i : a, s = n ? r.length : fe.length, c = y?.itemId === t, l = !c && x?.itemId === t ? x.edge : null;
		return /* @__PURE__ */ Y(Kr, { children: [
			l === "before" ? /* @__PURE__ */ J(Om, {}) : null,
			/* @__PURE__ */ J("div", {
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
				children: /* @__PURE__ */ J(jm, {
					item: e,
					onOpen: oe,
					reorderable: m,
					dragging: c,
					canMoveUp: o > 0,
					canMoveDown: o >= 0 && o < s - 1,
					onMoveUp: () => {
						n ? _e(n, -1) : e.kind === "orphan" && ve(t, -1);
					},
					onMoveDown: () => {
						n ? _e(n, 1) : e.kind === "orphan" && ve(t, 1);
					},
					onReorderStart: be
				})
			}),
			l === "after" ? /* @__PURE__ */ J(Om, {}) : null
		] }, t);
	}, Se = /* @__PURE__ */ Y("div", {
		className: "fixed inset-x-0 top-16 z-10 flex items-start gap-3 px-2 py-4",
		children: [/* @__PURE__ */ J(ac, {
			className: "flex-1 min-w-0",
			variant: ic.Search,
			placeholder: "Search projects…",
			value: p,
			onChange: (e) => r(e.target.value),
			onClear: () => r(""),
			"aria-label": "Search projects"
		}), /* @__PURE__ */ J(Ti, {
			variant: R.Secondary,
			content: I.Icon,
			"aria-label": "Filters",
			"aria-expanded": _,
			onClick: () => v(!0),
			children: /* @__PURE__ */ J(z, { iconName: V.Controls })
		})]
	}), Ce = /* @__PURE__ */ J(Ht, {
		open: _,
		onClose: () => v(!1),
		title: "Filters",
		bodyClassName: "p-0",
		children: /* @__PURE__ */ J(Jp, {
			sessions: ne,
			showSearch: !1,
			mobile: !0,
			onChange: () => v(!1)
		})
	});
	if (!O && !k && ie.length === 0) return /* @__PURE__ */ Y("div", {
		className: "flex h-full min-h-0",
		children: [s ? null : /* @__PURE__ */ J(lm, { variant: "projects" }), /* @__PURE__ */ J("div", {
			className: "min-h-0 min-w-0 flex-1",
			children: /* @__PURE__ */ J(Tm, {
				mobile: s,
				onStart: c.create,
				onAddRepository: u.isManaged ? u.addRepository : void 0,
				onManagedSettings: u.isManaged ? u.openSettings : void 0,
				modelReady: u.status?.model_ready,
				githubConnected: u.status?.github_status === "connected"
			})
		})]
	});
	let we = m && y != null && y.kind === "project" && ce.length === 0 && !re.find((e) => e.project_id === y.itemId)?.pinned;
	return /* @__PURE__ */ Y("div", {
		className: "flex h-full min-h-0",
		children: [
			s ? null : /* @__PURE__ */ J(lm, { variant: "projects" }),
			s ? Se : null,
			s ? Ce : null,
			/* @__PURE__ */ J("div", {
				className: d("flex-1 min-h-0 overflow-auto", s ? "px-2" : "px-8", y && "select-none cursor-grabbing"),
				children: /* @__PURE__ */ Y("div", {
					className: d("flex flex-col gap-6 [&>*]:shrink-0", s ? "pt-36 pb-8" : "py-4"),
					children: [
						k ? /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2 label-small text-error-primary",
							children: [/* @__PURE__ */ J("span", { children: ir(k) }), /* @__PURE__ */ J(B, {
								variant: R.Ghost,
								size: L.Small,
								content: I.Text,
								onClick: () => {
									A();
								},
								children: "Try again"
							})]
						}) : null,
						!O && !k && ae.length === 0 ? /* @__PURE__ */ J("div", {
							className: "label-small text-basic-muted text-center py-16",
							children: "No projects match the current filters."
						}) : null,
						ce.length > 0 || we ? /* @__PURE__ */ Y(Dm, {
							single: s,
							children: [ce.map(xe), we ? /* @__PURE__ */ J("div", {
								"data-pin-drop-zone": "true",
								className: d("min-h-[112px] rounded-[8px] border-2 border-dashed", C && "bg-info-primary/10"),
								style: { borderColor: "var(--blue-500)" }
							}) : null]
						}) : null,
						le.length > 0 ? /* @__PURE__ */ J(Dm, {
							single: s,
							children: le.map(xe)
						}) : null,
						ue.length > 0 ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(pl, { children: "Unassigned chat sessions" }), /* @__PURE__ */ J(Dm, {
							single: s,
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
function Fm(e, t, n) {
	return e ? "A run is in flight; wait for it to finish." : t && !n ? "Uncommitted changes: commit or stash them before switching." : null;
}
function Im({ label: e, icon: t, active: n, disabled: r, title: i, onClick: a }) {
	let o = jr();
	return /* @__PURE__ */ Y(Qc, {
		type: "button",
		size: o ? Xc.Large : Xc.Small,
		active: n,
		disabled: r,
		title: i,
		onClick: a,
		children: [/* @__PURE__ */ J(z, {
			iconName: t,
			className: "shrink-0"
		}), /* @__PURE__ */ J("span", {
			className: "flex-1 min-w-0 truncate text-left",
			children: e
		})]
	});
}
function Lm({ busy: e, children: t }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
		children: [e ? /* @__PURE__ */ J(A, {
			size: M.Small,
			variant: be.Neutral
		}) : null, t]
	});
}
function Rm({ sessionId: e, branch: t, placement: n = s.TopRight }) {
	let { useRunning: r } = P().stores.runtimeStore, [i, a] = K(!1), [o, c] = K(""), l = r(e), { data: u, isLoading: d, error: f } = ct(e, i), p = me(e), m = () => {
		a(!1), c(""), p.reset();
	}, h = o.trim(), g = (u?.branches ?? []).filter((e) => e.name.toLowerCase().includes(h.toLowerCase())), _ = (u?.branches ?? []).some((e) => e.name === h), v = u?.dirty ?? !1, y = Fm(l, v, !0), b = Fm(l, v, !1), x = jr(), S = (e, t) => {
		p.mutate({
			name: e,
			create: t
		}, { onSuccess: m });
	}, C = f ? ir(f) : p.error ? ir(p.error) : null;
	return /* @__PURE__ */ J(pn, {
		open: i,
		onClose: m,
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
						onChange: (e) => c(e.target.value)
					}), h && !_ && !f ? /* @__PURE__ */ J(Im, {
						label: /* @__PURE__ */ Y(q, { children: ["Create ", /* @__PURE__ */ J("span", {
							className: "text-basic-primary",
							children: h
						})] }),
						icon: V.Add,
						disabled: !!y,
						title: y ?? void 0,
						onClick: () => S(h, !0)
					}) : null]
				}),
				d ? /* @__PURE__ */ J("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ J(Lm, {
						busy: !0,
						children: "Reading branches…"
					})
				}) : null,
				!d && !f ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-h-0 gap-2 md:gap-1 p-2 md:p-0 overflow-auto [&>*]:shrink-0",
					children: [g.map((e) => {
						let t = e.is_current ? null : b;
						return /* @__PURE__ */ J(Im, {
							label: e.name,
							icon: e.is_current ? V.Check : V.Scheme,
							active: e.is_current,
							disabled: !!t,
							title: t ?? void 0,
							onClick: e.is_current ? () => {} : () => S(e.name, !1)
						}, e.name);
					}), g.length === 0 && !h ? /* @__PURE__ */ J(Lm, { children: "No local branches." }) : null]
				}) : null,
				p.isPending ? /* @__PURE__ */ J("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ J(Lm, {
						busy: !0,
						children: "Working…"
					})
				}) : null,
				C ? /* @__PURE__ */ J("div", {
					className: "shrink-0",
					children: /* @__PURE__ */ J(Cc, {
						variant: mc.Error,
						title: C
					})
				}) : null,
				!C && v && !l ? /* @__PURE__ */ J("div", {
					className: "shrink-0 px-4 pt-2 md:px-0 md:pt-0",
					children: /* @__PURE__ */ J(Cc, {
						variant: mc.Info,
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
			onClick: () => i ? m() : a(!0),
			children: [/* @__PURE__ */ J(z, {
				iconName: V.Scheme,
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
var zm = {
	title: "Create Subagent",
	description: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from Subagents.",
	muted: !0
}, Bm = {
	title: "Create Orchestrator Subagent",
	description: "Start a separate NAC planning session. Browse, steer, continue, and cancel it from Subagents.",
	muted: !0
};
function Vm({ sessionId: e, behavior: t, className: n, onCreateSubagent: r, onCreateOrchestrator: i }) {
	let a = se().orchestrationEnabled && t === "direct-with-orchestrator", o = F(e, !0), c = f(e, a), [l, u] = K(!1), p = (o.data ?? []).some((e) => e.status === "running") || a && (c.data ?? []).some((e) => e.status === "running");
	return /* @__PURE__ */ J(pn, {
		open: l,
		onClose: () => u(!1),
		sticky: !0,
		sheetOnMobile: !1,
		placement: s.TopRight,
		panelClassName: "gap-2",
		className: n,
		content: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y(Qc, {
			hoverHint: zm,
			onClick: () => {
				u(!1), r();
			},
			children: [/* @__PURE__ */ J(z, { iconName: V.Plane }), /* @__PURE__ */ J("span", {
				className: "min-w-0 flex-1 truncate text-left",
				children: "Create Subagent"
			})]
		}), a ? /* @__PURE__ */ Y(Qc, {
			hoverHint: Bm,
			onClick: () => {
				u(!1), i();
			},
			children: [/* @__PURE__ */ J(z, { iconName: V.Orchestrator }), /* @__PURE__ */ J("span", {
				className: "min-w-0 flex-1 truncate text-left",
				children: "Create Orchestrator Subagent"
			})]
		}) : null] }),
		children: /* @__PURE__ */ J(B, {
			type: "button",
			size: L.Large,
			variant: p ? R.GhostHighlightedAccent : R.Ghost,
			content: I.Icon,
			"aria-label": "Spawn",
			"aria-expanded": l,
			onClick: () => u((e) => !e),
			children: /* @__PURE__ */ J(z, {
				iconName: V.Add,
				size: 24,
				className: d("transition-transform", l && "rotate-45")
			})
		})
	});
}
//#endregion
//#region src/app/components/inspector/ModelPicker.tsx
var Hm = {
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
}, Um = [{
	id: "",
	label: "Default effort",
	hoverHint: {
		...Hm[""],
		muted: !0
	}
}, ...id.map((e) => ({
	...e,
	hoverHint: {
		...Hm[e.id],
		muted: !0
	}
}))];
function Wm({ sessionId: e, metadata: t, label: n, disabled: r }) {
	let i = hn(), a = Zn(), o = vd(), c = Nr(a.data), l = Dr(), u = t?.model ?? n, d = t?.reasoning_effort ?? "", f = t ? {
		backend: t.backend,
		model: t.model,
		baseUrl: t.base_url ?? ""
	} : null, p = xu(a.data, t?.backend, u), m = W(() => sd(p.supportedEfforts, d, Um), [p.supportedEfforts, d]), h = m.find((e) => e.id === d)?.label, g = typeof h == "string" ? h : "Default effort", [_, v] = K(!1), y = async (n) => {
		if (!t || n.backend === t.backend && n.model === t.model) return;
		let r = a.data?.providers.find((e) => e.id === n.backend), s = n.backend === t.backend, c = !!(r?.auth_status === "ready" || o.matches(n) && o.credentialReady);
		if (!s && !c) {
			i.error(`Connect ${n.backend} in session settings before switching to this model.`);
			return;
		}
		if (!s && !n.baseUrl) {
			i.error(`Configure an endpoint for ${n.backend} in session settings first.`);
			return;
		}
		let u = xu(a.data, n.backend, n.model).supportedEfforts, f = d && u.includes(d) ? d : null, p = s ? {
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
			}), i.success(`Model switched to ${n.model}`);
		} catch (e) {
			i.error(`The model was not switched: ${au($(e), n.backend)}`);
		}
	}, b = async (n) => {
		if (!(!t || n === d)) try {
			await l.mutateAsync({
				id: e,
				patch: { reasoning_effort: n || null }
			}), i.success(`Reasoning set to ${n || "the model default"}`);
		} catch (e) {
			i.error(`Reasoning was not changed: ${au($(e), t.backend)}`);
		}
	};
	return /* @__PURE__ */ Y("div", {
		className: "flex min-w-0 items-center",
		children: [
			/* @__PURE__ */ J(ju, {
				catalog: a.data,
				loading: a.isLoading,
				failed: a.isError,
				compact: !0,
				disabled: r || !t || l.isPending,
				liveByBackend: c,
				value: f,
				onSelect: (e) => void y(e)
			}),
			/* @__PURE__ */ J("span", {
				"aria-hidden": !0,
				className: "h-6 w-px shrink-0 bg-divider-muted"
			}),
			/* @__PURE__ */ J(Ln, {
				title: `Effort: ${g}`,
				description: "How much the model reasons before it answers.",
				position: s.TopCenter,
				sticky: !0,
				disabled: _,
				children: /* @__PURE__ */ J(fd, {
					items: m,
					value: d,
					placeholder: "Default effort",
					disabled: r || !t || l.isPending,
					size: L.Small,
					trailingIcon: V.Right,
					triggerClassName: "!gap-1.5 !pl-3",
					placement: s.TopCenter,
					onOpenChange: v,
					onValueChange: (e) => void b(e)
				})
			})
		]
	});
}
//#endregion
//#region src/app/components/inspector/PermissionControls.tsx
function Gm(e) {
	return e.map((e) => e.id).join(":");
}
function Km({ grant: e, deleting: t, onDelete: n }) {
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
		}), /* @__PURE__ */ J(B, {
			size: L.Small,
			variant: R.GhostDestructive,
			content: I.Icon,
			"aria-label": `Forget ${e.action} permission`,
			loading: t,
			onClick: n,
			children: /* @__PURE__ */ J(z, {
				iconName: V.Trash,
				size: 16
			})
		})]
	});
}
function qm({ sessionId: e, behavior: t, label: n = "Permissions", autoApprovalAvailable: r = !0, requesterLabel: i }) {
	let a = t === "direct" || t === "direct-with-orchestrator", o = dt(e, a), c = st(), l = ie(), u = Gr(), d = hn(), f = o.data?.requests ?? [], p = o.data?.grants ?? [], m = o.data?.approval_mode === "auto_approve", h = m && !r, [g, _] = K(!1), [v, y] = K(""), [b, x] = K(null), [S, C] = K(null), w = Gm(f), T = g || !!(w && w !== v), E = () => {
		y(w), _(!1);
	};
	if (!a) return null;
	let D = f[0] ?? null, ee = D?.resources.some((e) => e.save_resource) ?? !1, O = async (t) => {
		if (!(!D || b)) {
			x(D.id);
			try {
				await c.mutateAsync({
					sessionId: e,
					requestId: D.id,
					reply: t
				}), f.length === 1 && E();
			} catch (e) {
				d.error(`Unable to answer permission request: ${ir($(e))}`);
			} finally {
				x(null);
			}
		}
	}, k = async (t) => {
		if (!S) {
			C(t.id);
			try {
				await u.mutateAsync({
					sessionId: e,
					grantId: t.id
				});
			} catch (e) {
				d.error(`Unable to forget permission: ${ir($(e))}`);
			} finally {
				C(null);
			}
		}
	}, A = async (t) => {
		_(!0);
		try {
			await l.mutateAsync({
				sessionId: e,
				mode: t ? "auto_approve" : "manual"
			});
		} catch (e) {
			d.error(`Unable to change approval mode: ${ir($(e))}`);
		}
	}, te = f.length ? ` (${f.length})` : p.length ? ` (${p.length})` : "", j = m ? "Accept all" : "Manually", ne = h ? "Requests are approved automatically because the parent session accepts all. Change the mode on the parent." : m ? "Requests are approved automatically for this session and the agents it owns." : "Each request pauses until you approve or deny it.";
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Ln, {
		title: `Permission: ${j}`,
		description: ne,
		position: s.TopCenter,
		children: /* @__PURE__ */ Y(B, {
			size: L.Small,
			variant: f.length ? R.GhostHighlightedAccent : R.Ghost,
			content: I.IconLeft,
			className: "pr-3",
			"aria-label": m ? h ? `${n} — auto-approve inherited; open permissions` : "Auto-approve on — open permissions" : `${n}${te}`,
			onClick: () => _(!0),
			children: [/* @__PURE__ */ J(z, {
				iconName: V.Private,
				size: 16
			}), /* @__PURE__ */ J("span", {
				className: "label-micro",
				children: m ? "Accept all" : "Manually"
			})]
		})
	}), /* @__PURE__ */ J(Ht, {
		open: T,
		onClose: E,
		size: Mn.Wide,
		flush: !0,
		title: D ? "Permission required" : "Permissions",
		subheader: D ? `${D.tool} requested by ${i ?? "this session"} is paused before execution.` : h ? "Automatic approval is inherited from the parent session; change it from the parent." : m ? "Automatic approval is active for this session and its owned child agents." : "Remembered access for this session.",
		footer: D ? /* @__PURE__ */ Y("div", {
			className: "flex w-full flex-wrap justify-end gap-2",
			children: [
				/* @__PURE__ */ J(B, {
					variant: R.SecondaryDestructive,
					loading: b === D.id && c.variables?.reply === "reject",
					disabled: b !== null,
					onClick: () => void O("reject"),
					children: "Reject"
				}),
				/* @__PURE__ */ J(B, {
					variant: R.Secondary,
					loading: b === D.id && c.variables?.reply === "once",
					disabled: b !== null,
					onClick: () => void O("once"),
					children: "Allow once"
				}),
				/* @__PURE__ */ J(B, {
					variant: R.Primary,
					loading: b === D.id && c.variables?.reply === "always",
					disabled: b !== null || !ee,
					title: ee ? "Remember the server-derived narrow access pattern" : "This operation has no safe reusable permission pattern",
					onClick: () => void O("always"),
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
						})] }), /* @__PURE__ */ J(ul, {
							"aria-label": "Approve all automatically",
							checked: m,
							disabled: l.isPending,
							onChange: (e) => void A(e)
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
						children: p.map((e) => /* @__PURE__ */ J(Km, {
							grant: e,
							deleting: S === e.id,
							onDelete: () => void k(e)
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
function Jm(e) {
	return e.replaceAll("_", " ");
}
function Ym(e) {
	return e?.token_budget === null || e?.token_budget === void 0 ? "" : String(e.token_budget);
}
function Xm(e) {
	let t = e.trim();
	if (!t) return null;
	let n = Number(t);
	return Number.isSafeInteger(n) && n > 0 ? n : void 0;
}
function Zm({ sessionId: e, behavior: t, openRequest: n = 0 }) {
	let r = t === "direct" || t === "direct-with-orchestrator", i = ce(e, r), a = xe(), o = yt(), c = fe(), l = hn(), u = i.data ?? null, [d, f] = K(!1), [p, m] = K(""), [h, g] = K(""), _ = G(0);
	if (U(() => {
		n !== 0 && n !== _.current && (_.current = n, m(u?.objective ?? ""), g(Ym(u)), f(!0));
	}, [u, n]), !r) return null;
	let v = a.isPending || o.isPending || c.isPending, y = () => {
		m(u?.objective ?? ""), g(Ym(u)), f(!0);
	}, b = (e, t) => {
		l.error(`${e}: ${ir($(t))}`);
	}, x = async () => {
		let t = Xm(h);
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
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(Ln, {
		title: "Durable goal",
		position: s.TopCenter,
		children: /* @__PURE__ */ J(B, {
			size: L.Small,
			variant: u?.status === "active" ? R.GhostHighlightedAccent : R.Ghost,
			content: I.Icon,
			"aria-label": u ? `Goal: ${Jm(u.status)}` : "Create durable goal",
			onClick: y,
			children: /* @__PURE__ */ J(z, {
				iconName: V.Flag,
				size: 16
			})
		})
	}), /* @__PURE__ */ J(Ht, {
		open: d,
		onClose: () => f(!1),
		size: Mn.Wide,
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
							children: Jm(u.status)
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
				/* @__PURE__ */ J(sc, {
					label: "Objective",
					textAreaSize: oc.Medium,
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
						/* @__PURE__ */ J(B, {
							variant: R.Secondary,
							disabled: v,
							onClick: () => void S("paused"),
							children: "Pause"
						}),
						/* @__PURE__ */ J(B, {
							variant: R.Secondary,
							disabled: v,
							onClick: () => void S("usage_limited"),
							children: "Usage limit"
						}),
						/* @__PURE__ */ J(B, {
							variant: R.Secondary,
							disabled: v,
							onClick: () => void S("budget_limited"),
							children: "Budget limit"
						})
					] }) : u.status === "complete" ? null : /* @__PURE__ */ J(B, {
						variant: R.Secondary,
						disabled: v,
						onClick: () => void S("active"),
						children: "Resume"
					}), /* @__PURE__ */ J(B, {
						variant: R.GhostDestructive,
						disabled: v,
						onClick: () => void C(),
						children: "Clear"
					})] }) : null, /* @__PURE__ */ J(B, {
						variant: R.Primary,
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
var Qm = "Direct-session work that continues across ordinary turns until completed, blocked, paused, or limited.", $m = 100, eh = 1e6, th = 100, nh = 9600;
function rh(e) {
	let t = e.replaceAll("_", " ");
	return t.charAt(0).toUpperCase() + t.slice(1);
}
function ih(e) {
	return e === "active" ? Si.Green : e === "complete" ? Si.Gray : Si.Yellow;
}
function ah(e) {
	let t = Math.round(e / th) * th;
	return Math.min(eh, Math.max($m, t));
}
function oh({ sessionId: e, className: t, onOpen: n }) {
	let r = ce(e, !0).data ?? null, i = r?.status === "active";
	return /* @__PURE__ */ J(Ln, {
		className: t,
		position: s.TopCenter,
		title: r ? `Current Goal: ${rh(r.status)} - Click To Edit` : "Set Durable Goal",
		description: r ? r.objective : Qm,
		children: /* @__PURE__ */ J(B, {
			type: "button",
			size: L.Large,
			variant: i ? R.GhostHighlightedAccent : R.Ghost,
			content: I.Icon,
			"aria-label": r ? `Edit goal: ${rh(r.status)}` : "Set durable goal",
			onClick: n,
			children: /* @__PURE__ */ J(z, {
				iconName: V.Flag,
				size: 24
			})
		})
	});
}
function sh({ sessionId: e, onClose: t }) {
	let n = ce(e, !0), r = xe(), i = yt(), a = fe(), o = hn(), s = n.data ?? null, [c, l] = K(s?.objective ?? ""), [u, d] = K(s?.token_budget != null), [f, p] = K(ah(s?.token_budget ?? nh)), m = G(n.data !== void 0);
	U(() => {
		if (m.current || n.isPending) return;
		m.current = !0;
		let e = n.data ?? null;
		l(e?.objective ?? ""), d(e?.token_budget != null), p(ah(e?.token_budget ?? nh));
	}, [n.data, n.isPending]);
	let h = r.isPending || i.isPending || a.isPending, g = s != null && s.status !== "complete", _ = (e, t) => {
		o.error(`${e}: ${ir($(t))}`);
	}, v = async (n) => {
		let a = u ? f : null;
		if (!c.trim()) {
			o.error("Goal objective is required.");
			return;
		}
		try {
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
			}), l(""), d(!1), p(nh);
		} catch (e) {
			_("Unable to clear goal", e);
		}
	}, x = ch(s, h || !c.trim());
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
			}) : s ? /* @__PURE__ */ Y("div", {
				className: "flex flex-wrap items-center gap-2",
				children: [
					/* @__PURE__ */ J("span", {
						className: "shrink-0 text-micro font-semibold text-basic-primary",
						children: "Current Goal"
					}),
					/* @__PURE__ */ J(Ci, {
						text: rh(s.status),
						color: ih(s.status)
					}),
					/* @__PURE__ */ Y("span", {
						className: "min-w-0 flex-1 truncate text-micro text-basic-secondary",
						children: [
							s.tokens_used.toLocaleString(),
							" Tokens, ",
							Math.floor(s.time_used_ms / 1e3),
							"s"
						]
					}),
					/* @__PURE__ */ J(B, {
						type: "button",
						size: L.Small,
						variant: R.GhostDestructive,
						disabled: h,
						onClick: () => void b(),
						children: "Clear"
					}),
					/* @__PURE__ */ J(B, {
						type: "button",
						size: L.Small,
						variant: R.Primary,
						loading: h,
						disabled: !c.trim(),
						onClick: () => void v(!g),
						children: s.status === "complete" ? "Replace" : "Save"
					})
				]
			}) : null, /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2",
				children: [
					/* @__PURE__ */ J(ul, {
						checked: u,
						disabled: h,
						"aria-label": "Token budget",
						onChange: d
					}),
					/* @__PURE__ */ J("span", {
						className: "label-micro shrink-0 text-basic-primary",
						children: "Token Budget"
					}),
					u ? null : /* @__PURE__ */ J("span", {
						className: "w-16 shrink-0 text-micro text-basic-muted",
						children: "Disabled"
					}),
					/* @__PURE__ */ J("span", {
						className: "code code-small w-[60px] shrink-0 text-right text-basic-secondary",
						children: f.toLocaleString()
					}),
					/* @__PURE__ */ J(Yc, {
						className: "min-w-0 flex-1",
						min: $m,
						max: eh,
						step: th,
						value: f,
						disabled: h,
						label: "Token budget",
						onChange: (e) => {
							p(e), d(!0);
						}
					})
				]
			})]
		}), /* @__PURE__ */ Y("div", {
			className: "relative flex items-end rounded-[4px] bg-btn-secondary-accent pr-[96px]",
			children: [
				/* @__PURE__ */ J("textarea", {
					className: "relative block min-h-[48px] w-full resize-none border-none bg-transparent p-3 text-medium text-input outline-none placeholder:text-input-placeholder",
					rows: c.length > 80 ? 3 : 1,
					"aria-label": "Goal objective",
					placeholder: "Describe the concrete output",
					value: c,
					onChange: (e) => l(e.target.value),
					onKeyDown: (e) => {
						if (e.key === "Escape") {
							e.preventDefault(), t();
							return;
						}
						e.key !== "Enter" || e.shiftKey || (e.preventDefault(), v(s == null || s.status === "complete"));
					}
				}),
				/* @__PURE__ */ J(B, {
					type: "button",
					className: "absolute right-[48px] bottom-0",
					size: L.Large,
					variant: R.Ghost,
					content: I.Icon,
					"aria-label": "Close goal editor",
					onClick: t,
					children: /* @__PURE__ */ J(z, {
						iconName: V.Close,
						size: 24
					})
				}),
				/* @__PURE__ */ J(B, {
					type: "button",
					className: "absolute right-0 bottom-0",
					size: L.Large,
					variant: R.Primary,
					content: I.Icon,
					disabled: x.disabled || h,
					loading: h && x.kind === "save",
					"aria-label": x.label,
					onClick: () => {
						x.kind === "pause" ? y("paused") : x.kind === "resume" ? y("active") : v(!0);
					},
					children: /* @__PURE__ */ J(z, { iconName: x.icon })
				})
			]
		})]
	});
}
function ch(e, t) {
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
//#endregion
//#region src/app/features/direct-session/browserAdapters.ts
function lh(e, t, n = {
	readMessages: St(e).api.getMessages,
	subscribe: St(e).events
}) {
	let { applyAssistantDelta: r, applyEnvelope: i, captureRuntimeActivation: a, clearRuntimeThreads: o, resetRuntime: s, setStreamStatus: l, syncRunFromSnapshot: u } = St(e).stores.runtimeStore, d = D(e, t), f = !1, p = () => !1;
	return {
		attach: () => {
			f = !0, s(t), p = a(t), u(e.getQueryData(Mt.sessionSnapshot(t))?.active_run);
		},
		detach: () => {
			f = !1, p() && s(null), Je(d), e.cancelQueries({
				queryKey: Mt.sessionSnapshot(t),
				exact: !0
			}), e.cancelQueries({ queryKey: Mt.threadEventsRoot(t) }), e.removeQueries({ queryKey: Mt.threadEventsRoot(t) });
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
			n && (o(), e.cancelQueries({ queryKey: Mt.threadEventsRoot(t) }), e.removeQueries({ queryKey: Mt.threadEventsRoot(t) })), e.cancelQueries({
				queryKey: Mt.sessionSnapshot(t),
				exact: !0
			}), _(d, n);
		},
		snapshot: async () => {
			Tn("query:invalidate.session", { throttleMs: 0 }), await e.invalidateQueries({
				queryKey: Mt.sessionSnapshot(t),
				exact: !0
			});
		},
		tail: async (r) => {
			let i = Lr(d), a = AbortSignal.any([r, i.controller.signal]);
			try {
				let r = await n.readMessages(t, {
					limit: 24,
					includeSystem: !0,
					signal: a
				});
				if (!f || a.aborted || !$e(d, i.generation)) return { kind: "obsolete" };
				let o = !1;
				return e.setQueryData(Mt.sessionSnapshot(t), (e) => {
					if (!e) return o = !0, e;
					let t = c(e, r);
					return t.kind === "snapshot-required" ? (o = !0, e) : t.snapshot;
				}), o ? { kind: "snapshot-required" } : {
					kind: "accepted",
					total: r.page.total
				};
			} catch (e) {
				if (a.aborted || !$e(d, i.generation)) return { kind: "obsolete" };
				throw e;
			} finally {
				Mr(d, i);
			}
		},
		invalidate: (n, r) => {
			let i = n === "permissions" ? Mt.sessionPermissions(t) : n === "skills" ? Mt.sessionSkills(t) : n === "revisions" ? Mt.workspaceRevisions(t) : Mt.threadEvents(t, r ?? "");
			e.invalidateQueries({
				queryKey: i,
				exact: !0
			});
		}
	};
}
//#endregion
//#region src/app/features/direct-session/streamReconciliation.ts
var uh = class extends sr("nac/SessionObservation")() {}, dh = 250, fh = De(function* () {
	let e = yield* uh;
	return yield* En(tt(() => {
		e.attach();
		let t = !1, n = null, r = null, i = !1, a = !1, s = !1, c = 0, l = 0, u = null, d = new AbortController();
		function f(i) {
			t || (i && (c = 0), e.fenceSnapshot(i), clearTimeout(n ?? void 0), n = null, s = !1, clearTimeout(r ?? void 0), r = setTimeout(() => {
				if (r = null, t) return;
				let n = ++l;
				a = !0, He(ne({
					try: e.snapshot,
					catch: () => "snapshot-unavailable"
				}).pipe(Fe, Sn(tt(() => {
					t || n !== l || (a = !1, s && r === null && p());
				}))));
			}, dh));
		}
		function p() {
			if (t || i || a || r !== null) return;
			i = !0;
			let n = De(function* () {
				let n = 1;
				for (; !t && s && !a && r === null;) {
					s = !1;
					let r = yield* ne({
						try: () => e.tail(d.signal),
						catch: () => "tail-unavailable"
					}).pipe(o(() => at({ kind: "snapshot-required" })));
					if (!(t || r.kind === "obsolete")) {
						if (r.kind === "snapshot-required") {
							f(!0);
							return;
						}
						if (r.total < c) {
							if (n === 0) {
								f(!1);
								return;
							}
							--n, s = !0;
						}
					}
				}
			}).pipe(Sn(tt(() => {
				i = !1;
			})));
			He(n);
		}
		function m(e) {
			t || (c = Math.max(c, e), s = !0, !(r !== null || a || i) && (clearTimeout(n ?? void 0), n = setTimeout(() => {
				n = null, p();
			}, dh)));
		}
		let h = e.subscribe({
			change: (n) => {
				t || (n.finishedThread && e.invalidate("thread", n.finishedThread), n.refresh === "messages" ? m(n.transcriptLength) : n.refresh === "snapshot" ? f(!1) : n.refresh === "replace-snapshot" && f(!0), n.runCompleted && e.invalidate("revisions"), n.permissionsChanged && e.invalidate("permissions"));
			},
			epoch: (n) => {
				t || (u !== null && n !== u && (f(!0), e.invalidate("skills"), e.invalidate("permissions")), u = n);
			},
			replayLost: () => {
				t || (f(!0), e.invalidate("permissions"));
			}
		});
		return { close: () => {
			t || (t = !0, l += 1, h(), clearTimeout(n ?? void 0), clearTimeout(r ?? void 0), d.abort(), e.detach());
		} };
	}), (e) => tt(e.close));
});
//#endregion
//#region src/app/features/direct-session/browserRuntime.ts
function ph(e) {
	let t = u(xt()), n = (() => {
		try {
			return u(fh.pipe(ye(ml(uh, e)), pt(t)));
		} catch (n) {
			throw e.detach(), u(_t(t, Hn)), n;
		}
	})();
	return () => {
		n.close(), u(_t(t, Hn));
	};
}
//#endregion
//#region src/app/hooks/useSessionStream.ts
function mh(e) {
	let { resetRuntime: t } = P().stores.runtimeStore, n = oi();
	U(() => {
		if (!e) {
			t(null);
			return;
		}
		return ph(lh(n, e));
	}, [
		e,
		n,
		t
	]);
}
function hh(e, t) {
	let { subscribeToSessionEvents: n } = { subscribeToSessionEvents: P().events }, r = oi();
	U(() => {
		if (!t) return;
		let i = () => {
			r.invalidateQueries({
				queryKey: Mt.sessionPermissions(e),
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
function gh(e) {
	let { syncRunFromSnapshot: t } = P().stores.runtimeStore;
	U(() => {
		t(e);
	}, [e, t]);
}
//#endregion
//#region src/app/components/inspector/ChildControls.tsx
function _h({ child: e }) {
	let t = e.status === "running";
	return hh(e.child_session_id, t), t ? /* @__PURE__ */ J(qm, {
		sessionId: e.child_session_id,
		behavior: "direct",
		label: `Permissions for ${e.description}`,
		autoApprovalAvailable: !1,
		requesterLabel: `child agent “${e.description}”`
	}) : null;
}
function vh({ sessionId: e, behavior: t, showTrigger: n = !0, openRequest: r = 0 }) {
	let i = t === "direct" || t === "direct-with-orchestrator", a = F(e, i), o = rr(), c = hn(), [l, u] = K(!1), [d, f] = K(""), [p, m] = K(""), [h, g] = K(!0), _ = G(0);
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
			c.error(`Unable to start child: ${ir($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(q, { children: [
		v.map((e) => /* @__PURE__ */ J(_h, { child: e }, e.child_session_id)),
		n ? /* @__PURE__ */ J(Ln, {
			title: "Launch coding agent",
			position: s.TopCenter,
			children: /* @__PURE__ */ J(B, {
				size: L.Small,
				variant: v.some((e) => e.status === "running") ? R.GhostHighlightedAccent : R.Ghost,
				content: I.Icon,
				"aria-label": "Launch coding agent",
				onClick: () => u(!0),
				children: /* @__PURE__ */ J(z, {
					iconName: V.People,
					size: 16
				})
			})
		}) : null,
		/* @__PURE__ */ J(Ht, {
			open: l,
			onClose: () => u(!1),
			size: Mn.Wide,
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
						/* @__PURE__ */ J(sc, {
							label: "Complete task prompt",
							textAreaSize: oc.Medium,
							placeholder: "Describe the task, relevant context, and expected verification",
							value: p,
							onChange: (e) => m(e.target.value),
							textAreaClassName: "h-[112px] resize-none"
						}),
						/* @__PURE__ */ Y("div", {
							className: "flex flex-wrap items-center justify-between gap-3",
							children: [/* @__PURE__ */ Y("label", {
								className: "flex items-center gap-2 text-small text-basic-secondary",
								children: [/* @__PURE__ */ J(ul, {
									checked: h,
									disabled: y,
									onChange: g
								}), "Run in background"]
							}), /* @__PURE__ */ J(B, {
								variant: R.Primary,
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
function yh({ sessionId: e, behavior: t, showTrigger: n = !0, openRequest: r = 0 }) {
	let i = se().orchestrationEnabled && t === "direct-with-orchestrator", a = f(e, i), o = _e(), c = hn(), [l, u] = K(!1), [d, p] = K(""), [m, h] = K(""), [g, _] = K(!0), v = G(0);
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
			c.error(`Unable to start orchestrator: ${ir($(e))}`);
		}
	};
	return /* @__PURE__ */ Y(q, { children: [n ? /* @__PURE__ */ J(Ln, {
		title: "Launch NAC orchestrator",
		position: s.TopCenter,
		children: /* @__PURE__ */ J(B, {
			size: L.Small,
			variant: y.some((e) => e.status === "running") ? R.GhostHighlightedAccent : R.Ghost,
			content: I.Icon,
			"aria-label": "Launch NAC orchestrator",
			onClick: () => u(!0),
			children: /* @__PURE__ */ J(z, {
				iconName: V.Flow,
				size: 16
			})
		})
	}) : null, /* @__PURE__ */ J(Ht, {
		open: l,
		onClose: () => u(!1),
		size: Mn.Wide,
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
					/* @__PURE__ */ J(sc, {
						label: "Complete objective",
						textAreaSize: oc.Medium,
						placeholder: "Describe scope, constraints, and expected verification",
						value: m,
						onChange: (e) => h(e.target.value),
						textAreaClassName: "h-[112px] resize-none"
					}),
					/* @__PURE__ */ Y("div", {
						className: "flex flex-wrap items-center justify-between gap-3",
						children: [/* @__PURE__ */ Y("label", {
							className: "flex items-center gap-2 text-small text-basic-secondary",
							children: [/* @__PURE__ */ J(ul, {
								checked: g,
								disabled: b,
								onChange: _
							}), "Run in background"]
						}), /* @__PURE__ */ J(B, {
							variant: R.Primary,
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
var bh = "The subagent keeps working after you leave this chat. Steer or stop it from here.", xh = {
	completed: {
		text: "Completed",
		color: Si.Green
	},
	cancelled: {
		text: "Cancelled",
		color: Si.Yellow
	},
	failed: {
		text: "Failed",
		color: Si.Red
	},
	interrupted: {
		text: "Interrupted",
		color: Si.Yellow
	}
};
function Sh({ value: e, onChange: t, onSubmit: n, onStop: r, running: i, background: a, onBackgroundChange: o, status: c = null, busy: l = !1, permission: u, autoFocus: f = !1, focusRequest: p = 0 }) {
	let m = G(null), h = e.trim().length > 0, g = i ? "Steer a message" : "Send a message", _ = !i && c ? xh[c] : void 0, v = i ? a ? "Running in the background" : "Regular run" : "Run in the background";
	return $r(() => {
		let e = m.current;
		e && (e.style.height = "auto", e.style.height = `${e.scrollHeight}px`);
	}, [e]), $r(() => {
		if (!f) return;
		let e = () => m.current?.focus({ preventScroll: !0 });
		e();
		let t = requestAnimationFrame(e);
		return () => cancelAnimationFrame(t);
	}, [f, p]), /* @__PURE__ */ Y("form", {
		className: "flex w-full flex-col gap-4 rounded-[8px] bg-elevation-level-2 p-4 shadow-2xl",
		onSubmit: (e) => {
			e.preventDefault(), i && !h ? r() : h && n();
		},
		children: [/* @__PURE__ */ Y("div", {
			className: "relative flex items-end overflow-hidden rounded-[4px] bg-input py-2 pr-12 pl-2",
			children: [/* @__PURE__ */ J("textarea", {
				ref: m,
				rows: 1,
				value: e,
				placeholder: g,
				"aria-label": g,
				disabled: l,
				className: "max-h-40 min-h-5 w-full resize-none bg-transparent px-1 text-small text-input outline-none placeholder:text-input-placeholder",
				onChange: (e) => t(e.target.value),
				onKeyDown: (e) => {
					e.key !== "Enter" || e.shiftKey || (e.preventDefault(), h && !l && n());
				}
			}), /* @__PURE__ */ J(B, {
				type: "submit",
				size: L.Medium,
				variant: R.Primary,
				content: I.Icon,
				className: "absolute right-0 bottom-0",
				disabled: l || !i && !h,
				"aria-label": i ? h ? "Steer" : "Stop" : "Send",
				children: /* @__PURE__ */ J(z, { iconName: i && !h ? V.Stop : V.ArrowTop })
			})]
		}), /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2.5 h-6",
			children: [/* @__PURE__ */ Y("div", {
				className: "flex min-w-0 flex-1 items-center gap-2",
				children: [
					i ? null : /* @__PURE__ */ J(ul, {
						checked: a,
						disabled: l,
						"aria-label": "Run in the background",
						onChange: o
					}),
					/* @__PURE__ */ J("span", {
						className: d("label-micro truncate", i && a ? "text-info-primary" : i ? "text-basic-tertiary" : "text-basic-primary"),
						children: v
					}),
					/* @__PURE__ */ J(Ln, {
						title: v,
						description: bh,
						position: s.TopCenter,
						children: /* @__PURE__ */ J("span", {
							className: "inline-flex text-basic-tertiary",
							children: /* @__PURE__ */ J(z, {
								iconName: V.Info,
								size: 16
							})
						})
					}),
					_ ? /* @__PURE__ */ J(Ci, {
						text: _.text,
						color: _.color,
						className: "px-1 py-[2px]"
					}) : null
				]
			}), u]
		})]
	});
}
//#endregion
//#region src/app/components/inspector/SubagentComposer.tsx
function Ch(e) {
	let t = e.trim().split("\n")[0] ?? "";
	return t.length > 80 ? `${t.slice(0, 77)}…` : t;
}
function wh({ parentSessionId: e, target: t, permissionSessionId: n, permissionBehavior: r, requesterLabel: i, onStarted: a, autoFocus: o = !1, focusRequest: s = 0, showPermissions: c = !0 }) {
	let l = hn(), u = rr(), d = _e(), f = te(), p = Ie(), [m, h] = K(""), [g, _] = K(t.mode === "child" || t.mode === "orchestrator" ? t.background : !0), v = (t.mode === "child" || t.mode === "orchestrator") && t.status === "running", y = u.isPending || d.isPending || f.isPending || p.isPending, b = t.mode === "child" || t.mode === "orchestrator" ? t : null, x = async () => {
		let n = m.trim();
		if (!n) return;
		let r = b ? b.description : Ch(n);
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
			l.error(`Unable to update the subagent: ${ir($(e))}`);
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
			l.error(`Unable to stop the subagent: ${ir($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Sh, {
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
		permission: c ? /* @__PURE__ */ J(qm, {
			sessionId: n,
			behavior: r,
			autoApprovalAvailable: !1,
			requesterLabel: i
		}) : null
	});
}
function Th({ parentSessionId: e, sessionId: t, kind: n, description: r, behavior: i }) {
	let a = n === "managed-orchestrator", o = F(e, !a), s = f(e, a), c = a ? s.data?.find((e) => e.orchestrator_session_id === t) : o.data?.find((e) => e.child_session_id === t), l = {
		mode: a ? "orchestrator" : "child",
		id: t,
		description: c?.description || r || "Subagent",
		status: c?.status ?? "idle",
		background: c?.execution_mode !== "foreground"
	};
	return /* @__PURE__ */ J(wh, {
		parentSessionId: e,
		target: l,
		permissionSessionId: t,
		permissionBehavior: a ? "orchestrator" : i ?? "direct",
		requesterLabel: a ? void 0 : `child agent “${l.description}”`
	}, `${l.mode}:${l.id}:${l.status}:${l.background}`);
}
//#endregion
//#region src/app/hooks/usePromptHistoryPreview.ts
var Eh = 40;
function Dh(e) {
	let t = e.trim();
	if (!t) return "[empty]";
	let n = t.split("\n")[0] ?? "";
	return n.length <= Eh ? n : `${n.slice(0, Eh)}…`;
}
function Oh({ prompts: e, value: t, enabled: n, setValue: r, textareaRef: i, afterCommit: a }) {
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
		previewText: u ? Dh(d) : "",
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
var kh = /[\p{Alphabetic}\p{Number}_-]/u;
function Ah(e, t) {
	return t >= e.length ? null : e.slice(t)[Symbol.iterator]().next().value ?? null;
}
function jh(e, t) {
	let n = Ah(e, t);
	return n === null || !kh.test(n);
}
function Mh(e) {
	return [...e].sort((e, t) => t.name.length - e.name.length || e.name.localeCompare(t.name));
}
function Nh(e, t) {
	if (!e || t.length === 0) return [{
		text: e,
		skillName: null
	}];
	let n = Mh(t), r = [], i = 0, a = 0;
	for (;;) {
		let t = e.indexOf("$", a);
		if (t === -1) break;
		let o = t + 1, s = n.find((t) => e.startsWith(t.name, o) && jh(e, o + t.name.length));
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
function Ph(e, t, n, r) {
	if (t === 0 || t !== n || r.length === 0 || !jh(e, n)) return null;
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
var Fh = "Ask anything…", Ih = "Ask anything, or press ↑ for an earlier prompt", Lh = {
	mobile: 40,
	wide: 48
}, Rh = {
	mobile: 128,
	wide: 200
};
function zh(e) {
	let t = /^(\s*)\/(\S*)$/u.exec(e);
	if (!t || t[0] !== e) return null;
	let n = t[2];
	return n.includes("/") || n.includes("\\") ? null : {
		leadingWhitespace: t[1],
		prefix: n
	};
}
function Bh(e, t) {
	let n = e.trim();
	if (!n.startsWith("/")) return null;
	let r = n.slice(1), i = r.search(/\s/u), a = i === -1 ? r : r.slice(0, i), o = i === -1 ? "" : r.slice(i).trim();
	return t.find((e) => e.name === a && (e.accepts_arguments || !o)) ?? null;
}
function Vh(e, t, n, r) {
	return `${e}:${n}:${r}:${t}`;
}
var Hh = { WebkitTextStroke: "0.45px currentColor" };
function Uh(e) {
	return e.map((e, t) => e.skillName ? /* @__PURE__ */ J("strong", {
		className: "[font-weight:inherit] text-danger-primary",
		style: Hh,
		children: e.text
	}, `${e.skillName}-${t}`) : /* @__PURE__ */ J("span", { children: e.text }, t));
}
var Wh = { backgroundImage: "linear-gradient(to top, var(--color-bg-elevation-ground), var(--color-bg-elevation-ground-transparent))" };
function Gh({ iconName: e, prefix: t, value: n, iconSize: r = 14, className: i, title: a, showIcon: o = !0, labelClassName: c = "label-micro" }) {
	return /* @__PURE__ */ J(Ln, {
		title: a,
		position: s.TopCenter,
		children: /* @__PURE__ */ Y("div", {
			className: d("flex items-center gap-[2px] py-1 whitespace-nowrap", i),
			children: [t ? /* @__PURE__ */ J("span", {
				className: c,
				children: t
			}) : o && e ? /* @__PURE__ */ J(z, {
				iconName: e,
				size: r
			}) : null, /* @__PURE__ */ J("span", {
				className: c,
				children: n
			})]
		})
	});
}
function Kh(e, t) {
	let n = on(e), r = t.contextWindow;
	if (!r || e == null) return {
		value: n,
		title: "Orchestrator context"
	};
	let i = on(r);
	return t.estimated ? {
		value: `${n} / ${i} est.`,
		title: `Orchestrator context against ${t.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate`
	} : {
		value: `${n} / ${i}`,
		title: `Orchestrator context — ${Math.round(e / r * 100)}% of the model's context window`
	};
}
function qh({ sessionId: t, snapshot: n, entry: r }) {
	let { useSshConnectionStatus: i, sshTargetFromSummary: o, markSshDisconnected: c, markSshConnected: l } = P().stores.sshConnectionStore, { useSessionSpend: u, useRunning: f, useRunUsage: p, useRunStartedAt: m, useLastElapsedMs: h, useCancelArmed: g, pushLocalEvent: _, liftSessionSpend: v, captureRuntimeActivation: y } = P().stores.runtimeStore, { revealSidePanel: b, openSubagentLaunch: x } = P().stores.sessionLayoutStore, { consumePromptRequests: S } = P().stores.composerStore, C = pi();
	a("ChatInputBox");
	let [w, T] = K(""), E = G(w);
	U(() => {
		E.current = w;
	}, [w]);
	let D = jr(), ee = Qe(), O = D || ee, [k, te] = K(!1), [j, ne] = K({
		start: 0,
		end: 0
	}), [re, ie] = K(null), [ae, oe] = K(0), [se, le] = K(null), ue = D && !k, de = D ? Lh.mobile : Lh.wide, pe = D ? Rh.mobile : Rh.wide, N = f(t), F = g(t), me = hn(), he = Hf(), ge = mn(), _e = $n(), ve = e(), ye = Ue(), be = ht(), Se = Oe(), Ce = r?.summary.behavior ?? n?.metadata.behavior ?? null, Te = Ce === "direct" || Ce === "direct-with-orchestrator", Ee = r?.lineage ?? n?.lineage ?? null, De = Ee != null, ke = r !== null || n !== null, Ae = rt(t, Te && !De), je = ce(t, Te && !De), Me = xe(), Ne = yt(), Pe = fe(), [Fe, Ie] = K(0), [Le, Re] = K(!1), [ze, Be] = K(t);
	ze !== t && (Be(t), Re(!1));
	let { data: Ve, isError: He, refetch: We } = Tr(t), { data: Ke, isError: qe } = Et(t), Je = G(null), Ye = G(null), Ze = G(null), $e = G([]), et = G(!1), tt = Qr(), nt = p(), it = u();
	U(() => {
		v(Xe(n));
	}, [v, n]);
	let at = Pr(n, r, N || F ? nt : null, it), ot = r?.summary.backend ?? n?.metadata.backend ?? null, st = Zn(), ct = Xe(n), lt = at.usage?.total_tokens || ct?.total_tokens || null, ut = Kh(lt, xu(st.data, n?.metadata?.backend, at.model)), dt = gn(1e3, N), ft = m(), pt = h(), mt = (N && ft != null ? Math.max(0, dt - ft) : null) ?? pt ?? at.lastResponseMs, gt = o(r?.summary), _t = i(gt), vt = Fr(), bt = Ge(r?.summary) === "SSH", xt = N && Te && !De, St = N && Ce === "orchestrator" && !De, Ct = xt || St, wt = ge.isPending || _e.isPending || ve.isPending || ye.isPending || be.isPending || Se.isPending || Me.isPending || Ne.isPending || Pe.isPending, Tt = wt || F || N && !Ct, Ot = !!w.trim() && !Tt, kt = (Ae.data ?? []).filter((e) => e.status === "pending"), At = async (e, n, r) => {
		try {
			await be.mutateAsync({
				sessionId: t,
				itemId: e,
				expectedVersion: n,
				delivery: r
			});
		} catch (e) {
			me.error(`Unable to change pending message: ${ir($(e))}`);
		}
	}, jt = async (e, n) => {
		try {
			await Se.mutateAsync({
				sessionId: t,
				itemId: e,
				expectedVersion: n
			});
		} catch (e) {
			me.error(`Unable to cancel pending message: ${ir($(e))}`);
		}
	}, Mt = H(() => {
		let e = Je.current;
		e && (e.style.height = `${de}px`, e.style.height = `${Math.min(e.scrollHeight, pe)}px`);
	}, [de, pe]);
	$r(() => {
		let e = Ze.current, t = Je.current;
		e === null || !t || (Ze.current = null, Mt(), t.focus(), t.setSelectionRange(e, e));
	}, [Mt, w]);
	let Nt = Oh({
		prompts: W(() => {
			let e = [];
			for (let t of n?.messages ?? []) t.role === "user" && e.push(yr(t.content));
			return e.reverse();
		}, [n?.messages]),
		value: w,
		enabled: !D,
		setValue: T,
		textareaRef: Je,
		afterCommit: Mt
	}), Pt = Nt.reset, Ft = Qr();
	U(() => Pt(), [t, Pt]);
	let It = W(() => zh(w), [w]), Lt = W(() => {
		if (!It || !Ve) return [];
		let e = It.prefix.toLocaleLowerCase();
		return Ve.filter((t) => (t.name !== "goal" || Te) && t.name.toLocaleLowerCase().startsWith(e));
	}, [
		Ve,
		It,
		Te
	]), Rt = W(() => Ph(w, j.start, j.end, Ke ?? []), [
		j,
		Ke,
		w
	]), zt = W(() => {
		if (It !== null || Ke !== void 0 || j.start === 0 || j.start !== j.end) return null;
		let e = w.lastIndexOf("$", j.start - 1);
		return e === -1 ? null : {
			start: e,
			end: j.end
		};
	}, [
		It,
		j,
		Ke,
		w
	]), Bt = It ? "slash" : Rt || zt ? "skill" : null, Vt = W(() => Bt === "slash" ? Lt.map((e) => ({
		kind: "slash",
		key: e.command,
		name: `/${e.name}`,
		description: e.description,
		definition: e
	})) : Bt === "skill" && Rt ? Rt.entries.map((e) => ({
		kind: "skill",
		key: e.name,
		name: `$${e.name}`,
		description: e.description,
		definition: e
	})) : [], [
		Lt,
		Rt,
		Bt
	]), Ht = Bt === "slash" ? Vh("slash", w, 0, w.length) : Bt === "skill" ? Vh("skill", w, Rt?.start ?? zt?.start ?? j.start, Rt?.end ?? zt?.end ?? j.end) : null, Ut = k && Bt !== null && Ht !== re, Wt = Math.min(ae, Math.max(Vt.length - 1, 0)), Kt = se !== null && se < Vt.length ? se : Wt, qt = Ut ? Vt[Kt] : void 0, Jt = qt ? `${tt}-option-${Kt}` : void 0, Yt = H((e) => {
		qt && e.preventDefault();
	}, [qt]);
	U(() => {
		Ut && $e.current[Wt]?.scrollIntoView({ block: "nearest" });
	}, [
		Wt,
		Ut,
		Vt
	]);
	let Xt = H(() => {
		ie(Ht), le(null);
	}, [Ht]), Zt = H((e) => {
		let t, n, r;
		if (e.kind === "slash") {
			if (!It) return;
			t = `${It.leadingWhitespace}/${e.definition.name}${e.definition.accepts_arguments ? " " : ""}`, n = t.length, r = Vh("slash", t, 0, t.length);
		} else {
			if (!Rt) return;
			let i = `$${e.definition.name}`;
			t = `${w.slice(0, Rt.start)}${i}${w.slice(Rt.end)}`, n = Rt.start + i.length, r = Vh("skill", t, Rt.start, n);
		}
		t === w ? (Ze.current = null, Mt(), Je.current?.focus(), Je.current?.setSelectionRange(n, n)) : (Ze.current = n, T(t)), ne({
			start: n,
			end: n
		}), ie(r), le(null);
	}, [
		It,
		Mt,
		Rt,
		w
	]), Qt = W(() => Nh(w, Ke ?? []), [Ke, w]), $t = !Nt.active && Qt.some((e) => e.skillName !== null);
	$r(() => {
		let e = Je.current, t = Ye.current;
		!$t || !e || !t || (t.scrollTop = e.scrollTop, t.scrollLeft = e.scrollLeft);
	}, [
		ue,
		$t,
		w
	]), U(() => {
		let e = Je.current;
		e && (ue ? (e.style.height = `${Lh.mobile}px`, e.style.overflow = "hidden") : (e.style.overflow = "", Mt()));
	}, [ue, Mt]);
	let tn = H(() => {
		let e = Je.current;
		e && (e.focus(), requestAnimationFrame(() => {
			if (!Je.current) return;
			let e = Je.current.value.length;
			Je.current.selectionStart = e, Je.current.selectionEnd = e, ne({
				start: e,
				end: e
			}), Je.current.scrollTop = Je.current.scrollHeight;
		}));
	}, []), nn = H(async () => {
		if (!(!gt || vt.isPending)) try {
			await vt.mutateAsync(gt), l(gt);
		} catch (e) {
			c(gt), me.error(`SSH reconnect failed: ${ir($(e))}`);
		}
	}, [
		gt,
		vt,
		l,
		c,
		me
	]), rn = H(async (e) => {
		if (!Te) throw Error("Durable goals are available only in direct chats");
		let n = y(t), r = je.data;
		if (r === void 0) {
			let e = await je.refetch();
			if (!n()) return;
			if (e.error) throw e.error;
			r = e.data;
		}
		let i = e.trim().slice(5).trim();
		if (i === "" || i === "edit") {
			D ? Ie((e) => e + 1) : Re(!0);
			return;
		}
		if (i === "clear") {
			if (!r) throw Error("There is no durable goal to clear");
			await Pe.mutateAsync({
				sessionId: t,
				goalId: r.goal_id,
				expectedVersion: r.version
			});
			return;
		}
		if (i === "pause" || i === "resume") {
			if (!r) throw Error(`There is no durable goal to ${i}`);
			await Ne.mutateAsync({
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
		await Me.mutateAsync({
			sessionId: t,
			payload: { objective: i }
		});
	}, [
		y,
		Pe,
		Me,
		Te,
		je,
		D,
		t,
		Ne
	]), an = H(async (e = w, n) => {
		let r = e.trim();
		if (!r || Tt || et.current) return;
		let i = e === w, a = () => {
			!i || E.current !== e || (E.current = "", T(""), ne({
				start: 0,
				end: 0
			}), Pt(), Je.current && (Je.current.style.height = `${de}px`));
		};
		et.current = !0;
		let o = y(t);
		try {
			let i = Ve;
			if (e.trimStart().startsWith("/") && i === void 0) {
				let e = await We();
				if (!o()) return;
				if (i = e.data, i === void 0) {
					me.error("Unable to load slash commands");
					return;
				}
			}
			let s = i ? Bh(e, i) : null;
			if (s?.command === "compact") {
				try {
					if (await ve.mutateAsync(t), !o()) return;
					_("compaction", "▶ compacting context…"), a();
				} catch (e) {
					if (!o()) return;
					_("error", `compact failed: ${ir($(e))}`, !0), me.error(`Failed to compact: ${au($(e), ot)}`);
				}
				return;
			}
			if (s?.command === "goal") {
				try {
					if (await rn(r), !o()) return;
					a();
				} catch (e) {
					if (!o()) return;
					me.error(`Goal command failed: ${au($(e))}`);
				}
				return;
			}
			if (s && s.command !== "mcp_prompt") {
				me.error(`Unsupported slash command: /${s.name}`);
				return;
			}
			try {
				let e = await we(Cn({
					mode: xt ? "direct-running" : St ? "classic-running" : "idle",
					delivery: n,
					inbox: (e) => ye.mutateAsync({
						sessionId: t,
						delivery: e,
						prompt: r
					}),
					steer: () => _e.mutateAsync({
						id: t,
						instruction: r
					}),
					submit: () => ge.mutateAsync({
						id: t,
						prompt: r
					})
				}));
				if (!o()) return;
				e === "submitted" ? _("run", `▶ submitted: ${r.slice(0, 80)}`) : (xt || n) && _("steering", `▶ ${n ?? "steer"}: ${r.slice(0, 80)}`), a();
			} catch (e) {
				if (!o()) return;
				_("error", `submit failed: ${ir($(e))}`, !0), me.error(`Failed to send: ${au($(e), ot)}`);
			}
		} finally {
			et.current = !1;
		}
	}, [
		w,
		Tt,
		y,
		t,
		Pt,
		de,
		Ve,
		We,
		me,
		ve,
		_,
		ot,
		rn,
		xt,
		St,
		ye,
		_e,
		ge
	]);
	U(() => S((e) => void an(e)), [S, an]);
	let sn = H(async () => {
		await he.stopRun(t);
	}, [he, t]), cn = /* @__PURE__ */ J(Ln, {
		title: "Session settings",
		position: s.TopLeft,
		children: /* @__PURE__ */ J(B, {
			className: D ? "btn-round" : void 0,
			size: D ? L.Medium : L.Small,
			variant: R.Ghost,
			content: I.Icon,
			"aria-label": "Session settings",
			onClick: () => he.settings(t),
			children: /* @__PURE__ */ J(z, {
				iconName: V.Gear,
				size: D ? void 0 : 16
			})
		})
	}), ln = !!w.trim(), un = (N || F) && !ln, dn = /* @__PURE__ */ J(z, { iconName: un ? V.Stop : V.ArrowTop }), fn = F ? "Stopping run" : N && !ln ? "Stop run" : Ct ? "Steer active run" : "Send", _n = un ? "button" : "submit", vn = F || !un && !Ot, yn = N && !ln && !F ? () => void sn() : void 0, bn = D ? /* @__PURE__ */ J(Ti, {
		className: "shrink-0",
		variant: R.Primary,
		content: I.Icon,
		type: _n,
		disabled: vn,
		loading: F,
		"aria-label": fn,
		onPointerDown: Yt,
		onClick: yn,
		children: dn
	}) : /* @__PURE__ */ J(B, {
		className: "absolute bottom-0 right-0",
		size: L.Large,
		variant: R.Primary,
		content: I.Icon,
		type: _n,
		disabled: vn,
		loading: F,
		"aria-label": fn,
		onPointerDown: Yt,
		onClick: yn,
		children: dn
	}), xn = Ut ? Bt === "slash" ? Ve === void 0 ? He ? "Slash commands unavailable" : "Loading slash commands" : Vt.length ? `${Vt.length} slash ${Vt.length === 1 ? "command" : "commands"} available` : "No matching commands" : Ke === void 0 ? qe ? "Skills unavailable" : "Loading skills" : `${Vt.length} ${Vt.length === 1 ? "skill" : "skills"} available` : "", Sn = /* @__PURE__ */ Y("div", {
		className: d("relative flex items-end", D ? d("flex-1 min-w-0 rounded-[20px] bg-elevation-level-3 shadow-2xl overflow-hidden", ue && "pr-[40px]") : d("rounded-[4px] bg-input shadow-concave", Te ? "pl-[48px] pr-[96px]" : "pr-[48px]")),
		children: [
			/* @__PURE__ */ Y("div", {
				className: "relative flex-1 min-w-0",
				children: [
					/* @__PURE__ */ J("span", {
						className: "sr-only",
						role: "status",
						"aria-live": "polite",
						"aria-atomic": "true",
						children: xn
					}),
					$t && !ue ? /* @__PURE__ */ Y("div", {
						ref: Ye,
						"aria-hidden": "true",
						className: d("pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-medium text-input [scrollbar-gutter:stable]", D ? "px-4 py-2" : "p-3"),
						children: [Uh(Qt), w.endsWith("\n") ? " " : null]
					}) : null,
					/* @__PURE__ */ J("textarea", {
						ref: Je,
						className: d("relative block w-full bg-transparent resize-none border-none outline-none text-medium text-input placeholder:text-input-placeholder placeholder:whitespace-nowrap [scrollbar-gutter:stable]", D ? "px-4 py-2" : "p-3", ue && "opacity-0 pointer-events-none"),
						rows: 1,
						role: "combobox",
						"aria-label": "Message",
						"aria-autocomplete": "list",
						"aria-haspopup": "listbox",
						"aria-expanded": Ut,
						"aria-controls": Ut ? tt : void 0,
						"aria-activedescendant": Jt,
						"aria-describedby": Nt.active ? Ft : void 0,
						enterKeyHint: D ? "enter" : void 0,
						placeholder: Nt.active ? "" : Nt.hasHistory && w === "" ? Ih : Fh,
						spellCheck: !1,
						value: w,
						style: {
							minHeight: `${de}px`,
							maxHeight: `${pe}px`,
							color: $t ? "transparent" : void 0,
							caretColor: $t ? "var(--color-text-input)" : void 0
						},
						onChange: (e) => {
							e.target.value !== w && ie(null), oe(0), le(null), Nt.onValueChange(e.target.value), T(e.target.value), ne({
								start: e.target.selectionStart,
								end: e.target.selectionEnd
							}), Mt();
						},
						onSelect: (e) => {
							let t = {
								start: e.currentTarget.selectionStart,
								end: e.currentTarget.selectionEnd
							};
							(t.start !== j.start || t.end !== j.end) && (oe(0), le(null), ne(t));
						},
						onScroll: (e) => {
							Ye.current && (Ye.current.scrollTop = e.currentTarget.scrollTop, Ye.current.scrollLeft = e.currentTarget.scrollLeft);
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
								if (Ut && !e.shiftKey) {
									if (e.key === "Escape") {
										e.preventDefault(), Xt();
										return;
									}
									if ((e.key === "ArrowDown" || e.key === "ArrowUp") && Vt.length) {
										e.preventDefault(), oe(e.key === "ArrowDown" ? Math.min(Kt + 1, Vt.length - 1) : Math.max(Kt - 1, 0)), le(null);
										return;
									}
									if (e.key === "Tab" && qt) {
										e.preventDefault(), Zt(qt);
										return;
									}
									if (e.key === "Enter" && (qt || Bt === "slash")) {
										e.preventDefault(), qt && Zt(qt);
										return;
									}
								}
								Nt.onKeyDown(e) || e.key === "Enter" && (e.shiftKey || (e.preventDefault(), an()));
							}
						}
					}),
					Nt.active ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
						id: Ft,
						className: "sr-only",
						children: "Press Tab to take this prompt, Escape to leave it, or start typing to dismiss it"
					}), /* @__PURE__ */ Y("div", {
						className: "pointer-events-none absolute inset-0 flex items-center gap-2 px-3",
						children: [/* @__PURE__ */ J("span", {
							className: "min-w-0 truncate text-medium text-input-placeholder",
							children: Nt.previewText
						}), /* @__PURE__ */ J(Dt, {
							keys: ["tab"],
							spelled: !0,
							className: "shrink-0"
						})]
					})] }) : null,
					ue ? /* @__PURE__ */ J("div", {
						className: "absolute inset-0 flex items-center px-4 cursor-text",
						onClick: tn,
						children: /* @__PURE__ */ J("span", {
							className: d("w-full truncate text-medium", w ? "text-input" : "text-input-placeholder"),
							children: w ? Uh(Qt) : Fh
						})
					}) : null
				]
			}),
			!D && Te ? /* @__PURE__ */ J(Vm, {
				className: "absolute bottom-0 left-0",
				sessionId: t,
				behavior: Ce,
				onCreateSubagent: () => {
					x("agent"), b(D), C(vr.session(t, "delegated"));
				},
				onCreateOrchestrator: () => {
					x("orchestrator"), b(D), C(vr.session(t, "delegated"));
				}
			}) : null,
			!D && Te ? /* @__PURE__ */ J(oh, {
				className: "absolute right-[48px] bottom-0",
				sessionId: t,
				onOpen: () => Re(!0)
			}) : null,
			D ? ue ? /* @__PURE__ */ J("div", {
				className: "absolute top-0 right-0",
				children: cn
			}) : null : bn
		]
	}), wn = /* @__PURE__ */ J("div", {
		id: tt,
		role: "listbox",
		"aria-label": Bt === "skill" ? "Skills" : "Slash commands",
		children: Bt === "slash" && Ve === void 0 ? /* @__PURE__ */ J("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: He ? "Slash commands unavailable" : "Loading commands…"
		}) : Bt === "skill" && Ke === void 0 ? /* @__PURE__ */ J("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: qe ? "Skills unavailable" : "Loading skills…"
		}) : Vt.length ? Vt.map((e, t) => /* @__PURE__ */ Y("button", {
			id: `${tt}-option-${t}`,
			ref: (e) => {
				$e.current[t] = e;
			},
			type: "button",
			role: "option",
			"aria-selected": t === Kt,
			tabIndex: -1,
			className: d("flex min-h-10 w-full items-center gap-3 rounded-[4px] px-3 py-2 text-left", t === Kt ? "btn-ghost-highlighted" : "btn-ghost"),
			onPointerDown: (e) => e.preventDefault(),
			onPointerMove: () => le(t),
			onPointerLeave: () => le((e) => e === t ? null : e),
			onClick: () => Zt(e),
			children: [/* @__PURE__ */ J("span", {
				className: "code code-small shrink-0 text-basic-primary",
				children: e.name
			}), /* @__PURE__ */ J("span", {
				className: d("min-w-0 flex-1 text-small text-basic-secondary", e.kind === "skill" && "truncate"),
				children: e.description
			})]
		}, `${e.kind}-${e.key}`)) : /* @__PURE__ */ J("div", {
			className: "px-3 py-2 text-small text-basic-secondary",
			children: "No matching commands"
		})
	}), Tn = /* @__PURE__ */ J(pn, {
		open: Ut,
		onClose: Xt,
		content: wn,
		placement: s.TopRight,
		sticky: !0,
		closeOnEscape: !1,
		sheetOnMobile: !1,
		className: D ? "flex-1 min-w-0" : "w-full",
		size: "w-[min(400px,calc(100vw-16px))]",
		panelClassName: "max-h-[min(40vh,320px)] overflow-y-auto",
		children: Sn
	});
	return ke ? De && Ee ? /* @__PURE__ */ J(Th, {
		parentSessionId: Ee.parent_session_id,
		sessionId: t,
		kind: Ee.kind,
		description: Ee.description,
		behavior: Ce
	}) : /* @__PURE__ */ Y("form", {
		className: d("flex flex-col", D ? "gap-3 px-4 pt-8 pb-8" : ee ? "gap-3 px-2 pt-2 pb-4 rounded-[12px] bg-elevation-level-1 shadow-2xl" : "gap-4 p-4 rounded-[8px] bg-elevation-level-1 shadow-2xl"),
		style: D ? Wh : void 0,
		onSubmit: (e) => {
			if (e.preventDefault(), !Le) {
				if (qt) {
					Zt(qt);
					return;
				}
				an();
			}
		},
		children: [
			D ? /* @__PURE__ */ Y("div", {
				className: "flex items-end gap-2",
				children: [Tn, bn]
			}) : Le && Te ? /* @__PURE__ */ J(sh, {
				sessionId: t,
				onClose: () => Re(!1)
			}) : Tn,
			kt.length ? /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-2",
				"aria-label": "Pending messages",
				children: [/* @__PURE__ */ J("div", {
					className: "tag-label uppercase text-basic-secondary",
					children: "Pending messages"
				}), kt.map((e) => /* @__PURE__ */ Y("div", {
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
						/* @__PURE__ */ Y(B, {
							type: "button",
							size: L.Small,
							variant: R.Ghost,
							disabled: wt,
							onClick: () => void At(e.id, e.version, e.delivery === "steer" ? "queue" : "steer"),
							children: ["Change to ", e.delivery === "steer" ? "queue" : "steer"]
						}),
						/* @__PURE__ */ J(B, {
							type: "button",
							size: L.Small,
							variant: R.GhostDestructive,
							disabled: wt,
							onClick: () => void jt(e.id, e.version),
							children: "Cancel"
						})
					]
				}, e.id))]
			}) : null,
			/* @__PURE__ */ Y("div", {
				className: d("flex flex-wrap items-center gap-[10px]", D && "pl-2"),
				children: [/* @__PURE__ */ Y("div", {
					className: "flex flex-1 min-w-0 flex-wrap items-center gap-y-1 gap-x-4",
					children: [
						xt ? /* @__PURE__ */ J(B, {
							type: "button",
							size: L.Small,
							variant: R.Secondary,
							disabled: !Ot,
							onClick: () => void an(w, "queue"),
							children: "Queue Next"
						}) : null,
						/* @__PURE__ */ J(Wm, {
							sessionId: t,
							metadata: n?.metadata ?? null,
							label: at.model,
							disabled: Tt
						}),
						D ? null : /* @__PURE__ */ J("div", { className: "flex-1" }),
						D ? /* @__PURE__ */ J(qm, {
							sessionId: t,
							behavior: Ce
						}) : /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-2",
							children: [
								cn,
								Te ? /* @__PURE__ */ J("span", {
									"aria-hidden": !0,
									className: "h-6 w-px shrink-0 bg-divider-muted"
								}) : null,
								/* @__PURE__ */ J(qm, {
									sessionId: t,
									behavior: Ce
								})
							]
						}),
						!D && Te ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(vh, {
							sessionId: t,
							behavior: Ce,
							showTrigger: !1
						}), /* @__PURE__ */ J(yh, {
							sessionId: t,
							behavior: Ce,
							showTrigger: !1
						})] }) : null,
						D ? /* @__PURE__ */ Y(q, { children: [
							/* @__PURE__ */ J(Zm, {
								sessionId: t,
								behavior: Ce,
								openRequest: Fe
							}),
							/* @__PURE__ */ J(vh, {
								sessionId: t,
								behavior: Ce
							}),
							/* @__PURE__ */ J(yh, {
								sessionId: t,
								behavior: Ce
							})
						] }) : null,
						bt ? /* @__PURE__ */ J(Nf, {
							state: _t === "connected" ? "connected" : "reconnect",
							onReconnect: () => void nn()
						}) : D ? /* @__PURE__ */ J("span", {
							className: "text-[10px] leading-[12px] font-medium uppercase text-basic-tertiary shrink-0",
							children: at.env
						}) : null,
						D && (at.usage || lt) ? /* @__PURE__ */ Y("div", {
							className: "flex items-center gap-[2px] min-w-0",
							children: [/* @__PURE__ */ J(Gh, {
								iconName: V.Timelaps,
								value: ut.value,
								className: "text-info-primary",
								title: ut.title,
								labelClassName: "tag-label"
							}), at.usage && !O ? /* @__PURE__ */ Y(q, { children: [
								/* @__PURE__ */ J(Gh, {
									iconName: V.ArrowTop,
									value: on(at.usage.input_tokens),
									className: "text-info-secondary opacity-75",
									title: "Input tokens",
									labelClassName: "tag-label"
								}),
								at.usage.cache_read_tokens > 0 ? /* @__PURE__ */ J(Gh, {
									prefix: "C",
									value: on(at.usage.cache_read_tokens),
									className: "text-info-secondary opacity-75",
									title: "Cache read tokens",
									labelClassName: "tag-label"
								}) : null,
								/* @__PURE__ */ J(Gh, {
									iconName: V.ArrowDown,
									value: on(at.usage.output_tokens),
									className: "text-info-secondary opacity-75",
									title: "Output tokens",
									labelClassName: "tag-label"
								})
							] }) : null]
						}) : null
					]
				}), D ? /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-[10px] shrink-0",
					children: [at.usage ? /* @__PURE__ */ J(Gh, {
						iconName: V.Price,
						iconSize: 16,
						value: en(at.usage.cost?.total),
						className: "text-basic-primary",
						title: "Session cost",
						showIcon: !1
					}) : null, /* @__PURE__ */ J(Ln, {
						title: N ? "Run elapsed" : "Last response time",
						position: s.TopRight,
						children: /* @__PURE__ */ Y("div", {
							className: d("flex items-center gap-1 p-1 shrink-0 label-micro", N ? "text-basic-primary" : "text-basic-tertiary"),
							children: [O ? null : N ? /* @__PURE__ */ J(A, { size: M.Small }) : /* @__PURE__ */ J(z, {
								iconName: V.History,
								size: 16
							}), /* @__PURE__ */ J("span", {
								className: "block w-[40px] text-center",
								children: Gt(mt)
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
		}), N && /* @__PURE__ */ J(B, {
			size: L.Small,
			variant: R.GhostDestructive,
			content: I.Text,
			"aria-label": "Stop run",
			onClick: () => void sn(),
			children: "Stop"
		})]
	});
}
//#endregion
//#region src/app/components/inspector/MobileBottomBar.tsx
var Jh = {
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
function Yh({ panel: e, onPanelChange: t, panels: n = Wn }) {
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
					className: d("flex flex-col flex-1 min-w-0 items-center justify-center gap-1 h-16 rounded-[12px]", r ? "btn-primary" : "btn-ghost"),
					onClick: () => t(n),
					children: [/* @__PURE__ */ J(z, {
						iconName: Jh[n].iconName,
						size: 28
					}), /* @__PURE__ */ J("span", {
						className: d("label-micro font-bold truncate max-w-full", r ? null : "text-basic-primary"),
						children: Jh[n].label
					})]
				}, n);
			})
		})
	});
}
//#endregion
//#region src/app/components/inspector/PanelCountBadge.tsx
function Xh({ count: e }) {
	return /* @__PURE__ */ J("span", {
		className: "pointer-events-none absolute -top-1 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-btn-primary-disabled px-0.5 text-[9px] leading-3 font-medium text-basic-secondary",
		children: e
	});
}
//#endregion
//#region src/app/components/inspector/sessionPanelIcons.ts
var Zh = {
	sessions: V.Chat,
	threads: V.Flow,
	delegated: V.Robot,
	files: V.Folders,
	terminal: V.Terminal,
	worksets: V.Checklist,
	history: V.History
};
function Qh(e, t, n) {
	return e === "delegated" ? t : e === "worksets" ? n : 0;
}
function $h({ sessionId: e, snapshot: t, behavior: n, panels: r, onOpen: i, onSelect: a }) {
	let o = se(), s = r.includes("delegated"), c = F(e, s), l = f(e, s && n === "direct-with-orchestrator"), u = (c.data?.length ?? 0) + (o.orchestrationEnabled ? l.data?.length ?? 0 : 0), d = t?.worksets?.items.length ?? 0;
	return /* @__PURE__ */ J("div", {
		className: "flex h-full flex-col items-center p-2",
		style: { width: 52 },
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col items-center gap-4 [&>*]:shrink-0",
			children: [/* @__PURE__ */ J(eg, {
				label: "Show panel",
				onClick: i,
				children: /* @__PURE__ */ J(z, { iconName: V.SidebarChevronLeft })
			}), /* @__PURE__ */ J("div", {
				className: "flex flex-col items-center gap-4",
				children: r.map((e) => {
					let t = Qh(e, u, d);
					return /* @__PURE__ */ Y("span", {
						className: "relative",
						children: [/* @__PURE__ */ J(eg, {
							label: lr[e],
							onClick: () => a(e),
							children: /* @__PURE__ */ J(z, { iconName: Zh[e] })
						}), t > 0 ? /* @__PURE__ */ J(Xh, { count: t }) : null]
					}, e);
				})
			})]
		})
	});
}
function eg({ label: e, onClick: t, children: n }) {
	return /* @__PURE__ */ J(Ln, {
		title: e,
		position: s.CenterLeft,
		sticky: !0,
		children: /* @__PURE__ */ J(B, {
			variant: R.Ghost,
			content: I.Icon,
			"aria-label": e,
			onClick: t,
			children: n
		})
	});
}
//#endregion
//#region src/app/features/terminal/queries.ts
var tg = {
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
function ng(e) {
	let { api: t } = P();
	return ai({
		queryKey: tg.list(e),
		queryFn: ({ signal: n }) => t.listUserTerminals(e, n),
		retry: !1,
		refetchInterval: 2e3
	});
}
function rg(e, t) {
	let { api: n } = P();
	return ai({
		queryKey: tg.status(e, t),
		queryFn: ({ signal: r }) => n.getUserTerminal(e, t, r),
		retry: !1,
		refetchInterval: (e) => !e.state.data || e.state.data.alive || !e.state.data.output_complete ? 1e3 : !1
	});
}
function ig(e) {
	let { api: t } = P(), n = oi();
	return ii({
		mutationFn: (n) => t.openUserTerminal(e, {
			protocol_version: 1,
			launch_id: n,
			cols: 80,
			rows: 24
		}),
		retry: !1,
		onSuccess: () => n.invalidateQueries({ queryKey: tg.list(e) })
	});
}
function ag(e, t) {
	let { api: n } = P(), r = oi();
	return ii({
		mutationFn: () => n.terminateTerminal(e, t),
		retry: !1,
		onSuccess: () => Promise.all([r.invalidateQueries({ queryKey: tg.list(e) }), r.invalidateQueries({ queryKey: tg.status(e, t) })])
	});
}
//#endregion
//#region packages/nac-client/src/userTerminalInputPump.ts
var og = 16384, sg = class extends Error {
	cause;
	constructor(e, t) {
		super(e), this.name = "TerminalInputNotSentError", this.cause = t;
	}
}, cg = class {
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
			this.disposed = !0, this.rejectPending(new sg("Terminal input was not sent because its consumer closed", this.signal.reason));
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
		return e.length === 0 || e.length > og ? Promise.reject(new sg("Terminal input was not sent: each input must contain 1–16384 bytes")) : this.disposed ? Promise.reject(new sg("Terminal input was not sent because its consumer closed")) : this.failed === void 0 ? this.active && this.pendingBytes + e.length > og ? Promise.reject(new sg("Terminal input was not sent because the pending 16 KiB buffer is full")) : new Promise((t, n) => {
			let r = {
				resolve: t,
				reject: n
			};
			this.active ? (this.pending ??= {
				buffer: new Uint8Array(og),
				length: 0,
				receipts: []
			}, this.pending.buffer.set(e, this.pending.length), this.pending.length += e.length, this.pending.receipts.push(r)) : (this.active = !0, this.deliver({
				bytes: e.slice(),
				receipts: [r]
			}));
		}) : Promise.reject(new sg("Terminal input was not sent: acknowledge the preceding delivery failure first", this.failed));
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
			let n = t instanceof Pe ? t : new sg("Terminal input was not sent", t);
			for (let t of e.receipts) t.reject(n);
			this.rejectPending(new sg("Pending terminal input was not sent after the preceding delivery failed", t));
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
		if (this.active) throw new sg("Wait for the active input receipt before acknowledging its outcome");
		this.failed = void 0, this.connection.acknowledgeInputUncertainty();
	}
	dispose() {
		this.abort.abort(new DOMException("Terminal input consumer closed", "AbortError")), this.signal.removeEventListener("abort", this.cancelListener);
	}
}, lg = 14, ug = 1.2, dg = "\"IBMPlexMono\", Menlo, monospace";
async function fg(e) {
	let { Terminal: t } = await import("./chunks/xterm-DRfz6phr.js"), n = new t({
		cols: 80,
		rows: 24,
		fontFamily: dg,
		fontSize: lg,
		lineHeight: ug,
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
		fit: () => pg(n, e),
		dispose: () => {
			i = !0, r.dispose(), n.dispose();
		}
	};
}
function pg(e, t) {
	let n = document.createElement("canvas").getContext("2d");
	if (!n || t.clientWidth < 1 || t.clientHeight < 1) return null;
	n.font = `${lg}px ${dg}`;
	let r = n.measureText("W").width;
	if (r <= 0) return null;
	let i = Math.max(2, Math.min(500, Math.floor((t.clientWidth - 18) / r))), a = e.element ? e.element.clientHeight / e.rows : 0, o = a > 0 ? a : lg * ug, s = Math.max(1, Math.min(300, Math.floor(t.clientHeight / o)));
	return e.cols === i && e.rows === s ? null : (e.resize(i, s), {
		cols: i,
		rows: s
	});
}
//#endregion
//#region src/app/features/terminal/browserRuntime.ts
var mg = class extends he("TerminalOperationFailure") {};
function hg(e, t) {
	return ne({
		try: t,
		catch: (t) => new mg({
			operation: e,
			cause: t
		})
	});
}
function gg(e, t) {
	return e instanceof Error ? e.message : t;
}
function _g(e) {
	let n = u(xt()), r = new AbortController(), i = () => !r.signal.aborted, a = (e) => {
		i() ? u(N(n, tt(e))) : e();
	}, s, c = (t) => {
		i() && (e.phase("Disconnected"), e.notice(gg(t, "Terminal observation failed")), s && (s.terminal.options.disableStdin = !0));
	}, l = (e) => {
		Wr(e, { signal: r.signal }).then((e) => {
			if (Zt(e) && i()) {
				let n = Re(e.cause);
				c(vn(n) ? n.value.cause : t(e.cause));
			}
		}).catch(c);
	};
	return l(De(function* () {
		s = yield* hg("renderer", () => fg(e.host).then((e) => (a(e.dispose), r.signal.throwIfAborted(), e)));
		let t = s, n = new O(e.api, e.sessionId, e.terminalId, t.renderer, { pageLimit: 32768 });
		a(() => {
			n.detach().catch(() => {});
		});
		let c = new cg(n, r.signal);
		a(() => {
			(c.hasActiveInput || c.needsAcknowledgement) && (e.previousFailure.current = !0), c.dispose(), e.controls(null);
		}), e.controls({
			adapter: t,
			pump: c
		});
		let u = !1, d = !1, f = !1, p = null, m = oe(() => {
			let a = t.fit();
			return a && (p = a), f || !u || !d ? je : (f = !0, De(function* () {
				for (; p && i() && d;) {
					let e = p;
					p = null, yield* hg("resize", () => n.resize(e.cols, e.rows, r.signal));
				}
			}).pipe(o((t) => tt(() => {
				i() && e.notice(`Terminal resize failed: ${gg(t.cause, "geometry control unavailable")}`);
			})), Sn(tt(() => {
				f = !1;
			}))));
		}), h = (n) => {
			!i() || !u || t.terminal.options.disableStdin || l(hg("input", () => c.send(n)).pipe(o((n) => tt(() => {
				i() && (e.notice(gg(n.cause, "Terminal input failed")), c.needsAcknowledgement && (e.previousFailure.current = !0, t.terminal.options.disableStdin = !0, e.inputFailure(!0)));
			}))));
		}, g = t.terminal.onData((e) => h(new TextEncoder().encode(e)));
		a(() => g.dispose());
		let _ = t.terminal.onBinary((e) => h(Uint8Array.from(e, (e) => e.charCodeAt(0))));
		a(() => _.dispose());
		let v = new ResizeObserver(() => l(m));
		a(() => v.disconnect()), v.observe(e.host), t.terminal.element && v.observe(t.terminal.element), e.phase("Connecting"), e.notice(""), e.inputFailure(e.previousFailure.current);
		let y = yield* hg("attach", () => n.attach(r.signal, e.reconnect ? "reconnect" : "attach"));
		if (!i()) return;
		u = !0, d = y.alive;
		let b = y.alive && e.initialTyping && !e.reconnect && !e.previousFailure.current;
		t.terminal.options.disableStdin = !b, e.needsInputEnable(y.alive && !b), e.previousFailure.current && e.notice("Input delivery was not confirmed. Check the shell before enabling fresh input."), e.phase(y.alive ? "Connected" : "Retained output"), yield* m, document.fonts.ready.then(() => {
			i() && l(m);
		}), yield* hg("observe", () => n.run(r.signal, (t) => {
			d = t.terminal.alive, d || (p = null), t.gap && i() && e.notice("Earlier output was discarded. The display was reset before retained output was replayed.");
		})), i() && (t.terminal.options.disableStdin = !0, e.phase("Output complete"));
	})), () => {
		r.abort(), u(_t(n, Hn));
	};
}
//#endregion
//#region src/app/features/terminal/useTerminalController.ts
function vg(e, t, n, r) {
	let { api: i } = P(), a = G(null), [o, s] = K(0), [c, l] = K("Connecting"), [u, d] = K(""), [f, p] = K(!1), [m, h] = K(!1), g = G(r), _ = G(!1);
	return U(() => {
		let r = n.current;
		if (r) return _g({
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
function yg(e) {
	let { api: t } = P(), n = W(() => ({
		api: t,
		id: crypto.randomUUID()
	}), [t]);
	return /* @__PURE__ */ J(bg, { ...e }, `${n.id}:${e.sessionId}`);
}
function bg({ sessionId: e, onReviewSelection: t }) {
	let n = ng(e), r = ig(e), [i, a] = K(null), [o, s] = K(null), c = G(null), l = n.data?.terminals ?? [], u = i ?? l[0]?.terminal_id;
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
						value: u ?? "",
						onChange: (e) => {
							s(null), a(e.target.value);
						},
						className: "min-w-0 max-w-full rounded-md border border-muted bg-elevation-level-2 px-2 py-1 text-sm",
						children: [
							u ? null : /* @__PURE__ */ J("option", {
								value: "",
								children: "No shell"
							}),
							u && !l.some((e) => e.terminal_id === u) ? /* @__PURE__ */ J("option", {
								value: u,
								children: "Selected shell unavailable"
							}) : null,
							l.map((e, t) => /* @__PURE__ */ Y("option", {
								value: e.terminal_id,
								children: [
									"Shell ",
									t + 1,
									e.alive ? "" : " (exited)"
								]
							}, e.terminal_id))
						]
					}),
					/* @__PURE__ */ J(B, {
						size: L.Small,
						type: "button",
						variant: R.Secondary,
						disabled: r.isPending,
						onClick: () => {
							c.current ??= crypto.randomUUID(), r.mutate(c.current, { onSuccess: (e) => {
								s(e.terminal_id), a(e.terminal_id), c.current = null;
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
					/* @__PURE__ */ J(B, {
						size: L.Small,
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
			u ? /* @__PURE__ */ J(xg, {
				sessionId: e,
				terminalId: u,
				newlyOpened: o === u,
				onReviewSelection: t
			}, u) : /* @__PURE__ */ J("p", {
				role: "status",
				children: n.isPending ? "Loading shells…" : "Open a shell to start typing. Terminal output stays separate from the conversation."
			})
		]
	});
}
function xg({ sessionId: e, terminalId: t, onReviewSelection: n, newlyOpened: r }) {
	let i = rg(e, t), a = ag(e, t), o = G(null), s = vg(e, t, o, r);
	return /* @__PURE__ */ Y(q, { children: [
		/* @__PURE__ */ Y("div", {
			className: "flex flex-wrap items-center gap-2",
			children: [
				/* @__PURE__ */ Y("span", {
					role: "status",
					children: [s.phase, i.data && !i.data.alive ? ` · Exited${i.data.exit_code == null ? "" : ` (${i.data.exit_code})`}` : ""]
				}),
				/* @__PURE__ */ J(B, {
					size: L.Small,
					type: "button",
					variant: R.Ghost,
					onClick: s.focus,
					children: "Focus terminal"
				}),
				/* @__PURE__ */ J(B, {
					size: L.Small,
					type: "button",
					variant: R.Ghost,
					disabled: s.phase === "Connecting",
					onClick: s.reconnect,
					children: "Reconnect"
				}),
				/* @__PURE__ */ J(B, {
					size: L.Small,
					type: "button",
					variant: R.Ghost,
					disabled: !i.data?.alive || a.isPending,
					onClick: () => a.mutate(),
					children: a.isPending ? "Closing…" : "Close shell"
				}),
				n ? /* @__PURE__ */ J(B, {
					size: L.Small,
					type: "button",
					variant: R.Ghost,
					onClick: () => {
						let r = s.selection();
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
		s.notice ? /* @__PURE__ */ J("p", {
			role: "alert",
			children: s.notice
		}) : null,
		s.inputFailure || s.needsInputEnable ? /* @__PURE__ */ J(B, {
			size: L.Small,
			type: "button",
			variant: R.Secondary,
			onClick: s.acknowledgeInput,
			children: s.inputFailure ? "Acknowledge failure and enable fresh input" : "Enable terminal input"
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
function Sg({ state: e, controller: t, availability: n }) {
	let r = Qr(), i = e.phase === "sending", a = i || e.phase === "uncertain" || e.phase === "accepted", o = e.phase === "editing", s = e.choice.delivery === "steer" && e.choice.runId !== n.runId, c = e.phase === "reviewed" && !n.sourceUnavailable && (e.choice.delivery === "queue" || e.choice.delivery === "send" && n.mode === "idle" || e.choice.delivery === "steer" && n.mode === "busy" && !!n.runId && !s), l = e.choice.delivery === "queue" ? "Queue selection" : e.choice.delivery === "steer" ? "Steer selected run" : "Send selection";
	return /* @__PURE__ */ J(Ht, {
		open: e.phase !== "empty",
		title: "Review terminal selection",
		size: Mn.Large,
		onClose: i ? void 0 : () => t.clear(),
		onNavigate: () => t.clear(),
		closeOnOverlay: !i,
		footer: /* @__PURE__ */ Y("div", {
			className: "flex flex-wrap gap-2 justify-end",
			children: [
				/* @__PURE__ */ J(B, {
					type: "button",
					variant: R.Ghost,
					disabled: i,
					onClick: () => t.clear(),
					children: e.phase === "uncertain" ? "Dismiss unconfirmed submission" : "Dismiss review"
				}),
				e.phase === "accepted" ? null : /* @__PURE__ */ J(B, {
					type: "button",
					variant: R.Secondary,
					disabled: i,
					onClick: () => t.clear(),
					children: "Clear selection review"
				}),
				e.phase === "uncertain" ? /* @__PURE__ */ J(B, {
					type: "button",
					onClick: () => void t.retry(),
					children: "Retry same submission"
				}) : e.phase === "accepted" ? null : /* @__PURE__ */ J(B, {
					type: "button",
					disabled: !c,
					loading: i,
					onClick: () => void t.send(),
					children: i ? "Sending selection…" : l
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
						/* @__PURE__ */ J(B, {
							type: "button",
							variant: R.Secondary,
							onClick: () => void t.preview(),
							children: "Update preview"
						})
					]
				}) : !a && e.preview ? /* @__PURE__ */ J(B, {
					type: "button",
					variant: R.Ghost,
					onClick: () => t.editUserText(),
					children: "Edit accompanying text"
				}) : null,
				!o && e.preview?.user_text != null ? /* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("h3", { children: "Reviewed accompanying text" }), /* @__PURE__ */ J("pre", {
					"aria-label": "Reviewed accompanying text",
					className: "max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-bg-elevation-level-1 p-3",
					children: e.preview.user_text
				})] }) : null,
				e.phase === "error" && e.canPreview ? /* @__PURE__ */ J(B, {
					type: "button",
					variant: R.Secondary,
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
				s ? /* @__PURE__ */ J("p", {
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
//#region src/app/features/terminal-selection/reviewWorkflow.ts
var Cg = class extends he("SelectionFailure") {};
function wg(e) {
	let t = u(xt()), n = new AbortController(), r = !0;
	return u(N(t, tt(() => {
		r = !1, n.abort();
	}))), {
		signal: n.signal,
		activationCurrent: e,
		current: () => r && e(),
		close: () => u(_t(t, Hn))
	};
}
function Tg(e) {
	return De(function* () {
		yield* tt(e.started), yield* ne({
			try: () => e.request(e.operation.signal),
			catch: (e) => new Cg({
				operation: "preview",
				cause: e
			})
		}).pipe(k({
			onSuccess: (t) => tt(() => e.confirmed(t)),
			onFailure: (t) => tt(() => e.failed(t))
		}));
	}).pipe(Sn(tt(e.operation.close)));
}
function Eg(e) {
	return De(function* () {
		yield* tt(e.started), yield* ne({
			try: () => e.request(e.operation.signal),
			catch: (e) => new Cg({
				operation: "submit",
				cause: e
			})
		}).pipe(k({
			onSuccess: (t) => De(function* () {
				yield* tt(e.accepted), yield* tt(() => e.confirmed(t));
			}),
			onFailure: (t) => De(function* () {
				yield* tt(e.unconfirmed), yield* tt(() => e.failed(t));
			})
		}));
	}).pipe(Sn(tt(e.operation.close)));
}
//#endregion
//#region src/app/features/terminal-selection/reviewController.ts
var Dg = Object.freeze({
	phase: "empty",
	editorText: "",
	choice: { delivery: "send" }
}), Og = 32768, kg = 8192;
function Ag(e) {
	let t = 0, n = e[Symbol.iterator]();
	for (; !n.next().done;) if (++t > kg) return !1;
	return new TextEncoder().encode(e).byteLength <= Og;
}
var jg = class {
	ports;
	#e = Dg;
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
		!this.#a || this.#a.activationCurrent() || this.#u();
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
		if (e.sessionId !== this.ports.sessionId || !n.trim() || !Ag(n)) {
			this.#d({
				...Dg,
				source: r,
				phase: "error",
				error: "Select visible text within 32 KiB and 8,192 characters from this chat. Nothing was truncated or sent."
			});
			return;
		}
		this.#t = Object.freeze({
			...r,
			selectedText: n
		}), this.#n = crypto.randomUUID(), this.#d({
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
			if (!Ag(e)) {
				this.#d({
					...this.#e,
					error: "Accompanying text exceeds 32 KiB or 8,192 characters. That edit was rejected without truncation."
				});
				return;
			}
			this.#f(), this.#r = e === "" ? void 0 : e, this.#d({
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
		].includes(this.#e.phase) || (this.#f(), this.#d({
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
		let e = wg(this.ports.captureActivation());
		return this.#a = e, e;
	}
	#m(e, t) {
		if (!(this.#o || this.#a !== e)) {
			if (!e.current()) {
				this.checkActivation();
				return;
			}
			this.#a = void 0, t();
		}
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
		await He(Tg({
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
		}), await this.#h(this.#i, e));
	}
	async retry() {
		this.#e.phase !== "uncertain" || !this.#i || !this.#t || await this.#h(this.#i, this.#t);
	}
	async #h(e, t) {
		let n = this.#p();
		await He(Eg({
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
		this.#f(), this.#t = void 0, this.#n = void 0, this.#r = void 0, this.#i = void 0, this.#d(Dg);
	}
	dispose() {
		this.#o || (this.clear(), this.#o = !0, this.#l.clear());
	}
};
//#endregion
//#region src/app/features/terminal-selection/useSelectionReview.ts
function Mg(e) {
	let t = P(), n = oi(), r = W(() => {
		let r = () => {
			n.invalidateQueries({ queryKey: Mt.sessionRoot(e) }), n.invalidateQueries({ queryKey: Mt.sessionsAll });
		};
		return new jg({
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
	return U(() => r.retain(), [r]), U(() => t.stores.runtimeStore.runtimeStore.subscribe(r.checkActivation), [t, r]), {
		controller: r,
		state: ei(r.subscribe, r.getSnapshot, r.getSnapshot)
	};
}
//#endregion
//#region src/app/features/terminal-selection/TerminalWorkspace.tsx
function Ng({ sessionId: e }) {
	let { api: t } = P(), n = W(() => ({
		api: t,
		id: crypto.randomUUID()
	}), [t]);
	return /* @__PURE__ */ J(Pg, { sessionId: e }, `${n.id}:${e}`);
}
function Pg({ sessionId: e }) {
	let { controller: t, state: n } = Mg(e), r = Nn(e), i = P().stores.runtimeStore.useRunning(e), a = r.data?.active_run?.run_id, o = i || a ? "busy" : r.data && !r.isError ? "idle" : "unknown";
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(yg, {
		sessionId: e,
		onReviewSelection: (e) => t.capture(e, { delivery: o === "idle" ? "send" : "queue" })
	}), n.source ? /* @__PURE__ */ J(Fg, {
		state: n,
		controller: t,
		availability: {
			mode: o,
			runId: a
		}
	}, `${n.source.sessionId}:${n.source.terminalId}`) : null] });
}
function Fg({ state: e, controller: t, availability: n }) {
	let r = e.source, i = rg(r.sessionId, r.terminalId);
	return /* @__PURE__ */ J(Sg, {
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
function Ig(e, t, n) {
	return t == null ? e ? "A run is in flight; wait for it to finish." : n === 0 ? "Nothing to commit: the checkout matches HEAD." : null : "A revision is open; go back to the working tree to commit.";
}
var Lg = (e, t) => `${e} ${t}${e === 1 ? "" : "s"}`;
function Rg({ sessionId: e, changed: t, revision: n }) {
	let { useRunning: r } = P().stores.runtimeStore, [i, a] = K(!1), [o, c] = K(""), l = jr(), u = r(e), d = hn(), f = j(e), p = Ig(u, n, t.length), m = t.reduce((e, t) => e + (t.additions ?? 0), 0), h = t.reduce((e, t) => e + (t.deletions ?? 0), 0), g = () => {
		a(!1), f.reset();
	}, _ = () => {
		let e = o.trim();
		!e || p || f.isPending || f.mutate({ message: e }, { onSuccess: (e) => {
			d.success(`Committed ${Lg(e.files_changed, "file")} as ${e.sha.slice(0, 7)}.`), c(""), g();
		} });
	};
	return /* @__PURE__ */ J(pn, {
		open: i,
		onClose: g,
		sticky: !0,
		placement: s.BottomRight,
		size: cn.Medium,
		content: /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(sc, {
				autoFocus: !0,
				rows: 3,
				textAreaSize: oc.Small,
				placeholder: "Commit message",
				value: o,
				onChange: (e) => c(e.target.value),
				onKeyDown: (e) => {
					e.key === "Enter" && (e.metaKey || e.ctrlKey) && (e.preventDefault(), _());
				}
			}),
			/* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [
					/* @__PURE__ */ Y("span", {
						className: "flex-1 min-w-0 truncate",
						children: ["Staging ", Lg(t.length, "file")]
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
				children: ir(f.error)
			}) : null,
			/* @__PURE__ */ J(B, {
				size: L.Medium,
				variant: R.Secondary,
				disabled: !o.trim(),
				loading: f.isPending,
				onClick: _,
				children: "Commit"
			})
		] }),
		children: l ? /* @__PURE__ */ J(Ti, {
			className: "shrink-0",
			variant: R.Secondary,
			disabled: !!p,
			"aria-expanded": i,
			title: p ?? "Commit every change in the checkout",
			onClick: () => i ? g() : a(!0),
			children: "Commit"
		}) : /* @__PURE__ */ J(B, {
			className: "max-w-[120px] shrink-0",
			size: L.Small,
			variant: R.Secondary,
			disabled: !!p,
			"aria-expanded": i,
			title: p ?? "Commit every change in the checkout",
			onClick: () => i ? g() : a(!0),
			children: "Commit"
		})
	});
}
//#endregion
//#region src/app/components/inspector/PanelSplit.tsx
function zg({ list: e, listToolbar: t, listTitle: n, title: r, titleAction: i, actions: a, children: o }) {
	let { setPanelListWidth: s, usePanelListWidth: c } = P().stores.panelWidth, { useSidePanelList: l, toggleSidePanelList: u, showSidePanelList: f } = P().stores.sessionLayoutStore, p = c(), m = jr(), h = Qe(), g = l(), _ = G(null), [v, b] = K(0), x = G(!1), S = G(null);
	U(() => () => S.current?.(), []), U(() => {
		let e = _.current;
		if (!e) return;
		let t = () => b(e.clientWidth);
		t();
		let n = new ResizeObserver(t);
		return n.observe(e), () => n.disconnect();
	}, []);
	let C = v > 0 ? v * y : p, w = Ae(p, C);
	return m ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-0-5",
		children: o
	}), /* @__PURE__ */ Y(Ht, {
		open: g,
		onClose: () => f(!1),
		title: n,
		keepOnNavigate: !0,
		bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
		children: [/* @__PURE__ */ J("div", {
			className: d("flex flex-col flex-1 min-h-0 overflow-auto pt-2 px-2 gap-1 [&>*]:shrink-0", t && "pb-[80px]"),
			children: e
		}), t ? /* @__PURE__ */ J("div", {
			className: "absolute inset-x-0 bottom-0 z-10 p-4 pointer-events-none [&>*]:pointer-events-auto",
			children: t
		}) : null]
	})] }) : h ? /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-h-0 w-full",
		children: [g ? null : /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-[10px] h-12 px-2 shrink-0 border-b border-muted bg-elevation-level-1",
			children: [
				/* @__PURE__ */ J("span", {
					className: "min-w-0 truncate label-small text-basic-primary",
					children: r
				}),
				i,
				/* @__PURE__ */ J("span", { className: "flex-1" }),
				a,
				/* @__PURE__ */ J(B, {
					size: L.Medium,
					variant: R.Ghost,
					content: I.Icon,
					"aria-label": "Open list",
					"aria-expanded": !1,
					onClick: u,
					children: /* @__PURE__ */ J(z, { iconName: V.List })
				})
			]
		}), g ? /* @__PURE__ */ Y("div", {
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
		ref: _,
		className: "flex flex-1 min-h-0 w-full",
		children: [/* @__PURE__ */ Y("div", {
			className: "relative flex flex-col shrink-0 min-h-0 border-r border-muted bg-elevation-level-1",
			style: { width: w },
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
					"aria-valuemax": Math.round(C),
					"aria-valuenow": w,
					tabIndex: 0,
					className: "absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none",
					onPointerDown: (e) => {
						if (e.button !== 0) return;
						let t = _.current;
						if (!t) return;
						e.preventDefault(), S.current?.(), x.current = !0, e.currentTarget.setPointerCapture(e.pointerId);
						let n = e.currentTarget, r = t.style.cursor, i = t.style.userSelect;
						t.style.cursor = "col-resize", t.style.userSelect = "none";
						let a = (n) => {
							if (!x.current || n.pointerId !== e.pointerId) return;
							let r = t.getBoundingClientRect(), i = n.clientX - r.left;
							s(Ae(i, r.width * y));
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
						e.key === "ArrowLeft" ? (e.preventDefault(), s(Ae(w - t, C))) : e.key === "ArrowRight" && (e.preventDefault(), s(Ae(w + t, C)));
					}
				})
			]
		}), /* @__PURE__ */ J("div", {
			className: "flex flex-col flex-1 min-w-0 min-h-0 bg-elevation-level-1",
			children: o
		})]
	});
}
function Bg({ label: e, active: t = !1, disabled: n = !1, icon: r, trailing: i, labelClassName: a, title: o, onClick: s }) {
	let c = jr();
	return /* @__PURE__ */ Y(Qc, {
		type: "button",
		size: c ? Xc.Large : Xc.Small,
		active: t,
		disabled: n,
		"aria-pressed": t,
		title: o,
		onClick: s,
		children: [
			r,
			/* @__PURE__ */ J("span", {
				className: d("flex-1 min-w-0 truncate text-left", a),
				children: e
			}),
			i
		]
	});
}
function Vg({ listTitle: e }) {
	return /* @__PURE__ */ J(zg, {
		listTitle: e,
		list: /* @__PURE__ */ J("div", {
			className: "px-1",
			children: /* @__PURE__ */ J(Ri, {
				rows: 2,
				rowClassName: "h-6"
			})
		}),
		children: /* @__PURE__ */ J("div", {
			role: "status",
			"aria-label": `Loading ${e ?? "panel"}`,
			className: "flex flex-1 flex-col min-h-0 overflow-hidden p-4",
			children: /* @__PURE__ */ J(Ri, {
				rows: 3,
				rowClassName: "h-6"
			})
		})
	});
}
function Hg({ title: e, children: t }) {
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
var Ug = 3e3;
function Wg(e, t) {
	let { useWorkspaceEpoch: n } = P().stores.runtimeStore, r = oi(), i = n(), a = G(null), o = G(0);
	U(() => {
		if (t != null || i === 0 || a.current !== null) return;
		let n = Math.max(0, Ug - (Date.now() - o.current));
		a.current = window.setTimeout(() => {
			a.current = null, o.current = Date.now(), Tn("query:invalidate.workspace", { throttleMs: 0 }), r.invalidateQueries({
				queryKey: Mt.sessionSnapshot(e),
				exact: !0
			}), r.invalidateQueries({ queryKey: Mt.workspaceFilesRoot(e) }), r.invalidateQueries({ queryKey: Mt.workspaceDiffRoot(e) }), r.invalidateQueries({ queryKey: Mt.workspaceFileRoot(e) });
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
var Gg = {
	M: "text-danger-primary",
	A: "text-info-primary",
	"?": "text-info-primary",
	R: "text-info-primary",
	C: "text-info-primary",
	D: "text-error-primary",
	U: "text-error-primary"
}, Kg = (e) => e ? Gg[e.trim()[0]] ?? "text-basic-primary" : null, qg = (e) => d(Kg(e), e?.trim()[0] === "D" && "line-through") || void 0, Jg = (e) => e.endsWith("/");
function Yg(e) {
	let t = e.replace(/\/+$/, ""), n = t.split("/").pop() || t;
	return Jg(e) ? `${n}/` : n;
}
var Xg = (e, t) => ({
	name: e,
	path: t,
	dirs: /* @__PURE__ */ new Map(),
	files: []
}), Zg = (e, t) => e.name.localeCompare(t.name);
function Qg(e) {
	let t = e, n = e.name;
	for (; t.files.length === 0 && t.dirs.size === 1;) {
		let [e] = t.dirs.values();
		n = `${n}/${e.name}`, t = e;
	}
	let r = [...t.dirs.values()].map(Qg).sort(Zg), i = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: n,
		path: t.path,
		dirs: r,
		files: i,
		hasChanges: i.some((e) => e.status) || r.some((e) => e.hasChanges)
	};
}
function $g(e) {
	let t = Xg("", "");
	for (let n of e) {
		let e = n.path.replace(/\/+$/, "").split("/");
		e.pop();
		let r = t, i = "";
		for (let t of e) {
			i = i ? `${i}/${t}` : t;
			let e = r.dirs.get(t);
			e || (e = Xg(t, i), r.dirs.set(t, e)), r = e;
		}
		r.files.push(n);
	}
	let n = [...t.dirs.values()].map(Qg).sort(Zg), r = t.files.slice().sort((e, t) => e.path.localeCompare(t.path));
	return {
		name: "",
		path: "",
		dirs: n,
		files: r,
		hasChanges: r.some((e) => e.status) || n.some((e) => e.hasChanges)
	};
}
function e_(e, t = []) {
	for (let n of e.dirs) n.hasChanges && (t.push(n.path), e_(n, t));
	return t;
}
//#endregion
//#region src/app/components/inspector/FilesView.tsx
function t_({ open: e }) {
	return /* @__PURE__ */ J(z, {
		iconName: V.Right,
		size: 16,
		className: d("shrink-0 transition-transform", e && "rotate-90")
	});
}
function n_({ dir: e, depth: t, open: n, selected: r, onToggle: i, onSelect: a }) {
	let o = jr();
	return /* @__PURE__ */ Y("div", {
		className: d("flex flex-col gap-[2px]", t > 0 && "pl-1 ml-[3px] border-l border-muted"),
		children: [e.dirs.map((e) => {
			let o = n.has(e.path);
			return /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-[2px] w-full",
				children: [/* @__PURE__ */ J(Bg, {
					label: e.name,
					icon: /* @__PURE__ */ J(t_, { open: o }),
					labelClassName: e.hasChanges ? "text-danger-primary" : void 0,
					onClick: () => i(e.path)
				}), o ? /* @__PURE__ */ J(n_, {
					dir: e,
					depth: t + 1,
					open: n,
					selected: r,
					onToggle: i,
					onSelect: a
				}) : null]
			}, e.path);
		}), e.files.map((e) => /* @__PURE__ */ J(Bg, {
			label: Yg(e.path),
			active: r === e.path,
			title: e.path,
			labelClassName: qg(e.status),
			icon: /* @__PURE__ */ J(Ws, {
				path: e.path,
				size: o ? 24 : 16
			}),
			onClick: () => a(e.path)
		}, e.path))]
	});
}
function r_({ files: e, selected: t, onSelect: n }) {
	let r = jr();
	return e.length === 0 ? /* @__PURE__ */ J("div", {
		className: "p-1 label-micro text-basic-muted",
		children: "Nothing has changed here yet."
	}) : /* @__PURE__ */ J("div", {
		className: "flex flex-col gap-[2px]",
		children: e.map((e) => /* @__PURE__ */ J(Bg, {
			label: Yg(e.path),
			active: t === e.path,
			title: e.path,
			labelClassName: qg(e.status),
			icon: /* @__PURE__ */ J(Ws, {
				path: e.path,
				size: r ? 24 : 16
			}),
			onClick: () => n(e.path)
		}, e.path))
	});
}
function i_({ iconName: e, label: t, active: n, round: r = !1, onClick: i }) {
	return /* @__PURE__ */ J(B, {
		className: r ? "btn-round" : void 0,
		size: r ? L.Medium : L.Small,
		variant: n ? R.Primary : R.Ghost,
		content: I.Icon,
		"aria-pressed": n,
		"aria-label": t,
		title: t,
		onClick: i,
		children: /* @__PURE__ */ J(z, { iconName: e })
	});
}
function a_({ sessionId: e, listing: t, changed: n, revision: r, readOnly: i }) {
	let { selectFileListing: a } = P().stores.sessionLayoutStore, o = jr(), s = /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(i_, {
		iconName: V.Folders,
		label: "Show every file",
		active: t === "tree",
		round: o,
		onClick: () => a("tree")
	}), /* @__PURE__ */ J(i_, {
		iconName: V.Scheme,
		label: "Show changed files only",
		active: t === "changed",
		round: o,
		onClick: () => a("changed")
	})] }), c = i ? null : /* @__PURE__ */ J(Rg, {
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
function o_({ lineNo: e, content: t, tokens: n, tone: r, trailing: i }) {
	return /* @__PURE__ */ Y("div", {
		className: d("flex items-start w-full border-l-2 border-solid", r === "add" ? "bg-success-primary border-success-primary" : r === "delete" ? "bg-error-primary border-error-primary" : "border-transparent"),
		children: [/* @__PURE__ */ J("span", {
			className: "shrink-0 w-12 pr-1 text-right opacity-50 code code-small text-basic-muted select-none",
			children: e ?? ""
		}), /* @__PURE__ */ Y("span", {
			className: "flex-1 min-w-0 px-2 code code-small text-basic-primary whitespace-pre-wrap break-words",
			children: [n ? n.map((e, t) => /* @__PURE__ */ J("span", {
				style: nn(e),
				children: e.text
			}, t)) : t, i]
		})]
	});
}
function s_({ line: e, tokens: t }) {
	let n = e.kind === "delete", r = n ? e.old_lineno : e.new_lineno ?? e.old_lineno;
	return /* @__PURE__ */ J(o_, {
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
function c_({ tone: e, children: t }) {
	return /* @__PURE__ */ J("div", {
		className: d("mx-4 my-2 rounded-md px-3 py-2 code code-small", e === "error" ? "text-error-primary bg-error-tertiary border border-error-muted" : "text-basic-muted bg-elevation-level-0-5"),
		children: t
	});
}
function l_({ section: e, highlighted: t }) {
	return e.error ? /* @__PURE__ */ Y(c_, {
		tone: "error",
		children: ["Error: ", e.error]
	}) : e.binary ? /* @__PURE__ */ J(c_, { children: "Binary or non-UTF-8 content; inline hunks are unavailable." }) : e.too_large ? /* @__PURE__ */ J(c_, { children: "File is too large for inline diff rendering." }) : e.hunks.length === 0 ? /* @__PURE__ */ J(c_, { children: "No hunks for this section." }) : /* @__PURE__ */ Y("div", {
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
			}), e.lines.map((e, n) => /* @__PURE__ */ J(s_, {
				line: e,
				tokens: t.get(e)
			}, n))]
		}, n)), e.truncated ? /* @__PURE__ */ J(c_, { children: "Diff was truncated by the backend." }) : null]
	});
}
function u_({ path: e, trailing: t }) {
	return g() ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 h-10 px-4 shrink-0 border-b border-muted bg-elevation-level-1",
		title: e,
		children: [/* @__PURE__ */ Y("div", {
			className: "flex flex-1 items-center gap-[6px] min-w-0",
			children: [/* @__PURE__ */ J(Ws, { path: e }), /* @__PURE__ */ J("span", {
				className: "label-micro text-btn-secondary truncate",
				children: Yg(e)
			})]
		}), /* @__PURE__ */ J("div", {
			className: "flex items-center gap-2 shrink-0 code code-small",
			children: t
		})]
	}) : null;
}
function d_({ children: e }) {
	return /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-h-0 overflow-auto py-2 [&>*]:shrink-0",
		children: e
	});
}
function f_({ sessionId: e, file: t, revision: n }) {
	let { data: r, isFetching: i, error: a } = er(e, t.path, "all", 3, n), o = W(() => t.additions != null || t.deletions != null ? {
		additions: t.additions ?? 0,
		deletions: t.deletions ?? 0
	} : r ? r.sections.reduce((e, t) => ({
		additions: e.additions + t.additions,
		deletions: e.deletions + t.deletions
	}), {
		additions: 0,
		deletions: 0
	}) : null, [t, r]);
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(u_, {
		path: t.path,
		trailing: o ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ Y("span", {
			className: "text-success-primary",
			children: ["+", o.additions]
		}), /* @__PURE__ */ Y("span", {
			className: "text-error-primary",
			children: ["-", o.deletions]
		})] }) : null
	}), /* @__PURE__ */ Y(d_, { children: [
		i && !r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ J(A, { size: M.Small }), " Loading diff…"]
		}) : null,
		a ? /* @__PURE__ */ J(c_, {
			tone: "error",
			children: ir(a)
		}) : null,
		r ? /* @__PURE__ */ J(p_, { diff: r }) : null
	] })] });
}
function p_({ diff: e }) {
	let [t, n] = K(() => /* @__PURE__ */ new Map());
	return U(() => {
		let t = !0;
		return qt(e.path, e.sections).then((e) => {
			t && n(e);
		}), () => {
			t = !1;
		};
	}, [e]), e.error ? /* @__PURE__ */ J(c_, {
		tone: "error",
		children: e.error
	}) : e.sections.length === 0 ? /* @__PURE__ */ J(c_, { children: "No diff sections returned." }) : /* @__PURE__ */ J(q, { children: e.sections.map((e, n) => /* @__PURE__ */ J(l_, {
		section: e,
		highlighted: t
	}, n)) });
}
var m_ = (e) => e < 1024 ? `${e} B` : `${Math.round(e / 1024)} KB`;
function h_({ sessionId: e, path: t, revision: n }) {
	let { data: r, isFetching: i, error: a } = pe(e, t, n), [o, s] = K(null), c = r?.content?.replace(/\n$/, "") ?? null, l = W(() => c?.split("\n") ?? null, [c]);
	U(() => {
		if (c === null) return;
		let e = !0;
		return xr(t, c).then((t) => {
			e && t && s({
				text: c,
				lines: t
			});
		}), () => {
			e = !1;
		};
	}, [t, c]);
	let u = o?.text === c ? o.lines : null;
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(u_, {
		path: t,
		trailing: r ? /* @__PURE__ */ J("span", {
			className: "text-basic-muted",
			children: m_(r.size)
		}) : null
	}), /* @__PURE__ */ Y(d_, { children: [
		i && !r ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 px-4 py-2 code code-small text-basic-muted",
			children: [/* @__PURE__ */ J(A, { size: M.Small }), " Loading file…"]
		}) : null,
		a ? /* @__PURE__ */ J(c_, {
			tone: "error",
			children: ir(a)
		}) : null,
		r?.binary ? /* @__PURE__ */ J(c_, { children: "Binary file; nothing to show inline." }) : null,
		r?.too_large ? /* @__PURE__ */ Y(c_, { children: [
			"File is too large to display (",
			m_(r.size),
			")."
		] }) : null,
		l ? l.map((e, t) => /* @__PURE__ */ J(o_, {
			lineNo: t + 1,
			content: e,
			tokens: u?.[t]
		}, t)) : null
	] })] });
}
function g_({ sessionId: e, snapshot: t, revision: n = null, readOnly: r = !1 }) {
	let { useToggledFolders: i, useSelectedFile: a, useFileListing: o, toggleFolder: s, selectFile: c } = P().stores.sessionLayoutStore, l = oi(), u = a(), d = i(), f = o(), { data: p, error: m } = gt(e, n), h = ft(e, n);
	U(() => {
		n ?? l.invalidateQueries({ queryKey: Mt.sessionSnapshot(e) });
	}, [
		l,
		e,
		n
	]), Wg(e, n);
	let g = t?.workspace ?? null, _ = W(() => n == null ? g?.changed_files ?? [] : h.data?.changed_files ?? [], [
		n,
		g,
		h.data
	]), v = W(() => __(p?.files ?? [], _), [p, _]), y = W(() => $g(v), [v]), b = W(() => v.filter((e) => e.status !== null), [v]), x = W(() => {
		let e = new Set(e_(y));
		for (let t of d) e.delete(t) || e.add(t);
		return e;
	}, [y, d]), S = W(() => new Map(b.map((e) => [e.path, e])), [b]), C = u ?? b[0]?.path ?? null, w = C ? S.get(C) : void 0, T = m ?? (n == null ? null : h.error);
	return n == null && g?.error ? /* @__PURE__ */ J("div", {
		className: "p-6 label-small text-error-primary",
		children: g.error
	}) : T ? /* @__PURE__ */ J("div", {
		className: "p-6 label-small text-error-primary",
		children: ir(T)
	}) : p ? /* @__PURE__ */ J(zg, {
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
		listToolbar: /* @__PURE__ */ J(a_, {
			sessionId: e,
			listing: f,
			changed: _,
			revision: n,
			readOnly: r
		}),
		list: v.length === 0 ? /* @__PURE__ */ J("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "No files in the workspace."
		}) : f === "changed" ? /* @__PURE__ */ J(r_, {
			files: b,
			selected: C,
			onSelect: c
		}) : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(n_, {
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
		children: C ? w ? /* @__PURE__ */ J(f_, {
			sessionId: e,
			file: w,
			revision: n
		}, C) : /* @__PURE__ */ J(h_, {
			sessionId: e,
			path: C,
			revision: n
		}, C) : /* @__PURE__ */ J(Hg, { children: v.length === 0 ? "No files in the workspace." : "Select a file to see it." })
	}) : /* @__PURE__ */ J(Vg, { listTitle: "Files" });
}
function __(e, t) {
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
var v_ = null, y_ = !1;
function b_() {
	return v_ ??= import("./chunks/markdown-renderer-5-1nSeY9.js").then((e) => (y_ = !0, e)), v_;
}
function x_() {
	return y_;
}
//#endregion
//#region src/app/lib/markdown.tsx
var S_ = Yr(b_);
function C_({ children: e, streaming: t = !1, className: n }) {
	return /* @__PURE__ */ J("div", {
		className: d("chat-response markdown markdown-content text-basic-primary w-full", t && "streaming", n),
		children: /* @__PURE__ */ J(qr, {
			fallback: /* @__PURE__ */ J("pre", {
				className: "whitespace-pre-wrap font-sans",
				children: e
			}),
			children: /* @__PURE__ */ J(S_, {
				streaming: t,
				children: e
			})
		})
	});
}
//#endregion
//#region src/app/components/inspector/ChatBadge.tsx
var w_ = 240;
function T_({ label: e, pending: t = !1, active: n = !1, trailing: r, preface: i, body: o, onClick: s }) {
	a("ChatBadge");
	let [c, l] = K(!1), u = !!o, f = u || !!s, p = c || n;
	return /* @__PURE__ */ Y("div", {
		className: d("flex flex-col items-start w-full my-6 border-l-2 border-solid transition-colors duration-150", p ? "border-primary" : "border-tertiary"),
		children: [
			i,
			/* @__PURE__ */ Y("button", {
				type: "button",
				className: d("group flex items-center py-2 rounded-[4px] max-w-full", u ? "gap-[6px] pl-4 pr-2" : "gap-4 px-4", f ? p ? "btn-ghost-highlighted" : "btn-ghost" : "cursor-default"),
				disabled: !f,
				"aria-expanded": u ? c : void 0,
				"aria-pressed": n || void 0,
				onClick: () => {
					u && l((e) => !e), s?.();
				},
				children: [
					/* @__PURE__ */ J("span", {
						className: d("label-small truncate", t ? "text-shimmer-basic" : "text-btn-secondary"),
						children: e
					}),
					r,
					u ? /* @__PURE__ */ J(z, {
						iconName: c ? V.Down : V.Right,
						size: 20,
						className: d("shrink-0", c ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 [@media(hover:none)]:opacity-100")
					}) : null
				]
			}),
			u && o ? /* @__PURE__ */ J(_a, {
				isOpen: c,
				className: "w-full",
				isScrollable: t,
				scrollToBottom: t,
				style: t ? { maxHeight: w_ } : void 0,
				children: /* @__PURE__ */ J("div", {
					className: "thinking-content w-full pl-4 py-3",
					children: /* @__PURE__ */ J(C_, {
						className: "text-basic-tertiary",
						streaming: t,
						children: o
					})
				})
			}) : null
		]
	});
}
function E_({ additions: e, deletions: t }) {
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
var D_ = 8;
function O_({ file: e, active: t, onOpen: n }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		className: d("flex items-center gap-[6px] max-w-full py-2 md:py-1 px-2 rounded-[4px] shrink-0", t ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": t,
		title: e.path,
		onClick: () => n(e.path),
		children: [
			/* @__PURE__ */ J(Ws, { path: e.path }),
			/* @__PURE__ */ J("span", {
				className: "text-micro truncate",
				children: Yg(e.path)
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
function k_({ files: e, selected: t, onOpen: n, onOpenAll: r }) {
	if (!e.length) return null;
	let i = e.slice(0, D_), a = e.length - i.length;
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1 md:gap-0 w-full pl-2 pr-4 pb-1 items-start",
		children: [i.map((e) => /* @__PURE__ */ J(O_, {
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
function A_({ revision: e, panel: t }) {
	let { data: n } = ft(t.sessionId, e.id), r = W(() => (n?.changed_files ?? []).filter((e) => !e.path.endsWith("/")), [n]), i = t.selectedRevision === e.id;
	return /* @__PURE__ */ J(T_, {
		label: "Snapshot",
		trailing: /* @__PURE__ */ J(E_, {
			additions: e.additions,
			deletions: e.deletions
		}),
		preface: /* @__PURE__ */ J(k_, {
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
var j_ = 16, M_ = 150;
function N_(e) {
	switch (e) {
		case 0: return "";
		case 1: return "opacity-50";
		case 2: return "opacity-10";
		default: return "opacity-0";
	}
}
function P_(e) {
	let t = G(null), n = G(e);
	return $r(() => {
		let r = t.current;
		!r || e === n.current || (n.current = e, e && (r.style.transition = "none", r.style.transform = `translateY(${j_}px)`, r.offsetHeight, r.style.transition = `transform ${M_}ms ease-out`, r.style.transform = "translateY(0)"));
	}, [e]), t;
}
function F_({ lines: e, className: t }) {
	let n = e.slice(-4), r = P_(n[n.length - 1]?.key);
	return /* @__PURE__ */ J("div", {
		className: d("flex flex-col justify-end overflow-hidden", t),
		children: /* @__PURE__ */ J("div", {
			ref: r,
			className: "flex flex-col",
			children: n.map((e, t) => /* @__PURE__ */ J("span", {
				className: d("w-full truncate code code-micro !text-[11px] !leading-[16px] !m-0 block", "transition-opacity duration-150 ease-out", "text-basic-tertiary", N_(n.length - 1 - t)),
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
var I_ = {
	error: 0,
	running: 1,
	pending: 2,
	cancelled: 3,
	done: 4
};
function L_({ state: e }) {
	return e === "running" ? /* @__PURE__ */ J(A, {
		size: M.Small,
		variant: be.Neutral
	}) : e === "pending" ? /* @__PURE__ */ J(z, {
		iconName: V.Timelaps,
		size: 20,
		className: "[&>path]:!fill-basic-muted"
	}) : e === "error" ? /* @__PURE__ */ J(z, {
		iconName: V.Danger,
		size: 20,
		className: "[&>path]:!fill-error-primary"
	}) : e === "cancelled" ? /* @__PURE__ */ J(z, {
		iconName: V.Close,
		size: 20,
		className: "[&>path]:!fill-basic-muted"
	}) : /* @__PURE__ */ J(z, {
		iconName: V.CheckCircle,
		size: 20,
		className: "[&>path]:!fill-basic-primary"
	});
}
function R_(e) {
	return e.reduce((e, t) => I_[t.state] < I_[e] ? t.state : e, "done");
}
function z_({ thread: e, selected: t, onSelect: n }) {
	let r = jr(), i = e.state === "running", a = e.state === "pending", o = e.state === "cancelled", s = e.log.length ? e.log : [{
		key: "action",
		text: e.action,
		bare: e.action,
		mark: null,
		name: null,
		body: e.action,
		isError: !1
	}];
	return /* @__PURE__ */ J("div", {
		className: d("shrink-0 h-[84px] max-w-full overflow-hidden rounded-[4px]", r ? "w-[172px]" : "w-[220px]", i || a ? "bg-elevation-level-2" : "bg-elevation-level-1"),
		children: /* @__PURE__ */ Y("button", {
			type: "button",
			className: d("flex flex-col items-start w-full h-full text-left", t ? "btn-ghost-highlighted" : "btn-ghost"),
			"aria-pressed": t,
			onClick: () => n(e.name, e.key),
			children: [/* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 shrink-0 p-2 w-full",
				children: [
					/* @__PURE__ */ J(L_, { state: e.state }),
					/* @__PURE__ */ J("span", {
						className: d("flex-1 min-w-0 truncate label-small", i ? "text-shimmer-basic" : a ? "text-basic-muted" : e.state === "error" ? "text-error-primary" : "text-basic-primary"),
						children: e.name
					}),
					e.weight && /* @__PURE__ */ J("span", {
						className: "shrink-0 rounded-[3px] bg-elevation-level-3 px-1 text-[9px] uppercase tracking-wide text-basic-muted",
						children: e.weight
					})
				]
			}), i || o ? /* @__PURE__ */ J(F_, {
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
function B_({ threads: e, selected: t, onSelect: n }) {
	let r = R_(e);
	return /* @__PURE__ */ J("div", {
		className: d("pl-4 py-3 w-full min-w-0 border-l-2 border-solid", r === "error" ? "border-error-primary" : r === "running" ? "border-primary" : "border-tertiary"),
		children: /* @__PURE__ */ J("div", {
			className: "flex flex-wrap items-start gap-1 w-full min-w-0",
			children: e.map((e) => /* @__PURE__ */ J(z_, {
				thread: e,
				selected: t === e.key,
				onSelect: n
			}, e.key))
		})
	});
}
function V_({ rows: e, selected: t, onSelect: n }) {
	return /* @__PURE__ */ J("div", {
		className: "my-8 w-full flex flex-col items-start",
		children: e.map((e, r) => /* @__PURE__ */ J(B_, {
			threads: e,
			selected: t,
			onSelect: n
		}, e.map((e) => e.key).join("|") || `row-${r}`))
	});
}
//#endregion
//#region src/app/components/inspector/ToolCallDetail.tsx
var H_ = {
	pending: "○",
	running: "▸",
	"awaiting-approval": "◇",
	success: "✓",
	error: "✕",
	"timed-out": "◷",
	cancelled: "■",
	interrupted: "!"
}, U_ = Xr(function({ tool: e }) {
	let t = e.status === "pending" || e.status === "running", n = e.status === "awaiting-approval";
	return /* @__PURE__ */ Y("div", {
		className: "my-3 w-full max-w-full min-w-0 rounded-[6px] border border-tertiary px-3 py-2",
		"data-tool-call-id": e.callId,
		children: [/* @__PURE__ */ Y("div", {
			className: "flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1",
			children: [
				/* @__PURE__ */ J("span", {
					"aria-hidden": "true",
					className: d("code code-small shrink-0", n ? "text-accent-primary" : t ? "text-shimmer-basic" : e.status === "success" ? "text-success-primary" : "text-error-primary"),
					children: H_[e.status]
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
					className: d("label-micro shrink-0", n ? "text-accent-primary" : t ? "text-basic-secondary" : "text-basic-muted"),
					children: e.statusLabel
				})
			]
		}), e.resultPreview ? /* @__PURE__ */ J("p", {
			className: "code code-small mt-1 min-w-0 break-all pl-5 text-basic-tertiary",
			children: e.resultPreview
		}) : null]
	});
}), W_ = [
	"parameter",
	"tool_use",
	"tool_call",
	"tool_name",
	"invoke",
	"arguments",
	"parameters",
	"function"
].join("|"), G_ = RegExp(`<(${W_})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), K_ = RegExp(`<\\/?(?:${W_})\\b[^>]*>`, "gi");
function q_(e) {
	if (!e.includes("<")) return e;
	let t = e, n = "";
	for (; t !== n;) n = t, G_.lastIndex = 0, t = t.replace(G_, "");
	return K_.lastIndex = 0, t = t.replace(K_, ""), t;
}
//#endregion
//#region src/app/lib/toolPresentation.ts
function J_(e) {
	return typeof e == "string" ? {
		text: e,
		hasImage: !1
	} : {
		text: e.map((e) => e.type === "text" ? e.text : `[Image: ${e.image.mime_type}]`).join("\n\n"),
		hasImage: e.some((e) => e.type === "image")
	};
}
function Y_(e, t) {
	let n = /* @__PURE__ */ new Map();
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role === "tool") {
			n.set(t.tool_call_id, J_(t.content));
			continue;
		}
		if (t.role === "assistant" || t.role === "user") break;
	}
	return n;
}
function X_(e, t, n) {
	for (let r = t + 1; r < e.length; r += 1) {
		let t = e[r];
		if (t.role !== "tool") return t.role === "assistant" && typeof t.content == "string" && t.content.trim() === n;
	}
	return !1;
}
var Z_ = {
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
}, Q_ = {
	pending: "Pending",
	running: "Running",
	"awaiting-approval": "Awaiting approval",
	success: "Succeeded",
	error: "Failed",
	"timed-out": "Timed out",
	cancelled: "Cancelled",
	interrupted: "Interrupted"
}, $_ = "[tool call cancelled by user]", ev = "Tool execution was interrupted; no result was recorded.", tv = 160, nv = 180;
function rv(e, t) {
	let n = [...e ?? ""].map((e) => {
		let t = e.codePointAt(0) ?? 0;
		return t < 32 || t === 127 ? " " : e;
	}).join("").trim();
	return [...n].length <= t ? n : `${[...n].slice(0, t - 1).join("")}…`;
}
function iv(e) {
	let t = e.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
	return t ? t[0].toUpperCase() + t.slice(1) : "Tool call";
}
function av(e) {
	return Z_[e] || (e.startsWith("mcp__") ? `MCP · ${iv(e.split("__").filter(Boolean).at(-1) ?? "tool")}` : iv(e || "tool call"));
}
function ov(e) {
	return e.completion_status === "timed_out" ? "timed-out" : e.completion_status === "cancelled" ? "cancelled" : e.completion_status === "error" ? "error" : e.completion_status === "success" ? "success" : e.command_status === "timed_out" ? "timed-out" : e.command_status === "cancelled" ? "cancelled" : e.command_status === "spawn_error" || e.is_error || e.exit_code != null && e.exit_code !== 0 ? "error" : "success";
}
function sv(e) {
	let t = /* @__PURE__ */ new Map();
	for (let n of e) {
		if (n.type !== "tool_call_started" && n.type !== "tool_call_finished" || n.thread_name) continue;
		let e = t.get(n.call_id) ?? {};
		n.type === "tool_call_started" ? e.started = n : e.finished = n, t.set(n.call_id, e);
	}
	return t;
}
function cv({ call: e, events: t, hasResult: n, resultText: r, resultHasImage: i, active: a, awaitingApproval: o, turnCancelled: s }) {
	let c = rv(t?.started?.name ?? t?.finished?.name ?? e.function?.name ?? "tool", tv) || "tool", l;
	l = t?.finished ? ov(t.finished) : r?.startsWith($_) || s && !n ? "cancelled" : r?.trim() === ev ? "interrupted" : n ? "success" : a && o ? "awaiting-approval" : a && t?.started ? "running" : a ? "pending" : "interrupted";
	let u = rv(t?.finished?.content_preview, nv) || null;
	return !u && i && (u = "Image result"), !u && l === "cancelled" && (u = "No result was retained."), !u && l === "interrupted" && (u = "No result was recorded."), {
		callId: e.id,
		name: c,
		label: av(c),
		summary: rv(t?.started?.key_arg_preview, nv) || null,
		resultPreview: u,
		status: l,
		statusLabel: Q_[l]
	};
}
//#endregion
//#region src/app/lib/transcript.ts
var lv = "[run cancelled by user]", uv = "[run failed after this partial assistant response]";
function dv(e) {
	let t = e.trim();
	if (t === "[run failed after this partial assistant response]") return "";
	let n = `\n\n${uv}`;
	return t.endsWith(n) ? t.slice(0, -n.length).trimEnd() : t;
}
var fv = "[tool call cancelled by user]", pv = /* @__PURE__ */ new Set([
	"threads",
	"thread_read",
	"workset_read",
	"workset_list"
]), mv = "model-streaming";
function hv(e) {
	try {
		let t = JSON.parse(e.function?.arguments || "{}");
		return Object(t) === t ? t : {};
	} catch {
		return {};
	}
}
function gv(e) {
	return Ee(e) ? e : "";
}
function _v(e, t, n, r, i) {
	if (n.has(e) || i.liveFinishedToolCalls[e]) return !1;
	if (!t || !r) return !0;
	let a = i.worksets.find((e) => e.id === t);
	if (!a) return !0;
	let o = Ft(a.updated_at), s = Ft(r);
	return !Number.isFinite(o) || !Number.isFinite(s) || o < s;
}
function vv(e) {
	let t = [];
	return e.forEach((e) => {
		(e.type === "thread_started" || !t.length) && t.push([]), t[t.length - 1].push(e);
	}), t;
}
function yv(e) {
	let t = {};
	return Object.entries(e).forEach(([e, n]) => {
		t[e] = vv(n);
	}), t;
}
function bv(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = xv(e);
			t[n] = (t[n] ?? 0) + 1;
		});
	}), t;
}
function xv(e) {
	return gv(hv(e).name) || "thread";
}
function Sv(e) {
	return xv(e);
}
function Cv(e) {
	let t = {};
	return e.forEach((e) => {
		e.role === "assistant" && (e.tool_calls ?? []).forEach((e) => {
			if (e.function?.name !== "thread") return;
			let n = gv(hv(e).action);
			n && (t[xv(e)] = n);
		});
	}), t;
}
function wv(e) {
	let t = hv(e).threads;
	return Array.isArray(t) ? t.filter(Ee) : [];
}
function Tv(e) {
	let t = e.length;
	if (t <= 1) return t ? [e] : [];
	let n = /* @__PURE__ */ new Map();
	for (let r = 0; r < t; r += 1) {
		let t = xv(e[r]);
		if (n.has(t)) return [e];
		n.set(t, r);
	}
	let r = Array.from({ length: t }, () => []), i = Array.from({ length: t }, () => 0);
	for (let a = 0; a < t; a += 1) {
		let t = /* @__PURE__ */ new Set();
		for (let o of wv(e[a])) {
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
function Ev(e, t, n) {
	let r = e.threadEpisodes[t] ?? [];
	return r[n - ((e.dispatchCounts[t] ?? r.length) - r.length)];
}
function Dv(e) {
	let t = /* @__PURE__ */ new Set();
	return e.forEach((n, r) => {
		if (n.role !== "assistant") return;
		let i = Y_(e, r), a = (n.tool_calls ?? []).filter((e) => e.function?.name === "thread");
		if (!a.length) return;
		let o = X_(e, r, lv), s = !1;
		for (let e of a) {
			let n = i.get(e.id)?.text, r = Sv(e);
			if (n == null) {
				o || t.delete(r);
				continue;
			}
			n.startsWith(fv) ? (t.add(r), s = !0) : t.delete(r);
		}
		if (!(!s && !o)) for (let e of a) i.get(e.id) ?? t.add(Sv(e));
	}), t;
}
function Ov(e, t, n, r, i, a, o) {
	let s = xv(e), c = hv(e), l = gv(c.action), u = gv(c.weight), d = u === "light" || u === "heavy" ? u : null, f = i.get(e.id)?.text ?? null, p = t === (r.dispatchCounts[s] ?? 1) - 1 ? r.liveThreads[s] : void 0, m = wv(e).some((e) => a.has(e) && !o.has(e)), h = Ev(r, s, t), g = p?.status !== "running" && h?.some((e) => e.type === "thread_finished"), _ = p?.status === "finished", v = !(p?.status === "running" && !p.cancelled) && (f?.startsWith(fv) === !0 || p?.cancelled || f == null && t === (r.dispatchCounts[s] ?? 1) - 1 && r.cancelledNames.has(s)) ? "cancelled" : p?.isError ? "error" : f != null || _ || g ? "done" : m ? "pending" : "running";
	return {
		key: n,
		name: s,
		action: l,
		weight: d,
		summary: f || l,
		log: ur(Bt(h), p?.log ?? []),
		state: v
	};
}
function kv(e, t) {
	for (let n = e.length - 1; n >= 0; --n) {
		let r = e[n];
		if (r.kind === t && (t !== "text" || r.kind !== "text" || r.text.trim() !== "[run cancelled by user]")) return r.text;
	}
	return null;
}
function Av(e, t) {
	return e.reduce((e, n) => n.kind === t ? e + 1 : e, 0);
}
function jv(e, t, n = !1) {
	let r = q_(t.reasoning).trim(), i = q_(t.text).trim();
	if (!r && !i) return e;
	let a = e[e.length - 1], o = a?.kind === "model" && !n, s = o ? {
		...a,
		blocks: a.blocks.slice()
	} : {
		kind: "model",
		key: mv,
		blocks: [],
		durationMs: null,
		messageIndex: null
	}, c = !1;
	return r && !kv(s.blocks, "thoughts")?.includes(r) && (s.blocks.push({
		kind: "thoughts",
		key: `thoughts-${Av(s.blocks, "thoughts")}`,
		text: r,
		durationMs: null,
		streaming: !i
	}), c = !0), i && !kv(s.blocks, "text")?.includes(i) && (s.blocks.push({
		kind: "text",
		key: `text-${Av(s.blocks, "text")}`,
		text: i
	}), c = !0), c ? o ? [...e.slice(0, -1), s] : [...e, s] : e;
}
function Mv(e, t, n = {}, r = [], i = /* @__PURE__ */ new Set()) {
	let a = e?.messages ?? [], o = e?.response_timing.response_durations_ms ?? [], s = e?.message_created_at ?? [], c = e?.message_page?.start ?? 0, l = e?.metadata?.behavior === "direct" || e?.metadata?.behavior === "direct-with-orchestrator", u = sv(l ? [...e?.primary_tool_events ?? [], ...r] : []), d = -1;
	a.forEach((e, t) => {
		e.role === "user" && (d = t);
	});
	let f = bv(a), p = new Map((e?.threads ?? []).map((e) => [e.name, e.episode_count])), m = new Set(e?.active_threads ?? []), h = {}, g = {};
	for (let [e, t] of Object.entries(f)) {
		let n = p.get(e) ?? 0, r = Math.max(t, n + +!!m.has(e));
		h[e] = r, g[e] = Math.max(0, r - t);
	}
	let _ = {
		liveThreads: t,
		liveFinishedToolCalls: n,
		worksets: e?.worksets?.items ?? [],
		threadEpisodes: yv(e?.thread_events ?? {}),
		dispatchCounts: h,
		cancelledNames: Dv(a)
	}, v = [], y = null, b = /* @__PURE__ */ new Map();
	a.forEach((t, n) => {
		let r = c + n;
		if (t.role === "system" || t.role === "tool") return;
		if (t.role === "user") {
			y = null;
			let e = w(t.content);
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
				text: yr(t.content),
				invokedSkills: Tt(t.content),
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
		let f = q_(t.reasoning_text ?? "").trim();
		f && o.push({
			kind: "thoughts",
			key: `thoughts-${Av(o, "thoughts")}`,
			text: f,
			durationMs: t.duration_ms ?? null,
			streaming: !1
		});
		let p = dv(q_(t.content ?? ""));
		p && o.push({
			kind: "text",
			key: `text-${Av(o, "text")}`,
			text: p
		});
		let m = Y_(a, n), h = [];
		if ((t.tool_calls ?? []).forEach((t, c) => {
			let f = t.function?.name ?? "tool", p = `${f}-${r}-${c}`;
			if (f === "thread") h.push(t);
			else if (f === "workset_define") {
				let e = gv(hv(t).id);
				o.push({
					kind: "workset",
					key: p,
					worksetId: e,
					pending: _v(t.id, e, m, s[n] ?? null, _)
				});
			} else if (!pv.has(f)) {
				let r = m.get(t.id);
				l ? o.push({
					kind: "tool-detail",
					key: `tool-${t.id}`,
					presentation: cv({
						call: t,
						events: u.get(t.id),
						hasResult: r != null,
						resultText: r?.text ?? null,
						resultHasImage: r?.hasImage ?? !1,
						active: !!e?.active_run && n > d,
						awaitingApproval: i.has(t.id),
						turnCancelled: X_(a, n, lv)
					})
				}) : o.push({
					kind: "tool",
					key: p,
					name: f,
					pending: r == null
				});
			}
		}), h.length) {
			let e = new Set(h.map(xv)), t = /* @__PURE__ */ new Set();
			for (let e of h) {
				let n = xv(e);
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
			let n = Tv(h).map((n) => n.map((n) => {
				let i = xv(n), a = g[i] ?? 0;
				return g[i] = a + 1, Ov(n, a, `${i}@${r}:${n.id}`, _, m, e, t);
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
function Nv(e) {
	return e.streaming ? "Thinking" : e.durationMs == null ? "Thoughts" : `Thoughts, ${Fn(e.durationMs)}`;
}
function Pv(e) {
	return e.blocks.filter((e) => e.kind === "text").map((e) => e.text).join("\n\n").trim();
}
var Fv = Xr(function({ turn: e, model: t, active: n, activity: r, isLast: i = !1, selectedThreadEpisode: o, selectedWorkset: c, onSelectThread: l, onSelectWorkset: u, userMessageIndex: f, userText: p = "", onRefresh: m = null, onRevert: h = null, onFork: g = null, forks: _ = [], onOpenFork: v, onDismissFork: y, actionsDisabled: b = !1, readOnly: x = !1, snapshotRevision: S = null, filesPanel: C = null }) {
	a("ModelMessage");
	let w = !x && m != null && f != null, T = !x && h != null && f != null, E = e.messageIndex, D = Pv(e), ee = e.blocks.some((e) => e.kind === "text" && e.text.trim() === "[run cancelled by user]"), O = jr();
	return /* @__PURE__ */ J("div", {
		className: d("group/model-msg flex gap-1 items-start w-full max-w-full py-8 relative", i && "min-h-[calc(70vh-316px)]"),
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col flex-grow gap-1 pt-2 md:max-w-[calc(100%-36px)] min-w-0",
			children: [
				/* @__PURE__ */ Y("div", {
					className: "flex gap-3 items-center mb-4 min-w-0",
					children: [
						/* @__PURE__ */ J(Dc, { active: n }),
						/* @__PURE__ */ J("span", {
							className: "label-small text-basic-primary truncate",
							children: t
						}),
						n && r ? /* @__PURE__ */ J(q, { children: " " }) : e.durationMs == null ? null : /* @__PURE__ */ J("span", {
							className: "label-micro text-basic-muted shrink-0 fade",
							children: Xn(e.durationMs)
						})
					]
				}),
				/* @__PURE__ */ Y("div", {
					className: d("chat-response chat-response-content paragraph-medium text-basic-secondary relative w-full min-w-0 md:pl-3", n && "streaming"),
					children: [
						e.blocks.map((e) => {
							switch (e.kind) {
								case "thoughts": return e.text.trim() ? /* @__PURE__ */ J(T_, {
									label: Nv(e),
									pending: e.streaming,
									body: e.text
								}, e.key) : null;
								case "text": return e.text.trim() === "[run cancelled by user]" ? null : /* @__PURE__ */ J(C_, {
									streaming: n,
									children: e.text
								}, e.key);
								case "workset": return /* @__PURE__ */ J(T_, {
									label: e.worksetId ? `Worksets_${e.worksetId}` : e.pending ? "Defining worksets…" : "Worksets",
									pending: e.pending,
									active: c === e.worksetId,
									onClick: () => u(e.worksetId)
								}, e.key);
								case "tool": return /* @__PURE__ */ J(T_, {
									label: e.pending ? `${e.name}…` : e.name,
									pending: e.pending
								}, e.key);
								case "tool-detail": return /* @__PURE__ */ J(U_, { tool: e.presentation }, e.key);
								case "wave": return /* @__PURE__ */ J(V_, {
									rows: e.rows,
									selected: o,
									onSelect: l
								}, e.key);
								default: return null;
							}
						}),
						S && C ? /* @__PURE__ */ J(A_, {
							revision: S,
							panel: C
						}) : null,
						ee ? /* @__PURE__ */ J(Pi, {
							variant: Ai.Danger,
							title: "Run cancelled by user"
						}) : null
					]
				}),
				!x && _.length > 0 ? /* @__PURE__ */ J("div", {
					className: "flex flex-col gap-2 pt-4 md:pl-3 [&>*]:shrink-0",
					children: _.map((e) => /* @__PURE__ */ J(Ks, {
						sessionId: e.session_id,
						title: e.title,
						deleted: e.deleted,
						onOpen: v ? () => v(e.session_id) : void 0,
						onDismiss: y && e.deleted ? () => y(e.session_id) : void 0
					}, e.session_id))
				}) : null,
				n ? null : /* @__PURE__ */ Y("div", {
					className: d("flex items-center justify-start gap-3 pt-4 md:pl-3", "opacity-0 pointer-events-none transition-opacity duration-150", "group-hover/model-msg:opacity-100 group-hover/model-msg:pointer-events-auto", "group-focus-within/model-msg:opacity-100 group-focus-within/model-msg:pointer-events-auto", "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"),
					children: [
						w ? /* @__PURE__ */ J(Ln, {
							title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
							position: s.BottomRight,
							children: /* @__PURE__ */ J(B, {
								size: O ? L.Medium : L.Small,
								variant: O ? R.Ghost : R.Tertiary,
								content: I.Icon,
								"aria-label": "Regenerate from original prompt",
								disabled: b,
								onClick: () => m(f),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(z, {
									iconName: V.Refresh,
									size: 16
								})
							})
						}) : null,
						T ? /* @__PURE__ */ J(Ln, {
							title: "Revert to this snapshot",
							position: s.BottomRight,
							children: /* @__PURE__ */ J(B, {
								size: O ? L.Medium : L.Small,
								variant: O ? R.Ghost : R.Tertiary,
								content: I.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: b,
								onClick: () => h(f, p),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(z, {
									iconName: V.TurnLeft,
									size: 16
								})
							})
						}) : x ? null : /* @__PURE__ */ J(Ln, {
							title: "This message is not in the transcript yet",
							position: s.BottomRight,
							children: /* @__PURE__ */ J("span", {
								className: "inline-flex",
								children: /* @__PURE__ */ J(B, {
									size: O ? L.Medium : L.Small,
									variant: O ? R.Ghost : R.Tertiary,
									content: I.Icon,
									"aria-label": "Revert to this snapshot",
									disabled: !0,
									className: "md:!h-4 md:!min-h-4 md:!p-0",
									children: /* @__PURE__ */ J(z, {
										iconName: V.TurnLeft,
										size: 16
									})
								})
							})
						}),
						!x && g != null && E != null ? /* @__PURE__ */ J(Ln, {
							title: "Create fork",
							position: s.BottomRight,
							children: /* @__PURE__ */ J(B, {
								size: O ? L.Medium : L.Small,
								variant: O ? R.Ghost : R.Tertiary,
								content: I.Icon,
								"aria-label": "Create fork",
								disabled: b,
								onClick: () => g(E),
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(z, {
									iconName: V.Scheme,
									size: 16
								})
							})
						}) : null,
						/* @__PURE__ */ J(Qn, {
							value: D,
							size: O ? L.Medium : L.Small,
							variant: O ? R.Ghost : R.Tertiary,
							title: "Copy message",
							position: s.BottomRight,
							className: "md:!h-4 md:!min-h-4 md:!p-0"
						})
					]
				})
			]
		})
	});
}), Iv = Xr(function({ text: e, pending: t = !1, invokedSkills: n = null, timestamp: r = null, messageIndex: i, onRefresh: o = null, onRevert: c = null, actionsDisabled: l = !1, readOnly: u = !1 }) {
	a("UserMessage");
	let f = !u && o != null && i != null, p = !u && c != null && i != null, m = jr();
	return /* @__PURE__ */ Y("div", {
		className: "group/user-msg flex flex-col items-end w-full max-w-full pt-4 pb-8",
		children: [
			/* @__PURE__ */ J("div", {
				className: d("py-3 px-5 rounded-[12px] bg-elevation-sublevel-variant-B shadow-convex", "label-small text-basic-primary whitespace-pre-wrap break-words", t && "opacity-60"),
				children: e
			}),
			n && n.length > 0 ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-1 pt-1.5 pr-1 label-micro text-basic-tertiary",
				title: "Skill content was expanded into the prompt sent to the agent",
				children: [/* @__PURE__ */ J(z, {
					iconName: V.Bolt,
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
				className: d("flex items-center justify-end gap-3 pt-3", "opacity-0 pointer-events-none transition-opacity duration-150", "group-hover/user-msg:opacity-100 group-hover/user-msg:pointer-events-auto", "group-focus-within/user-msg:opacity-100 group-focus-within/user-msg:pointer-events-auto", "[@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto"),
				children: [
					r ? /* @__PURE__ */ J("span", {
						className: "label-micro text-basic-tertiary whitespace-nowrap truncate",
						children: r
					}) : null,
					f ? /* @__PURE__ */ J(Ln, {
						title: "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
						position: s.BottomLeft,
						children: /* @__PURE__ */ J(B, {
							size: m ? L.Medium : L.Small,
							variant: m ? R.Ghost : R.Tertiary,
							content: I.Icon,
							"aria-label": "Regenerate from original prompt",
							disabled: l,
							onClick: () => o(i),
							className: "md:!h-4 md:!min-h-4 md:!p-0",
							children: /* @__PURE__ */ J(z, {
								iconName: V.Refresh,
								size: 16
							})
						})
					}) : null,
					p ? /* @__PURE__ */ J(Ln, {
						title: "Revert to this snapshot",
						position: s.BottomLeft,
						children: /* @__PURE__ */ J(B, {
							size: m ? L.Medium : L.Small,
							variant: m ? R.Ghost : R.Tertiary,
							content: I.Icon,
							"aria-label": "Revert to this snapshot",
							disabled: l,
							onClick: () => c(i, e),
							className: "md:!h-4 md:!min-h-4 md:!p-0",
							children: /* @__PURE__ */ J(z, {
								iconName: V.TurnLeft,
								size: 16
							})
						})
					}) : u ? null : /* @__PURE__ */ J(Ln, {
						title: "This message is not in the transcript yet",
						position: s.BottomLeft,
						children: /* @__PURE__ */ J("span", {
							className: "inline-flex",
							children: /* @__PURE__ */ J(B, {
								size: m ? L.Medium : L.Small,
								variant: m ? R.Ghost : R.Tertiary,
								content: I.Icon,
								"aria-label": "Revert to this snapshot",
								disabled: !0,
								className: "md:!h-4 md:!min-h-4 md:!p-0",
								children: /* @__PURE__ */ J(z, {
									iconName: V.TurnLeft,
									size: 16
								})
							})
						})
					}),
					/* @__PURE__ */ J(Qn, {
						value: e,
						size: m ? L.Medium : L.Small,
						variant: m ? R.Ghost : R.Tertiary,
						title: "Copy message",
						position: s.BottomLeft,
						className: "md:!h-4 md:!min-h-4 md:!p-0"
					})
				]
			})
		]
	});
});
//#endregion
//#region src/app/features/delegation/presentation/DelegatedCompletionEvent.tsx
function Lv({ turn: e }) {
	let t = se().orchestrationEnabled || e.completion.kind === "coding-agent", n = pi(), r = e.completion.kind === "coding-agent" ? "Coding agent" : "NAC orchestrator", i = e.completion.status === "completed" ? Ai.Success : e.completion.status === "failed" ? Ai.Error : Ai.Danger;
	return /* @__PURE__ */ J(Pi, {
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
				t ? /* @__PURE__ */ J(B, {
					size: L.Small,
					variant: R.Ghost,
					onClick: () => n(vr.session(e.completion.sessionId)),
					children: "Open exact transcript"
				}) : null
			]
		})
	});
}
//#endregion
//#region src/app/hooks/useDelegatedPreviewStream.ts
var Rv = 250, zv = {
	text: "",
	reasoning: "",
	running: !1
};
function Bv(e) {
	let { subscribeToSessionEvents: t } = { subscribeToSessionEvents: P().events }, n = oi(), [r, i] = K(zv), [a, o] = K(e);
	return a !== e && (o(e), i(zv)), U(() => {
		if (!e || typeof EventSource > "u") return;
		let r = !1, a = !1, o = null, s = () => {
			clearTimeout(o ?? void 0), o = window.setTimeout(() => {
				o = null, !r && n.invalidateQueries({
					queryKey: Mt.sessionSnapshot(e),
					exact: !0
				});
			}, Rv);
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
						a = !0, i(zv), s();
						return;
					default: return;
				}
			},
			onAssistantDelta: (e) => {
				if (e.thread_name) return;
				if (e.reset) {
					a = !1, i(zv);
					return;
				}
				let t = a;
				a = !1, i((n) => {
					let r = t ? zv : n;
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
var Vv = (e) => 1 - (1 - e) ** 3, Hv = (e) => e.scrollHeight - (e.scrollTop + e.clientHeight);
function Uv(e) {
	e.scrollTop = e.scrollHeight - e.clientHeight;
}
function Wv(e, t, n = 300, r) {
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
			let r = Math.min(1, (t - c) / n), i = Math.max(0, e.scrollHeight - e.clientHeight), s = a + ((p ? i : Math.min(o, i)) - a) * Vv(r);
			e.scrollTop = p ? Math.max(e.scrollTop, s) : s, r < 1 ? l = requestAnimationFrame(m) : d(!0);
		};
		l = requestAnimationFrame(m);
	});
}
//#endregion
//#region src/app/hooks/useStickToBottom.ts
var Gv = 400, Kv = 60, qv = 400, Jv = 200, Yv = 300, Xv = 1, Zv = 50, Qv = 150, $v = /* @__PURE__ */ new Set([
	"ArrowUp",
	"ArrowDown",
	"PageUp",
	"PageDown",
	"Home",
	"End"
]);
function ey({ resetKey: e = null } = {}) {
	let t = G(null), n = G(null), [r, i] = K(!1), a = G(!0), o = G(!1), s = G(0), c = G(!1), l = G(null), u = G(null), d = G(null), f = G(!1), p = G(Jv), m = G(0), h = G(null), g = H(() => {
		h.current !== null && (clearTimeout(h.current), h.current = null), c.current = !1, o.current = !0;
	}, []), _ = H(() => {
		h.current !== null && clearTimeout(h.current), h.current = window.setTimeout(() => {
			h.current = null, o.current = !1;
		}, Zv);
	}, []), v = H(() => {
		let e = t.current;
		e && i(Hv(e) > Gv);
	}, []), y = H(() => {
		let e = u.current !== null;
		u.current?.abort(), u.current = null, d.current !== null && (cancelAnimationFrame(d.current), d.current = null), e && _();
	}, [_]), b = H((e) => {
		let n = t.current;
		if (!n || !a.current || (p.current = e, u.current)) return;
		v();
		let r = Hv(n);
		if (r <= 0) return;
		let i = !f.current;
		if (f.current = !0, i || r > n.clientHeight * Xv) {
			y(), g(), Uv(n), v(), _();
			return;
		}
		let o = new AbortController();
		u.current = o, g(), Wv(n, n.scrollHeight, e, o.signal).then((e) => {
			u.current === o && (u.current = null, _(), v(), p.current = Jv);
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
			}, Qv);
		}, r = () => {
			let t = Hv(e), n = s.current, r = e.scrollHeight !== n;
			if (s.current = e.scrollHeight, r) {
				t <= 60 && (a.current = !0);
				return;
			}
			o.current && !c.current || (t > Kv ? (a.current && y(), a.current = !1) : a.current = !0, v());
		}, i = (t) => {
			n();
			let r = Hv(e);
			t.deltaY < 0 && r > Kv ? (y(), a.current = !1, v()) : t.deltaY > 0 && r <= 60 && (a.current = !0);
		}, u = (t) => {
			let r = e.getBoundingClientRect();
			t.clientX >= r.left + e.clientWidth && n();
		}, d = (e) => {
			$v.has(e.key) && n();
		};
		return e.addEventListener("scroll", r, { passive: !0 }), e.addEventListener("wheel", i, { passive: !0 }), e.addEventListener("pointerdown", u, { passive: !0 }), e.addEventListener("touchmove", n, { passive: !0 }), e.addEventListener("keydown", d), r(), () => {
			e.removeEventListener("scroll", r), e.removeEventListener("wheel", i), e.removeEventListener("pointerdown", u), e.removeEventListener("touchmove", n), e.removeEventListener("keydown", d), l.current !== null && clearTimeout(l.current);
		};
	}, [y, v]), U(() => {
		let e = t.current, r = n.current;
		if (!e || !r) return;
		let i = () => {
			y(), g(), Uv(e), v(), _();
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
				if (!a.current || Hv(e) <= 60) return;
				i();
				return;
			}
			c();
		});
		x.observe(r);
		let S = new ResizeObserver(() => {
			a.current && (u.current || o.current || Hv(e) <= 60 || i());
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
	]), $r(() => {
		y(), a.current = !0, s.current = 0, m.current = 0;
		let e = t.current;
		if (!e) {
			f.current = !1;
			return;
		}
		f.current = !0, g(), Uv(e), v(), _();
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
			e && (y(), a.current = !0, i(!1), g(), Wv(e, e.scrollHeight, qv).then((t) => {
				_(), t || (a.current = Hv(e) <= 60, v());
			}));
		}, [
			g,
			y,
			_,
			v
		]),
		followLatest: H((e = Yv) => {
			f.current = !0, b(e);
		}, [b])
	};
}
//#endregion
//#region src/app/hooks/useMarkdownReady.ts
function ty() {
	let [e, t] = K(x_);
	return U(() => {
		if (e) return;
		let n = !0;
		return b_().finally(() => {
			n && t(!0);
		}), () => {
			n = !1;
		};
	}, [e]), e;
}
//#endregion
//#region src/app/hooks/useTranscriptReveal.ts
var ny = 1500;
function ry(e, t) {
	let n = ty(), r = ri({ queryKey: Mt.sessionRoot(e) }), [i, a] = K(null), o = G(null), s = G(!1), c = i === e;
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
		let n = setTimeout(() => a(e), ny);
		return () => clearTimeout(n);
	}, [
		c,
		t,
		e
	]), c;
}
//#endregion
//#region src/app/components/inspector/SubagentPreview.tsx
function iy() {}
function ay() {}
function oy(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function sy({ sessionId: e, title: t, fallbackText: n, icon: r }) {
	let i = pi(), a = Nn(e, { retry: !1 }), o = Bv(e), s = yn(e), c = a.data, l = !!c?.message_page?.has_older, u = c?.message_page?.start ?? 0, [f, p] = K(!1), [m, h] = K(e), g = G(!1);
	m !== e && (h(e), p(!1));
	let _ = o.running || !!c?.active_run, v = ry(e, !!c && (!l || f) || a.isError), { scrollRef: y, contentRef: b } = ey({ resetKey: e }), x = G(null);
	$r(() => {
		let e = x.current, t = y.current;
		!e || !t || (t.scrollTop = e.top + (t.scrollHeight - e.height), x.current = null);
	}, [y, u]);
	let S = s.mutateAsync;
	U(() => {
		g.current = !1;
	}, [e]), U(() => {
		if (!l || f || g.current) return;
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
		l,
		S,
		f,
		y,
		u
	]);
	let C = W(() => Mv(c ?? null, {}, {}, []), [c]), w = _ ? c?.active_run?.submitted_user_message : void 0, T = w ? yr(w.content) : "", E = w ? Tt(w.content) : null, D = !!(T && oy(C) !== T), ee = o.running && !c?.active_run && !!(o.text || o.reasoning), O = W(() => jv(C, {
		text: o.text,
		reasoning: o.reasoning
	}, D || ee), [
		o.reasoning,
		o.text,
		D,
		C,
		ee
	]), k = O[O.length - 1], A = _ && k?.kind === "model" && (!D || k.key === "model-streaming"), te = _ && !A, j = D && k?.key === "model-streaming", ne = c?.metadata.model ?? "", re = v ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
	return /* @__PURE__ */ Y("div", {
		className: "flex min-h-0 flex-1 flex-col",
		children: [/* @__PURE__ */ Y("div", {
			className: "flex h-14 shrink-0 items-center gap-2 border-b border-muted bg-elevation-level-1 px-4",
			children: [
				/* @__PURE__ */ J(z, {
					iconName: r,
					size: 20,
					className: "shrink-0 text-basic-secondary"
				}),
				/* @__PURE__ */ J("p", {
					className: d("label-small min-w-0 flex-1 truncate", _ ? "text-shimmer-basic" : "text-basic-primary"),
					children: t
				}),
				/* @__PURE__ */ Y(B, {
					size: L.Small,
					variant: R.Ghost,
					content: I.IconRight,
					"aria-label": "Open",
					onClick: () => i(vr.session(e)),
					children: ["Open", /* @__PURE__ */ J(z, { iconName: V.Right })]
				})
			]
		}), /* @__PURE__ */ Y("div", {
			className: "relative min-h-0 flex-1",
			children: [/* @__PURE__ */ J("div", {
				role: "status",
				"aria-label": v ? void 0 : "Loading conversation",
				className: d("pointer-events-none absolute inset-0 px-4 pt-4 transition-opacity duration-150 ease-in-out", v ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ J(Ri, {
					rows: 3,
					rowClassName: "h-[48px]"
				})
			}), /* @__PURE__ */ J("div", {
				ref: y,
				className: d("h-full overflow-y-auto", re, !v && "invisible"),
				children: /* @__PURE__ */ Y("div", {
					ref: b,
					className: "flex flex-col px-4 pt-2 pb-6 [&>*]:shrink-0",
					children: [
						f && l ? /* @__PURE__ */ Y("div", {
							role: "alert",
							className: "mb-4 flex items-center gap-2",
							children: [/* @__PURE__ */ J("span", {
								className: "label-small text-basic-muted",
								children: "Couldn’t load older messages."
							}), /* @__PURE__ */ J(B, {
								size: L.Small,
								variant: R.Ghost,
								onClick: () => p(!1),
								children: "Try again"
							})]
						}) : null,
						O.map((e, t) => {
							if (e.kind === "delegated-completion") return /* @__PURE__ */ J(Lv, { turn: e }, e.key);
							if (e.kind === "user") return /* @__PURE__ */ J(Iv, {
								text: e.text,
								invokedSkills: e.invokedSkills,
								timestamp: e.createdAt ? dn(e.createdAt) : null,
								readOnly: !0
							}, e.key);
							let n = t === O.length - 1, r = /* @__PURE__ */ J(Fv, {
								turn: e,
								model: ne,
								active: _ && n,
								isLast: !1,
								selectedThreadEpisode: null,
								selectedWorkset: null,
								onSelectThread: iy,
								onSelectWorkset: ay,
								readOnly: !0
							}, e.key);
							return j && e.key === "model-streaming" ? /* @__PURE__ */ Y(Kr, { children: [/* @__PURE__ */ J(Iv, {
								text: T,
								invokedSkills: E,
								pending: !0,
								readOnly: !0
							}), r] }, e.key) : r;
						}),
						D && !j ? /* @__PURE__ */ J(Iv, {
							text: T,
							invokedSkills: E,
							pending: !0,
							readOnly: !0
						}) : null,
						te ? /* @__PURE__ */ J(Fv, {
							turn: {
								kind: "model",
								key: "model-pending",
								blocks: [],
								durationMs: null,
								messageIndex: null
							},
							model: ne,
							active: !0,
							isLast: !1,
							selectedThreadEpisode: null,
							selectedWorkset: null,
							onSelectThread: iy,
							onSelectWorkset: ay,
							readOnly: !0
						}) : null,
						O.length === 0 && !_ && n ? /* @__PURE__ */ J("p", {
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
function cy(e) {
	return e.startsWith("child:") ? {
		mode: "child",
		id: e.slice(6)
	} : e.startsWith("orchestrator:") ? {
		mode: "orchestrator",
		id: e.slice(13)
	} : null;
}
function ly(e) {
	return e?.trim() || null;
}
function uy(e) {
	return {
		key: `child:${e.child_session_id}`,
		mode: "child",
		id: e.child_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: ly(e.failure) ?? ly(e.report) ?? ly(e.change_summary) ?? ly(e.verification_summary),
		icon: V.Plane
	};
}
function dy(e) {
	return {
		key: `orchestrator:${e.orchestrator_session_id}`,
		mode: "orchestrator",
		id: e.orchestrator_session_id,
		description: e.description,
		status: e.status,
		background: e.execution_mode !== "foreground",
		updatedAt: e.updated_at,
		fallbackText: ly(e.failure) ?? ly(e.report),
		icon: V.Orchestrator
	};
}
var fy = {
	agent: {
		title: "Launch Subagent",
		body: "Start a fresh-context coding agent. Browse, steer, continue, and cancel it from this chat.",
		icon: V.Plane
	},
	orchestrator: {
		title: "Launch Suborchestrator",
		body: "Start a separate NAC planning session. Browse, steer, continue, and cancel it from this chat.",
		icon: V.Orchestrator
	}
};
function py({ kind: e }) {
	let t = fy[e];
	return /* @__PURE__ */ Y("div", {
		className: "flex min-h-0 flex-1 flex-col items-center justify-center px-4",
		children: [
			/* @__PURE__ */ J(z, {
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
function my({ sessionId: e, behavior: t }) {
	let { useSubagentLaunch: n, showSidePanelList: r, useSubagentLaunchRequest: i, openSubagentLaunch: a, clearSubagentLaunch: o } = P().stores.sessionLayoutStore, s = se().orchestrationEnabled && t === "direct-with-orchestrator", c = F(e, !0), l = f(e, s), u = n(), p = !s && u === "orchestrator" ? null : u, m = i(), h = gn(6e4), [g, _] = K(null), [v, y] = K(e);
	v !== e && (y(e), _(null));
	let b = W(() => {
		let e = (c.data ?? []).map(uy), t = s ? (l.data ?? []).map(dy) : [];
		return [...e, ...t];
	}, [
		c.data,
		l.data,
		s
	]), x = [...b].sort((e, t) => t.updatedAt.localeCompare(e.updatedAt))[0]?.key ?? null, S = !s && g?.startsWith("orchestrator:") ? null : g, C = p ? null : S ?? x;
	U(() => {
		!s && u === "orchestrator" && o();
	}, [
		s,
		u,
		o
	]), !s && g?.startsWith("orchestrator:") && _(null), !p && g == null && x != null && _(x);
	let w = b.find((e) => e.key === C) ?? null, T = !p && !w && C ? cy(C) : null, E = W(() => Nl(b, (e) => ({
		updatedAt: e.updatedAt,
		pinned: !1
	}), h), [b, h]), D = (e) => {
		a(e), r(!1);
	}, ee = (e) => {
		o(), _(e), r(!1);
	}, O = p ? { mode: p === "agent" ? "new-agent" : "new-orchestrator" } : w ? {
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
	} : { mode: "new-agent" }, k = b.length === 0 && (c.isError || s && l.isError) ? /* @__PURE__ */ Y("div", {
		role: "alert",
		className: "rounded-[6px] border border-error-primary p-3",
		children: [/* @__PURE__ */ J("div", {
			className: "text-small text-error-primary",
			children: "Subagents could not be loaded."
		}), /* @__PURE__ */ J(B, {
			className: "mt-2",
			size: L.Small,
			variant: R.Ghost,
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
				children: e.items.map((e) => /* @__PURE__ */ J(ki, {
					title: e.description,
					icon: e.icon,
					running: e.status === "running",
					active: !p && w?.key === e.key,
					onClick: () => ee(e.key)
				}, e.key))
			})]
		}, e.label))
	});
	return /* @__PURE__ */ J(zg, {
		listTitle: "Subagents",
		title: p ? fy[p].title : w?.description,
		listToolbar: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-1 border-b border-muted p-2",
			children: [/* @__PURE__ */ Y(Qc, {
				active: p === "agent",
				onClick: () => D("agent"),
				children: [/* @__PURE__ */ J(z, { iconName: V.Add }), /* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: "New Agent"
				})]
			}), s ? /* @__PURE__ */ Y(Qc, {
				active: p === "orchestrator",
				onClick: () => D("orchestrator"),
				children: [/* @__PURE__ */ J(z, { iconName: V.Add }), /* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					children: "New Orchestrator"
				})]
			}) : null]
		}),
		list: k,
		children: /* @__PURE__ */ Y("div", {
			className: "flex min-h-0 flex-1 flex-col",
			children: [p ? /* @__PURE__ */ J(py, { kind: p }) : w ? /* @__PURE__ */ J(sy, {
				sessionId: w.id,
				title: w.description,
				fallbackText: w.fallbackText,
				icon: w.icon
			}) : T ? /* @__PURE__ */ J(sy, {
				sessionId: T.id,
				title: "Subagent",
				fallbackText: null,
				icon: T.mode === "orchestrator" ? V.Orchestrator : V.Plane
			}) : /* @__PURE__ */ J(py, { kind: "agent" }), /* @__PURE__ */ J("div", {
				className: d("shrink-0 p-2"),
				children: /* @__PURE__ */ J(wh, {
					autoFocus: p != null,
					focusRequest: m,
					parentSessionId: e,
					target: O,
					permissionSessionId: "id" in O ? O.id : e,
					permissionBehavior: O.mode === "orchestrator" || O.mode === "new-orchestrator" ? "orchestrator" : "direct",
					showPermissions: !1,
					onStarted: (e) => {
						o(), _(O.mode === "new-orchestrator" || O.mode === "orchestrator" ? `orchestrator:${e}` : `child:${e}`);
					}
				}, `${O.mode}:${"id" in O ? O.id : "new"}:${"status" in O ? O.status : ""}`)
			})]
		})
	});
}
//#endregion
//#region src/app/lib/revisions.ts
var hy = (e) => `Snapshot ${e}`, gy = (e, t) => t - e;
function _y(e, t) {
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
function vy({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		className: d("flex items-start gap-2 w-full p-2 rounded-[8px] text-left", r ? "btn-ghost-highlighted" : "btn-ghost"),
		"aria-pressed": r,
		onClick: i,
		children: [
			/* @__PURE__ */ J(z, {
				iconName: r ? V.Check : V.History,
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
function yy({ sessionId: e, selected: t, onSelect: n }) {
	let { data: r, isLoading: i, error: a } = bt(e), o = r ?? [];
	return a ? /* @__PURE__ */ J(Hg, { children: ir(a) }) : /* @__PURE__ */ Y("div", {
		className: "flex flex-col flex-1 min-h-0 overflow-auto p-2 gap-1 bg-elevation-level-1 [&>*]:shrink-0",
		children: [
			/* @__PURE__ */ J(vy, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => n(null)
			}),
			i ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 p-2 label-small text-basic-muted",
				children: [/* @__PURE__ */ J(A, {
					size: M.Small,
					variant: be.Neutral
				}), "Reading snapshots…"]
			}) : null,
			o.map((e, r) => /* @__PURE__ */ J(vy, {
				title: `${hy(gy(r, o.length))} · ${dn(e.created_at)}`,
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
var by = 50, xy = "200px";
function Sy(e, { key: t, step: n = by, atLeast: r = 0 }) {
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
		}, { rootMargin: xy });
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
function Cy({ text: e, active: t, large: n = !1 }) {
	return /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(z, {
		iconName: V.Info,
		size: n ? 20 : 16,
		className: d("shrink-0", t ? "text-basic-primary" : "text-btn-secondary")
	}), /* @__PURE__ */ J("span", {
		className: d("underline", n ? "label-small" : "label-micro", t ? "text-basic-primary" : "text-btn-secondary"),
		children: e
	})] });
}
function wy({ action: e, open: t, onClose: n, children: r }) {
	return /* @__PURE__ */ J(pn, {
		open: t,
		onClose: n,
		placement: s.BottomRight,
		sticky: !0,
		size: "w-[430px] max-w-[calc(100vw-16px)]",
		panelClassName: "p-4 overflow-auto max-h-[70vh]",
		sheetClassName: "max-h-[70vh] overflow-auto",
		className: "shrink-0",
		content: /* @__PURE__ */ J(C_, {
			className: "text-basic-primary px-4 md:px-0",
			children: e
		}),
		children: r
	});
}
function Ty({ action: e, large: t = !1 }) {
	let [n, r] = K(!1);
	return /* @__PURE__ */ J(wy, {
		action: e,
		open: n,
		onClose: () => r(!1),
		children: /* @__PURE__ */ J("button", {
			type: "button",
			className: "flex items-center gap-1 shrink-0",
			"aria-expanded": n,
			onClick: () => r((e) => !e),
			children: /* @__PURE__ */ J(Cy, {
				text: "See task",
				active: n,
				large: t
			})
		})
	});
}
function Ey({ action: e }) {
	let [t, n] = K(!1);
	return /* @__PURE__ */ J(wy, {
		action: e,
		open: t,
		onClose: () => n(!1),
		children: /* @__PURE__ */ J(B, {
			size: L.Medium,
			variant: t ? R.Primary : R.Secondary,
			"aria-expanded": t,
			onClick: () => n((e) => !e),
			children: "Task"
		})
	});
}
//#endregion
//#region src/app/components/inspector/SteeringPromptModal.tsx
function Dy({ open: e, title: t, subheader: n, value: r, submitting: i, disabled: a = !1, footerLeading: o, onChange: s, onClose: c, onSubmit: l }) {
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: i ? void 0 : c,
		onNavigate: c,
		size: Mn.Wide,
		title: t,
		subheader: n,
		children: /* @__PURE__ */ Y("div", {
			className: "flex flex-col gap-4",
			children: [/* @__PURE__ */ J(sc, {
				label: "Steering message",
				"aria-label": "Steering message",
				textAreaSize: oc.Medium,
				value: r,
				onChange: (e) => s(e.target.value),
				isDisabled: i,
				textAreaClassName: "h-[140px] resize-none"
			}), /* @__PURE__ */ Y("div", {
				className: "flex flex-wrap items-center justify-between gap-3",
				children: [/* @__PURE__ */ J("div", { children: o }), /* @__PURE__ */ J(B, {
					variant: R.Primary,
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
function Oy({ sessionId: e, threadName: t, onClose: n }) {
	let [r, i] = K(""), a = Rn(), o = hn(), s = async () => {
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
			o.error(`Unable to steer ${t}: ${ir($(e))}`);
		}
	};
	return /* @__PURE__ */ J(Dy, {
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
function ky(e, t, n, r) {
	return r ? t.has(r) || n[r] ? !0 : e ? e.threads.some((e) => e.name === r) || Object.hasOwn(e.thread_episodes, r) ? !0 : (e.active_threads ?? []).includes(r) : !1 : !1;
}
function Ay(e, t) {
	return {
		name: e,
		session_id: t,
		created_at: "",
		updated_at: "",
		episode_count: 0,
		latest_action: null
	};
}
function jy(e) {
	let t = /* @__PURE__ */ new Map();
	if (!e?.length) return t;
	for (let n = e.length - 1; n >= 0; --n) {
		let r = e[n];
		if (r.role !== "assistant") continue;
		let i = (r.tool_calls ?? []).filter((e) => e.function?.name === "thread");
		if (i.length) {
			Tv(i).forEach((e, n) => {
				for (let r of e) t.set(Sv(r), n);
			});
			break;
		}
	}
	return t;
}
var My = Xr(function({ entry: e, running: t }) {
	let n = e.status === "pending" && t;
	return /* @__PURE__ */ Y("div", {
		className: "pt-1",
		children: [/* @__PURE__ */ J("p", {
			className: d("code code-small whitespace-pre-wrap break-words", n ? "text-shimmer-basic" : "text-basic-tertiary"),
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
}), Ny = Xr(function({ entry: e }) {
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
}), Py = Xr(function({ entry: e, running: t }) {
	return e.kind === "tool_call" ? /* @__PURE__ */ J(My, {
		entry: e,
		running: t
	}) : /* @__PURE__ */ J(Ny, { entry: e });
}), Fy = {
	error: {
		label: "Failed",
		color: Si.Red
	},
	timed_out: {
		label: "Timed out",
		color: Si.Yellow
	},
	cancelled: {
		label: "Cancelled",
		color: Si.Yellow
	}
};
function Iy({ episode: e, index: t }) {
	let [n, r] = K(!1), i = jr(), a = Fy[e.status], o = i ? "label-small" : "label-micro";
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col items-start w-full",
		children: [/* @__PURE__ */ Y("button", {
			type: "button",
			className: "group flex items-center gap-2 w-full py-3 pl-1 pr-3 md:py-2 md:pl-3 md:pr-2 rounded-[4px] btn-ghost",
			"aria-expanded": n,
			onClick: () => r((e) => !e),
			children: [
				/* @__PURE__ */ J(z, {
					iconName: n ? V.Down : V.Right,
					size: 16,
					className: "shrink-0 text-basic-muted"
				}),
				/* @__PURE__ */ J("span", {
					className: `shrink-0 ${o} text-basic-primary`,
					children: `Episode ${t + 1}`
				}),
				a ? /* @__PURE__ */ J(Ci, {
					text: a.label,
					color: a.color,
					className: "shrink-0"
				}) : null
			]
		}), /* @__PURE__ */ J(_a, {
			isOpen: n,
			className: "w-full",
			children: /* @__PURE__ */ J("div", {
				className: "flex flex-col pl-1 pr-1 md:pl-3 md:pr-2 pt-2 pb-6",
				children: e.content.trim() ? /* @__PURE__ */ J(C_, {
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
var Ly = {
	pending: 0,
	running: 1,
	done: 2
};
function Ry({ scrollRef: e, stuckRef: t, entries: n, running: r, thinking: i, loading: a, className: o, historyControl: s }) {
	return /* @__PURE__ */ Y("div", {
		ref: e,
		className: d("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0 bg-elevation-level-0-5", o),
		onScroll: () => {
			let n = e.current;
			n && (t.current = Hv(n) <= 60);
		},
		children: [s, /* @__PURE__ */ Y("div", {
			className: "pb-[128px] md:pb-4",
			children: [
				n.map((e) => /* @__PURE__ */ J(Py, {
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
					children: /* @__PURE__ */ J(Ri, {
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
function zy({ lines: e, running: t, hasOlder: n, loadingOlder: r, loadingInitial: i, historyError: a, onRetry: o, onLoadOlder: s, className: c }) {
	let l = G(null), u = G(null), d = G(!0), f = W(() => At(e), [e]), p = W(() => An(t, e), [t, e]), m = f[0]?.kind === "tool_call" ? `call-${f[0].callId}` : f[0]?.key ?? null;
	$r(() => {
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
	return $r(() => {
		let e = u.current;
		!e || !d.current || Uv(e);
	}, [f.length, p]), /* @__PURE__ */ J(Ry, {
		scrollRef: u,
		stuckRef: d,
		entries: f,
		running: t,
		thinking: p,
		loading: i,
		className: c,
		historyControl: n || a ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2 pb-3",
			children: [n ? /* @__PURE__ */ J(B, {
				size: L.Small,
				variant: R.Secondary,
				disabled: r,
				onClick: h,
				children: r ? "Loading…" : "Load older commands"
			}) : null, a ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("span", {
				className: "text-micro text-error-primary",
				children: a
			}), /* @__PURE__ */ J(B, {
				size: L.Small,
				variant: R.Ghost,
				onClick: () => {
					n ? h() : o();
				},
				children: "Try again"
			})] }) : null]
		}) : null
	});
}
function By({ episodes: e, running: t, className: n }) {
	return e.length ? /* @__PURE__ */ J("div", {
		className: d("flex flex-col flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0", n),
		children: /* @__PURE__ */ J("div", {
			className: "pb-[128px] md:pb-4 flex flex-col",
			children: e.map((e, t) => /* @__PURE__ */ Y("div", {
				className: "flex flex-col",
				children: [t > 0 ? /* @__PURE__ */ J(Q, {}) : null, /* @__PURE__ */ J(Iy, {
					episode: e,
					index: t
				})]
			}, e.id))
		})
	}) : /* @__PURE__ */ J("div", {
		className: d("flex flex-1 min-h-0", n),
		children: /* @__PURE__ */ J("p", {
			className: "p-4 max-w-prose label-small text-basic-muted",
			children: t ? "An episode records one dispatch — what the thread was asked to do and what came back. This one is written when the dispatch ends; until then the Command Log is the live view." : "This thread has not been dispatched yet, so it has no episodes."
		})
	});
}
var Vy = {
	log: "Command Log",
	overview: "Episodes"
}, Hy = ["log", "overview"];
function Uy({ view: e, action: t, canSteer: n, onSteer: r, onChange: i }) {
	return /* @__PURE__ */ Y("div", {
		className: "absolute inset-x-0 top-0 flex items-center gap-2 overflow-x-auto overscroll-x-contain p-2",
		role: "toolbar",
		"aria-label": "Thread controls",
		children: [
			Hy.map((t) => /* @__PURE__ */ J("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ J(B, {
					className: "w-full",
					size: L.Medium,
					variant: e === t ? R.Primary : R.Secondary,
					"aria-pressed": e === t,
					onClick: () => i(t),
					children: Vy[t]
				})
			}, t)),
			t ? /* @__PURE__ */ J("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ J(Ey, { action: t })
			}) : null,
			n ? /* @__PURE__ */ J("div", {
				className: "flex shrink-0 rounded-full bg-elevation-level-3 shadow-2xl overflow-hidden",
				children: /* @__PURE__ */ J(B, {
					size: L.Medium,
					variant: R.Secondary,
					onClick: r,
					children: "Steer"
				})
			}) : null
		]
	});
}
function Wy({ view: e, onChange: t }) {
	return /* @__PURE__ */ J("div", {
		className: "flex items-center gap-2 shrink-0",
		role: "tablist",
		"aria-label": "Thread detail view",
		children: Hy.map((n) => /* @__PURE__ */ J(B, {
			size: L.Small,
			variant: e === n ? R.Primary : R.Secondary,
			className: "!rounded-full",
			"aria-pressed": e === n,
			onClick: () => t(n),
			children: Vy[n]
		}, n))
	});
}
function Gy({ view: e, onChange: t }) {
	return /* @__PURE__ */ J(el, {
		size: L.Small,
		variant: R.Secondary,
		value: e,
		items: Hy.map((e) => ({
			id: e,
			label: Vy[e]
		})),
		onValueChange: (e) => t(e)
	});
}
function Ky({ thread: e, action: t, episodes: n, events: r, liveLog: i, running: a, hasOlder: o, loadingOlder: s, loadingInitial: c, historyError: l, onLoadOlder: u, onRetry: f, view: p, canSteer: m, onSteer: h, onViewChange: g }) {
	let _ = jr(), v = Qe(), y = W(() => ur(Bt(r), i), [r, i]), b = _ ? "pt-14" : void 0, x = p === "log" ? /* @__PURE__ */ J(zy, {
		lines: y,
		running: a,
		hasOlder: o,
		loadingInitial: c,
		loadingOlder: s,
		historyError: l,
		onLoadOlder: u,
		onRetry: f,
		className: b
	}) : /* @__PURE__ */ J(By, {
		episodes: n,
		running: a,
		className: b
	});
	return _ || v ? /* @__PURE__ */ Y("div", {
		className: "relative flex flex-col flex-1 min-h-0 min-w-0",
		children: [x, _ ? /* @__PURE__ */ J(Uy, {
			view: p,
			action: t,
			canSteer: m,
			onSteer: h,
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
							className: d("label-small truncate", a ? "text-shimmer-basic" : "text-basic-primary"),
							children: e.name
						}), t ? /* @__PURE__ */ J(Ty, { action: t }) : null]
					}), /* @__PURE__ */ J("span", {
						className: "code code-micro text-basic-muted truncate",
						children: e.updated_at
					})]
				}),
				m ? /* @__PURE__ */ J(B, {
					size: L.Small,
					variant: R.Secondary,
					onClick: h,
					children: "Steer"
				}) : null,
				/* @__PURE__ */ J(Wy, {
					view: p,
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
function qy({ snapshot: e, selected: t, onSelect: n, canSteerWorkers: r }) {
	let { setSelectedThreadRunning: i } = P().stores.sessionLayoutStore, { useStreamStatus: a, useLiveThreads: o } = P().stores.runtimeStore, s = o(), c = a(), [l, u] = K("log"), [f, p] = K(null), m = W(() => e?.threads ?? [], [e]), h = e?.active_threads, g = e?.metadata.session_id ?? "", _ = W(() => jy(e?.messages), [e?.messages]), v = W(() => Cv(e?.messages ?? []), [e?.messages]), y = W(() => Dv(e?.messages ?? []), [e?.messages]), b = W(() => {
		let t = /* @__PURE__ */ new Set();
		for (let n of e?.messages ?? []) if (n.role === "assistant") for (let e of n.tool_calls ?? []) e.function?.name === "thread" && t.add(Sv(e));
		return t;
	}, [e?.messages]), x = c === "connecting" || c === "reconnecting", { runningNames: S, pendingNames: C } = W(() => {
		let e = /* @__PURE__ */ new Set(), t = /* @__PURE__ */ new Set();
		for (let n of h ?? []) {
			let r = s[n];
			r?.status === "running" ? e.add(n) : r?.status === "finished" || (x ? e.add(n) : t.add(n));
		}
		for (let [n, r] of Object.entries(s)) r.status === "running" ? (e.add(n), t.delete(n)) : r.status === "finished" && (e.delete(n), t.delete(n));
		return {
			runningNames: e,
			pendingNames: t
		};
	}, [
		h,
		s,
		x
	]), w = W(() => {
		let n = new Set(m.map((e) => e.name)), r = /* @__PURE__ */ new Set();
		for (let e of b) n.has(e) || r.add(e);
		t && !n.has(t) && ky(e, b, s, t) && r.add(t);
		for (let e of S) n.has(e) || r.add(e);
		for (let e of C) n.has(e) || r.add(e);
		for (let [e, t] of Object.entries(s)) t.status === "finished" && !n.has(e) && r.add(e);
		let i = [...m, ...[...r].map((e) => Ay(e, g))], a = (e) => C.has(e) ? "pending" : S.has(e) ? "running" : "done";
		return i.sort((e, t) => {
			let n = Ly[a(e.name)] - Ly[a(t.name)];
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
		s,
		g,
		e,
		_
	]), T = W(() => w.filter((e) => !C.has(e.name)), [w, C]), E = w.find((e) => e.name === t) ?? T[0] ?? w[0] ?? null, { visible: D, hasMore: ee, sentinelRef: O } = Sy(w, {
		key: g,
		atLeast: (E ? w.findIndex((e) => e.name === E.name) : -1) + 1
	}), k = E ? s[E.name] : void 0, te = E && (v[E.name] || E.latest_action) || "", j = E?.name ?? null, ne = !!(j && S.has(j)), re = r && k?.status === "running", ie = ln(e ? g : null, j), ae = W(() => ie.data ? Gn(ie.data.pages) : void 0, [ie.data]);
	return U(() => {
		j && t !== j && (t && w.some((e) => e.name === t) || n(j));
	}, [
		t,
		j,
		w,
		n
	]), U(() => {}, [
		t,
		w,
		b,
		s,
		e,
		g,
		m
	]), U(() => (i(ne), () => i(!1)), [ne, i]), e ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(zg, {
		listTitle: "Threads",
		title: E?.name,
		titleAction: te ? /* @__PURE__ */ J(Ty, { action: te }) : null,
		actions: E ? /* @__PURE__ */ Y("div", {
			className: "flex items-center gap-2",
			children: [re ? /* @__PURE__ */ J(B, {
				size: L.Small,
				variant: R.Secondary,
				onClick: () => p(E.name),
				children: "Steer"
			}) : null, /* @__PURE__ */ J(Gy, {
				view: l,
				onChange: u
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
			let r = C.has(t.name), i = S.has(t.name), a = s[t.name], o = e.thread_episodes?.[t.name]?.at(-1), c = e.thread_episodes?.[t.name]?.length ?? t.episode_count, l = !!a?.cancelled || y.has(t.name) || o?.status === "cancelled" || !i && !r && c === 0, u = a?.isError, f = v[t.name] || t.latest_action || "";
			return /* @__PURE__ */ J(Bg, {
				label: t.name,
				active: t.name === E?.name,
				disabled: r,
				title: r ? "Waiting on source threads" : f || void 0,
				icon: r ? /* @__PURE__ */ J(z, {
					iconName: V.Timelaps,
					size: 16,
					className: "shrink-0 [&>path]:!fill-basic-muted"
				}) : i ? /* @__PURE__ */ J(A, {
					size: M.Micro,
					variant: be.Neutral
				}) : l ? /* @__PURE__ */ J(z, {
					iconName: V.Close,
					size: 16,
					className: "shrink-0 [&>path]:!fill-basic-muted"
				}) : /* @__PURE__ */ J(z, {
					iconName: u ? V.Danger : V.CheckCircle,
					size: 16,
					className: d("shrink-0", u && "text-error-primary")
				}),
				trailing: /* @__PURE__ */ J("span", {
					className: "code code-micro text-basic-muted shrink-0",
					children: e.thread_episodes?.[t.name]?.length ?? t.episode_count
				}),
				onClick: () => n(t.name)
			}, t.name);
		}), ee ? /* @__PURE__ */ J("div", {
			ref: O,
			"aria-hidden": !0,
			className: "h-px"
		}) : null] }),
		children: E ? /* @__PURE__ */ J(Ky, {
			thread: E,
			action: te,
			episodes: e.thread_episodes?.[E.name] ?? [],
			events: ae ?? e.thread_events?.[E.name],
			liveLog: k?.log ?? [],
			running: S.has(E.name),
			hasOlder: !!ie.hasNextPage,
			loadingOlder: ie.isFetchingNextPage,
			loadingInitial: ie.isPending,
			historyError: ie.error instanceof Error ? ie.error.message : null,
			onLoadOlder: async () => {
				await ie.fetchNextPage();
			},
			onRetry: async () => {
				ie.data ? await ie.fetchNextPage() : await ie.refetch();
			},
			view: l,
			canSteer: re,
			onSteer: () => p(E.name),
			onViewChange: u
		}, `${g}:${E.name}`) : /* @__PURE__ */ J(Hg, {
			title: "No thread selected",
			children: "Threads contain conversations, command output, and file changes for each task. Select a thread to view its details."
		})
	}), f ? /* @__PURE__ */ J(Oy, {
		sessionId: g,
		threadName: f,
		onClose: () => p(null)
	}) : null] }) : /* @__PURE__ */ J(Vg, { listTitle: "Threads" });
}
//#endregion
//#region src/app/components/inspector/WorksetsView.tsx
var Jy = {
	done: "text-success-primary",
	completed: "text-success-primary",
	finished: "text-success-primary",
	active: "text-info-primary",
	running: "text-info-primary",
	in_progress: "text-info-primary",
	blocked: "text-error-primary",
	failed: "text-error-primary"
}, Yy = (e) => Jy[e.toLowerCase()] ?? "text-basic-secondary";
function Xy({ label: e, children: t }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-1",
		children: [/* @__PURE__ */ J("span", {
			className: "tag-label text-basic-muted",
			children: e
		}), t]
	});
}
function Zy({ item: e }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-4 p-4 rounded-[8px] border border-muted bg-elevation-level-1",
		children: [
			e.role ? /* @__PURE__ */ J(Ci, {
				text: e.role,
				color: Si.Blue,
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
			e.acceptance ? /* @__PURE__ */ J(Xy, {
				label: "Acceptance",
				children: /* @__PURE__ */ J("p", {
					className: "text-small text-basic-secondary",
					children: e.acceptance
				})
			}) : null,
			e.depends_on.length > 0 ? /* @__PURE__ */ J(Xy, {
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
function Qy({ workset: e }) {
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-col gap-6 flex-1 min-h-0 overflow-auto p-4 [&>*]:shrink-0",
		children: [
			/* @__PURE__ */ J(Xy, {
				label: "ID",
				children: /* @__PURE__ */ J("span", {
					className: "header-medium text-basic-primary break-words",
					children: e.id
				})
			}),
			e.goal ? /* @__PURE__ */ J(Xy, {
				label: "Goal",
				children: /* @__PURE__ */ J("p", {
					className: "paragraph-small text-basic-primary",
					children: e.goal
				})
			}) : null,
			e.status ? /* @__PURE__ */ J(Xy, {
				label: "Status",
				children: /* @__PURE__ */ J("span", {
					className: d("code code-medium", Yy(e.status)),
					children: e.status
				})
			}) : null,
			e.summary ? /* @__PURE__ */ J(Xy, {
				label: "Summary",
				children: /* @__PURE__ */ J("p", {
					className: "paragraph-small text-basic-primary",
					children: e.summary
				})
			}) : null,
			e.verification_recipe ? /* @__PURE__ */ J(Xy, {
				label: "Verification recipe",
				children: /* @__PURE__ */ J("p", {
					className: "paragraph-small text-basic-primary whitespace-pre-wrap",
					children: e.verification_recipe
				})
			}) : null,
			e.items.length > 0 ? /* @__PURE__ */ J(Xy, {
				label: "Workset items",
				children: /* @__PURE__ */ J("div", {
					className: "flex flex-col gap-2 pt-1",
					children: e.items.map((e) => /* @__PURE__ */ J(Zy, { item: e }, e.position))
				})
			}) : null
		]
	});
}
function $y({ snapshot: e, selected: t, onSelect: n }) {
	if (!e) return /* @__PURE__ */ J(Vg, { listTitle: "Worksets" });
	let r = e.worksets;
	if (r.error) return /* @__PURE__ */ J("div", {
		className: "p-6 label-small text-error-primary",
		children: r.error
	});
	let i = r.items.find((e) => e.id === t) ?? r.items[0] ?? null;
	return /* @__PURE__ */ J(zg, {
		listTitle: "Worksets",
		title: i?.id,
		list: r.items.length === 0 ? /* @__PURE__ */ J("div", {
			className: "p-1 label-micro text-basic-muted",
			children: "No worksets defined for this session."
		}) : r.items.map((e) => /* @__PURE__ */ J(Bg, {
			label: e.id,
			active: e.id === i?.id,
			trailing: /* @__PURE__ */ J("span", {
				className: "code code-micro text-basic-muted shrink-0",
				children: e.items.length
			}),
			onClick: () => n(e.id)
		}, e.id)),
		children: i ? /* @__PURE__ */ J(Qy, { workset: i }) : /* @__PURE__ */ J(Hg, { children: "No worksets defined for this session." })
	});
}
//#endregion
//#region src/app/hooks/useSessionFetching.ts
var eb = 150, tb = 500;
function nb(e) {
	let t = ri({ queryKey: Mt.sessionRoot(e) }) > 0, [n, r] = K(!1), i = G(0);
	return U(() => {
		if (t) {
			if (n) return;
			let e = window.setTimeout(() => {
				i.current = Date.now(), r(!0);
			}, eb);
			return () => clearTimeout(e);
		}
		if (!n) return;
		let e = tb - (Date.now() - i.current), a = window.setTimeout(() => r(!1), Math.max(0, e));
		return () => clearTimeout(a);
	}, [t, n]), n;
}
//#endregion
//#region src/app/components/inspector/SessionSideBox.tsx
function rb({ sessionId: e }) {
	let t = nb(e);
	return /* @__PURE__ */ J(uc, {
		active: t,
		className: "absolute bottom-[-1px] left-0 right-0 z-[1]"
	});
}
function ib({ sessionId: e, snapshot: t, behavior: n, panel: r, onPanelChange: i }) {
	let { useSidePanelExpanded: a, useSelectedWorkset: o, useSelectedThread: c, useSelectedRevision: l, toggleSidePanelExpanded: u, toggleSidePanelCollapsed: p, showSidePanelList: m, selectWorkset: h, selectThread: g, selectRevision: _ } = P().stores.sessionLayoutStore, v = a(), y = jr(), b = c(), x = o(), S = l(), C = n === void 0 ? t?.metadata.behavior ?? "orchestrator" : n, w = C === "direct" || C === "direct-with-orchestrator", T = C == null ? null : Vl(C, t?.lineage?.kind), E = T?.readOnly ?? !1, D = T?.widePanels ?? [], ee = se(), O = D.includes("delegated"), k = F(e, O), A = f(e, O && C === "direct-with-orchestrator"), te = (k.data?.length ?? 0) + (ee.orchestrationEnabled ? A.data?.length ?? 0 : 0), j = T == null ? null : D.includes(r) || y && T.mobilePanels.includes(r) ? r : T.defaultPanel, ne = /* @__PURE__ */ Y(q, { children: [
		j === "files" ? /* @__PURE__ */ J(g_, {
			sessionId: e,
			snapshot: t,
			revision: S,
			readOnly: E
		}) : null,
		j === "delegated" && w && !E ? /* @__PURE__ */ J(my, {
			sessionId: e,
			behavior: C
		}) : null,
		j === "terminal" && w && !E ? /* @__PURE__ */ J(Ng, { sessionId: e }) : null,
		j === "worksets" ? /* @__PURE__ */ J($y, {
			snapshot: t,
			selected: x,
			onSelect: h
		}) : null,
		j === "threads" ? /* @__PURE__ */ J(qy, {
			snapshot: t,
			selected: b,
			onSelect: g,
			canSteerWorkers: C === "orchestrator" && !E
		}) : null,
		j === "history" ? /* @__PURE__ */ J(yy, {
			sessionId: e,
			selected: S,
			onSelect: _
		}) : null
	] });
	return y ? /* @__PURE__ */ J("div", {
		className: "flex flex-col flex-1 min-h-0",
		children: ne
	}) : /* @__PURE__ */ Y("div", {
		className: d("flex flex-col min-h-0 h-full overflow-hidden bg-elevation-level-1", v ? null : "border-l border-muted"),
		children: [/* @__PURE__ */ Y("div", {
			className: d("flex items-center gap-4 pl-3 pr-2 py-2 shrink-0 bg-elevation-level-1 relative border-b border-muted", v ? "pr-10" : null),
			children: [
				/* @__PURE__ */ J(rb, { sessionId: e }),
				/* @__PURE__ */ J("div", {
					className: "flex flex-1 min-w-0 items-center gap-3",
					role: "tablist",
					children: D.map((e) => {
						let n = j === e, r = Qh(e, te, t?.worksets?.items.length ?? 0);
						return /* @__PURE__ */ Y("span", {
							className: "relative shrink-0",
							children: [/* @__PURE__ */ Y("button", {
								type: "button",
								role: "tab",
								"aria-selected": n,
								"aria-label": lr[e],
								className: d("btn btn-medium btn-icon-left !rounded-full", n ? "btn-secondary-highlighted" : "btn-ghost"),
								onClick: () => {
									m(!1), i(e);
								},
								children: [/* @__PURE__ */ J(z, { iconName: Zh[e] }), lr[e]]
							}), r > 0 ? /* @__PURE__ */ J(Xh, { count: r }) : null]
						}, e);
					})
				}),
				v ? null : /* @__PURE__ */ Y("div", {
					className: "flex items-center gap-2 pb-[2px] shrink-0",
					children: [/* @__PURE__ */ J(Ln, {
						title: "Expand panel",
						position: s.BottomLeft,
						children: /* @__PURE__ */ J(B, {
							size: L.Medium,
							variant: R.Ghost,
							content: I.Icon,
							"aria-label": "Expand panel",
							onClick: u,
							children: /* @__PURE__ */ J(z, { iconName: V.FullScreen })
						})
					}), /* @__PURE__ */ J(Ln, {
						title: "Hide panel",
						position: s.BottomLeft,
						children: /* @__PURE__ */ J(B, {
							size: L.Medium,
							variant: R.Ghost,
							content: I.Icon,
							"aria-label": "Hide panel",
							onClick: p,
							children: /* @__PURE__ */ J(z, { iconName: V.SidebarChevronRight })
						})
					})]
				})
			]
		}), /* @__PURE__ */ J("div", {
			className: "flex-1 min-h-0 flex flex-col",
			children: ne
		})]
	});
}
//#endregion
//#region src/app/components/inspector/InitialPrompts.tsx
var ab = [
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
function ob() {
	let { sendPrompt: e } = P().stores.composerStore;
	return /* @__PURE__ */ Y("div", {
		className: "flex flex-1 flex-col justify-center gap-2",
		children: [/* @__PURE__ */ J("p", {
			className: "text-[10px] leading-[12px] font-medium uppercase text-input-placeholder",
			children: "Get started"
		}), /* @__PURE__ */ J("div", {
			className: "grid gap-2 grid-cols-[repeat(auto-fill,minmax(min(360px,100%),1fr))]",
			children: ab.map((t) => /* @__PURE__ */ J(qs, {
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
function sb(e, t) {
	let n = t != null && iu(t, e).fix?.kind === "login", r = e ? Yt(e) : null, i = Pn(n && r !== null), a = i.data?.providers.find((e) => e.provider === r), o = a?.backend ?? null, s = !!a?.signed_in, c = wt(o, n && s), l = oi();
	U(() => {
		!n || o === null || l.invalidateQueries({ queryKey: Mt.managedProviderModels(o) });
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
function cb(e, t) {
	let n = Hf(), { start: r } = Ru(), i = t ? Yt(t) : null;
	return H((a, o) => {
		let { title: s, description: c, fix: l } = iu(a, t);
		return {
			title: s,
			description: c,
			action: lb(l, {
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
function lb(e, t) {
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
function ub({ open: e, onClose: t, sessionId: n, messageIdx: r, prompt: i }) {
	let a = hn(), o = fr();
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: t,
		title: "Revert to this snapshot",
		size: Mn.Small,
		footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(B, {
			variant: R.Ghost,
			size: L.Large,
			content: I.Text,
			onClick: t,
			disabled: o.isPending,
			children: "Cancel"
		}), /* @__PURE__ */ J(B, {
			variant: R.SecondaryDestructive,
			size: L.Large,
			content: I.Text,
			onClick: async () => {
				if (!(r == null || o.isPending)) try {
					let e = await o.mutateAsync({
						id: n,
						messageIdx: r
					});
					a.success(e.workspace_restored ? "Reverted to this snapshot" : "Transcript reverted; no workspace snapshot covered this point"), t();
				} catch (e) {
					a.error(`Failed to revert: ${ir($(e))}`);
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
function db(e, t, n) {
	return e.recovery_action === "resume_goal" ? t?.status === "blocked" ? "resume_goal" : null : e.recovery_action === "settings" ? "settings" : e.recovery_action === "regenerate_with_rewind" && n ? "regenerate" : null;
}
//#endregion
//#region src/app/components/inspector/Transcript.tsx
function fb({ warning: e }) {
	return e ? /* @__PURE__ */ J(Pi, {
		role: "status",
		variant: Ai.Info,
		title: "Session recovered",
		children: e
	}) : null;
}
function pb({ failure: e, goal: t, action: n }) {
	let r = e.recovery_action === "automatic_retry" && t?.status === "active", i = e.recovery_action === "resume_goal" && t?.status === "blocked", a = e.kind === "capacity", o = !!(e.partial_output?.text || e.partial_output?.reasoning || e.partial_output?.tool_call), s = a ? e.summary : r ? "Goal retry scheduled" : i ? "Goal stopped after repeated run failures" : o ? "Run stopped after a partial response" : e.summary, c = t?.next_attempt_at_epoch_ms ? new Date(t.next_attempt_at_epoch_ms).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
		second: "2-digit"
	}) : null, l = a ? "" : `${e.summary} `, u = r ? `${l}The durable goal and its usage were preserved. NAC will continue automatically${c ? ` at ${c}` : ""}.` : i ? `${l}The durable goal and its usage were preserved. Resume it when you want another bounded retry sequence.` : a ? `Retrying later may be necessary.${mb(e.retry_after_ms)}` : e.summary;
	return /* @__PURE__ */ Y(Pi, {
		role: r ? "status" : "alert",
		variant: r ? Ai.Info : Ai.Danger,
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
function mb(e) {
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
function hb(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		if (e[t]?.kind === "delegated-completion") return null;
		if (e[t]?.kind === "user") return t;
	}
	return null;
}
function gb(e) {
	for (let t = e.length - 1; t >= 0; --t) {
		let n = e[t];
		if (n.kind === "delegated-completion") return null;
		if (n.kind === "user") return n.text;
	}
	return null;
}
function _b({ sessionId: e, snapshot: t, panel: n, onFocusPanel: r, errorNotice: i = null }) {
	let { useStreamText: o, useStreamReasoning: s, useModelRetryAttempt: c, useRunning: l, useRunFailure: u, useRunError: f, useOptimisticUserPrompt: p, useLiveThreads: m, useCancelArmed: h, usePrimaryToolEvents: g, useFinishedToolCalls: _, useActivity: v, setOptimisticUserPrompt: y, pushLocalEvent: b } = P().stores.runtimeStore, { useSelectedWorkset: x, useSelectedThreadEpisode: S, useSelectedRevision: C, useSelectedFile: w, selectWorkset: T, selectThread: E, selectRevision: D, selectFile: ee } = P().stores.sessionLayoutStore, O = l(e), k = h(e), A = v(), te = f(), j = u(), ne = c(), re = m(), ie = _(), ae = g(), oe = o(), se = s(), le = p(), ue = S(), de = x(), M = w(), fe = C(), pe = hn(), N = Hf(), F = pi(), me = t?.metadata.backend ?? null, he = cb(e, me), ge = sb(me, te), _e = mn(), ve = Jn(), ye = cr(), be = Un(), xe = yn(e), { data: Se } = bt(e), Ce = t?.metadata.behavior === "direct" || t?.metadata.behavior === "direct-with-orchestrator", we = ce(e, Ce), Te = yt(), { data: Ee } = dt(e, Ce), De = W(() => new Set((Ee?.requests ?? []).map((e) => e.call_id).filter((e) => !!e)), [Ee?.requests]), { scrollRef: Oe, contentRef: ke, showJumpButton: Ae, jumpToLatest: je, followLatest: Me } = ey({ resetKey: e }), Ne = G(null), Pe = G(!1), Fe = G(!1), Ie = t?.message_page?.start ?? 0;
	$r(() => {
		let e = Ne.current, t = Oe.current;
		!e || !t || (t.scrollTop = e.top + (t.scrollHeight - e.height), Ne.current = null);
	}, [Ie, Oe]);
	let Le = H(() => {
		let e = Oe.current;
		e && (Ne.current = {
			height: e.scrollHeight,
			top: e.scrollTop
		}), xe.mutateAsync().then((e) => {
			e || (Ne.current = null);
		}).catch(() => {
			Ne.current = null;
		});
	}, [xe, Oe]);
	a("Transcript");
	let Re = W(() => xn("buildTranscript", () => Mv(t, re, ie, ae, De)), [
		t,
		re,
		ie,
		ae,
		De
	]), ze = O ? t?.active_run?.submitted_user_message : void 0, Be = ze ? yr(ze.content) : le ?? "", Ve = ze ? Tt(ze.content) : null, He = !!(Be && gb(Re) !== Be);
	$r(() => {
		Pe.current = !1, Fe.current = !1;
	}, [e]), U(() => {
		Fe.current = !0;
	}, [e]), $r(() => {
		let e = He && !Pe.current;
		Pe.current = He, e && Fe.current && Me(300);
	}, [He, Me]);
	let Ue = W(() => jv(Re, {
		text: oe,
		reasoning: se
	}, He), [
		Re,
		oe,
		se,
		He
	]), We = He && Ue[Ue.length - 1]?.key === "model-streaming";
	Tn("transcript:turns", {
		fields: {
			turns: Ue.length,
			streamChars: oe.length
		},
		throttleMs: 1e3
	});
	let Ge = W(() => hb(Ue), [Ue]), Ke = O || k || _e.isPending || ve.isPending || ye.isPending, [qe, Je] = K(null), Ye = ve.mutateAsync, Xe = H((t) => {
		Ke || (async () => {
			try {
				let n = await Ye({
					id: e,
					messageIdx: t
				});
				b("run", `▶ regenerated: ${n.display_prompt.slice(0, 80)}`);
			} catch (e) {
				b("error", `regeneration failed: ${ir($(e))}`, !0), pe.error(`Failed to regenerate: ${au($(e), me)}`);
			}
		})();
	}, [
		Ke,
		me,
		b,
		Ye,
		e,
		pe
	]), Ze = ye.mutateAsync, Qe = H((t) => {
		Ke || (async () => {
			try {
				let n = await Ze({
					id: e,
					messageIdx: t
				});
				F(vr.session(n.session_id));
			} catch (e) {
				pe.error(`Failed to create fork: ${au($(e), me)}`);
			}
		})();
	}, [
		Ke,
		me,
		Ze,
		F,
		e,
		pe
	]), $e = H((e) => {
		F(vr.session(e));
	}, [F]), et = be.mutate, tt = H((t) => {
		et({
			id: e,
			forkId: t
		}, { onError: (e) => {
			pe.error(`Failed to dismiss fork: ${au($(e), me)}`);
		} });
	}, [
		me,
		et,
		e,
		pe
	]), nt = H((e, t) => {
		Je({
			messageIdx: e,
			prompt: t
		});
	}, []), rt = jr(), it = t?.metadata.model ?? "", at = t?.lineage != null, ot = W(() => _y(Ue, Se), [Ue, Se]);
	U(() => {
		!He && le && y(null);
	}, [
		He,
		le,
		y
	]);
	let st = Ue[Ue.length - 1], ct = O && st?.kind === "model" && (!He || st.key === "model-streaming"), lt = (O || He) && !ct, ut = H((e, t) => {
		E(e, t), r("threads");
	}, [r, E]), ft = H((e) => {
		T(e), r("worksets");
	}, [r, T]), pt = H((e) => {
		D(e), r("files");
	}, [r, D]), mt = H((e, t) => {
		D(e), ee(t), r("files");
	}, [
		r,
		ee,
		D
	]), ht = W(() => ({
		sessionId: e,
		selectedFile: n === "files" ? M : null,
		selectedRevision: n === "files" ? fe : null,
		onOpenFile: mt,
		onOpenPanel: pt
	}), [
		e,
		n,
		M,
		fe,
		mt,
		pt
	]), gt = !!(t && Ue.length === 0 && !O && !He), _t = te && !O ? te : null, vt = O ? null : j ?? t?.run_failure ?? we.data?.last_failure ?? null, xt = [...Ue].reverse().find((e) => e.kind === "user"), St = vt ? db(vt, we.data, xt?.kind === "user") : null, Ct = vt ? St === "resume_goal" ? {
		label: "Resume goal",
		onClick: () => {
			let t = we.data;
			t && Te.mutateAsync({
				sessionId: e,
				goalId: t.goal_id,
				payload: {
					expected_version: t.version,
					status: "active"
				}
			}).catch((e) => pe.error(`Failed to resume goal: ${au($(e), me)}`));
		}
	} : St === "settings" ? {
		label: "Open settings",
		onClick: () => N.settings(e)
	} : St === "regenerate" && xt?.kind === "user" ? {
		label: "Regenerate from original prompt",
		onClick: () => Xe(xt.messageIndex)
	} : void 0 : void 0, wt = vt ? null : i ?? (_t && !ge ? he(_t) : null), Et = ry(e, !!t || i !== null), Dt = Et ? "opacity-100 transition-opacity duration-300 ease-in-out" : "opacity-0 transition-opacity duration-300 ease-in-out";
	return /* @__PURE__ */ Y("div", {
		className: "relative flex-1 min-h-0",
		children: [
			/* @__PURE__ */ J("div", {
				role: "status",
				"aria-label": Et ? void 0 : "Loading conversation",
				className: d("pointer-events-none absolute inset-x-0 top-[96px] px-4 transition-opacity duration-150 ease-in-out md:top-[72px] md:px-0", Et ? "opacity-0" : "opacity-100 delay-200"),
				children: /* @__PURE__ */ J("div", {
					className: "mx-auto w-full max-w-[720px]",
					children: /* @__PURE__ */ J(Ri, {
						rows: 3,
						rowClassName: "h-[48px]"
					})
				})
			}),
			gt ? /* @__PURE__ */ J("div", {
				className: d("absolute inset-x-0 top-[96px] flex overflow-auto px-4 md:top-[72px] md:px-0", rt ? "bottom-[128px]" : "bottom-[136px]", Dt),
				children: /* @__PURE__ */ J("div", {
					className: "m-auto w-full max-w-[720px]",
					children: /* @__PURE__ */ J(ob, {})
				})
			}) : null,
			/* @__PURE__ */ J("div", {
				ref: Oe,
				className: d("h-full overflow-auto", Dt, !Et && "invisible"),
				children: /* @__PURE__ */ Y("div", {
					ref: ke,
					className: d("flex flex-col pt-[96px] md:pt-[72px] [&>*]:shrink-0 px-4 md:px-0", rt ? "pb-[180px]" : "pb-[320px] mx-auto max-w-[720px]"),
					children: [
						t?.message_page?.has_older ? /* @__PURE__ */ Y("div", {
							className: "mb-4 flex flex-col items-start gap-2",
							children: [/* @__PURE__ */ J(B, {
								variant: R.Ghost,
								size: L.Small,
								content: I.Text,
								disabled: xe.isPending,
								onClick: Le,
								children: xe.isPending ? "Loading…" : "Load older"
							}), xe.isError ? /* @__PURE__ */ Y("div", {
								role: "alert",
								className: "flex items-center gap-2 text-basic-muted label-small",
								children: [/* @__PURE__ */ J("span", { children: "Couldn’t load older messages." }), /* @__PURE__ */ J(B, {
									variant: R.Ghost,
									size: L.Small,
									content: I.Text,
									onClick: Le,
									children: "Try again"
								})]
							}) : null]
						}) : null,
						/* @__PURE__ */ J(pr, {
							id: "turns",
							children: Ue.map((e, r) => {
								if (e.kind === "delegated-completion") return /* @__PURE__ */ J(Lv, { turn: e }, e.key);
								if (e.kind === "user") return /* @__PURE__ */ J(Iv, {
									text: e.text,
									invokedSkills: e.invokedSkills,
									timestamp: e.createdAt ? dn(e.createdAt) : null,
									messageIndex: e.messageIndex,
									actionsDisabled: Ke,
									readOnly: at,
									onRefresh: !at && Ge === r ? Xe : null,
									onRevert: at ? null : nt
								}, e.key);
								let i = null, a = null;
								for (let e = r - 1; e >= 0; --e) {
									let t = Ue[e];
									if (t?.kind === "delegated-completion") break;
									if (t?.kind === "user") {
										i = e, a = t;
										break;
									}
								}
								let o = r === Ue.length - 1 && !(He && e.key !== "model-streaming"), s = /* @__PURE__ */ J(Fv, {
									turn: e,
									model: it,
									active: O && o,
									isLast: o && !lt,
									activity: O && o ? A : void 0,
									selectedThreadEpisode: n === "threads" ? ue : null,
									selectedWorkset: n === "worksets" ? de : null,
									onSelectThread: ut,
									onSelectWorkset: ft,
									userMessageIndex: a?.messageIndex,
									userText: a?.text,
									actionsDisabled: Ke,
									readOnly: at,
									onRefresh: !at && i != null && Ge === i ? Xe : null,
									onRevert: at ? null : nt,
									onFork: at ? null : Qe,
									forks: at ? [] : (t?.forks ?? []).filter((t) => t.source_message_idx === e.messageIndex),
									onOpenFork: $e,
									onDismissFork: tt,
									snapshotRevision: e.messageIndex == null ? null : ot.get(e.messageIndex) ?? null,
									filesPanel: ht
								}, e.key);
								return We && e.key === "model-streaming" ? /* @__PURE__ */ Y(Kr, { children: [/* @__PURE__ */ J(Iv, {
									text: Be,
									invokedSkills: Ve,
									pending: !0
								}), s] }, e.key) : s;
							})
						}),
						He && !We ? /* @__PURE__ */ J(Iv, {
							text: Be,
							invokedSkills: Ve,
							pending: !0
						}) : null,
						lt ? /* @__PURE__ */ J(Fv, {
							turn: {
								kind: "model",
								key: "model-pending",
								blocks: [],
								durationMs: null,
								messageIndex: null
							},
							model: it,
							active: !0,
							isLast: !0,
							selectedThreadEpisode: n === "threads" ? ue : null,
							selectedWorkset: n === "worksets" ? de : null,
							onSelectThread: ut,
							onSelectWorkset: ft
						}) : null,
						wt ? /* @__PURE__ */ J(Pi, {
							role: "alert",
							variant: Ai.Error,
							title: wt.title,
							action: wt.action,
							children: wt.description
						}) : null,
						O && ne ? /* @__PURE__ */ J(Pi, {
							role: "status",
							variant: Ai.Info,
							title: `Connection interrupted; retrying model response (attempt ${ne})`,
							children: "The abandoned partial stream was cleared before this attempt began."
						}) : null,
						vt ? /* @__PURE__ */ J(pb, {
							failure: vt,
							goal: we.data,
							action: Ct
						}) : null,
						/* @__PURE__ */ J(fb, { warning: t?.transcript_recovery_warning })
					]
				})
			}),
			/* @__PURE__ */ J("div", {
				className: `absolute z-[2] left-1/2 bottom-0 -translate-x-1/2 rounded-full  transition-all duration-150 ease-out ${Ae ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-75 opacity-0 pointer-events-none"}`,
				children: /* @__PURE__ */ Y(B, {
					variant: R.Primary,
					size: L.Small,
					content: I.IconRight,
					className: "!rounded-b-none !shadow-3xl",
					onClick: je,
					children: ["Last messages", /* @__PURE__ */ J(z, { iconName: V.Down })]
				})
			}),
			/* @__PURE__ */ J(ub, {
				open: qe !== null,
				onClose: () => Je(null),
				sessionId: e,
				messageIdx: qe?.messageIdx ?? null,
				prompt: qe?.prompt ?? ""
			})
		]
	});
}
//#endregion
//#region src/app/features/direct-session/RunDetails.tsx
function vb({ context: e, input: t, output: n, cost: r, elapsed: i }) {
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
function yb({ title: e, subtitle: t, trailing: n, selected: r, onClick: i }) {
	return /* @__PURE__ */ Y("button", {
		type: "button",
		className: "flex items-start gap-2 w-full p-1 rounded-[4px] text-left btn-ghost",
		onClick: i,
		children: [
			/* @__PURE__ */ J(z, {
				iconName: r ? V.Check : V.History,
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
function bb({ sessionId: e, selected: t, onSelect: n, placement: r = s.TopRight }) {
	let [i, a] = K(!1), { data: o, isLoading: c, error: l } = bt(e), u = o ?? [], f = (e) => gy(e, u.length), p = u.findIndex((e) => e.id === t), m = p >= 0 ? hy(f(p)) : "Working tree", h = (e) => {
		n(e), a(!1);
	};
	return /* @__PURE__ */ J(pn, {
		open: i,
		onClose: () => a(!1),
		placement: r,
		className: "min-w-0",
		content: /* @__PURE__ */ Y(q, { children: [
			/* @__PURE__ */ J(yb, {
				title: "Working tree",
				subtitle: "The files as they are right now",
				selected: t == null,
				onClick: () => h(null)
			}),
			c ? /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 p-1 label-micro text-basic-muted",
				children: [/* @__PURE__ */ J(A, {
					size: M.Small,
					variant: be.Neutral
				}), "Reading snapshots…"]
			}) : null,
			l ? /* @__PURE__ */ J("div", {
				className: "p-1 label-micro text-error-primary",
				children: ir(l)
			}) : null,
			!c && !l ? /* @__PURE__ */ Y("div", {
				className: "flex flex-col gap-1 max-h-[280px] overflow-auto [&>*]:shrink-0",
				children: [u.map((e, n) => /* @__PURE__ */ J(xb, {
					revision: e,
					ordinal: f(n),
					selected: e.id === t,
					onClick: () => h(e.id)
				}, e.id)), u.length === 0 ? /* @__PURE__ */ J("div", {
					className: "p-1 label-micro text-basic-muted",
					children: "No snapshots yet. One is taken every time a run finishes."
				}) : null]
			}) : null
		] }),
		children: /* @__PURE__ */ Y("button", {
			type: "button",
			className: d("flex items-center gap-[6px] min-w-0 pl-1 pr-3 py-1 rounded-[4px] btn-ghost", t != null && "text-info-primary"),
			"aria-expanded": i,
			"aria-label": `Snapshot: ${m}`,
			onClick: () => a(!i),
			children: [/* @__PURE__ */ J(z, {
				iconName: V.History,
				size: 16,
				className: "shrink-0"
			}), /* @__PURE__ */ J("span", {
				className: "label-micro text-btn-secondary truncate max-w-[64px] xl:max-w-[128px]",
				children: m
			})]
		})
	});
}
function xb({ revision: e, ordinal: t, selected: n, onClick: r }) {
	let i = e.label.trim();
	return /* @__PURE__ */ J(yb, {
		title: `${hy(t)} · ${dn(e.created_at)}`,
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
var Sb = {
	direct: "Agent",
	"direct-with-orchestrator": "Agent + NAC",
	orchestrator: "Orchestrator"
};
function Cb(e, t) {
	let n = t.contextWindow;
	return !n || e == null ? "Context tokens" : t.estimated ? `Context against ${t.provider?.id ?? "the provider"}'s default window — the catalog does not know this model, so the limit is an estimate` : `Context — ${Math.round(e / n * 100)}% of the model's context window`;
}
function wb({ iconName: e, value: t, title: n, className: r, labelClassName: i }) {
	return /* @__PURE__ */ J(Ln, {
		title: n,
		position: s.BottomCenter,
		children: /* @__PURE__ */ Y("div", {
			className: d("flex items-center gap-0.5 whitespace-nowrap", r),
			children: [/* @__PURE__ */ J(z, {
				iconName: e,
				size: 14
			}), /* @__PURE__ */ J("span", {
				className: i,
				children: t
			})]
		})
	});
}
function Tb({ sessionId: e, snapshot: t, entry: n, onShowPanel: r }) {
	let { useSessionSpend: i, useRunning: a, useRunUsage: o, useRunStartedAt: c, useLastElapsedMs: l, useCancelArmed: u, liftSessionSpend: f } = P().stores.runtimeStore, { useSelectedRevision: p, selectRevision: m } = P().stores.sessionLayoutStore, h = pi(), g = hl(), { data: _ = [] } = Rt(), v = a(e), y = u(e), b = o(), x = i();
	U(() => {
		f(Xe(t));
	}, [f, t]);
	let S = Pr(t, n, v || y ? b : null, x), C = Zn(), w = Xe(t), T = S.usage?.total_tokens || w?.total_tokens || null, E = Cb(T, xu(C.data, t?.metadata?.backend, S.model)), D = gn(1e3, v), ee = c(), O = l(), k = (v && ee != null ? Math.max(0, D - ee) : null) ?? O ?? S.lastResponseMs, A = p(), te = ft(e, A), j = t?.workspace ?? null, ne = A == null ? j : te.data ?? {
		total_additions: 0,
		total_deletions: 0
	}, re = ne?.total_additions ?? 0, ie = ne?.total_deletions ?? 0, ae = j?.repo_label ?? j?.workspace_display ?? null, oe = j?.branch ?? null, ce = n?.lineage ?? t?.lineage ?? null, le = ce != null, ue = ce?.kind === "traditional-child" ? "Traditional coding agent" : ce?.kind === "managed-orchestrator" ? "Managed NAC orchestrator" : null, de = ce ? _.find((e) => e.summary.session_id === ce.parent_session_id) : void 0, M = de ? g(de.summary) : "Parent session", fe = () => {
		ce && h(vr.session(ce.parent_session_id, "delegated"));
	}, pe = se(), N = n?.summary.behavior ?? t?.metadata.behavior ?? null, F = g(n?.summary);
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
								/* @__PURE__ */ J(B, {
									size: L.Large,
									variant: R.Ghost,
									content: I.Icon,
									className: "!h-6 !w-6 !min-h-0 !p-0",
									"aria-label": "Parent chat",
									onClick: fe,
									children: /* @__PURE__ */ J(z, { iconName: V.Left })
								}),
								/* @__PURE__ */ J("button", {
									type: "button",
									className: "label-medium max-w-[120px] truncate text-btn-secondary",
									title: M,
									onClick: fe,
									children: M
								}),
								/* @__PURE__ */ J(z, {
									iconName: V.Right,
									size: 16,
									className: "shrink-0 text-btn-secondary"
								})
							] }) : null,
							/* @__PURE__ */ J("p", {
								className: d("header-md min-w-0 truncate", v ? "text-shimmer-basic" : "text-basic-primary"),
								children: F
							}),
							ue ? /* @__PURE__ */ J("span", {
								className: "tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-1 py-[2px] text-basic-tertiary",
								children: ue
							}) : N && pe.orchestrationEnabled ? /* @__PURE__ */ J("span", {
								className: "tag-label inline-flex shrink-0 items-center rounded-full border border-tertiary bg-elevation-sublevel-variant-B px-1 py-[2px] text-basic-tertiary",
								children: Sb[N]
							}) : null
						]
					}),
					N === "direct" || N === "direct-with-orchestrator" ? /* @__PURE__ */ J(vb, {
						context: on(T),
						input: on(S.usage?.input_tokens),
						output: on(S.usage?.output_tokens),
						cost: en(S.usage?.cost?.total),
						elapsed: Gt(k)
					}) : /* @__PURE__ */ Y(q, { children: [S.usage || T ? /* @__PURE__ */ Y("div", {
						className: "shrink-0 items-center gap-0.5 hidden xl:flex",
						children: [/* @__PURE__ */ J(wb, {
							iconName: V.Timelaps,
							value: on(T),
							title: E,
							className: "text-info-primary",
							labelClassName: "label-micro"
						}), S.usage ? /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(wb, {
							iconName: V.ArrowTop,
							value: on(S.usage.input_tokens),
							title: "Input tokens",
							className: "text-info-secondary opacity-75",
							labelClassName: "text-micro"
						}), /* @__PURE__ */ J(wb, {
							iconName: V.ArrowDown,
							value: on(S.usage.output_tokens),
							title: "Output tokens",
							className: "text-info-secondary opacity-75",
							labelClassName: "text-micro"
						})] }) : null]
					}) : null, /* @__PURE__ */ Y("div", {
						className: "flex shrink-0 items-center",
						children: [S.usage ? /* @__PURE__ */ J(Ln, {
							title: "Session cost",
							position: s.BottomCenter,
							children: /* @__PURE__ */ J("span", {
								className: "text-micro whitespace-nowrap text-basic-primary",
								children: en(S.usage.cost?.total)
							})
						}) : null, /* @__PURE__ */ J(Ln, {
							title: v ? "Run elapsed" : "Last response time",
							position: s.BottomRight,
							children: /* @__PURE__ */ J("span", {
								className: "label-micro flex h-6 w-14 items-center justify-end text-basic-tertiary",
								children: Gt(k)
							})
						})]
					})] }),
					r ? /* @__PURE__ */ J(Ln, {
						title: "Show panel",
						position: s.BottomLeft,
						children: /* @__PURE__ */ J(B, {
							size: L.Medium,
							variant: R.Ghost,
							content: I.Icon,
							"aria-label": "Show panel",
							onClick: r,
							children: /* @__PURE__ */ J(z, { iconName: V.SidebarChevronLeft })
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
							ae ? /* @__PURE__ */ Y("div", {
								className: "flex shrink-0 items-center gap-0.5",
								children: [/* @__PURE__ */ J("span", {
									className: "label-micro max-w-[120px] truncate text-basic-tertiary",
									children: ae
								}), /* @__PURE__ */ J("span", {
									className: "tag-label text-basic-muted",
									children: Ge(n?.summary)
								})]
							}) : null,
							oe && !le ? /* @__PURE__ */ J(Rm, {
								sessionId: e,
								branch: oe,
								placement: s.BottomRight
							}) : null,
							oe && le ? /* @__PURE__ */ Y("span", {
								className: "label-micro flex min-w-0 items-center gap-1.5 text-btn-secondary",
								children: [/* @__PURE__ */ J(z, {
									iconName: V.Scheme,
									size: 16,
									className: "shrink-0"
								}), /* @__PURE__ */ J("span", {
									className: "truncate",
									children: oe
								})]
							}) : null
						]
					}),
					/* @__PURE__ */ J(bb, {
						sessionId: e,
						selected: A,
						onSelect: m,
						placement: s.BottomLeft
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
function Eb(e, t) {
	let { useSshConnectionStatus: n, sshTargetKey: r, sshTargetFromSummary: i, markSshDisconnected: a, markSshConnected: o } = P().stores.sshConnectionStore, s = W(() => i(t), [i, t]), c = n(s), l = Fr(), u = G(null);
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
function Db() {
	let { useSidePanelExpanded: e, useSidePanelCollapsed: t, useSidePanelAnimate: n, useSelectedWorkset: r, useSelectedThreadRunning: i, useSelectedThread: o, useSelectedRevision: s, useSelectedFile: c, toggleSidePanelList: l, toggleSidePanelExpanded: u, toggleSidePanelCollapsed: f, showSidePanelList: p, revealSidePanel: m, setSidePanelAnimate: h, resetSessionSelection: g, unbindSidePanelProject: _, bindSidePanelProject: v } = P().stores.sessionLayoutStore, { clearAttention: y } = P().stores.attentionStore, { sessionId: b, panel: x } = mi(), S = pi(), C = b ?? null, w = se(), T = Of();
	a("SessionPage");
	let { data: E = null, error: D, refetch: ee } = Nn(C), { data: O = null } = Sr(C), k = cb(C, O?.summary.backend), A = t(), te = n(), j = e(), ne = o(), ie = i(), ae = r(), oe = c(), ce = s(), le = jr(), ue = O != null || E != null, de = ue ? O?.summary.behavior ?? E?.metadata.behavior ?? "orchestrator" : null, M = !ue || re(w, de, O?.lineage ?? E?.lineage);
	mh(M ? C : null), gh(M ? E?.active_run : null), Eb(M ? C : null, M ? O?.summary : null);
	let fe = de == null ? null : Vl(de, E?.lineage?.kind), pe = fe?.mobilePanels ?? [], N = zt(x) ? x : kt, F = fe == null || fe.mobilePanels.includes(N) ? N : fe.defaultPanel;
	U(() => {
		!C || !E || !zt(x) || x === F || S(vr.session(C, F), { replace: !0 });
	}, [
		F,
		C,
		S,
		x,
		E
	]);
	let me = ft(C, le && F === "files" ? ce : null);
	U(() => {
		C && y(C), g();
	}, [
		y,
		C,
		g
	]);
	let he = O ? O.summary.project_id ?? "" : null;
	if ($r(() => {
		_(), he != null && v(he);
	}, [
		v,
		C,
		he,
		_
	]), U(() => {
		if (te) return;
		let e = requestAnimationFrame(() => h(!0));
		return () => cancelAnimationFrame(e);
	}, [te, h]), ue && !M) return /* @__PURE__ */ Y("div", {
		className: "flex flex-1 flex-col items-center justify-center gap-4 p-8",
		children: [
			/* @__PURE__ */ J("h1", {
				className: "heading-small",
				children: "This chat is unavailable in direct-only mode"
			}),
			/* @__PURE__ */ J("p", { children: "Its saved behavior and history are preserved. An operator can enable orchestration to open it." }),
			/* @__PURE__ */ J(B, {
				onClick: () => {
					let e = O?.summary.project_id ?? E?.metadata.project_id;
					e ? T.newChat(e) : T.create();
				},
				children: "New direct chat"
			})
		]
	});
	if (!C) return /* @__PURE__ */ J(ci, {
		to: vr.list(),
		replace: !0
	});
	if (!zt(x)) return /* @__PURE__ */ J(ci, {
		to: vr.session(C, kt),
		replace: !0
	});
	let ge = O?.summary.model_config_error ?? (!E && D ? D : null), _e = ge ? k(ge, () => void ee()) : null, ve = (e) => S(vr.session(C, e)), ye = (e) => {
		m(le), ve(e);
	}, be = ce == null ? E?.workspace?.changed_files ?? [] : me.data?.changed_files ?? [], xe = oe ?? be[0]?.path ?? null, Se = xe ? be.find((e) => e.path === xe) : void 0, Ce = Se && (Se.additions || Se.deletions) ? /* @__PURE__ */ Y("div", {
		className: "flex items-center gap-2 shrink-0 code code-small",
		children: [/* @__PURE__ */ Y("span", {
			className: "text-success-primary",
			children: ["+", Se.additions ?? 0]
		}), /* @__PURE__ */ Y("span", {
			className: "text-error-primary",
			children: ["-", Se.deletions ?? 0]
		})]
	}) : null, we = ne, Te = F === "threads" && ie, Ee = /* @__PURE__ */ J(ib, {
		sessionId: C,
		snapshot: E,
		behavior: de,
		panel: F,
		onPanelChange: ve
	});
	return /* @__PURE__ */ Y("section", {
		className: "relative flex min-h-0 min-w-0 flex-1 h-full overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ Y("div", {
			className: "relative flex flex-1 min-w-0 h-full min-h-0",
			children: [/* @__PURE__ */ J("div", {
				className: d("flex flex-col items-center flex-1 min-w-0 h-full", le ? "px-0" : "px-2"),
				children: /* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-h-0 w-full relative",
					children: [
						le && (O?.lineage ?? E?.lineage) ? /* @__PURE__ */ J("div", {
							className: "pointer-events-none absolute inset-x-0 top-16 z-20 flex items-center px-3 pt-2",
							children: /* @__PURE__ */ J(B, {
								className: "pointer-events-auto relative",
								size: L.Small,
								variant: R.Ghost,
								onClick: () => {
									let e = (O?.lineage ?? E?.lineage)?.parent_session_id;
									e && S(vr.session(e, "delegated"));
								},
								children: "Parent chat"
							})
						}) : null,
						le ? null : /* @__PURE__ */ J(Tb, {
							sessionId: C,
							snapshot: E,
							entry: O
						}),
						/* @__PURE__ */ J(_b, {
							sessionId: C,
							snapshot: E,
							panel: F,
							onFocusPanel: ye,
							errorNotice: _e
						}),
						/* @__PURE__ */ J("div", {
							className: d("absolute bottom-0 left-0 right-0", le ? "-mx-2" : "pb-2 mx-auto max-w-[720px]"),
							children: /* @__PURE__ */ J(qh, {
								sessionId: C,
								snapshot: E,
								entry: O
							})
						})
					]
				})
			}), le ? null : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J("div", {
				className: d("relative h-full shrink-0", te && "transition-[width] duration-500 ease-in-out", A ? "w-[52px]" : "w-1/2"),
				style: te ? void 0 : { transition: "none" },
				children: A ? /* @__PURE__ */ J("div", {
					className: "absolute inset-y-0 right-0 w-[52px]",
					children: /* @__PURE__ */ J($h, {
						sessionId: C,
						snapshot: E,
						behavior: de,
						panels: fe?.widePanels ?? [],
						onOpen: f,
						onSelect: ye
					})
				}) : null
			}), /* @__PURE__ */ J("div", {
				className: d("absolute inset-y-0 right-0 z-[1] flex flex-col min-w-0 w-1/2", te && "transition-transform duration-500 ease-in-out", A && "translate-x-full"),
				style: te ? void 0 : { transition: "none" },
				"aria-hidden": A,
				inert: A,
				children: /* @__PURE__ */ J("div", {
					className: "flex flex-col flex-1 min-h-0",
					children: /* @__PURE__ */ J("div", {
						className: "flex-1 min-h-0",
						children: j ? null : Ee
					})
				})
			})] })]
		}), le ? /* @__PURE__ */ Y(Ht, {
			open: j,
			onClose: u,
			keepOnNavigate: !0,
			title: /* @__PURE__ */ Y("div", {
				className: "flex items-center gap-2 min-w-0",
				children: [/* @__PURE__ */ Y("div", {
					className: "flex flex-col flex-1 min-w-0 justify-center",
					children: [/* @__PURE__ */ J("div", {
						className: "min-w-0 truncate",
						children: /* @__PURE__ */ J("span", {
							className: d("header-small", Te ? "text-shimmer-basic" : "text-basic-primary"),
							children: F === "threads" ? we ?? lr.threads : F === "worksets" ? ae ?? E?.worksets.items[0]?.id ?? lr.worksets : F === "files" ? oe?.split("/").pop() ?? E?.workspace?.changed_files?.[0]?.path.split("/").pop() ?? lr.files : lr[F]
						})
					}), F === "files" ? Ce : null]
				}), E?.workspace?.branch && !E.lineage ? /* @__PURE__ */ J(Rm, {
					sessionId: C,
					branch: E.workspace.branch
				}) : null]
			}),
			headerActions: F === "history" ? null : /* @__PURE__ */ J(B, {
				size: L.Large,
				variant: R.Ghost,
				content: I.Icon,
				"aria-label": "Open list",
				onClick: l,
				children: /* @__PURE__ */ J(z, {
					iconName: V.List,
					size: 24
				})
			}),
			bodyClassName: "!p-0 relative flex flex-col overflow-hidden",
			children: [/* @__PURE__ */ J("div", {
				className: "flex flex-col flex-1 min-h-0",
				children: Ee
			}), pe.length > 0 ? /* @__PURE__ */ J(Yh, {
				panel: F,
				panels: pe,
				onPanelChange: (e) => {
					p(!1), ve(e);
				}
			}) : null]
		}) : /* @__PURE__ */ J(Ht, {
			open: j,
			onClose: u,
			fullScreen: !0,
			chromeless: !0,
			keepOnNavigate: !0,
			children: /* @__PURE__ */ J("div", {
				className: "flex flex-col flex-1 min-h-0",
				children: Ee
			})
		})]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedGitHubPanel.tsx
function Ob({ onConnected: e }) {
	let { api: t } = P(), n = hn(), r = oi(), i = un(), [a, o] = K(null), [s, c] = K(""), [l, u] = K(!1);
	U(() => {
		if (!a) return;
		let i = !1, s = new AbortController();
		return (async () => {
			for (; !i;) {
				try {
					let i = await t.pollManagedGitHubLogin(a.login_id, s.signal);
					if (i.state === "complete") {
						r.setQueryData($t.github, i.auth), o(null), c(""), Promise.all([r.invalidateQueries({ queryKey: $t.github }), r.invalidateQueries({ queryKey: $t.hostStatus })]), n.success("GitHub connected"), e?.();
						return;
					}
					if (i.state === "failed") {
						c(i.error), o(null);
						return;
					}
				} catch (e) {
					s.signal.aborted || c(au($(e)));
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
			c(au($(e)));
		} finally {
			u(!1);
		}
	}, f = async () => {
		u(!0);
		try {
			await t.disconnectManagedGitHub(), await Promise.all([r.invalidateQueries({ queryKey: $t.github }), r.invalidateQueries({ queryKey: $t.hostStatus })]), n.success("GitHub disconnected");
		} catch (e) {
			n.error(`Disconnect failed: ${ir($(e))}`);
		} finally {
			u(!1);
		}
	};
	return i.isLoading ? /* @__PURE__ */ J(A, { size: M.Medium }) : /* @__PURE__ */ Y("div", {
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
						}) : /* @__PURE__ */ J(z, { iconName: V.Github }),
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
							children: [/* @__PURE__ */ J(z, {
								iconName: V.CheckCircle,
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
						}), /* @__PURE__ */ J(Qn, {
							value: a.user_code,
							title: "Copy device code"
						})]
					}),
					/* @__PURE__ */ Y("div", {
						className: "mt-3 flex flex-wrap gap-2",
						children: [/* @__PURE__ */ Y(B, {
							variant: R.Primary,
							content: I.IconRight,
							onClick: () => window.open(a.verification_uri, "_blank", "noopener"),
							children: ["Open GitHub ", /* @__PURE__ */ J(z, { iconName: V.External })]
						}), /* @__PURE__ */ J(B, {
							variant: R.Tertiary,
							content: I.Text,
							onClick: () => {
								t.cancelManagedGitHubLogin(a.login_id), o(null);
							},
							children: "Cancel"
						})]
					})
				]
			}) : null,
			s ? /* @__PURE__ */ J("p", {
				className: "text-small text-error-primary",
				children: s
			}) : null,
			a ? null : /* @__PURE__ */ Y("div", {
				className: "flex gap-2",
				children: [/* @__PURE__ */ J(B, {
					variant: R.Primary,
					content: I.Text,
					onClick: () => void d(),
					loading: l,
					children: i.data?.connected ? "Reconnect GitHub" : "Connect GitHub"
				}), i.data?.connected ? /* @__PURE__ */ J(B, {
					variant: R.SecondaryDestructive,
					content: I.Text,
					onClick: () => void f(),
					disabled: l,
					children: "Disconnect"
				}) : null]
			})
		]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedSecretsPanel.tsx
function kb() {
	let e = Cr(), t = Pt(), n = Yn(), r = hn(), [i, a] = K(""), [o, s] = K(""), [c, l] = K(!1), u = W(() => c ? Ne(i) : "", [c, i]), d = async () => {
		if (l(!0), !(Ne(i) || o.length === 0)) try {
			await t.mutateAsync({
				name: i,
				value: o
			}), a(""), s(""), l(!1), r.success("Secret saved for future command spawns");
		} catch (e) {
			r.error(`Secret was not saved: ${ir($(e))}`);
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
						a(e.target.value), l(!1);
					},
					validation: !!u,
					validationText: u,
					autoCapitalize: "none",
					spellCheck: !1
				}), /* @__PURE__ */ J(Z, {
					inputSize: X.Large,
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
			/* @__PURE__ */ J("div", { children: /* @__PURE__ */ J(B, {
				variant: R.Primary,
				content: I.Text,
				onClick: () => void d(),
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
					e.isLoading ? /* @__PURE__ */ J(A, { size: M.Small }) : null,
					e.data?.secrets.length === 0 ? /* @__PURE__ */ J("p", {
						className: "text-small text-basic-tertiary",
						children: "No host secrets saved."
					}) : null,
					e.data?.secrets.map((e) => /* @__PURE__ */ Y("div", {
						className: "flex items-center gap-3 rounded-lg border border-basic p-3",
						children: [
							/* @__PURE__ */ J(z, { iconName: V.Key }),
							/* @__PURE__ */ J("code", {
								className: "min-w-0 flex-1 truncate text-basic-primary",
								children: e.name
							}),
							/* @__PURE__ */ J("span", {
								className: "text-small text-basic-muted",
								children: "value hidden"
							}),
							/* @__PURE__ */ J(B, {
								variant: R.Ghost,
								size: L.Small,
								content: I.Icon,
								"aria-label": `Delete ${e.name}`,
								onClick: async () => {
									try {
										await n.mutateAsync(e.name), r.success(`${e.name} removed from future command spawns`);
									} catch (e) {
										r.error(`Secret was not removed: ${ir($(e))}`);
									}
								},
								loading: n.isPending,
								children: /* @__PURE__ */ J(z, { iconName: V.Trash })
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
function Ab() {
	return `nac-upgrade-${globalThis.crypto.randomUUID()}`;
}
function jb(e) {
	if (!e) throw Error("managed upgrade action target is unavailable");
	return e;
}
async function Mb(e, t) {
	if (!t.actionable || t.action === "wait" || !t.target) throw Error("managed upgrade blocker is wait-only");
	let n = t.target;
	switch (t.action) {
		case "cancel_active_run": {
			let t = jb(n.session_id), r = jb(n.run_id);
			await e.cancelExactRun(t, r);
			return;
		}
		case "cancel_traditional_child":
			await e.cancelTraditionalChild(jb(n.session_id), jb(n.child_session_id));
			return;
		case "cancel_managed_orchestrator":
			await e.cancelManagedOrchestrator(jb(n.session_id), jb(n.orchestrator_session_id));
			return;
		case "terminate_terminal":
			await e.terminateTerminal(jb(n.session_id), jb(n.terminal_id));
			return;
		case "cancel_clone_operation":
			await e.cancelManagedClone(jb(n.clone_operation_id));
			return;
	}
}
function Nb(e, t, n) {
	if (!t) return !1;
	let r = t.target_release ?? t.desired_release;
	return !r || !i(r, n) ? !1 : !e || t.operation_id !== e.operation_id || t.state !== e.state || t.updated_at !== e.updated_at;
}
function Pb() {
	let { api: e } = P(), t = Rr(), n = We(), r = G(null), i = t.data?.operation?.operation_id ?? null, [a, o] = K(!1), [s, c] = K(""), [l, u] = K({}), d = G(i);
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
		let e = r.current ?? Ab(), i = t.data?.operation ?? null, a = t.data?.preview.latest_beta;
		r.current = e, c("");
		try {
			await n.mutateAsync(e), r.current = null, o(!1);
		} catch (e) {
			c(ke(e).message), Or(e) && (r.current = null, o(!1));
			let n = await t.refetch();
			!Or(e) && !n.error && a && Nb(i, n.data?.operation, a) && (r.current = null, c(""), o(!1));
		}
	}, [t, n]), h = H(async (n) => {
		u((e) => ({
			...e,
			[n.selection_key]: "requesting"
		}));
		try {
			await Mb(e, n), u((e) => ({
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
function Fb() {
	let e = Pb(), t = e.snapshot, n = wn(t.error);
	if (t.isLoading) return /* @__PURE__ */ Y("section", {
		"aria-labelledby": "managed-upgrade-heading",
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ J("h2", {
			id: "managed-upgrade-heading",
			className: "label-medium text-basic-primary",
			children: "Managed NAC upgrade"
		}), /* @__PURE__ */ J("div", {
			className: "mt-3",
			children: /* @__PURE__ */ J(A, { size: M.Small })
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
				e.retryLabel ? /* @__PURE__ */ J(B, {
					className: "mt-3",
					size: L.Small,
					variant: R.Secondary,
					content: I.Text,
					onClick: () => void t.refetch(),
					loading: t.isFetching,
					children: e.retryLabel
				}) : null
			]
		});
	}
	let { preview: r, operation: a } = t.data, o = a ? C(a.state) : !1, s = r.upgrade_available && !o, c = a?.target_release, l = c && !i(c, r.latest_beta);
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
					children: Ye(r.distance?.accepted_releases ?? null)
				})] }), s ? /* @__PURE__ */ J(B, {
					size: L.Small,
					variant: R.Primary,
					content: I.Text,
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
					/* @__PURE__ */ J(Ib, {
						label: "Current",
						release: r.current
					}),
					/* @__PURE__ */ J(Ib, {
						label: "Latest beta",
						release: r.latest_beta
					}),
					l ? /* @__PURE__ */ J(Ib, {
						label: "Accepted target",
						release: c,
						className: "lg:col-span-2"
					}) : null
				]
			}),
			a ? /* @__PURE__ */ J(Lb, {
				operation: a,
				settlements: e.settlements,
				onSettle: (t) => void e.requestSettlement(t)
			}) : null,
			/* @__PURE__ */ Y(Ht, {
				open: e.confirmationOpen,
				onClose: e.cancelStart,
				title: "Upgrade Managed NAC?",
				size: Mn.Small,
				footer: /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(B, {
					variant: R.Tertiary,
					content: I.Text,
					onClick: e.cancelStart,
					disabled: e.startPending,
					children: "Cancel"
				}), /* @__PURE__ */ J(B, {
					variant: R.Primary,
					content: I.Text,
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
function Ib({ label: e, release: t, className: n = "" }) {
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
function Lb({ operation: e, settlements: t, onSettle: n }) {
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
							}), e.actionable ? /* @__PURE__ */ J(B, {
								size: L.Small,
								variant: R.SecondaryDestructive,
								content: I.Text,
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
function Rb({ ready: e }) {
	return /* @__PURE__ */ J("span", {
		"aria-hidden": !0,
		className: `inline-block h-2 w-2 rounded-full ${e ? "bg-success-primary" : "bg-warning-primary"}`
	});
}
function zb() {
	let e = an();
	if (e.isLoading) return /* @__PURE__ */ J(A, { size: M.Medium });
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
			/* @__PURE__ */ J(Fb, {}),
			/* @__PURE__ */ Y("div", {
				className: "grid grid-cols-1 gap-2 sm:grid-cols-2",
				children: [
					/* @__PURE__ */ J(Bb, {
						label: t.model.display_name,
						value: t.model_ready ? t.model.id : "Needs attention",
						ready: t.model_ready
					}),
					/* @__PURE__ */ J(Bb, {
						label: "GitHub",
						value: t.github_status.replace("-", " "),
						ready: t.github_status === "connected"
					}),
					/* @__PURE__ */ J(Bb, {
						label: "Projects",
						value: String(t.project_count),
						ready: !0
					}),
					/* @__PURE__ */ J(Bb, {
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
						children: /* @__PURE__ */ J(Rb, { ready: e.ready })
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
function Bb({ label: e, value: t, ready: n }) {
	return /* @__PURE__ */ Y("div", {
		className: "rounded-lg border border-basic p-4",
		children: [/* @__PURE__ */ J("p", {
			className: "text-small text-basic-tertiary",
			children: e
		}), /* @__PURE__ */ Y("div", {
			className: "mt-1 flex items-center gap-2",
			children: [/* @__PURE__ */ J(Rb, { ready: n }), /* @__PURE__ */ J("p", {
				className: "label-medium capitalize text-basic-primary",
				children: t
			})]
		})]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedHostModal.tsx
function Vb({ open: e, onClose: t, tab: n, onTabChange: r, onGitHubConnected: i }) {
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: t,
		title: "Managed host",
		size: Mn.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		children: /* @__PURE__ */ Y("div", {
			className: "flex h-full min-h-0 flex-col md:flex-row",
			children: [/* @__PURE__ */ J("nav", {
				className: "flex shrink-0 gap-1 overflow-x-auto border-b border-basic md:w-44 md:flex-col md:border-b-0 md:border-r p-2",
				children: bn.map((e) => /* @__PURE__ */ J("button", {
					type: "button",
					className: `rounded px-3 py-2 text-left label-small capitalize ${n === e ? "bg-elevation-level-2 text-basic-primary" : "text-basic-tertiary"}`,
					onClick: () => r(e),
					children: e === "github" ? "GitHub" : e
				}, e))
			}), /* @__PURE__ */ Y("div", {
				className: "min-h-0 flex-1 overflow-auto p-4 md:p-6",
				children: [
					n === "status" ? /* @__PURE__ */ J(zb, {}) : null,
					n === "github" ? /* @__PURE__ */ J(Ob, { onConnected: i }) : null,
					n === "secrets" ? /* @__PURE__ */ J(kb, {}) : null
				]
			})]
		})
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedBranchPicker.tsx
function Hb(e, t) {
	return e.toLowerCase().localeCompare(t.toLowerCase()) || e.localeCompare(t);
}
function Ub({ branches: e, value: t, onValueChange: n, isLoading: r, error: i }) {
	let [a, o] = K(!1), [c, l] = K(""), [u, d] = K(null), f = G(null), p = G(null), m = Qr(), h = jr(), g = W(() => {
		let t = c.trim().toLowerCase(), n = [...e].sort(Hb);
		return t ? n.filter((e) => e.toLowerCase().includes(t)) : n;
	}, [e, c]), _ = u === null ? -1 : g.indexOf(u), v = (e = !0) => {
		o(!1), l(""), d(null), e && f.current?.focus();
	}, y = () => {
		if (a) {
			v();
			return;
		}
		let n = [...e].sort(Hb);
		d(t || n[0] || null), o(!0);
	};
	U(() => {
		a && p.current?.focus();
	}, [a]), U(() => {
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
		let t = u === null ? -1 : g.indexOf(u), n = t < 0 ? e > 0 ? 0 : g.length - 1 : (t + e + g.length) % g.length;
		d(g[n] ?? null);
	}, S = (e) => {
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault(), x(1);
				break;
			case "ArrowUp":
				e.preventDefault(), x(-1);
				break;
			case "Home":
				e.preventDefault(), d(g[0] ?? null);
				break;
			case "End":
				e.preventDefault(), d(g.at(-1) ?? null);
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
	}, C = r ? /* @__PURE__ */ Y("div", {
		role: "status",
		className: "flex items-center gap-2 p-3 text-small text-basic-tertiary",
		children: [/* @__PURE__ */ J(A, {
			size: M.Small,
			variant: be.Neutral
		}), "Loading branches…"]
	}) : i ? /* @__PURE__ */ J("p", {
		role: "alert",
		className: "p-3 text-small text-error-primary",
		children: i
	}) : e.length === 0 ? /* @__PURE__ */ J("p", {
		role: "status",
		className: "p-3 text-small text-basic-tertiary",
		children: "No branches found."
	}) : g.length === 0 ? /* @__PURE__ */ Y("p", {
		role: "status",
		className: "p-3 text-small text-basic-tertiary",
		children: [
			"No branches match \"",
			c.trim(),
			"\"."
		]
	}) : null;
	return /* @__PURE__ */ Y("div", {
		className: "flex min-w-0 flex-col gap-1 text-small text-basic-secondary",
		children: [/* @__PURE__ */ J("span", { children: "Branch" }), /* @__PURE__ */ J(pn, {
			open: a,
			onClose: () => v(),
			placement: s.BottomLeft,
			sticky: !0,
			className: "w-full",
			size: "w-[min(420px,calc(100vw-32px))]",
			panelClassName: "max-w-[calc(100vw-32px)]",
			sheetClassName: "px-4",
			content: /* @__PURE__ */ Y("div", {
				className: "flex h-[min(420px,70dvh)] min-h-[220px] flex-col gap-2 p-2 md:p-0",
				children: [/* @__PURE__ */ J(Z, {
					ref: p,
					inputSize: h ? X.Large : X.Medium,
					label: "Find branch",
					"aria-label": "Find branch",
					placeholder: "Search loaded branches",
					role: "combobox",
					"aria-autocomplete": "list",
					"aria-expanded": a,
					"aria-controls": m,
					"aria-activedescendant": _ >= 0 ? `${m}-option-${_}` : void 0,
					value: c,
					onChange: (t) => {
						let n = t.target.value, r = n.trim().toLowerCase(), i = [...e].sort(Hb).filter((e) => !r || e.toLowerCase().includes(r));
						l(n), d(i[0] ?? null);
					},
					onKeyDown: S
				}), /* @__PURE__ */ Y("div", {
					id: m,
					role: "listbox",
					"aria-label": "Branches",
					className: "flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto rounded border border-basic p-1",
					children: [C, !r && !i ? g.map((e, n) => /* @__PURE__ */ Y(Qc, {
						id: `${m}-option-${n}`,
						role: "option",
						"aria-selected": e === t,
						tabIndex: -1,
						size: h ? Xc.Large : Xc.Medium,
						active: e === u,
						className: "shrink-0",
						onMouseEnter: () => d(e),
						onMouseDown: (e) => e.preventDefault(),
						onClick: () => b(e),
						children: [/* @__PURE__ */ J("span", {
							className: "min-w-0 flex-1 truncate text-left",
							title: e,
							children: e
						}), e === t ? /* @__PURE__ */ J(z, {
							iconName: V.Check,
							className: "shrink-0"
						}) : null]
					}, e)) : null]
				})]
			}),
			children: /* @__PURE__ */ Y("button", {
				ref: f,
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
				children: [/* @__PURE__ */ J("span", {
					className: "min-w-0 flex-1 truncate text-left",
					title: t,
					children: t || "Select a branch"
				}), /* @__PURE__ */ J(z, {
					iconName: V.Down,
					className: `shrink-0 transition-transform duration-150 ${a ? "rotate-180" : "rotate-0"}`
				})]
			})
		})]
	});
}
//#endregion
//#region src/app/features/managed/presentation/ManagedRepositoryModal.tsx
function Wb({ open: e, onClose: t, onConnect: n }) {
	let { api: r } = P(), i = pi(), a = hn(), o = oi(), s = an(), c = un(e), [l, u] = K(""), [d, f] = K(null), [p, m] = K(""), [h, g] = K(""), [_, v] = K(""), [y, b] = K(null), [x, S] = K(""), [C, w] = K(!1), T = ai({
		queryKey: ["managed-github-repositories"],
		queryFn: ({ signal: e }) => r.listManagedGitHubRepositories(e),
		enabled: e && c.data?.connected === !0,
		retry: !1
	}), E = le(d?.full_name), D = ai({
		queryKey: ["managed-github-branches", d?.full_name],
		queryFn: ({ signal: e }) => r.listManagedGitHubBranches(E[0], E[1], e),
		enabled: e && E !== null,
		retry: !1
	});
	U(() => {
		if (!y || !Se(y)) return;
		let e = !1, n = new AbortController();
		return (async () => {
			for (; !e;) {
				await new Promise((e) => setTimeout(e, 500));
				try {
					let e = await r.getManagedClone(y.operation_id, n.signal);
					if (b(e), e.status !== "running") {
						e.status === "completed" && (await Promise.all([o.invalidateQueries({ queryKey: Mt.projects }), o.invalidateQueries({ queryKey: $t.hostStatus })]), a.success(`${e.project_name} is ready`), t(), i(vr.project(e.project_id)));
						return;
					}
				} catch (e) {
					n.signal.aborted || S(au($(e)));
					return;
				}
			}
		})(), () => {
			e = !0, n.abort();
		};
	}, [
		y,
		i,
		t,
		o,
		a,
		r
	]);
	let ee = W(() => {
		let e = l.trim().toLowerCase(), t = T.data?.repositories ?? [];
		return e ? t.filter((t) => t.full_name.toLowerCase().includes(e)) : t;
	}, [T.data, l]), O = async () => {
		if (!(!d || !p || !h.trim() || !_.trim())) {
			w(!0), S("");
			try {
				b(await r.startManagedClone({
					repository_id: d.id,
					repository: d.full_name,
					branch: p,
					destination: h.trim(),
					project_name: _.trim(),
					project_description: null
				}));
			} catch (e) {
				S(au($(e)));
			} finally {
				w(!1);
			}
		}
	}, k = async () => {
		if (!(!y || !Se(y))) try {
			b(await r.cancelManagedClone(y.operation_id));
		} catch (e) {
			S(ir($(e)));
		}
	}, te = C || Se(y), j = D.error ? au($(D.error)) : null;
	return /* @__PURE__ */ J(Ht, {
		open: e,
		onClose: te ? void 0 : t,
		title: "Add repository",
		size: Mn.Large,
		flush: !0,
		className: "h-[min(760px,calc(100vh-32px))]",
		footer: y?.status === "running" ? /* @__PURE__ */ J(B, {
			variant: R.SecondaryDestructive,
			content: I.Text,
			onClick: () => void k(),
			children: "Cancel clone"
		}) : /* @__PURE__ */ Y(q, { children: [/* @__PURE__ */ J(B, {
			variant: R.Tertiary,
			content: I.Text,
			onClick: t,
			children: "Cancel"
		}), /* @__PURE__ */ J(B, {
			variant: R.Primary,
			content: I.Text,
			onClick: () => void O(),
			disabled: !d || !p || !h.trim() || !_.trim(),
			loading: C,
			children: "Clone repository"
		})] }),
		children: /* @__PURE__ */ Y("div", {
			className: "flex h-full min-h-0 flex-col gap-4 overflow-auto p-4 md:p-6",
			"data-testid": "managed-repository-modal",
			children: [
				c.data?.connected ? null : /* @__PURE__ */ Y("div", {
					className: "flex flex-col items-start gap-3 rounded-lg border border-basic p-4",
					children: [/* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
						className: "label-medium text-basic-primary",
						children: "Connect GitHub to browse Arcee repositories"
					}), /* @__PURE__ */ J("p", {
						className: "text-small text-basic-tertiary",
						children: "You can still create a Project through NAC's existing local or SSH flow."
					})] }), /* @__PURE__ */ J(B, {
						variant: R.Primary,
						content: I.Text,
						onClick: n,
						children: "Connect GitHub"
					})]
				}),
				c.data?.connected && !y ? /* @__PURE__ */ Y(q, { children: [
					/* @__PURE__ */ J(Z, {
						inputSize: X.Large,
						label: "Find repository",
						"aria-label": "Find repository",
						placeholder: "Search accessible repositories",
						value: l,
						onChange: (e) => u(e.target.value)
					}),
					/* @__PURE__ */ Y("div", {
						className: "min-h-[140px] max-h-60 overflow-auto rounded-lg border border-basic p-1",
						children: [
							T.isLoading ? /* @__PURE__ */ J("div", {
								className: "p-4",
								children: /* @__PURE__ */ J(A, { size: M.Small })
							}) : null,
							T.error ? /* @__PURE__ */ J("p", {
								className: "p-4 text-small text-error-primary",
								children: au($(T.error))
							}) : null,
							ee.map((e) => /* @__PURE__ */ Y("button", {
								type: "button",
								className: `flex w-full items-center gap-3 rounded p-3 text-left ${d?.id === e.id ? "bg-elevation-level-2" : "hover:bg-elevation-level-1"}`,
								onClick: () => {
									f(e), m(e.default_branch), g(e.name), v(e.name), S("");
								},
								children: [
									/* @__PURE__ */ J(z, { iconName: e.private ? V.Lock : V.Github }),
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
									d?.id === e.id ? /* @__PURE__ */ J(z, { iconName: V.CheckCircle }) : null
								]
							}, e.id)),
							!T.isLoading && ee.length === 0 ? /* @__PURE__ */ J("p", {
								className: "p-4 text-small text-basic-tertiary",
								children: "No repositories match."
							}) : null
						]
					}),
					d ? /* @__PURE__ */ Y("div", {
						className: "grid grid-cols-1 gap-3 sm:grid-cols-2",
						children: [
							/* @__PURE__ */ J(Ub, {
								branches: D.data?.branches ?? [],
								value: p,
								onValueChange: m,
								isLoading: D.isLoading,
								error: j
							}, d.full_name),
							/* @__PURE__ */ J(Z, {
								inputSize: X.Large,
								label: "Project name",
								"aria-label": "Project name",
								value: _,
								onChange: (e) => v(e.target.value)
							}),
							/* @__PURE__ */ J(Z, {
								className: "sm:col-span-2",
								inputSize: X.Large,
								label: "Checkout directory",
								"aria-label": "Checkout directory",
								value: h,
								onChange: (e) => g(e.target.value),
								hintText: `${s.data?.repository_root ?? "Repository root"}/${h || "directory"}`
							})
						]
					}) : null
				] }) : null,
				y ? /* @__PURE__ */ Y("div", {
					className: "flex flex-col gap-4 rounded-lg border border-basic p-4",
					children: [
						/* @__PURE__ */ Y("div", {
							className: "flex items-center gap-3",
							children: [y.status === "running" ? /* @__PURE__ */ J(A, { size: M.Small }) : /* @__PURE__ */ J(z, { iconName: y.status === "completed" ? V.CheckCircle : V.Danger }), /* @__PURE__ */ Y("div", { children: [/* @__PURE__ */ J("p", {
								className: "label-medium text-basic-primary capitalize",
								children: y.status
							}), /* @__PURE__ */ Y("p", {
								className: "text-small text-basic-tertiary break-all",
								children: [
									y.repository,
									" · ",
									y.branch
								]
							})] })]
						}),
						/* @__PURE__ */ J("pre", {
							className: "max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-elevation-level-2 p-3 code-small text-basic-secondary",
							children: y.progress || "Preparing clone…"
						}),
						y.error ? /* @__PURE__ */ J("p", {
							className: "text-small text-error-primary",
							children: y.error
						}) : null
					]
				}) : null,
				x ? /* @__PURE__ */ J("p", {
					className: "text-small text-error-primary",
					children: x
				}) : null
			]
		})
	});
}
//#endregion
//#region src/app/features/managed/controller/ManagedHostProvider.tsx
function Gb({ children: e }) {
	let t = an(), [n, r] = K(!1), [i, a] = K("status"), [o, s] = K(!1), [c, l] = K(!1), u = t.data ?? null, d = H(() => {
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
	return /* @__PURE__ */ Y(Lp.Provider, {
		value: h,
		children: [
			e,
			/* @__PURE__ */ J(Vb, {
				open: n,
				tab: i,
				onTabChange: a,
				onClose: () => {
					r(!1), l(!1);
				},
				onGitHubConnected: m
			}),
			o ? /* @__PURE__ */ J(Wb, {
				open: !0,
				onClose: () => s(!1),
				onConnect: f
			}) : null
		]
	});
}
//#endregion
//#region src/App.tsx
function Kb() {
	let { sessionId: e } = mi();
	return /* @__PURE__ */ Y("section", {
		className: "relative flex h-full min-h-0 overflow-hidden bg-elevation-ground",
		children: [/* @__PURE__ */ J(lm, {}), /* @__PURE__ */ J(Db, {}, e)]
	});
}
function qb() {
	return se().orchestrationEnabled ? /* @__PURE__ */ J(pm, {}) : /* @__PURE__ */ J(ci, {
		to: vr.list(),
		replace: !0
	});
}
function Jb() {
	return /* @__PURE__ */ J(yi, { children: /* @__PURE__ */ J(zn, { children: /* @__PURE__ */ J(Vf, { children: /* @__PURE__ */ J(Df, { children: /* @__PURE__ */ J(Gb, { children: /* @__PURE__ */ Y(di, { children: [
		/* @__PURE__ */ Y(ui, {
			element: /* @__PURE__ */ J(Hp, {}),
			children: [
				/* @__PURE__ */ J(ui, {
					path: "/",
					element: /* @__PURE__ */ J(Pm, {})
				}),
				/* @__PURE__ */ J(ui, {
					path: "/project/:projectId",
					element: /* @__PURE__ */ J(hm, {})
				}),
				/* @__PURE__ */ J(ui, {
					path: "/session/:sessionId/:panel?",
					element: /* @__PURE__ */ J(Kb, {})
				})
			]
		}),
		/* @__PURE__ */ J(ui, {
			path: "/design",
			element: /* @__PURE__ */ J(qb, {})
		}),
		/* @__PURE__ */ J(ui, {
			path: "*",
			element: /* @__PURE__ */ J(ci, {
				to: vr.list(),
				replace: !0
			})
		})
	] }) }) }) }) }) });
}
//#endregion
//#region src/app/providers/ThemeProvider.tsx
var Yb = [
	"light",
	"dark",
	"system"
], Xb = "nac-theme", Zb = "dark", Qb = Jr(null), $b = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
function ex(e) {
	return Zb;
}
function tx() {
	let e = document.documentElement;
	e.setAttribute("data-theme", Zb), e.classList.remove("light", "dark"), e.classList.add(Zb), e.style.colorScheme = Zb;
}
function nx() {
	let e = localStorage.getItem(Xb);
	return e && Yb.includes(e) ? e : $b() ? "dark" : "light";
}
var rx = ({ children: e, local: t = !1 }) => {
	let [n, r] = K(() => t ? "dark" : nx()), i = H((e) => {
		Yb.includes(e) && (r(e), t || (localStorage.setItem(Xb, e), tx()));
	}, [t]), a = H(() => {
		r((e) => {
			let n = e === "light" ? "dark" : e === "dark" ? "system" : "light";
			return t || (localStorage.setItem(Xb, n), tx()), n;
		});
	}, [t]);
	return U(() => {
		t || tx();
	}, [t]), /* @__PURE__ */ J(Qb.Provider, {
		value: {
			theme: n,
			resolved: ex(n),
			setTheme: i,
			toggleTheme: a
		},
		children: e
	});
};
function ix() {
	let e = Zr(Qb);
	if (!e) throw Error("useTheme must be used within a ThemeProvider");
	return e;
}
//#endregion
//#region src/app/runtime/NativePresentationRoot.tsx
function ax(e) {
	return /* @__PURE__ */ J(ox, { ...e }, e.runtime.id);
}
function ox({ runtime: e, router: t, theme: n, className: r, styles: i, globalKeyboard: a }) {
	if (U(() => e.retain(), [e]), ei(e.subscribe, e.isClosed, e.isClosed)) return null;
	let o = /* @__PURE__ */ J(sx, {
		runtime: e,
		className: r,
		styles: i,
		globalKeyboard: a,
		children: t(/* @__PURE__ */ J(Jb, {}))
	});
	return /* @__PURE__ */ J(nr.Provider, {
		value: e,
		children: /* @__PURE__ */ J(ti, {
			client: e.queryClient,
			children: n ? n(o) : /* @__PURE__ */ J(rx, {
				local: !0,
				children: o
			})
		})
	});
}
function sx({ runtime: e, className: t, styles: n, globalKeyboard: r, children: i }) {
	let { resolved: a } = ix();
	return /* @__PURE__ */ Y("div", {
		className: `${t ?? "nac-presentation h-full min-h-0"} ${a}`,
		style: { contain: "layout paint" },
		"data-nac-runtime": e.id,
		"data-theme": a,
		children: [n, /* @__PURE__ */ J(E, {
			globalKeyboard: r,
			children: i
		})]
	});
}
//#endregion
export { ax as NativePresentationRoot, vt as NativeRuntime, nr as RuntimeContext, mt as createNativeRuntime, P as useNativeRuntime };
