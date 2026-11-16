import { n as e } from "./RuntimeContext-BntTaIwR.js";
import { i as t, r as n } from "./PresentationBoundary-DgJz1GXw.js";
import { n as r } from "./visibility-Cy5NeKga.js";
import { useLayoutEffect as i, useRef as a } from "react";
// src/app/features/desktop-commands/sessionTarget.ts
var o = (e, t) => Object.keys(e).length === t.length && t.every((t) => Object.hasOwn(e, t)), s = (e) => typeof e == "string" && e.length > 0 && new TextEncoder().encode(e).length <= 512 && !/\p{Cc}/u.test(e);
function c(e, t) {
	if (!e.connectSessionTarget) return () => {};
	let n = !0, r = 0, i, a = e.connectSessionTarget(async (e) => {
		if (!n || !e || typeof e != "object") return "stale";
		let a = e, c = a.target;
		if (!o(a, [
			"version",
			"request",
			"source",
			"profile",
			"launch",
			"view",
			"document",
			"target"
		]) || a.version !== 1 || a.source !== "notification-response" || !Number.isSafeInteger(a.request) || a.request <= r || a.request > 2147483647 || ![
			a.profile,
			a.launch,
			a.view,
			a.document
		].every(s) || !c || typeof c != "object" || !o(c, ["session_id", "occurrence_id"]) || !s(c.session_id) || !s(c.occurrence_id)) return "unavailable";
		r = a.request, i?.abort();
		let l = new AbortController();
		i = l;
		try {
			let e = await t(c, l.signal);
			return n && i === l && !l.signal.aborted ? e : "stale";
		} catch {
			return !n || l.signal.aborted ? "stale" : "unavailable";
		} finally {
			i === l && (i = void 0);
		}
	});
	return () => {
		n = !1, i?.abort(), i = void 0, a();
	};
}
// src/app/features/desktop-commands/DesktopSessionTargetOwner.tsx
function l({ port: o }) {
	let s = e(), l = n(), u = t(), d = r(), f = a(!1), p = a({
		ownsKeyboard: l,
		layers: u
	});
	return i(() => {
		p.current = {
			ownsKeyboard: l,
			layers: u
		};
	}), i(() => {
		if (!o.connectSessionTarget) return;
		let e = () => {
			f.current = !0;
		}, t = () => {
			f.current = !1;
		};
		return document.addEventListener("compositionstart", e, !0), document.addEventListener("compositionend", t, !0), () => {
			document.removeEventListener("compositionstart", e, !0), document.removeEventListener("compositionend", t, !0);
		};
	}, [o]), i(() => {
		if (!o.connectSessionTarget || !d) return;
		let e = () => {
			let e = document.activeElement;
			return f.current || p.current.layers.modalDepth() > 0 || !p.current.ownsKeyboard(e) ? !1 : !(e instanceof HTMLElement && (e.matches("input,textarea,select") || e.isContentEditable) && !e.hasAttribute("data-nac-retained-draft"));
		};
		return c(o, (t, n) => s.productNavigation?.openNotificationSessionTarget(t, n, e) ?? Promise.resolve("unavailable"));
	}, [
		o,
		s,
		d
	]), null;
}
export { l as DesktopSessionTargetOwner };
