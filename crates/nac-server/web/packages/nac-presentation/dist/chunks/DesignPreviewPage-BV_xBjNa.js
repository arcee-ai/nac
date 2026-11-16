import { $ as e, O as t, S as n, X as r, Y as i, Z as a, _ as o, b as ee, c as te, et as s, f as ne, g as c, h as l, m as u, n as d, o as re, r as f, t as ie, tt as p, u as ae, x as oe, y as se } from "./Toast-abpBl7uJ.js";
import { $ as m, $t as h, A as ce, B as g, Bt as le, C as ue, Ct as de, D as fe, Dt as pe, E as me, Et as he, F as ge, Ft as _, G as _e, Gt as ve, H as ye, I as be, It as xe, J as Se, Kt as Ce, L as we, Lt as Te, M as Ee, Mt as v, N as De, Nt as Oe, O as ke, Pt as Ae, Q as je, Qt as y, R as Me, Rt as Ne, S as b, St as Pe, T as Fe, Tt as Ie, U as x, V as Le, W as Re, Wt as ze, Xt as S, Y as Be, Yt as Ve, Zt as C, an as He, at as w, b as T, bt as Ue, ct as We, dt as E, en as D, et as Ge, f as Ke, ft as qe, g as O, gt as Je, h as Ye, ht as Xe, in as k, it as A, j as Ze, jt as Qe, k as $e, l as et, lt as tt, nn as nt, nt as rt, on as j, ot as it, pt as at, q as M, rn as N, rt as ot, sn as st, t as ct, tn as P, tt as lt, ut, vt as F, wt as dt, x as ft, xt as pt, y as mt, z as ht, zt as gt } from "./ReasoningItem-CGfb1IkO.js";
import { Fragment as I, useEffect as _t, useRef as vt, useState as L } from "react";
import { Fragment as R, jsx as z, jsxs as B } from "react/jsx-runtime";
// src/app/components/pages/design-preview/AvatarsSection.tsx
function yt() {
	let [e, t] = L("Port the ArceeFM atoms");
	return /* @__PURE__ */ z(S, {
		title: "Avatars and editable header",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ B("div", {
				className: "flex flex-wrap items-center gap-4",
				children: [
					/* @__PURE__ */ z(h, {
						name: "Aleksy",
						size: D.Small
					}),
					/* @__PURE__ */ z(h, { name: "NAC Orchestrator" }),
					/* @__PURE__ */ z(h, {
						name: "Opus",
						size: D.Large
					}),
					/* @__PURE__ */ z(h, {
						name: "🛠",
						glyph: !0,
						size: D.Large
					}),
					/* @__PURE__ */ z(h, {
						name: "Anthropic",
						size: D.XLarge,
						color: "var(--color-bg-info-primary)"
					})
				]
			}), /* @__PURE__ */ z(Xe, {
				value: e,
				onCommit: t,
				size: Je.Medium,
				className: "max-w-[360px]"
			})]
		})
	});
}
// src/app/components/pages/design-preview/Showcase.tsx
function V({ id: e, title: t, description: n, children: r }) {
	return /* @__PURE__ */ B("section", {
		id: e,
		"aria-labelledby": `${e}-title`,
		className: "flex scroll-mt-20 flex-col gap-4",
		children: [/* @__PURE__ */ B("div", {
			className: "flex flex-col gap-1",
			children: [/* @__PURE__ */ z("h2", {
				id: `${e}-title`,
				className: "type-title text-basic-primary",
				children: t
			}), /* @__PURE__ */ z("p", {
				className: "type-body-chrome max-w-[60ch] text-basic-tertiary",
				children: n
			})]
		}), /* @__PURE__ */ z("div", {
			className: "flex flex-col gap-4",
			children: r
		})]
	});
}
function H({ label: e, hint: t, className: n, children: r }) {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-2 border-b border-muted px-4 py-4 last:border-b-0 md:flex-row md:gap-6",
		children: [/* @__PURE__ */ B("div", {
			className: "flex w-full shrink-0 flex-col gap-0.5 md:w-[168px]",
			children: [/* @__PURE__ */ z("span", {
				className: "type-label text-basic-primary",
				children: e
			}), t ? /* @__PURE__ */ z("span", {
				className: "type-meta text-basic-tertiary",
				children: t
			}) : null]
		}), /* @__PURE__ */ z("div", {
			className: p("flex min-w-0 flex-1 flex-wrap items-center gap-3", n),
			children: r
		})]
	});
}
function U({ children: e }) {
	return /* @__PURE__ */ z("code", {
		className: "code-small text-basic-tertiary",
		children: e
	});
}
// src/app/components/pages/design-preview/BadgesSection.tsx
function bt() {
	return /* @__PURE__ */ B(R, { children: [
		/* @__PURE__ */ B(u, {
			variant: o.Secondary,
			size: c.Small,
			"aria-label": "Changes, 12 added, 3 removed",
			children: [/* @__PURE__ */ z("span", {
				className: "tabular text-success-primary",
				children: "+12"
			}), /* @__PURE__ */ z("span", {
				className: "tabular text-error-primary",
				children: "−3"
			})]
		}),
		/* @__PURE__ */ B(u, {
			variant: o.Secondary,
			size: c.Small,
			content: l.IconLeft,
			"aria-label": "3 agents, 1 running",
			children: [/* @__PURE__ */ z(F, { status: "working" }), "3 agents"]
		}),
		/* @__PURE__ */ B(u, {
			variant: o.Secondary,
			size: c.Small,
			content: l.IconLeft,
			children: [/* @__PURE__ */ z(e, { iconName: s.Flag }), "Goal"]
		}),
		/* @__PURE__ */ B(u, {
			variant: o.SecondaryHighlighted,
			size: c.Small,
			content: l.IconRight,
			children: ["Agent", /* @__PURE__ */ z(e, { iconName: s.Down })]
		})
	] });
}
function xt() {
	let [e, t] = L(!0), [n, r] = L(!1);
	return /* @__PURE__ */ B(S, {
		title: "Badges, chips and switches",
		children: [
			/* @__PURE__ */ B(H, {
				label: "Badges",
				hint: "11px, sentence case, a soft wash.",
				children: [
					/* @__PURE__ */ z(C, {
						text: "Running",
						color: y.Neutral
					}),
					/* @__PURE__ */ z(C, {
						text: "Needs approval",
						color: y.Yellow
					}),
					/* @__PURE__ */ z(C, {
						text: "Failed",
						color: y.Red
					}),
					/* @__PURE__ */ z(C, {
						text: "Merged",
						color: y.Green
					}),
					/* @__PURE__ */ z(C, {
						text: "Docs",
						color: y.Blue
					}),
					/* @__PURE__ */ z(C, {
						text: "Idle",
						color: y.Gray
					}),
					/* @__PURE__ */ z(C, {
						text: "No wash",
						color: y.Red,
						background: !1
					})
				]
			}),
			/* @__PURE__ */ z(H, {
				label: "Chips",
				hint: "24px pills: header pills, composer chips.",
				children: /* @__PURE__ */ z(bt, {})
			}),
			/* @__PURE__ */ B(H, {
				label: "Switch",
				hint: "Ink track when on, in either theme.",
				children: [
					/* @__PURE__ */ z(T, {
						checked: e,
						onChange: t,
						"aria-label": "Notifications"
					}),
					/* @__PURE__ */ z(T, {
						checked: n,
						onChange: r,
						size: ft.Large,
						"aria-label": "Large switch"
					}),
					/* @__PURE__ */ z(T, {
						checked: !0,
						disabled: !0,
						"aria-label": "On, disabled"
					}),
					/* @__PURE__ */ z(T, {
						checked: !1,
						disabled: !0,
						"aria-label": "Off, disabled"
					})
				]
			})
		]
	});
}
// src/app/components/pages/design-preview/TabsPreview.tsx
var St = [
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
], Ct = [
	{
		label: "Regular",
		variant: st.Regular
	},
	{
		label: "Accent",
		variant: st.Accent
	},
	{
		label: "Destructive",
		variant: st.Destructive
	}
], wt = [
	{
		label: "small",
		size: j.Small
	},
	{
		label: "medium",
		size: j.Medium
	},
	{
		label: "large",
		size: j.Large
	}
], Tt = [
	{
		label: "Small",
		size: Ge.Small
	},
	{
		label: "Medium",
		size: Ge.Medium
	},
	{
		label: "Large",
		size: Ge.Large
	}
], Et = [
	{
		label: "Icon left",
		content: m.IconLeft
	},
	{
		label: "Icon right",
		content: m.IconRight
	},
	{
		label: "Icon",
		content: m.IconOnly
	},
	{
		label: "Text",
		content: m.TextOnly
	},
	{
		label: "Full",
		content: m.Full
	}
];
function Dt() {
	return /* @__PURE__ */ B("div", {
		className: "grid w-fit grid-cols-[160px_repeat(4,200px)] items-center gap-x-4 gap-y-2",
		children: [
			/* @__PURE__ */ z("span", {}),
			St.map((e) => /* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			Ct.flatMap((t) => wt.map((n) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ B("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					t.label,
					", ",
					n.label
				]
			}), St.map((r) => /* @__PURE__ */ B(He, {
				variant: t.variant,
				size: n.size,
				active: r.active,
				disabled: r.disabled,
				children: [
					/* @__PURE__ */ z(e, { iconName: s.Search }),
					/* @__PURE__ */ z("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: "New session"
					}),
					/* @__PURE__ */ z(e, { iconName: s.Edit })
				]
			}, r.label))] }, `${t.label}-${n.label}`)))
		]
	});
}
function Ot() {
	return /* @__PURE__ */ B("div", {
		className: "grid w-fit grid-cols-[160px_repeat(5,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ z("span", {}),
			Et.map((e) => /* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			Tt.flatMap((e) => St.map((t) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ B("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label.toLowerCase()
				]
			}), Et.map((n) => /* @__PURE__ */ z(je, {
				size: e.size,
				content: n.content,
				active: t.active,
				disabled: t.disabled,
				iconName: s.Play,
				trailingIcon: s.Right,
				"aria-label": n.content === m.IconOnly ? "Run" : void 0,
				children: "Run"
			}, n.label))] }, `${e.label}-${t.label}`)))
		]
	});
}
function kt() {
	return /* @__PURE__ */ B(R, { children: [/* @__PURE__ */ B("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ z("span", {
			className: "type-subheading text-basic-primary",
			children: "Rows (menus, lists)"
		}), /* @__PURE__ */ z(Dt, {})]
	}), /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ z("span", {
			className: "type-subheading text-basic-primary",
			children: "Tabs"
		}), /* @__PURE__ */ z(Ot, {})]
	})] });
}
// src/app/components/pages/design-preview/ButtonsSection.tsx
var At = [
	{
		label: "Primary",
		variant: o.Primary
	},
	{
		label: "Secondary",
		variant: o.Secondary
	},
	{
		label: "Secondary highlighted",
		variant: o.SecondaryHighlighted
	},
	{
		label: "Secondary destructive",
		variant: o.SecondaryDestructive
	},
	{
		label: "Secondary accent",
		variant: o.SecondaryAccent
	},
	{
		label: "Secondary accent highlighted",
		variant: o.SecondaryAccentHighlighted
	},
	{
		label: "Ghost",
		variant: o.Ghost
	},
	{
		label: "Ghost highlighted",
		variant: o.GhostHighlighted
	},
	{
		label: "Ghost destructive",
		variant: o.GhostDestructive
	},
	{
		label: "Ghost accent",
		variant: o.GhostAccent
	},
	{
		label: "Ghost highlighted accent",
		variant: o.GhostHighlightedAccent
	},
	{
		label: "Tertiary",
		variant: o.Tertiary
	},
	{
		label: "Tertiary destructive",
		variant: o.TertiaryDestructive
	},
	{
		label: "Tertiary accent",
		variant: o.TertiaryAccent
	}
], jt = [
	{
		label: "Secondary",
		variant: o.Secondary
	},
	{
		label: "Ghost highlighted",
		variant: o.GhostHighlighted
	},
	{
		label: "Tertiary",
		variant: o.Tertiary
	}
], Mt = [
	{
		label: "small",
		size: c.Small
	},
	{
		label: "medium",
		size: c.Medium
	},
	{
		label: "large",
		size: c.Large
	}
], Nt = [
	{
		label: "Icon",
		content: l.Icon
	},
	{
		label: "Icon left",
		content: l.IconLeft
	},
	{
		label: "Text",
		content: l.Text
	},
	{
		label: "Icon right",
		content: l.IconRight
	}
];
function W({ variant: t, size: n = c.Medium, content: r = l.IconLeft, disabled: i = !1 }) {
	let a = r === l.Icon;
	return /* @__PURE__ */ B(u, {
		variant: t,
		size: n,
		content: r,
		disabled: i,
		"aria-label": a ? "Add" : void 0,
		children: [
			a || r === l.IconLeft ? /* @__PURE__ */ z(e, { iconName: s.Add }) : null,
			a ? null : "Label",
			r === l.IconRight ? /* @__PURE__ */ z(e, { iconName: s.Right }) : null
		]
	});
}
function Pt() {
	return /* @__PURE__ */ B("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ z("span", {}),
			[
				"Default",
				"Disabled",
				"Icon",
				"Icon, disabled"
			].map((e) => /* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}, e)),
			At.map(({ label: e, variant: t }) => /* @__PURE__ */ B(I, { children: [
				/* @__PURE__ */ z("span", {
					className: "type-body-chrome text-basic-secondary",
					children: e
				}),
				/* @__PURE__ */ z(W, { variant: t }),
				/* @__PURE__ */ z(W, {
					variant: t,
					disabled: !0
				}),
				/* @__PURE__ */ z(W, {
					variant: t,
					content: l.Icon
				}),
				/* @__PURE__ */ z(W, {
					variant: t,
					content: l.Icon,
					disabled: !0
				})
			] }, e))
		]
	});
}
function Ft() {
	return /* @__PURE__ */ B("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ z("span", {}),
			Nt.map(({ label: e }) => /* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}, e)),
			jt.flatMap((e) => Mt.map((t) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ B("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), Nt.map(({ label: n, content: r }) => /* @__PURE__ */ z(W, {
				variant: e.variant,
				size: t.size,
				content: r
			}, n))] }, `${e.label}-${t.label}`)))
		]
	});
}
function It() {
	return /* @__PURE__ */ z(S, {
		title: "Buttons",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-col gap-8 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ B("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ z("p", {
						className: "type-body-chrome text-basic-tertiary",
						children: "Every control is a pill. Primary is ink; secondary is a surface with a hairline; ghost and tertiary carry no box until hovered. Accent variants are ink washes: there is no brand hue. Small 24, medium 32, large 40."
					}), /* @__PURE__ */ B("div", {
						className: "flex flex-wrap items-center gap-3",
						children: [
							/* @__PURE__ */ z(u, {
								variant: o.Primary,
								children: "Primary"
							}),
							/* @__PURE__ */ z(u, {
								variant: o.Secondary,
								children: "Secondary"
							}),
							/* @__PURE__ */ z(u, {
								variant: o.Ghost,
								children: "Ghost"
							}),
							/* @__PURE__ */ z(u, {
								variant: o.Tertiary,
								children: "Tertiary"
							}),
							/* @__PURE__ */ z(u, {
								variant: o.SecondaryDestructive,
								children: "Delete"
							}),
							/* @__PURE__ */ z(u, {
								variant: o.GhostDestructive,
								children: "Remove"
							}),
							/* @__PURE__ */ z(u, {
								variant: o.Primary,
								loading: !0,
								children: "Loading"
							}),
							/* @__PURE__ */ z(u, {
								variant: o.Secondary,
								disabled: !0,
								children: "Disabled"
							}),
							/* @__PURE__ */ B(u, {
								variant: o.Secondary,
								content: l.IconLeft,
								children: [/* @__PURE__ */ z(e, { iconName: s.Add }), "New session"]
							})
						]
					})]
				}),
				/* @__PURE__ */ B("div", {
					className: "flex flex-col gap-3",
					children: [
						/* @__PURE__ */ z("span", {
							className: "type-subheading text-basic-primary",
							children: "Variants and states"
						}),
						/* @__PURE__ */ z(Pt, {}),
						/* @__PURE__ */ z(Ft, {})
					]
				}),
				/* @__PURE__ */ z(kt, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ChoicesSection.tsx
var Lt = [{
	id: "trace",
	name: "session-trace.txt",
	size: "12 KB"
}];
function Rt(e) {
	return {
		id: `${e.name}-${e.lastModified}`,
		name: e.name,
		size: `${Math.ceil(e.size / 1024)} KB`
	};
}
function zt() {
	let [e, t] = L(!0), [n, r] = L("first"), [i, a] = L(Lt);
	return /* @__PURE__ */ z(S, {
		title: "Choices, multi-line and file input",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ B("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ z(Qe, {
						checked: e,
						onChange: t,
						children: "Skip permission prompts"
					}), /* @__PURE__ */ z(Qe, {
						checked: !1,
						onChange: () => {},
						disabled: !0,
						children: "Disabled"
					})]
				}),
				/* @__PURE__ */ B("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ z(fe, {
						name: "preview-choice",
						checked: n === "first",
						onChange: () => r("first"),
						children: "Working tree"
					}), /* @__PURE__ */ z(fe, {
						name: "preview-choice",
						checked: n === "second",
						onChange: () => r("second"),
						children: "Latest snapshot"
					})]
				}),
				/* @__PURE__ */ z(_e, {
					label: "System prompt",
					rows: 3,
					placeholder: "Extra instructions for the agent",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ B("div", {
					className: "flex w-[320px] flex-col gap-2",
					children: [/* @__PURE__ */ z(We, {
						accept: ".txt,.md,.pdf",
						hint: "Text, Markdown or PDF.",
						onFilesSelected: (e) => a(e.map(Rt))
					}), /* @__PURE__ */ z(We, {
						files: i,
						onRemove: (e) => a(i.filter((t) => t.id !== e))
					})]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/CodeBlockSection.tsx
var Bt = "pub enum AgentEvent {\n    RunStarted { thread_name: Option<String> },\n    AssistantMessage {\n        thread_name: Option<String>,\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { thread_name: Option<String> },\n}";
function Vt() {
	return /* @__PURE__ */ z(S, {
		title: "Code block and chat loader",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ z(f, {
				code: Bt,
				language: "rust",
				title: "events.rs",
				lineNumbers: !0,
				expandable: !0,
				maxHeight: "220px"
			}), /* @__PURE__ */ z(Ve, {})]
		})
	});
}
// src/app/components/pages/design-preview/DatesSection.tsx
function Ht() {
	let [e, t] = L(null), [n, r] = L({
		from: null,
		to: null
	});
	return /* @__PURE__ */ z(S, {
		title: "Dates",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ z(Ie, {
					label: "Created after",
					value: e,
					onChange: t,
					className: "w-[240px]"
				}),
				/* @__PURE__ */ z(Ie, {
					label: "Window",
					range: n,
					onRangeChange: r,
					hintText: "Two clicks pick the ends.",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ z(he, {
					selected: e ? /* @__PURE__ */ new Date(`${e}T00:00:00`) : void 0,
					onSelect: (e) => t(`${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`),
					className: "rounded-[8px] border border-muted bg-elevation-level-2"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/FilesAtomsSection.tsx
var G = [
	{
		size: E.Large,
		badge: at.Large,
		title: "Large"
	},
	{
		size: E.Medium,
		badge: at.Medium,
		title: "Medium"
	},
	{
		size: E.Small,
		badge: at.Small,
		title: "Small"
	}
], Ut = "src/app/components/index.tsx", Wt = "src/app/components/calendar/RecurringEventsTimeZonePicker.tsx", Gt = [
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
], Kt = [
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
], qt = [
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
		path: Wt,
		additions: 1204,
		deletions: 377
	}
], Jt = [
	{
		title: "Default",
		status: null
	},
	{
		title: "Changed",
		status: w.Changed
	},
	{
		title: "Added",
		status: w.Added
	},
	{
		title: "Deleted",
		status: w.Deleted
	},
	{
		title: "Changed name",
		status: w.ChangedName
	},
	{
		title: "Copied",
		status: w.Copied
	},
	{
		title: "Changed type",
		status: w.ChangedType
	},
	{
		title: "Conflict",
		status: w.Conflict
	},
	{
		title: "Not tracked",
		status: w.NotTracked
	},
	{
		title: "Ignored",
		status: w.Ignored
	}
], Yt = [
	{
		title: "File",
		variant: A.File
	},
	{
		title: "File, active",
		variant: A.File,
		active: !0
	},
	{
		title: "File, disabled",
		variant: A.File,
		disabled: !0
	},
	{
		title: "Folder",
		variant: A.Folder
	},
	{
		title: "Folder, open",
		variant: A.Folder,
		active: !0
	}
], Xt = "src/app/lib/parser.ts", K = (e, t, n, r, i = !0) => ({
	kind: e,
	old_lineno: t,
	new_lineno: n,
	content: r,
	has_trailing_newline: i
}), Zt = {
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
			K("context", 1, 1, "import { tokenize } from \"./lexer\";"),
			K("delete", 2, null, "import type { Token } from \"./lexer\";"),
			K("insert", null, 2, "import { type Token, TokenKind } from \"./lexer\";"),
			K("context", 3, 3, "")
		]
	}, {
		function_context: null,
		old_start: 24,
		old_lines: 3,
		new_start: 24,
		new_lines: 4,
		lines: [
			K("context", 24, 24, "export function parse(source: string): Token[] {"),
			K("delete", 25, null, "  return tokenize(source);"),
			K("insert", null, 25, "  const tokens = tokenize(source);"),
			K("insert", null, 26, "  return tokens.filter((token) => token.kind !== TokenKind.Whitespace && token.kind !== TokenKind.Comment);"),
			K("context", 26, 27, "}", !1)
		]
	}]
}, q = "bg-elevation-ground p-2", J = () => {};
function Qt() {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ z("span", {
			className: "type-meta-strong text-basic-muted",
			children: "File button"
		}), /* @__PURE__ */ B("div", {
			className: "grid w-fit grid-cols-[auto_repeat(3,auto)] items-center gap-x-4 gap-y-2",
			children: [
				/* @__PURE__ */ z("span", {}),
				G.map(({ size: e, title: t }) => /* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-muted",
					children: t
				}, e)),
				Gt.map((e) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: e.title
				}), G.map(({ size: t }) => /* @__PURE__ */ z("div", {
					className: q,
					children: /* @__PURE__ */ z(ut, {
						path: Ut,
						size: t,
						active: e.active,
						disabled: e.disabled,
						additions: e.additions,
						deletions: e.deletions,
						onClick: J
					})
				}, t))] }, e.title))
			]
		})]
	});
}
function $t() {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ z("span", {
			className: "type-meta-strong text-basic-muted",
			children: "A long name in 200px"
		}), /* @__PURE__ */ z("div", {
			className: "flex flex-wrap items-start gap-4",
			children: G.map(({ size: e }) => /* @__PURE__ */ z("div", {
				className: `w-[200px] ${q}`,
				children: /* @__PURE__ */ z(ut, {
					path: Wt,
					size: e,
					additions: 1204,
					deletions: 377,
					onClick: J
				})
			}, e))
		})]
	});
}
function en() {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ z("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code changes badge"
		}), /* @__PURE__ */ B("div", {
			className: "grid w-fit grid-cols-[64px_repeat(3,auto)] items-center gap-x-6 gap-y-2",
			children: [
				/* @__PURE__ */ z("span", {}),
				Kt.map(({ title: e }) => /* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-muted",
					children: e
				}, e)),
				G.map(({ badge: e, title: t }) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: t
				}), Kt.map((t) => /* @__PURE__ */ z(qe, {
					size: e,
					additions: t.additions,
					deletions: t.deletions
				}, t.title))] }, e))
			]
		})]
	});
}
function tn({ files: e, size: t, caption: n }) {
	let [r, i] = L(e[1]?.path ?? null);
	return /* @__PURE__ */ B("div", {
		className: "flex w-[280px] flex-col gap-2",
		children: [
			/* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: n
			}),
			/* @__PURE__ */ z("div", {
				className: q,
				children: /* @__PURE__ */ z(tt, {
					"aria-label": "Changed files",
					size: t,
					files: e.map((e) => ({
						...e,
						active: e.path === r
					})),
					onOpen: i
				})
			}),
			/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-tertiary",
				children: ["Open file: ", r ?? "none"]
			})
		]
	});
}
function nn() {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [G.map(({ size: e, title: t }) => /* @__PURE__ */ z(tn, {
			size: e,
			files: qt.slice(0, 5),
			caption: `List, 5 files, ${t}`
		}, e)), /* @__PURE__ */ z(tn, {
			size: E.Small,
			files: qt,
			caption: "List, 17 files, Small"
		})]
	});
}
function rn() {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ z("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Git status labels"
		}), /* @__PURE__ */ z("div", {
			className: `flex w-fit gap-3 ${q}`,
			children: Object.values(w).map((e) => /* @__PURE__ */ z(it, { status: e }, e))
		})]
	});
}
var an = (e) => e === A.Folder ? "components" : "index.tsx";
function on() {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: "File list tab button, Small"
			}),
			/* @__PURE__ */ B("div", {
				className: "grid w-fit grid-cols-[auto_repeat(5,160px)] items-center gap-x-3 gap-y-1",
				children: [
					/* @__PURE__ */ z("span", {}),
					Yt.map(({ title: e }) => /* @__PURE__ */ z("span", {
						className: "type-meta-strong text-basic-muted",
						children: e
					}, e)),
					Jt.map(({ title: e, status: t }) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ z("span", {
						className: "type-meta-strong text-basic-tertiary",
						children: e
					}), Yt.map((e) => /* @__PURE__ */ z("div", {
						className: q,
						children: /* @__PURE__ */ z(rt, {
							name: an(e.variant),
							variant: e.variant,
							status: t,
							active: e.active,
							disabled: e.disabled,
							onClick: J
						})
					}, e.title))] }, e))
				]
			}),
			/* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: "File list tab button, Large"
			}),
			/* @__PURE__ */ z("div", {
				className: "flex flex-wrap items-start gap-4",
				children: Yt.filter((e) => !e.disabled).map((e) => /* @__PURE__ */ z("div", {
					className: `w-[280px] ${q}`,
					children: /* @__PURE__ */ z(rt, {
						name: an(e.variant),
						variant: e.variant,
						size: ot.Large,
						status: w.Changed,
						active: e.active,
						onClick: J
					})
				}, e.title))
			})
		]
	});
}
var sn = (e, t) => ({
	kind: e.kind === "insert" || e.kind === "delete" ? e.kind : "context",
	number: e.kind === "delete" ? e.old_lineno : e.new_lineno ?? e.old_lineno,
	content: e.content,
	tokens: t,
	trailing: e.has_trailing_newline ? null : /* @__PURE__ */ z("span", {
		className: "italic text-basic-muted",
		children: " No newline at end of file"
	})
});
function cn() {
	let [e, t] = L(() => /* @__PURE__ */ new Map());
	return _t(() => {
		let e = !0;
		return re(Xt, [Zt]).then((n) => {
			e && t(n);
		}), () => {
			e = !1;
		};
	}, []), /* @__PURE__ */ z("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [{
			title: "Code displayer, two hunks",
			tokens: e
		}, {
			title: "Code displayer without tokens",
			tokens: null
		}].map(({ title: e, tokens: t }) => /* @__PURE__ */ B("div", {
			className: "flex w-[480px] flex-col gap-2",
			children: [/* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}), /* @__PURE__ */ z("div", {
				className: q,
				children: /* @__PURE__ */ z(pe, {
					"aria-label": `Changes to ${Xt}`,
					hunks: Zt.hunks.map((e) => e.lines.map((e) => sn(e, t?.get(e))))
				})
			})]
		}, e))
	});
}
function ln() {
	return /* @__PURE__ */ z(S, {
		title: "Files",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ z(Qt, {}),
				/* @__PURE__ */ z($t, {}),
				/* @__PURE__ */ z(en, {}),
				/* @__PURE__ */ z(nn, {}),
				/* @__PURE__ */ z(rn, {}),
				/* @__PURE__ */ z(on, {}),
				/* @__PURE__ */ z(cn, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/InputsSection.tsx
var un = [
	{
		id: "sonnet",
		label: "Claude Sonnet",
		icon: s.Brain
	},
	{
		id: "opus",
		label: "Claude Opus",
		icon: s.Brain
	},
	{
		id: "gpt",
		label: "GPT",
		icon: s.Ai
	}
];
function dn({ onOpenModal: e }) {
	let [t, n] = L("sonnet");
	return /* @__PURE__ */ z(S, {
		title: "Inputs",
		children: /* @__PURE__ */ B("div", {
			className: "flex flex-col gap-5 p-4",
			children: [
				/* @__PURE__ */ B("div", {
					className: "flex flex-wrap items-end gap-4",
					children: [
						/* @__PURE__ */ z(M, {
							label: "Working directory",
							inputSize: Be.Medium,
							placeholder: "/Users/me/project",
							className: "w-full max-w-[320px]"
						}),
						/* @__PURE__ */ z(M, {
							label: "Search",
							inputSize: Be.Medium,
							leading: Se.Icon,
							leadingIconName: s.Search,
							placeholder: "Filter sessions",
							hintText: "Matches name and cwd",
							className: "w-full max-w-[280px]"
						}),
						/* @__PURE__ */ z(Fe, {
							items: un,
							value: t,
							onValueChange: n,
							placeholder: "Pick a model"
						})
					]
				}),
				/* @__PURE__ */ B("div", {
					className: "flex flex-wrap items-end gap-4",
					children: [/* @__PURE__ */ z(M, {
						label: "Project name",
						placeholder: "nac",
						hintText: "Large: forms and dialogs. 44px on touch screens.",
						className: "w-full max-w-[320px]"
					}), /* @__PURE__ */ z(M, {
						label: "Base URL",
						defaultValue: "api.example",
						validation: !0,
						validationText: "Enter a full URL, including https://",
						className: "w-full max-w-[320px]"
					})]
				}),
				/* @__PURE__ */ B("div", {
					className: "flex flex-wrap items-center gap-3",
					children: [/* @__PURE__ */ z(u, {
						variant: o.Secondary,
						onClick: e,
						children: "Open modal"
					}), /* @__PURE__ */ z("span", {
						className: "type-meta text-basic-tertiary",
						children: "A confirmation dialog: 20px corners, 52px header, pill actions."
					})]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/InsightItemsPreview.tsx
var fn = "The parser drops nested tables because the lexer resets its indent stack on every blank line. Check where resetIndent is called before changing it: the list renderer relies on the same reset.", pn = "npm run typecheck", mn = JSON.stringify({
	cmd: pn,
	workdir: "/workspace/demo-project",
	yield_time_ms: 1e4
}, null, 2), hn = "> nac-web@0.0.0 typecheck\n> tsc -p packages/nac-client/tsconfig.json --noEmit && tsc -b\n\nChecked src/app/components/inspector/insights/presentation/InsightDetailColumn.tsx without errors.", gn = `${hn}\nChecked 412 files in 6.1 s.\nFound 0 errors.`, _n = "Pause after the staging deploy and wait for my review before touching production.", vn = "resetIndent\\(", yn = JSON.stringify({
	pattern: vn,
	path: "src/app/lib",
	output_mode: "content"
}, null, 2), bn = "src/app/lib/lexer.ts:42\nsrc/app/lib/lexer.ts:118\nsrc/app/lib/parser/table.ts:7", xn = `${bn}\nsrc/app/lib/parser/list.ts:63\nsrc/app/lib/parser/list.ts:91`, Sn = [
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
], Y = `${Sn.join("|").slice(0, 110)}…`, Cn = JSON.stringify({
	pattern: Sn.join("|"),
	path: "src/app/lib",
	regex: !0
}, null, 2), wn = "The file changed on disk after it was read, so the edit was not applied. Read src/app/lib/lexer.ts again and repeat the edit against its current content; the old text no longer matches line 42.", Tn = `${wn.slice(0, 160).trimEnd()}...`, En = 1200;
function Dn() {
	let [e, t] = L(x.Default);
	return _t(() => {
		if (e !== x.Loading) return;
		let n = window.setTimeout(() => t(x.Expanded), En);
		return () => window.clearTimeout(n);
	}, [e]), {
		state: e,
		showFull: () => t(x.Loading),
		hide: () => t(x.Default)
	};
}
function X({ title: e, shortContent: t, fullContent: n }) {
	let r = Dn();
	return /* @__PURE__ */ z(ye, {
		title: e,
		state: r.state,
		shortContent: t,
		fullContent: n,
		onShowFull: r.showFull,
		onHide: r.hide
	});
}
function On() {
	let e = Dn(), t = e.state === x.Expanded;
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ z("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Error, the message cut by its preview"
		}), /* @__PURE__ */ z("div", {
			className: "w-[542px] max-w-full bg-elevation-ground",
			children: /* @__PURE__ */ z(ht, {
				id: "preview-cut-error",
				icon: s.Edit,
				title: "Edit lexer.ts",
				state: g.Error,
				errorMessage: t ? wn : Tn,
				errorAction: /* @__PURE__ */ z(Re, {
					expanded: t,
					loading: e.state === x.Loading,
					onClick: t ? e.hide : e.showFull
				})
			})
		})]
	});
}
var Z = () => {}, kn = [
	{
		label: "Default, with Show full",
		title: "Input",
		shortContent: Y,
		onShowFull: Z
	},
	{
		label: "Default, without Show full",
		title: "Input",
		shortContent: Y
	},
	{
		label: "Default, without a preview",
		title: "Input",
		shortContent: "",
		onShowFull: Z
	},
	{
		label: "Default, the load failed (Show full retries)",
		title: "Input",
		shortContent: Y,
		onShowFull: Z,
		error: "Could not load the full input."
	},
	{
		label: "Loading",
		title: "Input",
		state: x.Loading,
		shortContent: Y,
		onShowFull: Z
	},
	{
		label: "Expanded",
		title: "Input",
		state: x.Expanded,
		shortContent: Y,
		fullContent: Cn,
		onHide: Z
	},
	{
		label: "Expanded, cut by the server",
		title: "Input",
		state: x.Expanded,
		shortContent: Y,
		fullContent: Cn,
		onHide: Z,
		note: "The server cut this input at its size limit."
	},
	{
		label: "Without heading",
		title: "Input",
		showHeading: !1,
		shortContent: Y,
		onShowFull: Z
	}
];
function An() {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ z("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code displayer"
		}), /* @__PURE__ */ B("div", {
			className: "grid grid-cols-3 items-start gap-4",
			children: [kn.map(({ label: e, ...t }) => /* @__PURE__ */ B("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: e
				}), /* @__PURE__ */ z("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ z(ye, { ...t })
				})]
			}, e)), /* @__PURE__ */ B("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: "Interactive"
				}), /* @__PURE__ */ z("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ z(X, {
						title: "Input",
						shortContent: Y,
						fullContent: Cn
					})
				})]
			})]
		})]
	});
}
var jn = [
	{
		type: "Reasoning",
		icon: s.Brain,
		title: "Thoughts, 2.3 s",
		loadingTitle: "Thinking",
		copyText: fn,
		errorMessage: "The model stopped before it finished reasoning.",
		body: (e) => e === g.Default ? /* @__PURE__ */ z("p", { children: fn }) : null
	},
	{
		type: "Run Command (Error keeps the input)",
		icon: s.Terminal,
		title: "Run command",
		loadingTitle: "Running command",
		copyText: pn,
		errorMessage: "Command exited with code 2.",
		body: (e) => {
			if (e === g.Loading) return null;
			let t = /* @__PURE__ */ z(X, {
				title: "Input",
				shortContent: pn,
				fullContent: mn
			});
			return e === g.Error ? t : /* @__PURE__ */ B(R, { children: [t, /* @__PURE__ */ z(X, {
				title: "Output",
				shortContent: hn,
				fullContent: gn
			})] });
		}
	},
	{
		type: "Steer Session (Loading and Error keep the link)",
		icon: s.AddChat,
		title: "Steer session",
		loadingTitle: "Steer session",
		copyText: _n,
		errorMessage: "The session is no longer running.",
		body: (e) => e === g.Default ? /* @__PURE__ */ B(R, { children: [/* @__PURE__ */ z("p", { children: _n }), /* @__PURE__ */ z(Le, {
			label: "Calendar rollout",
			href: "#/design"
		})] }) : /* @__PURE__ */ z(Le, {
			label: "Calendar rollout",
			onClick: () => {}
		})
	},
	{
		type: "Search File",
		icon: s.SearchFile,
		title: "Search files",
		loadingTitle: "Search files",
		copyText: vn,
		errorMessage: "The pattern is not a valid regular expression.",
		body: (e) => {
			if (e === g.Loading) return null;
			let t = /* @__PURE__ */ z(X, {
				title: "Input",
				shortContent: vn,
				fullContent: yn
			});
			return e === g.Error ? t : /* @__PURE__ */ B(R, { children: [t, /* @__PURE__ */ z(X, {
				title: "Output",
				shortContent: bn,
				fullContent: xn
			})] });
		}
	}
], Mn = [
	{
		state: g.Default,
		title: "Default"
	},
	{
		state: g.Loading,
		title: "Loading"
	},
	{
		state: g.Error,
		title: "Error"
	}
];
function Nn() {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ z("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Stacked, the first one active"
		}), /* @__PURE__ */ z("div", {
			className: "flex w-[542px] max-w-full flex-col bg-elevation-ground",
			children: jn.map((e, t) => /* @__PURE__ */ z(ht, {
				id: `preview-stacked-${e.icon}`,
				icon: e.icon,
				title: e.title,
				active: t === 0,
				copyText: e.copyText,
				children: e.body(g.Default)
			}, e.type))
		})]
	});
}
function Pn() {
	return /* @__PURE__ */ B("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ z(An, {}),
			/* @__PURE__ */ z(Nn, {}),
			/* @__PURE__ */ z(On, {}),
			/* @__PURE__ */ B("div", {
				className: "grid grid-cols-3 items-start gap-x-4 gap-y-2",
				children: [Mn.map(({ state: e, title: t }) => /* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-muted",
					children: t
				}, e)), jn.flatMap((e) => [!1, !0].map((t) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ z("span", {
					className: "col-span-3 pt-2 type-meta-strong text-basic-tertiary",
					children: t ? `${e.type}, active` : e.type
				}), Mn.map(({ state: n }) => /* @__PURE__ */ z("div", {
					className: "min-w-0 bg-elevation-ground",
					children: /* @__PURE__ */ z(ht, {
						id: `preview-${e.icon}-${n}-${t}`,
						icon: e.icon,
						title: n === g.Loading ? e.loadingTitle : e.title,
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
var Fn = [
	{
		type: "Thread",
		icon: s.Chat,
		label: "impl/calendar",
		meta: "Thread, 3"
	},
	{
		type: "Thoughts",
		icon: s.Brain,
		label: "Thoughts",
		meta: "13.8 s",
		runningLabel: "Thinking…"
	},
	{
		type: "Define Workset",
		icon: s.Checklist,
		label: "calendar-sync",
		meta: "Workset",
		failedLabel: "Define Workset",
		runningLabel: "Defining Workset…"
	},
	{
		type: "Delete Workset",
		icon: s.Trash,
		label: "Deleted: impl/calendar",
		failedLabel: "Delete thread",
		runningLabel: "Deleting…"
	},
	{
		type: "Read File",
		icon: s.ReadFile,
		label: "index.tsx",
		meta: "Read",
		failedLabel: "Read File",
		runningLabel: "Reading File…"
	},
	{
		type: "Write File",
		icon: s.FileUpload,
		label: "index.tsx",
		meta: "Write",
		failedLabel: "Create File",
		runningLabel: "Creating File…"
	},
	{
		type: "Edit File",
		icon: s.Edit,
		label: "index.tsx",
		meta: "Edit",
		failedLabel: "Edit File",
		runningLabel: "Editing File…"
	},
	{
		type: "Glob",
		icon: s.SearchFiles,
		label: "Find files",
		meta: "Glob",
		runningLabel: "Find files…"
	},
	{
		type: "Grep",
		icon: s.SearchFile,
		label: "Search files",
		meta: "Grep",
		runningLabel: "Search files…"
	},
	{
		type: "Run Terminal",
		icon: s.Terminal,
		label: "Run command",
		meta: "Exec",
		runningLabel: "Running command…"
	},
	{
		type: "Use Terminal",
		icon: s.WriteCommand,
		label: "Write command",
		meta: "Write",
		runningLabel: "Write command…"
	},
	{
		type: "Read Output Command",
		icon: s.ScreenView,
		label: "Read Output Command",
		meta: "Read",
		runningLabel: "Read Output Command…"
	},
	{
		type: "Create goal",
		icon: s.Flag,
		label: "Create goal",
		meta: "Create",
		runningLabel: "Creating goal…"
	},
	{
		type: "Read goal",
		icon: s.Goal,
		label: "Get goal",
		meta: "Read",
		runningLabel: "Get goal…"
	},
	{
		type: "Update goal",
		icon: s.Checklist,
		label: "Update goal",
		meta: "Edit",
		runningLabel: "Updating goal…"
	},
	{
		type: "Spawn Session - Agent",
		icon: s.Plane,
		label: "Calendar sync agent",
		meta: "Spawn",
		failedLabel: "Spawn Agent",
		runningLabel: "Spawn Agent…"
	},
	{
		type: "Spawn Session - Orchestrator",
		icon: s.Orchestrator,
		label: "Calendar rollout",
		meta: "Spawn",
		failedLabel: "Spawn Orchestrator",
		runningLabel: "Spawn Orchestrator…"
	},
	{
		type: "Check session status",
		icon: s.Info,
		label: "Calendar sync agent",
		meta: "Check",
		failedLabel: "Check session status",
		runningLabel: "Checking session status…"
	},
	{
		type: "Steer Session",
		icon: s.AddChat,
		label: "Calendar rollout",
		meta: "Steer",
		failedLabel: "Steer session",
		runningLabel: "Steer session…"
	},
	{
		type: "Session Read",
		icon: s.Eye,
		label: "Calendar rollout",
		meta: "Read",
		failedLabel: "Read session",
		runningLabel: "Reading session…"
	},
	{
		type: "Session Wait",
		icon: s.Timelaps,
		label: "Calendar rollout",
		meta: "Wait",
		failedLabel: "Wait for session",
		runningLabel: "Wait for session…"
	},
	{
		type: "Cancel session",
		icon: s.Trash,
		label: "Calendar sync agent",
		meta: "Delete",
		failedLabel: "Delete session",
		runningLabel: "Deleting session…"
	},
	{
		type: "ToolsSegment",
		icon: s.Right,
		label: "Total activity: 13.3s",
		meta: "12",
		runningLabel: "Working…",
		group: !0
	},
	{
		type: "Web search",
		icon: s.Search,
		label: "tokio select timeout",
		meta: "Search",
		runningLabel: "Searching the web…"
	},
	{
		type: "Web fetch",
		icon: s.Globe,
		label: "docs.rs",
		meta: "Fetch",
		runningLabel: "Fetching docs.rs…"
	},
	{
		type: "Other tool",
		icon: s.Code,
		label: "MCP · list_issues",
		meta: "Tool",
		runningLabel: "Running list_issues…"
	}
], In = [
	{
		status: N.Ready,
		title: "Ready"
	},
	{
		status: N.Pending,
		title: "Pending"
	},
	{
		status: N.Running,
		title: "Running"
	},
	{
		status: N.Failed,
		title: "Failed or canceled"
	}
], Ln = [
	"Thread",
	"Read File",
	"ToolsSegment"
], Q = [
	{
		key: "thoughts",
		icon: s.Brain,
		label: "Thoughts",
		meta: "13.8 s"
	},
	{
		key: "read",
		icon: s.ReadFile,
		label: "index.tsx",
		meta: "Read"
	},
	{
		key: "write",
		icon: s.FileUpload,
		label: "index.tsx",
		meta: "Write"
	}
], Rn = [
	"impl/calendar",
	"impl/recurring-events",
	"review/calendar",
	"docs/calendar"
], zn = "flex w-[268px] flex-col gap-1 bg-elevation-ground p-2", Bn = "flex w-[380px] flex-col gap-1 bg-elevation-ground p-2";
function Vn(e, t) {
	return t === N.Running ? e.runningLabel ?? e.label : t === N.Failed ? e.failedLabel ?? e.label : e.label;
}
function Hn(e, t) {
	return (t === N.Running || t === N.Failed) && e.type !== "Thread" ? void 0 : e.meta;
}
function Un() {
	let e = [...Fn.map((e) => ({
		sample: e,
		active: !1
	})), ...Fn.filter((e) => Ln.includes(e.type)).map((e) => ({
		sample: e,
		active: !0
	}))];
	return /* @__PURE__ */ B("div", {
		className: "grid grid-cols-[136px_repeat(4,minmax(0,1fr))] items-center gap-x-3 gap-y-1",
		children: [
			/* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: "Type"
			}),
			In.map(({ status: e, title: t }) => /* @__PURE__ */ z("span", {
				className: "px-2 type-meta-strong text-basic-muted",
				children: t
			}, e)),
			e.map(({ sample: e, active: t }) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ z("span", {
				className: "truncate type-meta-strong text-basic-tertiary",
				children: t ? `${e.type}, active` : e.type
			}), In.map(({ status: n }) => /* @__PURE__ */ z(P, {
				icon: e.icon,
				label: Vn(e, n),
				meta: Hn(e, n),
				status: n,
				selected: t || void 0,
				expanded: e.group ? t : void 0
			}, n))] }, `${e.type}-${t}`))
		]
	});
}
function Wn() {
	let [e, t] = L(!0), [n, r] = L("thoughts"), i = n === "group" || Q.some(({ key: e }) => e === n);
	return /* @__PURE__ */ B("div", {
		className: zn,
		children: [
			/* @__PURE__ */ z(P, {
				icon: s.Right,
				label: "Total activity: 13.3s",
				meta: String(Q.length),
				expanded: e,
				selected: i,
				onClick: () => {
					t((e) => !e), r("group");
				}
			}),
			e ? /* @__PURE__ */ z(k, { children: Q.map((e) => /* @__PURE__ */ z(P, {
				icon: e.icon,
				label: e.label,
				meta: e.meta,
				selected: n === e.key,
				onClick: () => r(e.key)
			}, e.key)) }) : null,
			/* @__PURE__ */ z(P, {
				icon: s.Eye,
				label: "Calendar rollout",
				meta: "Read",
				onClick: () => {}
			}),
			/* @__PURE__ */ z(P, {
				icon: s.Right,
				label: "Total activity: 4.1s",
				meta: "5",
				expanded: !1
			}),
			/* @__PURE__ */ z(P, {
				icon: s.Orchestrator,
				label: "Calendar rollout",
				meta: "Spawn",
				onClick: () => {}
			}),
			/* @__PURE__ */ z(P, {
				icon: s.Brain,
				label: "Thoughts",
				meta: "2.1 s",
				selected: n === "last",
				onClick: () => r("last")
			})
		]
	});
}
function Gn() {
	let [e, t] = L(Rn[0]), n = (n) => /* @__PURE__ */ z(P, {
		icon: s.Chat,
		label: n,
		meta: "Thread, 3",
		selected: e === n,
		onClick: () => t(n)
	}, n);
	return /* @__PURE__ */ B("div", {
		className: zn,
		children: [
			/* @__PURE__ */ z(P, {
				icon: s.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ z(k, { children: Rn.map(n) }),
			/* @__PURE__ */ z(P, {
				icon: s.Right,
				label: "Total activity: 13.3s",
				meta: "12",
				expanded: !1
			}),
			/* @__PURE__ */ z(k, { children: n("impl/time-zones") }),
			/* @__PURE__ */ z(P, {
				icon: s.Brain,
				label: "Thoughts",
				meta: "2.1 s"
			})
		]
	});
}
function Kn() {
	return /* @__PURE__ */ B("div", {
		className: zn,
		children: [
			/* @__PURE__ */ z(P, {
				icon: s.Chat,
				label: "impl/calendar-sync-recurring-events-and-time-zones",
				meta: "Thread, 12"
			}),
			/* @__PURE__ */ z(P, {
				icon: s.Orchestrator,
				label: "Roll the recurring-events fix out to every calendar provider",
				meta: "Spawn"
			}),
			/* @__PURE__ */ z(P, {
				icon: s.Plane,
				label: "Investigate why the nightly export drops recurring events",
				meta: "Spawn",
				status: N.Pending,
				selected: !0
			})
		]
	});
}
function qn() {
	let [e, t] = L(!0), [n, r] = L("review/calendar"), i = nt.Large;
	return /* @__PURE__ */ B("div", {
		className: Bn,
		children: [
			/* @__PURE__ */ z(P, {
				size: i,
				icon: s.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ B(k, {
				className: "py-2",
				children: [
					/* @__PURE__ */ z(P, {
						size: i,
						icon: s.Chat,
						label: "impl/calendar",
						meta: "Thread, 3",
						status: N.Running
					}),
					/* @__PURE__ */ z(P, {
						size: i,
						icon: s.Chat,
						label: "impl/recurring-events",
						meta: "Thread, 2",
						status: N.Failed
					}),
					/* @__PURE__ */ z(P, {
						size: i,
						icon: s.Chat,
						label: "docs/calendar",
						meta: "Thread, 1",
						status: N.Pending
					}),
					/* @__PURE__ */ z(P, {
						size: i,
						icon: s.Chat,
						label: "review/calendar",
						meta: "Thread, 3",
						selected: n === "review/calendar",
						onClick: () => r("review/calendar")
					})
				]
			}),
			/* @__PURE__ */ z(P, {
				size: i,
				icon: s.Right,
				label: "Worked for 13.3s",
				meta: String(Q.length),
				expanded: e,
				onClick: () => t((e) => !e)
			}),
			e ? /* @__PURE__ */ z(k, { children: Q.map((e) => /* @__PURE__ */ z(P, {
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
function Jn() {
	return /* @__PURE__ */ z(S, {
		title: "Insights",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ z(Un, {}),
				/* @__PURE__ */ B("div", {
					className: "flex flex-wrap items-start gap-6",
					children: [
						/* @__PURE__ */ z(Wn, {}),
						/* @__PURE__ */ z(Gn, {}),
						/* @__PURE__ */ z(Kn, {}),
						/* @__PURE__ */ z(qn, {})
					]
				}),
				/* @__PURE__ */ z(Pn, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ModelLoaderSection.tsx
var Yn = [{
	variant: Ce.Default,
	label: "Default"
}, {
	variant: Ce.Accent,
	label: "Accent"
}], Xn = [
	{
		size: ve.Small,
		label: "Small 16px"
	},
	{
		size: ve.Medium,
		label: "Medium 20px"
	},
	{
		size: ve.Large,
		label: "Large 24px"
	}
], Zn = [
	1,
	2,
	3
];
function Qn() {
	return /* @__PURE__ */ z(S, {
		title: "Model loader",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(4,72px)] items-center gap-x-4 gap-y-3",
			children: [
				/* @__PURE__ */ z("span", {}),
				/* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Animated"
				}),
				Zn.map((e) => /* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: ["Frame ", e]
				}, e)),
				Yn.flatMap(({ variant: e, label: t }) => Xn.map(({ size: n, label: r }) => /* @__PURE__ */ B(I, { children: [
					/* @__PURE__ */ B("span", {
						className: "type-body-chrome text-basic-secondary",
						children: [
							t,
							" · ",
							r
						]
					}),
					/* @__PURE__ */ z(ze, {
						size: n,
						variant: e
					}),
					Zn.map((t) => /* @__PURE__ */ z(ze, {
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
function $n() {
	return /* @__PURE__ */ z(S, {
		title: "Notices",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ B("div", {
				className: "flex flex-wrap gap-3",
				children: [
					/* @__PURE__ */ z(De, {
						variant: ge.Info,
						title: "Read-only snapshot",
						className: "w-full max-w-[280px]",
						children: "Pick the working tree to edit files again."
					}),
					/* @__PURE__ */ z(De, {
						variant: ge.Error,
						title: "Run failed",
						className: "w-full max-w-[280px]",
						children: "The provider rejected the request."
					}),
					/* @__PURE__ */ z(De, {
						variant: ge.Success,
						title: "Branch switched",
						className: "w-full max-w-[280px]"
					})
				]
			}), /* @__PURE__ */ B("div", {
				className: "flex w-full max-w-[398px] flex-col gap-2",
				children: [
					/* @__PURE__ */ z(_, {
						variant: xe.Danger,
						title: "Needs your answer",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ z(_, {
						variant: xe.Error,
						title: "Provider rejected the request",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ z(_, {
						variant: xe.Success,
						title: "Branch merged",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ z(_, {
						variant: xe.Info,
						title: "Snapshot restored",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					})
				]
			})]
		})
	});
}
// src/app/components/pages/design-preview/NumericInputsSection.tsx
function er() {
	let [e, t] = L(4), [n, r] = L(.7), [i, a] = L(["local"]), [o, ee] = L(1);
	return /* @__PURE__ */ z(S, {
		title: "Numeric inputs, tags and pagination",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ B("div", {
					className: "flex flex-wrap items-center gap-8",
					children: [/* @__PURE__ */ z(Ee, {
						value: e,
						onChange: t,
						min: 1,
						max: 16,
						"aria-label": "Parallel threads"
					}), /* @__PURE__ */ B("div", {
						className: "flex items-center gap-4 w-[320px]",
						children: [/* @__PURE__ */ z(me, {
							min: 0,
							max: 2,
							step: .1,
							value: n,
							onChange: r,
							label: "Temperature"
						}), /* @__PURE__ */ z("span", {
							className: "code code-small text-basic-muted w-8 shrink-0",
							children: n.toFixed(1)
						})]
					})]
				}),
				/* @__PURE__ */ z(mt, {
					tags: [
						"local",
						"docker",
						"remote",
						"sandbox"
					],
					selected: i,
					onChange: a
				}),
				/* @__PURE__ */ z(Ze, {
					page: o,
					pageSize: 10,
					totalItems: 84,
					itemLabel: "sessions",
					onPageChange: ee,
					className: "border-t border-muted"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/OverlaysSection.tsx
var tr = [
	{
		icon: s.Edit,
		label: "Rename"
	},
	{
		icon: s.FileCopy,
		label: "Copy link"
	},
	{
		icon: s.Pin,
		label: "Pin to top"
	}
], nr = [
	{
		variant: d.Success,
		content: "Session settings saved"
	},
	{
		variant: d.Danger,
		content: "Connection lost. Retrying…"
	},
	{
		variant: d.Error,
		content: "Could not update pin"
	}
];
function rr() {
	let [e, t] = L([]), n = vt(0), r = vt(/* @__PURE__ */ new Set());
	_t(() => {
		let e = r.current;
		return () => e.forEach(clearTimeout);
	}, []);
	let i = (e, t) => {
		let n = setTimeout(() => {
			r.current.delete(n), e();
		}, t);
		r.current.add(n);
	}, a = (e) => {
		t((t) => t.map((t) => t.id === e ? {
			...t,
			dismissing: !0
		} : t)), i(() => t((t) => t.filter((t) => t.id !== e)), 160);
	};
	return {
		toasts: e,
		show: () => {
			let e = nr[n.current % nr.length], r = n.current++;
			t((t) => [...t, {
				id: r,
				...e,
				dismissing: !1
			}]), i(() => a(r), 3e3);
		},
		dismiss: a
	};
}
function ir() {
	let [r, a] = L(!1), [te, d] = L(!1), [re, f] = L(!1), { toasts: p, show: ae, dismiss: m } = rr();
	return /* @__PURE__ */ B(S, {
		title: "Overlays",
		children: [
			/* @__PURE__ */ B(H, {
				label: "Popover",
				hint: "Overlay surface, 14px corner, 32px rows. A sheet on phones.",
				children: [
					/* @__PURE__ */ z(ee, {
						open: r,
						onClose: () => a(!1),
						placement: i.BottomRight,
						size: oe.Small,
						sticky: !0,
						content: tr.map((t) => /* @__PURE__ */ B(He, {
							size: j.Medium,
							onClick: () => a(!1),
							children: [/* @__PURE__ */ z(e, { iconName: t.icon }), /* @__PURE__ */ z("span", {
								className: "min-w-0 flex-1 truncate text-left",
								children: t.label
							})]
						}, t.label)),
						children: /* @__PURE__ */ B(u, {
							variant: o.Secondary,
							content: l.IconRight,
							"aria-expanded": r,
							onClick: () => a((e) => !e),
							children: ["Open popover", /* @__PURE__ */ z(e, { iconName: s.Down })]
						})
					}),
					/* @__PURE__ */ z(ne, { value: "nac" }),
					/* @__PURE__ */ z(t, { keys: ["cmd", "k"] })
				]
			}),
			/* @__PURE__ */ B(H, {
				label: "Tooltip",
				hint: "An inverse ink chip, 12px, with its shortcut.",
				children: [/* @__PURE__ */ z(se, {
					title: "New session",
					keyboardShortcuts: ["cmd", "n"],
					position: i.BottomCenter,
					children: /* @__PURE__ */ z(u, {
						variant: o.Ghost,
						content: l.Icon,
						"aria-label": "New session",
						children: /* @__PURE__ */ z(e, { iconName: s.Add })
					})
				}), /* @__PURE__ */ z(se, {
					title: "Pin session",
					description: "Keeps it at the top of its project.",
					position: i.BottomCenter,
					sticky: !0,
					showTooltipOnMobile: !0,
					children: /* @__PURE__ */ z(u, {
						variant: o.Ghost,
						content: l.Icon,
						"aria-label": "Pin",
						children: /* @__PURE__ */ z(e, { iconName: s.Pin })
					})
				})]
			}),
			/* @__PURE__ */ z(H, {
				label: "Toast",
				hint: "A small pill at the bottom centre; errors read in red.",
				children: /* @__PURE__ */ z(u, {
					variant: o.Secondary,
					onClick: ae,
					children: "Show a toast"
				})
			}),
			/* @__PURE__ */ B(H, {
				label: "Drawer and sheet",
				hint: "Right drawer on desktop, bottom sheet on phones.",
				children: [/* @__PURE__ */ z(u, {
					variant: o.Secondary,
					onClick: () => d(!0),
					children: "Open drawer"
				}), /* @__PURE__ */ z(u, {
					variant: o.Secondary,
					onClick: () => f(!0),
					children: "Open bottom sheet"
				})]
			}),
			/* @__PURE__ */ z(dt, {
				open: te,
				onClose: () => d(!1),
				title: "Changes",
				headerActions: /* @__PURE__ */ z(u, {
					variant: o.Ghost,
					size: c.Small,
					children: "All changes"
				}),
				children: /* @__PURE__ */ B("div", {
					className: "type-body-chrome flex flex-col gap-3 p-4 text-basic-secondary",
					children: [/* @__PURE__ */ z("p", { children: "Drawers carry everything that is not the conversation: changes, subagents, terminal, goal, schedules and insights. They open from the header pills." }), /* @__PURE__ */ z("p", {
						className: "text-basic-tertiary",
						children: "Escape or the close button returns focus here."
					})]
				})
			}),
			/* @__PURE__ */ z(n, {
				open: re,
				onClose: () => f(!1),
				children: /* @__PURE__ */ z("div", {
					className: "flex flex-col px-2",
					children: tr.map((t) => /* @__PURE__ */ B(He, {
						size: j.Large,
						onClick: () => f(!1),
						children: [/* @__PURE__ */ z(e, { iconName: t.icon }), /* @__PURE__ */ z("span", {
							className: "min-w-0 flex-1 truncate text-left",
							children: t.label
						})]
					}, t.label))
				})
			}),
			p.length > 0 ? /* @__PURE__ */ z("div", {
				className: "pointer-events-none fixed inset-x-0 bottom-[calc(20px+env(safe-area-inset-bottom))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2",
				children: p.map((e) => /* @__PURE__ */ z(ie, {
					variant: e.variant,
					content: e.content,
					dismissing: e.dismissing,
					onClose: () => m(e.id)
				}, e.id))
			}) : null
		]
	});
}
// src/app/components/pages/design-preview/PaletteSection.tsx
var ar = [
	{
		label: "Surfaces",
		note: "Warm paper; elevation is a step of lightness plus a hairline.",
		swatches: [
			{
				name: "Ground",
				token: "--f-ground"
			},
			{
				name: "Sidebar",
				token: "--f-sidebar"
			},
			{
				name: "Surface",
				token: "--f-surface"
			},
			{
				name: "Overlay",
				token: "--f-overlay"
			}
		]
	},
	{
		label: "Ink",
		note: "Primary actions are ink. There is no brand hue in chrome.",
		swatches: [
			{
				name: "Primary",
				token: "--f-ink"
			},
			{
				name: "Secondary",
				token: "--f-ink-2"
			},
			{
				name: "Tertiary",
				token: "--f-ink-3"
			},
			{
				name: "Muted",
				token: "--f-ink-4"
			},
			{
				name: "Faint",
				token: "--f-ink-5"
			}
		]
	},
	{
		label: "Washes and lines",
		note: "Ink at low alpha: hovers, selection and hairlines that work on any surface.",
		swatches: [
			{
				name: "Wash 1",
				token: "--f-wash-1"
			},
			{
				name: "Wash 2",
				token: "--f-wash-2"
			},
			{
				name: "Wash 3",
				token: "--f-wash-3"
			},
			{
				name: "Line",
				token: "--f-line",
				line: !0
			},
			{
				name: "Strong line",
				token: "--f-line-strong",
				line: !0
			}
		]
	},
	{
		label: "Signals",
		note: "Colour only ever means something.",
		swatches: [
			{
				name: "Needs you",
				token: "--f-amber"
			},
			{
				name: "Failed",
				token: "--f-red"
			},
			{
				name: "Done, added",
				token: "--f-green"
			},
			{
				name: "Link",
				token: "--f-blue"
			}
		]
	}
];
function or({ swatch: e }) {
	return /* @__PURE__ */ B("div", {
		className: "flex min-w-0 flex-col gap-1",
		children: [
			/* @__PURE__ */ z("span", {
				"aria-hidden": !0,
				className: p("h-10 w-full rounded-md", e.line ? "border-2" : "shadow-[inset_0_0_0_1px_var(--f-line)]"),
				style: e.line ? {
					borderColor: `var(${e.token})`,
					background: "var(--f-surface)"
				} : { background: `var(${e.token})` }
			}),
			/* @__PURE__ */ z("span", {
				className: "type-meta-strong mt-0.5 truncate text-[var(--f-ink)]",
				children: e.name
			}),
			/* @__PURE__ */ z("code", {
				className: "truncate font-mono text-2xs text-[var(--f-ink-3)]",
				children: e.token
			})
		]
	});
}
function sr({ mode: e }) {
	return /* @__PURE__ */ B("div", {
		className: p(e, "flex min-w-0 flex-1 flex-col gap-5 rounded-card border border-[var(--f-line)] bg-[var(--f-ground)] p-4 text-[var(--f-ink)]"),
		children: [/* @__PURE__ */ B("div", {
			className: "flex items-baseline justify-between gap-2",
			children: [/* @__PURE__ */ z("span", {
				className: "type-strong",
				children: e === "light" ? "Light" : "Dark"
			}), /* @__PURE__ */ z("span", {
				className: "type-meta text-[var(--f-ink-3)]",
				children: e === "light" ? "Ink on warm paper" : "Designed, not inverted"
			})]
		}), ar.map((e) => /* @__PURE__ */ B("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ z("span", {
				className: "type-meta-strong text-[var(--f-ink-3)]",
				children: e.label
			}), /* @__PURE__ */ z("div", {
				className: "grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-x-2.5 gap-y-3",
				children: e.swatches.map((e) => /* @__PURE__ */ z(or, { swatch: e }, e.token))
			})]
		}, e.label))]
	});
}
function cr() {
	return /* @__PURE__ */ z(S, {
		title: "Palette",
		children: /* @__PURE__ */ B("div", {
			className: "flex flex-col gap-4 p-4",
			children: [/* @__PURE__ */ z("ul", {
				className: "type-body-chrome flex flex-col gap-1 text-basic-secondary",
				children: ar.map((e) => /* @__PURE__ */ B("li", { children: [
					/* @__PURE__ */ B("span", {
						className: "text-basic-primary",
						children: [e.label, "."]
					}),
					" ",
					e.note
				] }, e.label))
			}), /* @__PURE__ */ B("div", {
				className: "flex flex-col gap-4 lg:flex-row",
				children: [/* @__PURE__ */ z(sr, { mode: "light" }), /* @__PURE__ */ z(sr, { mode: "dark" })]
			})]
		})
	});
}
// src/app/components/pages/design-preview/QualificationSection.tsx
function lr() {
	return /* @__PURE__ */ z(S, {
		title: "Selected presentation journeys",
		children: /* @__PURE__ */ B("div", {
			className: "type-body-chrome flex min-w-0 flex-col gap-3 p-4 text-basic-secondary",
			children: [
				/* @__PURE__ */ z("p", { children: "Use these production patterns together: readable reasoning and answers, calm navigation, one new-session flow from Home, a settings page with grouped sections, managed readiness and drawers with a clear way back. Keep a 4px spacing rhythm and 44px phone controls." }),
				/* @__PURE__ */ z("p", { children: "Samples document the treatment. Qualify complete journeys in the built standalone app and the exact packed presentation, including two independent views alongside host controls. Check light and dark, long and error content, keyboard focus, reduced motion and real 200% browser zoom." }),
				/* @__PURE__ */ z("p", { children: "Native inputs, the instance-owned overlay stack and specialized code, math, diff and terminal views retain their existing owners. A sample or passing fixture does not record human design acceptance or signed hosted qualification." })
			]
		})
	});
}
// src/app/components/pages/design-preview/ReasoningSection.tsx
var ur = "The build spends most of its time preparing images. I’ll check the cache key before changing the build steps.\n\nA stable key should include the lockfile and image directory so unchanged inputs can reuse the cache.";
function dr() {
	let [e, t] = L(!0);
	return /* @__PURE__ */ z(S, {
		title: "Conversation: reasoning and answer",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex min-w-0 flex-col gap-4",
			children: [
				/* @__PURE__ */ z("p", {
					className: "type-body-chrome text-basic-secondary",
					children: "Reasoning: 14px / 22px, secondary text, 12px paragraphs, 16px inset, 1px tertiary rule, no filled surface. Header and copy targets: 44px. Answer: existing 14px / 24px primary prose. Live opens; settled starts closed. A reader’s toggle, focus or selection wins on settlement. Activity remains a link to Insights; this is its reasoning detail, without a second heading."
				}),
				/* @__PURE__ */ z(u, {
					variant: o.Secondary,
					onClick: () => t(!e),
					children: e ? "Settle reasoning" : "Resume reasoning"
				}),
				/* @__PURE__ */ z(ct, {
					segment: {
						kind: "reasoning",
						key: "preview",
						text: ur,
						streaming: e,
						durationMs: e ? null : 2300
					},
					active: !1
				}),
				/* @__PURE__ */ z(et, { children: "Use a stable image cache key to avoid rebuilding unchanged images." })
			]
		})
	});
}
// src/app/components/pages/design-preview/samples.ts
var fr = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
];
// src/app/components/pages/design-preview/SessionAvatarsSection.tsx
function pr() {
	return /* @__PURE__ */ z(S, {
		title: "Session avatars",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [fr.map((e) => /* @__PURE__ */ B("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ z(ce, {
					id: e,
					size: 40
				}), /* @__PURE__ */ z("span", {
					className: "code code-small text-basic-muted",
					children: e
				})]
			}, e)), /* @__PURE__ */ B("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ z(Ae, {}), /* @__PURE__ */ z("span", {
					className: "code code-small text-basic-muted",
					children: "unassigned"
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/SessionIdentitySection.tsx
var mr = [
	gt.Small,
	gt.Medium,
	gt.Large
], hr = [
	{
		label: "Default",
		className: "text-fill-btn-secondary"
	},
	{
		label: "Hovered",
		className: "text-fill-btn-secondary-hovered"
	},
	{
		label: "Pressed",
		className: "text-fill-btn-secondary-pressed"
	},
	{
		label: "Disabled",
		className: "text-fill-btn-secondary-disabled"
	}
], gr = [
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
], _r = [
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
], vr = () => {};
function yr() {
	return /* @__PURE__ */ B("div", {
		className: "grid w-fit grid-cols-[200px_repeat(12,32px)] items-center gap-y-3",
		children: [
			/* @__PURE__ */ z("span", {}),
			hr.map((e) => /* @__PURE__ */ z("span", {
				className: "col-span-3 type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			le.map((e) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ z("span", {
				className: "type-body-chrome truncate text-basic-secondary",
				children: e.label
			}), hr.flatMap((t) => mr.map((n) => /* @__PURE__ */ z("span", {
				className: p("flex items-center justify-center", t.className),
				children: /* @__PURE__ */ z(Ne, {
					behavior: e.id,
					size: n
				})
			}, `${t.label}-${n}`)))] }, e.id))
		]
	});
}
function br({ isMobile: e }) {
	let t = /* @__PURE__ */ z(Ke, {
		title: "Chat session 1",
		isMobile: e,
		onPin: vr,
		onRename: vr,
		onDelete: vr
	});
	return /* @__PURE__ */ B("div", {
		className: p("grid w-fit items-center gap-x-4 gap-y-2", e ? "grid-cols-[120px_repeat(4,240px)]" : "grid-cols-[120px_repeat(4,200px)]"),
		children: [
			/* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: e ? "Mobile" : "Desktop"
			}),
			gr.map((e) => /* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			_r.map((n) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ z("span", {
				className: "type-body-chrome text-basic-secondary",
				children: n.label
			}), gr.map((r) => /* @__PURE__ */ z(Te, {
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
function xr() {
	return /* @__PURE__ */ z(S, {
		title: "Project navigation",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ z(yr, {}),
				/* @__PURE__ */ B("div", {
					className: "flex items-start gap-2",
					children: [
						/* @__PURE__ */ z(v, {
							title: "Fix the parser",
							behavior: "direct",
							showBehaviorIcon: !0,
							active: !0
						}),
						/* @__PURE__ */ z(v, {
							title: "Rewrite the store layer",
							behavior: "direct-with-orchestrator",
							showBehaviorIcon: !0
						}),
						/* @__PURE__ */ z(v, {
							title: "Investigating",
							behavior: "orchestrator",
							showBehaviorIcon: !0,
							running: !0
						}),
						/* @__PURE__ */ z(v, {
							title: "Without NAC",
							behavior: "direct"
						}),
						/* @__PURE__ */ z(v, {
							title: "Fork: Fix the parser",
							forkedFromTitle: "Fix the parser"
						}),
						/* @__PURE__ */ z(v, {
							title: "Fork running",
							forkedFromTitle: "Fix the parser",
							running: !0
						})
					]
				}),
				/* @__PURE__ */ z(br, { isMobile: !1 }),
				/* @__PURE__ */ z(br, { isMobile: !0 }),
				/* @__PURE__ */ B("div", {
					className: "flex flex-col gap-2 max-w-[320px]",
					children: [/* @__PURE__ */ z(lt, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title"
					}), /* @__PURE__ */ z(lt, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title",
						deleted: !0
					})]
				}),
				/* @__PURE__ */ B("div", {
					className: "flex flex-col gap-1 max-w-[320px]",
					children: [
						/* @__PURE__ */ z(ke, {
							entityId: fr[3],
							name: "arcee-ai/nac",
							trailing: "4",
							active: !0
						}),
						/* @__PURE__ */ z(ke, {
							entityId: fr[4],
							name: "arcee-ai/telos",
							trailing: "1",
							running: !0
						}),
						/* @__PURE__ */ z(ke, {
							entityId: fr[5],
							name: "Unassigned session",
							variant: $e.Orphan
						})
					]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/ShapeSection.tsx
var Sr = [
	{
		name: "rounded-xs",
		px: 4,
		use: "ticks"
	},
	{
		name: "rounded-sm",
		px: 6,
		use: "chips in rows"
	},
	{
		name: "rounded-md",
		px: 8,
		use: "rows, tooltips"
	},
	{
		name: "rounded-lg",
		px: 10,
		use: "inputs"
	},
	{
		name: "rounded-card",
		px: 14,
		use: "cards, popovers"
	},
	{
		name: "rounded-sheet",
		px: 20,
		use: "dialogs, sheets"
	},
	{
		name: "rounded-composer",
		px: 22,
		use: "composer"
	},
	{
		name: "rounded-pill",
		px: 9999,
		use: "controls, chips"
	}
], Cr = {
	"rounded-xs": "rounded-xs",
	"rounded-sm": "rounded-sm",
	"rounded-md": "rounded-md",
	"rounded-lg": "rounded-lg",
	"rounded-card": "rounded-card",
	"rounded-sheet": "rounded-sheet",
	"rounded-composer": "rounded-composer",
	"rounded-pill": "rounded-pill"
}, wr = [
	{
		name: "Ground",
		className: "bg-elevation-ground border border-tertiary",
		token: "page"
	},
	{
		name: "Surface",
		className: "bg-elevation-level-1 border border-tertiary",
		token: "cards"
	},
	{
		name: "Popover",
		className: "bg-elevation-level-3 shadow-lg",
		token: "shadow-lg"
	},
	{
		name: "Dialog",
		className: "bg-elevation-level-2 shadow-2xl",
		token: "shadow-2xl"
	}
], Tr = [
	{
		name: "--dur-fast",
		value: "120ms",
		use: "hover, press, colour"
	},
	{
		name: "--dur-base",
		value: "160ms",
		use: "popovers, toasts"
	},
	{
		name: "--dur-slow",
		value: "200ms",
		use: "drawers, sheets"
	}
];
function Er() {
	let [e, t] = L(!1);
	return /* @__PURE__ */ B(S, {
		title: "Shape, elevation and motion",
		children: [
			/* @__PURE__ */ z(H, {
				label: "Radius",
				hint: "One scale. Controls are pills; boxes step up.",
				children: /* @__PURE__ */ z("div", {
					className: "grid w-full grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-4 gap-y-5",
					children: Sr.map((e) => /* @__PURE__ */ B("div", {
						className: "flex min-w-0 flex-col gap-1.5",
						children: [
							/* @__PURE__ */ z("span", {
								"aria-hidden": !0,
								className: p("h-12 w-full border border-secondary bg-elevation-sublevel-variant-A", Cr[e.name])
							}),
							/* @__PURE__ */ z("code", {
								className: "truncate font-mono text-2xs text-basic-secondary",
								children: e.name
							}),
							/* @__PURE__ */ B("span", {
								className: "type-meta text-basic-muted",
								children: [
									e.px === 9999 ? "full" : `${e.px}px`,
									" · ",
									e.use
								]
							})
						]
					}, e.name))
				})
			}),
			/* @__PURE__ */ z(H, {
				label: "Elevation",
				hint: "Hairlines at rest; shadows only on floating layers.",
				children: /* @__PURE__ */ z("div", {
					className: "flex flex-wrap gap-4 rounded-card bg-elevation-ground p-4",
					children: wr.map((e) => /* @__PURE__ */ B("div", {
						className: p("flex h-20 w-[132px] flex-col justify-end rounded-card p-3", e.className),
						children: [/* @__PURE__ */ z("span", {
							className: "type-label text-basic-primary",
							children: e.name
						}), /* @__PURE__ */ z(U, { children: e.token })]
					}, e.name))
				})
			}),
			/* @__PURE__ */ z(H, {
				label: "Motion",
				hint: "Quick ease-out, never bouncy; reduced motion turns it off.",
				children: /* @__PURE__ */ B("div", {
					className: "flex w-full flex-col gap-3",
					children: [
						/* @__PURE__ */ z("div", {
							className: "flex flex-wrap gap-4",
							children: Tr.map((e) => /* @__PURE__ */ B("div", {
								className: "flex flex-col",
								children: [/* @__PURE__ */ z(U, { children: e.name }), /* @__PURE__ */ B("span", {
									className: "type-meta text-basic-tertiary",
									children: [
										e.value,
										" · ",
										e.use
									]
								})]
							}, e.name))
						}),
						/* @__PURE__ */ z("div", {
							className: "relative h-10 w-full max-w-[420px] rounded-pill bg-elevation-sublevel-variant-A",
							children: /* @__PURE__ */ z("span", {
								"aria-hidden": !0,
								className: "absolute top-1 size-8 rounded-pill bg-btn-primary transition-[left] duration-200 ease-[var(--ease-drawer)] motion-reduce:transition-none",
								style: { left: e ? "calc(100% - 36px)" : "4px" }
							})
						}),
						/* @__PURE__ */ z("div", { children: /* @__PURE__ */ z(u, {
							variant: o.Secondary,
							onClick: () => t((e) => !e),
							children: "Play drawer easing"
						}) })
					]
				})
			})
		]
	});
}
// src/app/components/pages/design-preview/StatusSection.tsx
var Dr = pt([
	"done",
	"working",
	"needs-answer",
	"idle"
]);
function Or() {
	return /* @__PURE__ */ B(S, {
		title: "Status",
		children: [
			/* @__PURE__ */ z(H, {
				label: "Ladder",
				hint: "Most urgent first; a row shows only its top rung.",
				children: /* @__PURE__ */ z("ol", {
					className: "flex w-full flex-col gap-2",
					children: Ue.map((e, t) => /* @__PURE__ */ B("li", {
						className: "flex items-center gap-3",
						children: [
							/* @__PURE__ */ z("span", {
								className: "type-meta tabular w-4 text-right text-basic-muted",
								children: t + 1
							}),
							/* @__PURE__ */ z(F, {
								status: e,
								size: "md",
								labelled: !0
							}),
							Pe(e) ? /* @__PURE__ */ z("span", {
								className: "type-tag rounded-pill bg-danger-primary px-2 py-0.5 text-danger-primary",
								children: "Needs you"
							}) : null
						]
					}, e))
				})
			}),
			/* @__PURE__ */ B(H, {
				label: "Roll-up",
				hint: "A parent shows its most urgent child.",
				children: [
					/* @__PURE__ */ z("span", {
						className: "type-body-chrome text-basic-secondary",
						children: "done, working, needs an answer, idle"
					}),
					/* @__PURE__ */ z("span", {
						"aria-hidden": !0,
						className: "text-basic-muted",
						children: "→"
					}),
					/* @__PURE__ */ z(F, {
						status: Dr,
						size: "md",
						labelled: !0
					}),
					/* @__PURE__ */ B("code", {
						className: "code-small text-basic-muted",
						children: ["sessionStatus(…) = ", de({
							running: !0,
							pendingQuestions: 1
						})]
					})
				]
			}),
			/* @__PURE__ */ z(H, {
				label: "Working",
				hint: "The only agent-working animation.",
				children: /* @__PURE__ */ B("div", {
					className: "flex items-center gap-2",
					children: [
						/* @__PURE__ */ z(F, { status: "working" }),
						/* @__PURE__ */ z("span", {
							className: "type-body-chrome focus-shimmer",
							children: "Running tests…"
						}),
						/* @__PURE__ */ z("span", {
							className: "type-meta tabular text-basic-muted",
							children: "1m 12s"
						})
					]
				})
			}),
			/* @__PURE__ */ B(H, {
				label: "Loaders",
				hint: "Plain and quiet, for everything that is not the agent.",
				children: [
					/* @__PURE__ */ z(r, {
						size: a.Small,
						"aria-label": "Loading"
					}),
					/* @__PURE__ */ z(Me, { size: a.Medium }),
					/* @__PURE__ */ z(Oe, {
						rows: 3,
						className: "w-[200px]"
					}),
					/* @__PURE__ */ z("div", {
						className: "w-[200px] overflow-hidden rounded-pill bg-elevation-sublevel-variant-A",
						children: /* @__PURE__ */ z(we, { active: !0 })
					})
				]
			})
		]
	});
}
var $ = {
	onOpen: () => {},
	sessionHref: "#/design"
}, kr = [
	{
		label: "Ready · direct agent",
		card: {
			title: "Child session title",
			status: b.Ready,
			behavior: "direct",
			...$
		}
	},
	{
		label: "Ready · direct + NAC",
		card: {
			title: "Child session title",
			status: b.Ready,
			behavior: "direct-with-orchestrator",
			...$
		}
	},
	{
		label: "Ready · managed orchestrator",
		card: {
			title: "Child session title",
			status: b.Ready,
			lineage: "managed-orchestrator",
			...$
		}
	},
	{
		label: "Running",
		card: {
			title: "Child session title",
			status: b.Running,
			behavior: "direct",
			...$
		}
	},
	{
		label: "Failed",
		card: {
			title: "Child session title",
			status: b.Failed,
			statusLabel: "Failed",
			behavior: "direct",
			...$
		}
	},
	{
		label: "Failed · cancelled",
		card: {
			title: "Child session title",
			status: b.Failed,
			statusLabel: "Cancelled",
			behavior: "direct",
			...$
		}
	},
	{
		label: "Not found",
		card: {
			title: "Child session title",
			status: b.NotFound,
			...$
		}
	},
	{
		label: "Static",
		card: {
			title: "Child session title",
			status: b.Ready,
			behavior: "direct"
		}
	}
], Ar = [{
	label: "NAC on",
	showBehaviorIcon: !0
}, {
	label: "NAC off",
	showBehaviorIcon: !1
}], jr = "Investigate the flaky parser tests in the store layer";
function Mr() {
	return /* @__PURE__ */ z(S, {
		title: "Subagent transcript card",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [/* @__PURE__ */ B("div", {
				className: "grid w-fit grid-cols-[200px_repeat(2,320px)] items-center gap-x-4 gap-y-3",
				children: [
					/* @__PURE__ */ z("span", {}),
					Ar.map((e) => /* @__PURE__ */ z("span", {
						className: "type-meta-strong text-basic-muted",
						children: e.label
					}, e.label)),
					kr.map((e) => /* @__PURE__ */ B(I, { children: [/* @__PURE__ */ z("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e.label
					}), Ar.map((t) => /* @__PURE__ */ z(ue, {
						showBehaviorIcon: t.showBehaviorIcon,
						...e.card
					}, t.label))] }, e.label))
				]
			}), /* @__PURE__ */ B("div", {
				className: "flex flex-col gap-2",
				children: [/* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Narrow container · 240px"
				}), /* @__PURE__ */ B("div", {
					className: "flex w-[240px] flex-col gap-3",
					children: [/* @__PURE__ */ z(ue, {
						title: jr,
						status: b.Ready,
						behavior: "direct",
						showBehaviorIcon: !0,
						...$
					}), /* @__PURE__ */ z(ue, {
						title: jr,
						status: b.Failed,
						statusLabel: "Cancelled",
						behavior: "direct",
						showBehaviorIcon: !0,
						...$
					})]
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/ToolsBadgeSection.tsx
var Nr = [
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
], Pr = [
	{ label: "Thinking…" },
	{ label: "Searching the web…" },
	{
		label: "Fetching arcee.ai…",
		leadingIcon: s.Globe
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
], Fr = () => {};
function Ir() {
	return /* @__PURE__ */ z(S, {
		title: "Tools and reasoning badge",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ B("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(2,auto)] items-center justify-items-start gap-x-10 gap-y-3",
			children: [
				/* @__PURE__ */ z("span", {}),
				/* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Default"
				}),
				/* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Selected"
				}),
				Nr.map(({ caption: e, label: t, inProgress: n, disabled: r }) => /* @__PURE__ */ B(I, { children: [
					/* @__PURE__ */ z("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e
					}),
					/* @__PURE__ */ z(O, {
						label: t,
						inProgress: n,
						disabled: r,
						onClick: Fr
					}),
					/* @__PURE__ */ z(O, {
						label: t,
						inProgress: n,
						disabled: r,
						selected: !0,
						onClick: Fr
					})
				] }, e)),
				Pr.map(({ label: e, leadingIcon: t }, n) => /* @__PURE__ */ B(I, { children: [
					/* @__PURE__ */ z("span", {
						className: "type-body-chrome text-basic-secondary",
						children: n === 0 ? "In progress" : null
					}),
					/* @__PURE__ */ z(O, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						onClick: Fr
					}),
					/* @__PURE__ */ z(O, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						selected: !0,
						onClick: Fr
					})
				] }, e))
			]
		})
	});
}
// src/app/components/pages/design-preview/TypographySection.tsx
var Lr = [
	{
		name: "type-display",
		spec: "30 / 600 (24 on phones)",
		sample: "What should we work on?"
	},
	{
		name: "type-title",
		spec: "20 / 600",
		sample: "Settings"
	},
	{
		name: "type-heading",
		spec: "17 / 600",
		sample: "Needs you"
	},
	{
		name: "type-subheading",
		spec: "14 / 600",
		sample: "Model and provider"
	},
	{
		name: "type-body",
		spec: "15 / 1.65, conversation",
		sample: "I updated the parser and the tests pass."
	},
	{
		name: "type-strong",
		spec: "13 / 600",
		sample: "Fix the flaky parser test"
	},
	{
		name: "type-label",
		spec: "13 / 500, controls",
		sample: "New session"
	},
	{
		name: "type-body-chrome",
		spec: "13 / 400, chrome",
		sample: "Runs in the project's working tree."
	},
	{
		name: "type-meta-strong",
		spec: "12 / 500",
		sample: "nac · main · local"
	},
	{
		name: "type-meta",
		spec: "12 / 400",
		sample: "Edited 4 minutes ago"
	},
	{
		name: "type-tag",
		spec: "11 / 500, never caps",
		sample: "3 agents"
	}
];
function Rr() {
	return /* @__PURE__ */ z(S, {
		title: "Typography",
		children: /* @__PURE__ */ B("div", {
			className: "flex flex-col",
			children: [Lr.map((e) => /* @__PURE__ */ B("div", {
				className: "flex flex-col gap-1 border-b border-muted px-4 py-3 md:flex-row md:items-baseline md:gap-6",
				children: [/* @__PURE__ */ B("div", {
					className: "flex w-full shrink-0 flex-col md:w-[200px]",
					children: [/* @__PURE__ */ z(U, { children: e.name }), /* @__PURE__ */ z("span", {
						className: "type-meta text-basic-muted",
						children: e.spec
					})]
				}), /* @__PURE__ */ z("div", {
					className: `${e.name} min-w-0 truncate text-basic-primary`,
					children: e.sample
				})]
			}, e.name)), /* @__PURE__ */ B("div", {
				className: "flex flex-col gap-1 px-4 py-3 md:flex-row md:items-baseline md:gap-6",
				children: [/* @__PURE__ */ B("div", {
					className: "flex w-full shrink-0 flex-col md:w-[200px]",
					children: [/* @__PURE__ */ z(U, { children: "code-medium" }), /* @__PURE__ */ z("span", {
						className: "type-meta text-basic-muted",
						children: "IBM Plex Mono 12.5"
					})]
				}), /* @__PURE__ */ z("code", {
					className: "code code-medium text-basic-secondary",
					children: "cargo test -p nac-core"
				})]
			})]
		})
	});
}
// src/app/components/pages/DesignPreviewPage.tsx
var zr = [
	{
		id: "foundations",
		title: "Foundations"
	},
	{
		id: "controls",
		title: "Controls"
	},
	{
		id: "feedback",
		title: "Status and feedback"
	},
	{
		id: "overlays",
		title: "Floating layers"
	},
	{
		id: "conversation",
		title: "Conversation"
	},
	{
		id: "navigation",
		title: "Sessions and navigation"
	},
	{
		id: "workspace",
		title: "Workspace"
	}
], Br = [
	{
		id: "system",
		label: "System"
	},
	{
		id: "light",
		label: "Light"
	},
	{
		id: "dark",
		label: "Dark"
	}
];
function Vr() {
	let e = Ye(), t = e?.setTheme;
	if (!t) return null;
	let n = e?.theme ?? "system";
	return /* @__PURE__ */ z("div", {
		role: "radiogroup",
		"aria-label": "Preview theme",
		className: "inline-flex items-center gap-0.5 rounded-pill bg-elevation-sublevel-variant-B p-0.5",
		children: Br.map((e) => /* @__PURE__ */ z("button", {
			type: "button",
			role: "radio",
			"aria-checked": n === e.id,
			onClick: () => t(e.id),
			className: p("type-label h-7 rounded-pill px-3 transition-colors duration-150 ease-out motion-reduce:transition-none", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-border-focus-outline)]", n === e.id ? "bg-elevation-level-1 text-basic-primary shadow-md" : "text-basic-tertiary hover:text-basic-primary"),
			children: e.label
		}, e.id))
	});
}
function Hr({ className: e }) {
	return /* @__PURE__ */ z("nav", {
		"aria-label": "Showcase contents",
		className: e,
		children: /* @__PURE__ */ z("ul", {
			className: "flex flex-col gap-0.5",
			children: zr.map((e) => /* @__PURE__ */ z("li", { children: /* @__PURE__ */ z("button", {
				type: "button",
				className: "type-body-chrome flex h-8 w-full items-center rounded-md px-2.5 text-left text-basic-tertiary transition-colors duration-150 ease-out hover:bg-elevation-sublevel-variant-B hover:text-basic-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-border-focus-outline)]",
				onClick: () => document.getElementById(e.id)?.scrollIntoView({
					behavior: "smooth",
					block: "start"
				}),
				children: e.title
			}) }, e.id))
		})
	});
}
function Ur() {
	return /* @__PURE__ */ B("div", {
		className: "h-full overflow-y-auto bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ B("header", {
			className: "sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-muted bg-elevation-ground/90 px-5 backdrop-blur-md",
			children: [
				/* @__PURE__ */ z(be, { height: 16 }),
				/* @__PURE__ */ z("span", {
					className: "type-strong min-w-0 truncate text-basic-tertiary",
					children: "design system"
				}),
				/* @__PURE__ */ z("div", { className: "flex-1" }),
				/* @__PURE__ */ z(Vr, {})
			]
		}), /* @__PURE__ */ B("div", {
			className: "mx-auto flex w-full max-w-[1240px] gap-10 px-4 py-8 md:px-8 md:py-12",
			children: [/* @__PURE__ */ z(Hr, { className: "sticky top-[84px] hidden h-fit w-[184px] shrink-0 xl:block" }), /* @__PURE__ */ B("main", {
				className: "flex min-w-0 flex-1 flex-col gap-14",
				children: [
					/* @__PURE__ */ B("div", {
						className: "flex flex-col gap-3",
						children: [/* @__PURE__ */ z("h1", {
							className: "type-display text-basic-primary",
							children: "Focus"
						}), /* @__PURE__ */ z("p", {
							className: "type-body max-w-[62ch] text-basic-secondary",
							children: "Quiet, airy, confident. Warm-neutral paper with ink on it; colour only when it means something. Hairlines at rest, soft shadows on floating layers, pills for every control, and one status ladder everywhere."
						})]
					}),
					/* @__PURE__ */ B(V, {
						id: "foundations",
						title: "Foundations",
						description: "The palette in both themes, the one type scale, the radius scale, elevation and motion.",
						children: [
							/* @__PURE__ */ z(cr, {}),
							/* @__PURE__ */ z(Rr, {}),
							/* @__PURE__ */ z(Er, {})
						]
					}),
					/* @__PURE__ */ B(V, {
						id: "controls",
						title: "Controls",
						description: "Buttons, fields, choices and chips. Hover, press and keyboard focus are live.",
						children: [
							/* @__PURE__ */ z(It, {}),
							/* @__PURE__ */ z(Wr, {}),
							/* @__PURE__ */ z(zt, {}),
							/* @__PURE__ */ z(xt, {}),
							/* @__PURE__ */ z(er, {}),
							/* @__PURE__ */ z(Ht, {})
						]
					}),
					/* @__PURE__ */ B(V, {
						id: "feedback",
						title: "Status and feedback",
						description: "Needs approval, needs an answer, failed, working, waiting, done, idle — and the notices that explain them.",
						children: [
							/* @__PURE__ */ z(Or, {}),
							/* @__PURE__ */ z($n, {}),
							/* @__PURE__ */ z(Qn, {})
						]
					}),
					/* @__PURE__ */ z(V, {
						id: "overlays",
						title: "Floating layers",
						description: "Popovers, tooltips, toasts, drawers and sheets share one layer stack: Escape closes the top one and focus returns where it came from.",
						children: /* @__PURE__ */ z(ir, {})
					}),
					/* @__PURE__ */ B(V, {
						id: "conversation",
						title: "Conversation",
						description: "A centred 15px column: plain-prose answers, folded reasoning and tools, subagent cards.",
						children: [
							/* @__PURE__ */ z(dr, {}),
							/* @__PURE__ */ z(lr, {}),
							/* @__PURE__ */ z(Ir, {}),
							/* @__PURE__ */ z(Mr, {}),
							/* @__PURE__ */ z(Vt, {})
						]
					}),
					/* @__PURE__ */ B(V, {
						id: "navigation",
						title: "Sessions and navigation",
						description: "Session rows, tabs, avatars and identity in the sidebar and the header.",
						children: [
							/* @__PURE__ */ z(xr, {}),
							/* @__PURE__ */ z(pr, {}),
							/* @__PURE__ */ z(yt, {})
						]
					}),
					/* @__PURE__ */ B(V, {
						id: "workspace",
						title: "Workspace",
						description: "Files, diffs and insights inside the drawers.",
						children: [/* @__PURE__ */ z(ln, {}), /* @__PURE__ */ z(Jn, {})]
					})
				]
			})]
		})]
	});
}
function Wr() {
	let [e, t] = L(!1);
	return /* @__PURE__ */ B(R, { children: [/* @__PURE__ */ z(dn, { onOpenModal: () => t(!0) }), /* @__PURE__ */ B(te, {
		open: e,
		onClose: () => t(!1),
		title: "Delete session",
		size: ae.Small,
		footer: /* @__PURE__ */ B(R, { children: [/* @__PURE__ */ z(u, {
			variant: o.Secondary,
			onClick: () => t(!1),
			children: "Cancel"
		}), /* @__PURE__ */ z(u, {
			variant: o.SecondaryDestructive,
			onClick: () => t(!1),
			children: "Delete"
		})] }),
		children: [/* @__PURE__ */ z("p", { children: "“Fix the flaky parser test” and its transcript, subagents and schedules will be deleted. This cannot be undone." }), /* @__PURE__ */ z("p", {
			className: "type-meta mt-2 text-basic-tertiary",
			children: "The shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom."
		})]
	})] });
}
export { Ur as default };
