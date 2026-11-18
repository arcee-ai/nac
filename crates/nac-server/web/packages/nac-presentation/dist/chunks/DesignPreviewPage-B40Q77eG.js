import { $ as e, J as t, O as n, Q as r, S as i, X as a, Y as o, _ as s, b as ee, c as te, f as ne, g as c, h as l, m as u, n as d, o as re, r as ie, t as ae, tt as f, u as oe, x as se, y as ce } from "./Toast-DLhlVenn.js";
import { $ as p, $t as m, A as le, At as h, B as g, C as ue, Ct as de, D as fe, E as pe, F as me, Ft as he, G as ge, H as _e, Ht as ve, I as ye, It as be, J as xe, Jt as _, L as Se, Lt as Ce, M as we, Mt as Te, N as Ee, Nt as v, O as De, Pt as y, Q as b, Qt as x, R as Oe, Rt as ke, S, St as Ae, T as je, Tt as Me, U as C, Ut as Ne, V as Pe, W as Fe, Wt as Ie, Xt as w, Y as Le, Yt as T, Z as Re, Zt as E, _t as D, an as ze, at as Be, b as O, bt as Ve, ct as He, dt as Ue, en as We, et as Ge, ft as Ke, g as k, h as qe, ht as Je, in as A, it as j, j as Ye, jt as Xe, k as Ze, kt as Qe, lt as $e, mt as et, n as tt, nn as M, nt, q as N, qt as rt, rn as it, rt as P, st as at, t as ot, tn as F, tt as st, u as ct, ut as I, vt as lt, wt as ut, x as dt, xt as ft, y as pt, yt as mt, z as ht } from "./ChatSessionActions-B-0VVzsV.js";
import { Fragment as L, useEffect as gt, useRef as _t, useState as R } from "react";
import { Fragment as z, jsx as B, jsxs as V } from "react/jsx-runtime";
// src/app/components/pages/design-preview/AvatarsSection.tsx
function vt() {
	let [e, t] = R("Port the ArceeFM atoms");
	return /* @__PURE__ */ B(_, {
		title: "Avatars and editable header",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ V("div", {
				className: "flex flex-wrap items-center gap-4",
				children: [
					/* @__PURE__ */ B(E, {
						name: "Aleksy",
						size: x.Small
					}),
					/* @__PURE__ */ B(E, { name: "NAC Orchestrator" }),
					/* @__PURE__ */ B(E, {
						name: "Opus",
						size: x.Large
					}),
					/* @__PURE__ */ B(E, {
						name: "🛠",
						glyph: !0,
						size: x.Large
					}),
					/* @__PURE__ */ B(E, {
						name: "Anthropic",
						size: x.XLarge,
						color: "var(--color-bg-info-primary)"
					})
				]
			}), /* @__PURE__ */ B(et, {
				value: e,
				onCommit: t,
				size: Je.Medium,
				className: "max-w-[360px]"
			})]
		})
	});
}
// src/app/components/pages/design-preview/Showcase.tsx
function H({ id: e, title: t, description: n, children: r }) {
	return /* @__PURE__ */ V("section", {
		id: e,
		"aria-labelledby": `${e}-title`,
		className: "flex scroll-mt-20 flex-col gap-4",
		children: [/* @__PURE__ */ V("div", {
			className: "flex flex-col gap-1",
			children: [/* @__PURE__ */ B("h2", {
				id: `${e}-title`,
				className: "type-title text-basic-primary",
				children: t
			}), /* @__PURE__ */ B("p", {
				className: "type-body-chrome max-w-[60ch] text-basic-tertiary",
				children: n
			})]
		}), /* @__PURE__ */ B("div", {
			className: "flex flex-col gap-4",
			children: r
		})]
	});
}
function U({ label: e, hint: t, className: n, children: r }) {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2 border-b border-muted px-4 py-4 last:border-b-0 md:flex-row md:gap-6",
		children: [/* @__PURE__ */ V("div", {
			className: "flex w-full shrink-0 flex-col gap-0.5 md:w-[168px]",
			children: [/* @__PURE__ */ B("span", {
				className: "type-label text-basic-primary",
				children: e
			}), t ? /* @__PURE__ */ B("span", {
				className: "type-meta text-basic-tertiary",
				children: t
			}) : null]
		}), /* @__PURE__ */ B("div", {
			className: f("flex min-w-0 flex-1 flex-wrap items-center gap-3", n),
			children: r
		})]
	});
}
function yt({ children: e }) {
	return /* @__PURE__ */ B("code", {
		className: "code-small text-basic-tertiary",
		children: e
	});
}
// src/app/components/pages/design-preview/BadgesSection.tsx
function bt() {
	return /* @__PURE__ */ V(z, { children: [
		/* @__PURE__ */ V(u, {
			variant: s.Secondary,
			size: c.Small,
			"aria-label": "Changes, 12 added, 3 removed",
			children: [/* @__PURE__ */ B("span", {
				className: "tabular text-success-primary",
				children: "+12"
			}), /* @__PURE__ */ B("span", {
				className: "tabular text-error-primary",
				children: "−3"
			})]
		}),
		/* @__PURE__ */ V(u, {
			variant: s.Secondary,
			size: c.Small,
			content: l.IconLeft,
			"aria-label": "3 agents, 1 running",
			children: [/* @__PURE__ */ B(D, { status: "working" }), "3 agents"]
		}),
		/* @__PURE__ */ V(u, {
			variant: s.Secondary,
			size: c.Small,
			content: l.IconLeft,
			children: [/* @__PURE__ */ B(r, { iconName: e.Flag }), "Goal"]
		}),
		/* @__PURE__ */ V(u, {
			variant: s.SecondaryHighlighted,
			size: c.Small,
			content: l.IconRight,
			children: ["Agent", /* @__PURE__ */ B(r, { iconName: e.Down })]
		})
	] });
}
function xt() {
	let [e, t] = R(!0), [n, r] = R(!1);
	return /* @__PURE__ */ V(_, {
		title: "Badges, chips and switches",
		children: [
			/* @__PURE__ */ V(U, {
				label: "Badges",
				hint: "11px, sentence case, a soft wash.",
				children: [
					/* @__PURE__ */ B(T, {
						text: "Running",
						color: w.Neutral
					}),
					/* @__PURE__ */ B(T, {
						text: "Needs approval",
						color: w.Yellow
					}),
					/* @__PURE__ */ B(T, {
						text: "Failed",
						color: w.Red
					}),
					/* @__PURE__ */ B(T, {
						text: "Merged",
						color: w.Green
					}),
					/* @__PURE__ */ B(T, {
						text: "Docs",
						color: w.Blue
					}),
					/* @__PURE__ */ B(T, {
						text: "Idle",
						color: w.Gray
					}),
					/* @__PURE__ */ B(T, {
						text: "No wash",
						color: w.Red,
						background: !1
					})
				]
			}),
			/* @__PURE__ */ B(U, {
				label: "Chips",
				hint: "24px pills: header pills, composer chips.",
				children: /* @__PURE__ */ B(bt, {})
			}),
			/* @__PURE__ */ V(U, {
				label: "Switch",
				hint: "Ink track when on, in either theme.",
				children: [
					/* @__PURE__ */ B(O, {
						checked: e,
						onChange: t,
						"aria-label": "Notifications"
					}),
					/* @__PURE__ */ B(O, {
						checked: n,
						onChange: r,
						size: dt.Large,
						"aria-label": "Large switch"
					}),
					/* @__PURE__ */ B(O, {
						checked: !0,
						disabled: !0,
						"aria-label": "On, disabled"
					}),
					/* @__PURE__ */ B(O, {
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
		variant: ze.Regular
	},
	{
		label: "Accent",
		variant: ze.Accent
	},
	{
		label: "Destructive",
		variant: ze.Destructive
	}
], wt = [
	{
		label: "small",
		size: A.Small
	},
	{
		label: "medium",
		size: A.Medium
	},
	{
		label: "large",
		size: A.Large
	}
], Tt = [
	{
		label: "Small",
		size: p.Small
	},
	{
		label: "Medium",
		size: p.Medium
	},
	{
		label: "Large",
		size: p.Large
	}
], Et = [
	{
		label: "Icon left",
		content: b.IconLeft
	},
	{
		label: "Icon right",
		content: b.IconRight
	},
	{
		label: "Icon",
		content: b.IconOnly
	},
	{
		label: "Text",
		content: b.TextOnly
	},
	{
		label: "Full",
		content: b.Full
	}
];
function Dt() {
	return /* @__PURE__ */ V("div", {
		className: "grid w-fit grid-cols-[160px_repeat(4,200px)] items-center gap-x-4 gap-y-2",
		children: [
			/* @__PURE__ */ B("span", {}),
			St.map((e) => /* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			Ct.flatMap((t) => wt.map((n) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ V("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					t.label,
					", ",
					n.label
				]
			}), St.map((i) => /* @__PURE__ */ V(it, {
				variant: t.variant,
				size: n.size,
				active: i.active,
				disabled: i.disabled,
				children: [
					/* @__PURE__ */ B(r, { iconName: e.Search }),
					/* @__PURE__ */ B("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: "New session"
					}),
					/* @__PURE__ */ B(r, { iconName: e.Edit })
				]
			}, i.label))] }, `${t.label}-${n.label}`)))
		]
	});
}
function Ot() {
	return /* @__PURE__ */ V("div", {
		className: "grid w-fit grid-cols-[160px_repeat(5,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ B("span", {}),
			Et.map((e) => /* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			Tt.flatMap((t) => St.map((n) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ V("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					t.label,
					", ",
					n.label.toLowerCase()
				]
			}), Et.map((r) => /* @__PURE__ */ B(Re, {
				size: t.size,
				content: r.content,
				active: n.active,
				disabled: n.disabled,
				iconName: e.Play,
				trailingIcon: e.Right,
				"aria-label": r.content === b.IconOnly ? "Run" : void 0,
				children: "Run"
			}, r.label))] }, `${t.label}-${n.label}`)))
		]
	});
}
function kt() {
	return /* @__PURE__ */ V(z, { children: [/* @__PURE__ */ V("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ B("span", {
			className: "type-subheading text-basic-primary",
			children: "Rows (menus, lists)"
		}), /* @__PURE__ */ B(Dt, {})]
	}), /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ B("span", {
			className: "type-subheading text-basic-primary",
			children: "Tabs"
		}), /* @__PURE__ */ B(Ot, {})]
	})] });
}
// src/app/components/pages/design-preview/ButtonsSection.tsx
var At = [
	{
		label: "Primary",
		variant: s.Primary
	},
	{
		label: "Secondary",
		variant: s.Secondary
	},
	{
		label: "Secondary highlighted",
		variant: s.SecondaryHighlighted
	},
	{
		label: "Secondary destructive",
		variant: s.SecondaryDestructive
	},
	{
		label: "Secondary accent",
		variant: s.SecondaryAccent
	},
	{
		label: "Secondary accent highlighted",
		variant: s.SecondaryAccentHighlighted
	},
	{
		label: "Ghost",
		variant: s.Ghost
	},
	{
		label: "Ghost highlighted",
		variant: s.GhostHighlighted
	},
	{
		label: "Ghost destructive",
		variant: s.GhostDestructive
	},
	{
		label: "Ghost accent",
		variant: s.GhostAccent
	},
	{
		label: "Ghost highlighted accent",
		variant: s.GhostHighlightedAccent
	},
	{
		label: "Tertiary",
		variant: s.Tertiary
	},
	{
		label: "Tertiary destructive",
		variant: s.TertiaryDestructive
	},
	{
		label: "Tertiary accent",
		variant: s.TertiaryAccent
	}
], jt = [
	{
		label: "Secondary",
		variant: s.Secondary
	},
	{
		label: "Ghost highlighted",
		variant: s.GhostHighlighted
	},
	{
		label: "Tertiary",
		variant: s.Tertiary
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
function W({ variant: t, size: n = c.Medium, content: i = l.IconLeft, disabled: a = !1 }) {
	let o = i === l.Icon;
	return /* @__PURE__ */ V(u, {
		variant: t,
		size: n,
		content: i,
		disabled: a,
		"aria-label": o ? "Add" : void 0,
		children: [
			o || i === l.IconLeft ? /* @__PURE__ */ B(r, { iconName: e.Add }) : null,
			o ? null : "Label",
			i === l.IconRight ? /* @__PURE__ */ B(r, { iconName: e.Right }) : null
		]
	});
}
function Pt() {
	return /* @__PURE__ */ V("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ B("span", {}),
			[
				"Default",
				"Disabled",
				"Icon",
				"Icon, disabled"
			].map((e) => /* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}, e)),
			At.map(({ label: e, variant: t }) => /* @__PURE__ */ V(L, { children: [
				/* @__PURE__ */ B("span", {
					className: "type-body-chrome text-basic-secondary",
					children: e
				}),
				/* @__PURE__ */ B(W, { variant: t }),
				/* @__PURE__ */ B(W, {
					variant: t,
					disabled: !0
				}),
				/* @__PURE__ */ B(W, {
					variant: t,
					content: l.Icon
				}),
				/* @__PURE__ */ B(W, {
					variant: t,
					content: l.Icon,
					disabled: !0
				})
			] }, e))
		]
	});
}
function Ft() {
	return /* @__PURE__ */ V("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ B("span", {}),
			Nt.map(({ label: e }) => /* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}, e)),
			jt.flatMap((e) => Mt.map((t) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ V("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), Nt.map(({ label: n, content: r }) => /* @__PURE__ */ B(W, {
				variant: e.variant,
				size: t.size,
				content: r
			}, n))] }, `${e.label}-${t.label}`)))
		]
	});
}
function It() {
	return /* @__PURE__ */ B(_, {
		title: "Buttons",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-8 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ V("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ B("p", {
						className: "type-body-chrome text-basic-tertiary",
						children: "Every control is a pill. Primary is ink; secondary is a surface with a hairline; ghost and tertiary carry no box until hovered. Accent variants are ink washes: there is no brand hue. Small 24, medium 32, large 40."
					}), /* @__PURE__ */ V("div", {
						className: "flex flex-wrap items-center gap-3",
						children: [
							/* @__PURE__ */ B(u, {
								variant: s.Primary,
								children: "Primary"
							}),
							/* @__PURE__ */ B(u, {
								variant: s.Secondary,
								children: "Secondary"
							}),
							/* @__PURE__ */ B(u, {
								variant: s.Ghost,
								children: "Ghost"
							}),
							/* @__PURE__ */ B(u, {
								variant: s.Tertiary,
								children: "Tertiary"
							}),
							/* @__PURE__ */ B(u, {
								variant: s.SecondaryDestructive,
								children: "Delete"
							}),
							/* @__PURE__ */ B(u, {
								variant: s.GhostDestructive,
								children: "Remove"
							}),
							/* @__PURE__ */ B(u, {
								variant: s.Primary,
								loading: !0,
								children: "Loading"
							}),
							/* @__PURE__ */ B(u, {
								variant: s.Secondary,
								disabled: !0,
								children: "Disabled"
							}),
							/* @__PURE__ */ V(u, {
								variant: s.Secondary,
								content: l.IconLeft,
								children: [/* @__PURE__ */ B(r, { iconName: e.Add }), "New session"]
							})
						]
					})]
				}),
				/* @__PURE__ */ V("div", {
					className: "flex flex-col gap-3",
					children: [
						/* @__PURE__ */ B("span", {
							className: "type-subheading text-basic-primary",
							children: "Variants and states"
						}),
						/* @__PURE__ */ B(Pt, {}),
						/* @__PURE__ */ B(Ft, {})
					]
				}),
				/* @__PURE__ */ B(kt, {})
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
	let [e, t] = R(!0), [n, r] = R("first"), [i, a] = R(Lt);
	return /* @__PURE__ */ B(_, {
		title: "Choices, multi-line and file input",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ V("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ B(Qe, {
						checked: e,
						onChange: t,
						children: "Skip permission prompts"
					}), /* @__PURE__ */ B(Qe, {
						checked: !1,
						onChange: () => {},
						disabled: !0,
						children: "Disabled"
					})]
				}),
				/* @__PURE__ */ V("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ B(fe, {
						name: "preview-choice",
						checked: n === "first",
						onChange: () => r("first"),
						children: "Working tree"
					}), /* @__PURE__ */ B(fe, {
						name: "preview-choice",
						checked: n === "second",
						onChange: () => r("second"),
						children: "Latest snapshot"
					})]
				}),
				/* @__PURE__ */ B(ge, {
					label: "System prompt",
					rows: 3,
					placeholder: "Extra instructions for the agent",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ V("div", {
					className: "flex w-[320px] flex-col gap-2",
					children: [/* @__PURE__ */ B(at, {
						accept: ".txt,.md,.pdf",
						hint: "Text, Markdown or PDF.",
						onFilesSelected: (e) => a(e.map(Rt))
					}), /* @__PURE__ */ B(at, {
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
	return /* @__PURE__ */ B(_, {
		title: "Code block and chat loader",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ B(ie, {
				code: Bt,
				language: "rust",
				title: "events.rs",
				lineNumbers: !0,
				expandable: !0,
				maxHeight: "220px"
			}), /* @__PURE__ */ B(rt, {})]
		})
	});
}
// src/app/components/pages/design-preview/DatesSection.tsx
function Ht() {
	let [e, t] = R(null), [n, r] = R({
		from: null,
		to: null
	});
	return /* @__PURE__ */ B(_, {
		title: "Dates",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ B(de, {
					label: "Created after",
					value: e,
					onChange: t,
					className: "w-[240px]"
				}),
				/* @__PURE__ */ B(de, {
					label: "Window",
					range: n,
					onRangeChange: r,
					hintText: "Two clicks pick the ends.",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ B(ut, {
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
		size: I.Large,
		badge: Ke.Large,
		title: "Large"
	},
	{
		size: I.Medium,
		badge: Ke.Medium,
		title: "Medium"
	},
	{
		size: I.Small,
		badge: Ke.Small,
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
		status: j.Changed
	},
	{
		title: "Added",
		status: j.Added
	},
	{
		title: "Deleted",
		status: j.Deleted
	},
	{
		title: "Changed name",
		status: j.ChangedName
	},
	{
		title: "Copied",
		status: j.Copied
	},
	{
		title: "Changed type",
		status: j.ChangedType
	},
	{
		title: "Conflict",
		status: j.Conflict
	},
	{
		title: "Not tracked",
		status: j.NotTracked
	},
	{
		title: "Ignored",
		status: j.Ignored
	}
], Yt = [
	{
		title: "File",
		variant: P.File
	},
	{
		title: "File, active",
		variant: P.File,
		active: !0
	},
	{
		title: "File, disabled",
		variant: P.File,
		disabled: !0
	},
	{
		title: "Folder",
		variant: P.Folder
	},
	{
		title: "Folder, open",
		variant: P.Folder,
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
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "File button"
		}), /* @__PURE__ */ V("div", {
			className: "grid w-fit grid-cols-[auto_repeat(3,auto)] items-center gap-x-4 gap-y-2",
			children: [
				/* @__PURE__ */ B("span", {}),
				G.map(({ size: e, title: t }) => /* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: t
				}, e)),
				Gt.map((e) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: e.title
				}), G.map(({ size: t }) => /* @__PURE__ */ B("div", {
					className: q,
					children: /* @__PURE__ */ B($e, {
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
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "A long name in 200px"
		}), /* @__PURE__ */ B("div", {
			className: "flex flex-wrap items-start gap-4",
			children: G.map(({ size: e }) => /* @__PURE__ */ B("div", {
				className: `w-[200px] ${q}`,
				children: /* @__PURE__ */ B($e, {
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
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code changes badge"
		}), /* @__PURE__ */ V("div", {
			className: "grid w-fit grid-cols-[64px_repeat(3,auto)] items-center gap-x-6 gap-y-2",
			children: [
				/* @__PURE__ */ B("span", {}),
				Kt.map(({ title: e }) => /* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: e
				}, e)),
				G.map(({ badge: e, title: t }) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: t
				}), Kt.map((t) => /* @__PURE__ */ B(Ue, {
					size: e,
					additions: t.additions,
					deletions: t.deletions
				}, t.title))] }, e))
			]
		})]
	});
}
function tn({ files: e, size: t, caption: n }) {
	let [r, i] = R(e[1]?.path ?? null);
	return /* @__PURE__ */ V("div", {
		className: "flex w-[280px] flex-col gap-2",
		children: [
			/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: n
			}),
			/* @__PURE__ */ B("div", {
				className: q,
				children: /* @__PURE__ */ B(He, {
					"aria-label": "Changed files",
					size: t,
					files: e.map((e) => ({
						...e,
						active: e.path === r
					})),
					onOpen: i
				})
			}),
			/* @__PURE__ */ V("span", {
				className: "type-meta-strong text-basic-tertiary",
				children: ["Open file: ", r ?? "none"]
			})
		]
	});
}
function nn() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [G.map(({ size: e, title: t }) => /* @__PURE__ */ B(tn, {
			size: e,
			files: qt.slice(0, 5),
			caption: `List, 5 files, ${t}`
		}, e)), /* @__PURE__ */ B(tn, {
			size: I.Small,
			files: qt,
			caption: "List, 17 files, Small"
		})]
	});
}
function rn() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Git status labels"
		}), /* @__PURE__ */ B("div", {
			className: `flex w-fit gap-3 ${q}`,
			children: Object.values(j).map((e) => /* @__PURE__ */ B(Be, { status: e }, e))
		})]
	});
}
var an = (e) => e === P.Folder ? "components" : "index.tsx";
function on() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: "File list tab button, Small"
			}),
			/* @__PURE__ */ V("div", {
				className: "grid w-fit grid-cols-[auto_repeat(5,160px)] items-center gap-x-3 gap-y-1",
				children: [
					/* @__PURE__ */ B("span", {}),
					Yt.map(({ title: e }) => /* @__PURE__ */ B("span", {
						className: "type-meta-strong text-basic-muted",
						children: e
					}, e)),
					Jt.map(({ title: e, status: t }) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
						className: "type-meta-strong text-basic-tertiary",
						children: e
					}), Yt.map((e) => /* @__PURE__ */ B("div", {
						className: q,
						children: /* @__PURE__ */ B(st, {
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
			/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: "File list tab button, Large"
			}),
			/* @__PURE__ */ B("div", {
				className: "flex flex-wrap items-start gap-4",
				children: Yt.filter((e) => !e.disabled).map((e) => /* @__PURE__ */ B("div", {
					className: `w-[280px] ${q}`,
					children: /* @__PURE__ */ B(st, {
						name: an(e.variant),
						variant: e.variant,
						size: nt.Large,
						status: j.Changed,
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
	trailing: e.has_trailing_newline ? null : /* @__PURE__ */ B("span", {
		className: "italic text-basic-muted",
		children: " No newline at end of file"
	})
});
function cn() {
	let [e, t] = R(() => /* @__PURE__ */ new Map());
	return gt(() => {
		let e = !0;
		return re(Xt, [Zt]).then((n) => {
			e && t(n);
		}), () => {
			e = !1;
		};
	}, []), /* @__PURE__ */ B("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [{
			title: "Code displayer, two hunks",
			tokens: e
		}, {
			title: "Code displayer without tokens",
			tokens: null
		}].map(({ title: e, tokens: t }) => /* @__PURE__ */ V("div", {
			className: "flex w-[480px] flex-col gap-2",
			children: [/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}), /* @__PURE__ */ B("div", {
				className: q,
				children: /* @__PURE__ */ B(Me, {
					"aria-label": `Changes to ${Xt}`,
					hunks: Zt.hunks.map((e) => e.lines.map((e) => sn(e, t?.get(e))))
				})
			})]
		}, e))
	});
}
function ln() {
	return /* @__PURE__ */ B(_, {
		title: "Files",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ B(Qt, {}),
				/* @__PURE__ */ B($t, {}),
				/* @__PURE__ */ B(en, {}),
				/* @__PURE__ */ B(nn, {}),
				/* @__PURE__ */ B(rn, {}),
				/* @__PURE__ */ B(on, {}),
				/* @__PURE__ */ B(cn, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/InputsSection.tsx
var un = [
	{
		id: "sonnet",
		label: "Claude Sonnet",
		icon: e.Brain
	},
	{
		id: "opus",
		label: "Claude Opus",
		icon: e.Brain
	},
	{
		id: "gpt",
		label: "GPT",
		icon: e.Ai
	}
];
function dn({ onOpenModal: t }) {
	let [n, r] = R("sonnet");
	return /* @__PURE__ */ B(_, {
		title: "Inputs",
		children: /* @__PURE__ */ V("div", {
			className: "flex flex-col gap-5 p-4",
			children: [
				/* @__PURE__ */ V("div", {
					className: "flex flex-wrap items-end gap-4",
					children: [
						/* @__PURE__ */ B(N, {
							label: "Working directory",
							inputSize: Le.Medium,
							placeholder: "/Users/me/project",
							className: "w-full max-w-[320px]"
						}),
						/* @__PURE__ */ B(N, {
							label: "Search",
							inputSize: Le.Medium,
							leading: xe.Icon,
							leadingIconName: e.Search,
							placeholder: "Filter sessions",
							hintText: "Matches name and cwd",
							className: "w-full max-w-[280px]"
						}),
						/* @__PURE__ */ B(je, {
							items: un,
							value: n,
							onValueChange: r,
							placeholder: "Pick a model"
						})
					]
				}),
				/* @__PURE__ */ V("div", {
					className: "flex flex-wrap items-end gap-4",
					children: [/* @__PURE__ */ B(N, {
						label: "Project name",
						placeholder: "nac",
						hintText: "Large: forms and dialogs. 44px on touch screens.",
						className: "w-full max-w-[320px]"
					}), /* @__PURE__ */ B(N, {
						label: "Base URL",
						defaultValue: "api.example",
						validation: !0,
						validationText: "Enter a full URL, including https://",
						className: "w-full max-w-[320px]"
					})]
				}),
				/* @__PURE__ */ V("div", {
					className: "flex flex-wrap items-center gap-3",
					children: [/* @__PURE__ */ B(u, {
						variant: s.Secondary,
						onClick: t,
						children: "Open modal"
					}), /* @__PURE__ */ B("span", {
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
	let [e, t] = R(C.Default);
	return gt(() => {
		if (e !== C.Loading) return;
		let n = window.setTimeout(() => t(C.Expanded), En);
		return () => window.clearTimeout(n);
	}, [e]), {
		state: e,
		showFull: () => t(C.Loading),
		hide: () => t(C.Default)
	};
}
function X({ title: e, shortContent: t, fullContent: n }) {
	let r = Dn();
	return /* @__PURE__ */ B(_e, {
		title: e,
		state: r.state,
		shortContent: t,
		fullContent: n,
		onShowFull: r.showFull,
		onHide: r.hide
	});
}
function On() {
	let t = Dn(), n = t.state === C.Expanded;
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Error, the message cut by its preview"
		}), /* @__PURE__ */ B("div", {
			className: "w-[542px] max-w-full bg-elevation-ground",
			children: /* @__PURE__ */ B(ht, {
				id: "preview-cut-error",
				icon: e.Edit,
				title: "Edit lexer.ts",
				state: g.Error,
				errorMessage: n ? wn : Tn,
				errorAction: /* @__PURE__ */ B(Fe, {
					expanded: n,
					loading: t.state === C.Loading,
					onClick: n ? t.hide : t.showFull
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
		state: C.Loading,
		shortContent: Y,
		onShowFull: Z
	},
	{
		label: "Expanded",
		title: "Input",
		state: C.Expanded,
		shortContent: Y,
		fullContent: Cn,
		onHide: Z
	},
	{
		label: "Expanded, cut by the server",
		title: "Input",
		state: C.Expanded,
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
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code displayer"
		}), /* @__PURE__ */ V("div", {
			className: "grid grid-cols-3 items-start gap-4",
			children: [kn.map(({ label: e, ...t }) => /* @__PURE__ */ V("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: e
				}), /* @__PURE__ */ B("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ B(_e, { ...t })
				})]
			}, e)), /* @__PURE__ */ V("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: "Interactive"
				}), /* @__PURE__ */ B("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ B(X, {
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
		icon: e.Brain,
		title: "Thoughts, 2.3 s",
		loadingTitle: "Thinking",
		copyText: fn,
		errorMessage: "The model stopped before it finished reasoning.",
		body: (e) => e === g.Default ? /* @__PURE__ */ B("p", { children: fn }) : null
	},
	{
		type: "Run Command (Error keeps the input)",
		icon: e.Terminal,
		title: "Run command",
		loadingTitle: "Running command",
		copyText: pn,
		errorMessage: "Command exited with code 2.",
		body: (e) => {
			if (e === g.Loading) return null;
			let t = /* @__PURE__ */ B(X, {
				title: "Input",
				shortContent: pn,
				fullContent: mn
			});
			return e === g.Error ? t : /* @__PURE__ */ V(z, { children: [t, /* @__PURE__ */ B(X, {
				title: "Output",
				shortContent: hn,
				fullContent: gn
			})] });
		}
	},
	{
		type: "Steer Session (Loading and Error keep the link)",
		icon: e.AddChat,
		title: "Steer session",
		loadingTitle: "Steer session",
		copyText: _n,
		errorMessage: "The session is no longer running.",
		body: (e) => e === g.Default ? /* @__PURE__ */ V(z, { children: [/* @__PURE__ */ B("p", { children: _n }), /* @__PURE__ */ B(Pe, {
			label: "Calendar rollout",
			href: "#/design"
		})] }) : /* @__PURE__ */ B(Pe, {
			label: "Calendar rollout",
			onClick: () => {}
		})
	},
	{
		type: "Search File",
		icon: e.SearchFile,
		title: "Search files",
		loadingTitle: "Search files",
		copyText: vn,
		errorMessage: "The pattern is not a valid regular expression.",
		body: (e) => {
			if (e === g.Loading) return null;
			let t = /* @__PURE__ */ B(X, {
				title: "Input",
				shortContent: vn,
				fullContent: yn
			});
			return e === g.Error ? t : /* @__PURE__ */ V(z, { children: [t, /* @__PURE__ */ B(X, {
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
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Stacked, the first one active"
		}), /* @__PURE__ */ B("div", {
			className: "flex w-[542px] max-w-full flex-col bg-elevation-ground",
			children: jn.map((e, t) => /* @__PURE__ */ B(ht, {
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
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ B(An, {}),
			/* @__PURE__ */ B(Nn, {}),
			/* @__PURE__ */ B(On, {}),
			/* @__PURE__ */ V("div", {
				className: "grid grid-cols-3 items-start gap-x-4 gap-y-2",
				children: [Mn.map(({ state: e, title: t }) => /* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: t
				}, e)), jn.flatMap((e) => [!1, !0].map((t) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
					className: "col-span-3 pt-2 type-meta-strong text-basic-tertiary",
					children: t ? `${e.type}, active` : e.type
				}), Mn.map(({ state: n }) => /* @__PURE__ */ B("div", {
					className: "min-w-0 bg-elevation-ground",
					children: /* @__PURE__ */ B(ht, {
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
		icon: e.Chat,
		label: "impl/calendar",
		meta: "Thread, 3"
	},
	{
		type: "Thoughts",
		icon: e.Brain,
		label: "Thoughts",
		meta: "13.8 s",
		runningLabel: "Thinking…"
	},
	{
		type: "Define Workset",
		icon: e.Checklist,
		label: "calendar-sync",
		meta: "Workset",
		failedLabel: "Define Workset",
		runningLabel: "Defining Workset…"
	},
	{
		type: "Delete Workset",
		icon: e.Trash,
		label: "Deleted: impl/calendar",
		failedLabel: "Delete thread",
		runningLabel: "Deleting…"
	},
	{
		type: "Read File",
		icon: e.ReadFile,
		label: "index.tsx",
		meta: "Read",
		failedLabel: "Read File",
		runningLabel: "Reading File…"
	},
	{
		type: "Write File",
		icon: e.FileUpload,
		label: "index.tsx",
		meta: "Write",
		failedLabel: "Create File",
		runningLabel: "Creating File…"
	},
	{
		type: "Edit File",
		icon: e.Edit,
		label: "index.tsx",
		meta: "Edit",
		failedLabel: "Edit File",
		runningLabel: "Editing File…"
	},
	{
		type: "Glob",
		icon: e.SearchFiles,
		label: "Find files",
		meta: "Glob",
		runningLabel: "Find files…"
	},
	{
		type: "Grep",
		icon: e.SearchFile,
		label: "Search files",
		meta: "Grep",
		runningLabel: "Search files…"
	},
	{
		type: "Run Terminal",
		icon: e.Terminal,
		label: "Run command",
		meta: "Exec",
		runningLabel: "Running command…"
	},
	{
		type: "Use Terminal",
		icon: e.WriteCommand,
		label: "Write command",
		meta: "Write",
		runningLabel: "Write command…"
	},
	{
		type: "Read Output Command",
		icon: e.ScreenView,
		label: "Read Output Command",
		meta: "Read",
		runningLabel: "Read Output Command…"
	},
	{
		type: "Create goal",
		icon: e.Flag,
		label: "Create goal",
		meta: "Create",
		runningLabel: "Creating goal…"
	},
	{
		type: "Read goal",
		icon: e.Goal,
		label: "Get goal",
		meta: "Read",
		runningLabel: "Get goal…"
	},
	{
		type: "Update goal",
		icon: e.Checklist,
		label: "Update goal",
		meta: "Edit",
		runningLabel: "Updating goal…"
	},
	{
		type: "Spawn Session - Agent",
		icon: e.Plane,
		label: "Calendar sync agent",
		meta: "Spawn",
		failedLabel: "Spawn Agent",
		runningLabel: "Spawn Agent…"
	},
	{
		type: "Spawn Session - Orchestrator",
		icon: e.Orchestrator,
		label: "Calendar rollout",
		meta: "Spawn",
		failedLabel: "Spawn Orchestrator",
		runningLabel: "Spawn Orchestrator…"
	},
	{
		type: "Check session status",
		icon: e.Info,
		label: "Calendar sync agent",
		meta: "Check",
		failedLabel: "Check session status",
		runningLabel: "Checking session status…"
	},
	{
		type: "Steer Session",
		icon: e.AddChat,
		label: "Calendar rollout",
		meta: "Steer",
		failedLabel: "Steer session",
		runningLabel: "Steer session…"
	},
	{
		type: "Session Read",
		icon: e.Eye,
		label: "Calendar rollout",
		meta: "Read",
		failedLabel: "Read session",
		runningLabel: "Reading session…"
	},
	{
		type: "Session Wait",
		icon: e.Timelaps,
		label: "Calendar rollout",
		meta: "Wait",
		failedLabel: "Wait for session",
		runningLabel: "Wait for session…"
	},
	{
		type: "Cancel session",
		icon: e.Trash,
		label: "Calendar sync agent",
		meta: "Delete",
		failedLabel: "Delete session",
		runningLabel: "Deleting session…"
	},
	{
		type: "ToolsSegment",
		icon: e.Right,
		label: "Total activity: 13.3s",
		meta: "12",
		runningLabel: "Working…",
		group: !0
	},
	{
		type: "Web search",
		icon: e.Search,
		label: "tokio select timeout",
		meta: "Search",
		runningLabel: "Searching the web…"
	},
	{
		type: "Web fetch",
		icon: e.Globe,
		label: "docs.rs",
		meta: "Fetch",
		runningLabel: "Fetching docs.rs…"
	},
	{
		type: "Other tool",
		icon: e.Code,
		label: "MCP · list_issues",
		meta: "Tool",
		runningLabel: "Running list_issues…"
	}
], In = [
	{
		status: F.Ready,
		title: "Ready"
	},
	{
		status: F.Pending,
		title: "Pending"
	},
	{
		status: F.Running,
		title: "Running"
	},
	{
		status: F.Failed,
		title: "Failed or canceled"
	}
], Ln = [
	"Thread",
	"Read File",
	"ToolsSegment"
], Q = [
	{
		key: "thoughts",
		icon: e.Brain,
		label: "Thoughts",
		meta: "13.8 s"
	},
	{
		key: "read",
		icon: e.ReadFile,
		label: "index.tsx",
		meta: "Read"
	},
	{
		key: "write",
		icon: e.FileUpload,
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
	return t === F.Running ? e.runningLabel ?? e.label : t === F.Failed ? e.failedLabel ?? e.label : e.label;
}
function Hn(e, t) {
	return (t === F.Running || t === F.Failed) && e.type !== "Thread" ? void 0 : e.meta;
}
function Un() {
	let e = [...Fn.map((e) => ({
		sample: e,
		active: !1
	})), ...Fn.filter((e) => Ln.includes(e.type)).map((e) => ({
		sample: e,
		active: !0
	}))];
	return /* @__PURE__ */ V("div", {
		className: "grid grid-cols-[136px_repeat(4,minmax(0,1fr))] items-center gap-x-3 gap-y-1",
		children: [
			/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: "Type"
			}),
			In.map(({ status: e, title: t }) => /* @__PURE__ */ B("span", {
				className: "px-2 type-meta-strong text-basic-muted",
				children: t
			}, e)),
			e.map(({ sample: e, active: t }) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
				className: "truncate type-meta-strong text-basic-tertiary",
				children: t ? `${e.type}, active` : e.type
			}), In.map(({ status: n }) => /* @__PURE__ */ B(m, {
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
	let [t, n] = R(!0), [r, i] = R("thoughts"), a = r === "group" || Q.some(({ key: e }) => e === r);
	return /* @__PURE__ */ V("div", {
		className: zn,
		children: [
			/* @__PURE__ */ B(m, {
				icon: e.Right,
				label: "Total activity: 13.3s",
				meta: String(Q.length),
				expanded: t,
				selected: a,
				onClick: () => {
					n((e) => !e), i("group");
				}
			}),
			t ? /* @__PURE__ */ B(M, { children: Q.map((e) => /* @__PURE__ */ B(m, {
				icon: e.icon,
				label: e.label,
				meta: e.meta,
				selected: r === e.key,
				onClick: () => i(e.key)
			}, e.key)) }) : null,
			/* @__PURE__ */ B(m, {
				icon: e.Eye,
				label: "Calendar rollout",
				meta: "Read",
				onClick: () => {}
			}),
			/* @__PURE__ */ B(m, {
				icon: e.Right,
				label: "Total activity: 4.1s",
				meta: "5",
				expanded: !1
			}),
			/* @__PURE__ */ B(m, {
				icon: e.Orchestrator,
				label: "Calendar rollout",
				meta: "Spawn",
				onClick: () => {}
			}),
			/* @__PURE__ */ B(m, {
				icon: e.Brain,
				label: "Thoughts",
				meta: "2.1 s",
				selected: r === "last",
				onClick: () => i("last")
			})
		]
	});
}
function Gn() {
	let [t, n] = R(Rn[0]), r = (r) => /* @__PURE__ */ B(m, {
		icon: e.Chat,
		label: r,
		meta: "Thread, 3",
		selected: t === r,
		onClick: () => n(r)
	}, r);
	return /* @__PURE__ */ V("div", {
		className: zn,
		children: [
			/* @__PURE__ */ B(m, {
				icon: e.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ B(M, { children: Rn.map(r) }),
			/* @__PURE__ */ B(m, {
				icon: e.Right,
				label: "Total activity: 13.3s",
				meta: "12",
				expanded: !1
			}),
			/* @__PURE__ */ B(M, { children: r("impl/time-zones") }),
			/* @__PURE__ */ B(m, {
				icon: e.Brain,
				label: "Thoughts",
				meta: "2.1 s"
			})
		]
	});
}
function Kn() {
	return /* @__PURE__ */ V("div", {
		className: zn,
		children: [
			/* @__PURE__ */ B(m, {
				icon: e.Chat,
				label: "impl/calendar-sync-recurring-events-and-time-zones",
				meta: "Thread, 12"
			}),
			/* @__PURE__ */ B(m, {
				icon: e.Orchestrator,
				label: "Roll the recurring-events fix out to every calendar provider",
				meta: "Spawn"
			}),
			/* @__PURE__ */ B(m, {
				icon: e.Plane,
				label: "Investigate why the nightly export drops recurring events",
				meta: "Spawn",
				status: F.Pending,
				selected: !0
			})
		]
	});
}
function qn() {
	let [t, n] = R(!0), [r, i] = R("review/calendar"), a = We.Large;
	return /* @__PURE__ */ V("div", {
		className: Bn,
		children: [
			/* @__PURE__ */ B(m, {
				size: a,
				icon: e.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ V(M, {
				className: "py-2",
				children: [
					/* @__PURE__ */ B(m, {
						size: a,
						icon: e.Chat,
						label: "impl/calendar",
						meta: "Thread, 3",
						status: F.Running
					}),
					/* @__PURE__ */ B(m, {
						size: a,
						icon: e.Chat,
						label: "impl/recurring-events",
						meta: "Thread, 2",
						status: F.Failed
					}),
					/* @__PURE__ */ B(m, {
						size: a,
						icon: e.Chat,
						label: "docs/calendar",
						meta: "Thread, 1",
						status: F.Pending
					}),
					/* @__PURE__ */ B(m, {
						size: a,
						icon: e.Chat,
						label: "review/calendar",
						meta: "Thread, 3",
						selected: r === "review/calendar",
						onClick: () => i("review/calendar")
					})
				]
			}),
			/* @__PURE__ */ B(m, {
				size: a,
				icon: e.Right,
				label: "Worked for 13.3s",
				meta: String(Q.length),
				expanded: t,
				onClick: () => n((e) => !e)
			}),
			t ? /* @__PURE__ */ B(M, { children: Q.map((e) => /* @__PURE__ */ B(m, {
				size: a,
				icon: e.icon,
				label: e.label,
				meta: e.meta,
				selected: r === e.key,
				onClick: () => i(e.key)
			}, e.key)) }) : null
		]
	});
}
function Jn() {
	return /* @__PURE__ */ B(_, {
		title: "Insights",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ B(Un, {}),
				/* @__PURE__ */ V("div", {
					className: "flex flex-wrap items-start gap-6",
					children: [
						/* @__PURE__ */ B(Wn, {}),
						/* @__PURE__ */ B(Gn, {}),
						/* @__PURE__ */ B(Kn, {}),
						/* @__PURE__ */ B(qn, {})
					]
				}),
				/* @__PURE__ */ B(Pn, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ModelLoaderSection.tsx
var Yn = [{
	variant: Ie.Default,
	label: "Default"
}, {
	variant: Ie.Accent,
	label: "Accent"
}], Xn = [
	{
		size: Ne.Small,
		label: "Small 16px"
	},
	{
		size: Ne.Medium,
		label: "Medium 20px"
	},
	{
		size: Ne.Large,
		label: "Large 24px"
	}
], Zn = [
	1,
	2,
	3
];
function Qn() {
	return /* @__PURE__ */ B(_, {
		title: "Model loader",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(4,72px)] items-center gap-x-4 gap-y-3",
			children: [
				/* @__PURE__ */ B("span", {}),
				/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Animated"
				}),
				Zn.map((e) => /* @__PURE__ */ V("span", {
					className: "type-meta-strong text-basic-muted",
					children: ["Frame ", e]
				}, e)),
				Yn.flatMap(({ variant: e, label: t }) => Xn.map(({ size: n, label: r }) => /* @__PURE__ */ V(L, { children: [
					/* @__PURE__ */ V("span", {
						className: "type-body-chrome text-basic-secondary",
						children: [
							t,
							" · ",
							r
						]
					}),
					/* @__PURE__ */ B(ve, {
						size: n,
						variant: e
					}),
					Zn.map((t) => /* @__PURE__ */ B(ve, {
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
	return /* @__PURE__ */ B(_, {
		title: "Notices",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ V("div", {
				className: "flex flex-wrap gap-3",
				children: [
					/* @__PURE__ */ B(Ee, {
						variant: me.Info,
						title: "Read-only snapshot",
						className: "w-full max-w-[280px]",
						children: "Pick the working tree to edit files again."
					}),
					/* @__PURE__ */ B(Ee, {
						variant: me.Error,
						title: "Run failed",
						className: "w-full max-w-[280px]",
						children: "The provider rejected the request."
					}),
					/* @__PURE__ */ B(Ee, {
						variant: me.Success,
						title: "Branch switched",
						className: "w-full max-w-[280px]"
					})
				]
			}), /* @__PURE__ */ V("div", {
				className: "flex w-full max-w-[398px] flex-col gap-2",
				children: [
					/* @__PURE__ */ B(v, {
						variant: y.Danger,
						title: "Needs your answer",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ B(v, {
						variant: y.Error,
						title: "Provider rejected the request",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ B(v, {
						variant: y.Success,
						title: "Branch merged",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ B(v, {
						variant: y.Info,
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
	let [e, t] = R(4), [n, r] = R(.7), [i, a] = R(["local"]), [o, s] = R(1);
	return /* @__PURE__ */ B(_, {
		title: "Numeric inputs, tags and pagination",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ V("div", {
					className: "flex flex-wrap items-center gap-8",
					children: [/* @__PURE__ */ B(we, {
						value: e,
						onChange: t,
						min: 1,
						max: 16,
						"aria-label": "Parallel threads"
					}), /* @__PURE__ */ V("div", {
						className: "flex items-center gap-4 w-[320px]",
						children: [/* @__PURE__ */ B(pe, {
							min: 0,
							max: 2,
							step: .1,
							value: n,
							onChange: r,
							label: "Temperature"
						}), /* @__PURE__ */ B("span", {
							className: "code code-small text-basic-muted w-8 shrink-0",
							children: n.toFixed(1)
						})]
					})]
				}),
				/* @__PURE__ */ B(pt, {
					tags: [
						"local",
						"docker",
						"remote",
						"sandbox"
					],
					selected: i,
					onChange: a
				}),
				/* @__PURE__ */ B(Ye, {
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
// src/app/components/pages/design-preview/OverlaysSection.tsx
var tr = [
	{
		icon: e.Edit,
		label: "Rename"
	},
	{
		icon: e.FileCopy,
		label: "Copy link"
	},
	{
		icon: e.Pin,
		label: "Pin to top"
	}
], nr = [
	{
		variant: d.Success,
		content: "Chat renamed"
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
	let [e, t] = R([]), n = _t(0), r = _t(/* @__PURE__ */ new Set());
	gt(() => {
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
	let [a, o] = R(!1), [te, d] = R(!1), [re, ie] = R(!1), { toasts: f, show: oe, dismiss: p } = rr();
	return /* @__PURE__ */ V(_, {
		title: "Overlays",
		children: [
			/* @__PURE__ */ V(U, {
				label: "Popover",
				hint: "Overlay surface, 14px corner, 32px rows. A sheet on phones.",
				children: [
					/* @__PURE__ */ B(ee, {
						open: a,
						onClose: () => o(!1),
						placement: t.BottomRight,
						size: se.Small,
						sticky: !0,
						content: tr.map((e) => /* @__PURE__ */ V(it, {
							size: A.Medium,
							onClick: () => o(!1),
							children: [/* @__PURE__ */ B(r, { iconName: e.icon }), /* @__PURE__ */ B("span", {
								className: "min-w-0 flex-1 truncate text-left",
								children: e.label
							})]
						}, e.label)),
						children: /* @__PURE__ */ V(u, {
							variant: s.Secondary,
							content: l.IconRight,
							"aria-expanded": a,
							onClick: () => o((e) => !e),
							children: ["Open popover", /* @__PURE__ */ B(r, { iconName: e.Down })]
						})
					}),
					/* @__PURE__ */ B(ne, { value: "nac" }),
					/* @__PURE__ */ B(n, { keys: ["cmd", "k"] })
				]
			}),
			/* @__PURE__ */ V(U, {
				label: "Tooltip",
				hint: "An inverse ink chip, 12px, with its shortcut.",
				children: [/* @__PURE__ */ B(ce, {
					title: "New session",
					keyboardShortcuts: ["cmd", "n"],
					position: t.BottomCenter,
					children: /* @__PURE__ */ B(u, {
						variant: s.Ghost,
						content: l.Icon,
						"aria-label": "New session",
						children: /* @__PURE__ */ B(r, { iconName: e.Add })
					})
				}), /* @__PURE__ */ B(ce, {
					title: "Pin session",
					description: "Keeps it at the top of its project.",
					position: t.BottomCenter,
					sticky: !0,
					showTooltipOnMobile: !0,
					children: /* @__PURE__ */ B(u, {
						variant: s.Ghost,
						content: l.Icon,
						"aria-label": "Pin",
						children: /* @__PURE__ */ B(r, { iconName: e.Pin })
					})
				})]
			}),
			/* @__PURE__ */ B(U, {
				label: "Toast",
				hint: "A small pill at the bottom centre; errors read in red.",
				children: /* @__PURE__ */ B(u, {
					variant: s.Secondary,
					onClick: oe,
					children: "Show a toast"
				})
			}),
			/* @__PURE__ */ V(U, {
				label: "Drawer and sheet",
				hint: "Right drawer on desktop, bottom sheet on phones.",
				children: [/* @__PURE__ */ B(u, {
					variant: s.Secondary,
					onClick: () => d(!0),
					children: "Open drawer"
				}), /* @__PURE__ */ B(u, {
					variant: s.Secondary,
					onClick: () => ie(!0),
					children: "Open bottom sheet"
				})]
			}),
			/* @__PURE__ */ B(Ae, {
				open: te,
				onClose: () => d(!1),
				title: "Changes",
				headerActions: /* @__PURE__ */ B(u, {
					variant: s.Ghost,
					size: c.Small,
					children: "All changes"
				}),
				children: /* @__PURE__ */ V("div", {
					className: "type-body-chrome flex flex-col gap-3 p-4 text-basic-secondary",
					children: [/* @__PURE__ */ B("p", { children: "Drawers carry everything that is not the conversation: changes, subagents, terminal, goal, schedules and insights. They open from the header pills." }), /* @__PURE__ */ B("p", {
						className: "text-basic-tertiary",
						children: "Escape or the close button returns focus here."
					})]
				})
			}),
			/* @__PURE__ */ B(i, {
				open: re,
				onClose: () => ie(!1),
				children: /* @__PURE__ */ B("div", {
					className: "flex flex-col px-2",
					children: tr.map((e) => /* @__PURE__ */ V(it, {
						size: A.Large,
						onClick: () => ie(!1),
						children: [/* @__PURE__ */ B(r, { iconName: e.icon }), /* @__PURE__ */ B("span", {
							className: "min-w-0 flex-1 truncate text-left",
							children: e.label
						})]
					}, e.label))
				})
			}),
			f.length > 0 ? /* @__PURE__ */ B("div", {
				className: "pointer-events-none fixed inset-x-0 bottom-[calc(20px+env(safe-area-inset-bottom))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2",
				children: f.map((e) => /* @__PURE__ */ B(ae, {
					variant: e.variant,
					content: e.content,
					dismissing: e.dismissing,
					onClose: () => p(e.id)
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
	return /* @__PURE__ */ V("div", {
		className: "flex min-w-0 flex-col gap-1",
		children: [
			/* @__PURE__ */ B("span", {
				"aria-hidden": !0,
				className: f("h-10 w-full rounded-md", e.line ? "border-2" : "shadow-[inset_0_0_0_1px_var(--f-line)]"),
				style: e.line ? {
					borderColor: `var(${e.token})`,
					background: "var(--f-surface)"
				} : { background: `var(${e.token})` }
			}),
			/* @__PURE__ */ B("span", {
				className: "type-meta-strong mt-0.5 truncate text-[var(--f-ink)]",
				children: e.name
			}),
			/* @__PURE__ */ B("code", {
				className: "truncate font-mono text-2xs text-[var(--f-ink-3)]",
				children: e.token
			})
		]
	});
}
function sr({ mode: e }) {
	return /* @__PURE__ */ V("div", {
		className: f(e, "flex min-w-0 flex-1 flex-col gap-5 rounded-card border border-[var(--f-line)] bg-[var(--f-ground)] p-4 text-[var(--f-ink)]"),
		children: [/* @__PURE__ */ V("div", {
			className: "flex items-baseline justify-between gap-2",
			children: [/* @__PURE__ */ B("span", {
				className: "type-strong",
				children: e === "light" ? "Light" : "Dark"
			}), /* @__PURE__ */ B("span", {
				className: "type-meta text-[var(--f-ink-3)]",
				children: e === "light" ? "Ink on warm paper" : "Designed, not inverted"
			})]
		}), ar.map((e) => /* @__PURE__ */ V("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-[var(--f-ink-3)]",
				children: e.label
			}), /* @__PURE__ */ B("div", {
				className: "grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-x-2.5 gap-y-3",
				children: e.swatches.map((e) => /* @__PURE__ */ B(or, { swatch: e }, e.token))
			})]
		}, e.label))]
	});
}
function cr() {
	return /* @__PURE__ */ B(_, {
		title: "Palette",
		children: /* @__PURE__ */ V("div", {
			className: "flex flex-col gap-4 p-4",
			children: [/* @__PURE__ */ B("ul", {
				className: "type-body-chrome flex flex-col gap-1 text-basic-secondary",
				children: ar.map((e) => /* @__PURE__ */ V("li", { children: [
					/* @__PURE__ */ V("span", {
						className: "text-basic-primary",
						children: [e.label, "."]
					}),
					" ",
					e.note
				] }, e.label))
			}), /* @__PURE__ */ V("div", {
				className: "flex flex-col gap-4 lg:flex-row",
				children: [/* @__PURE__ */ B(sr, { mode: "light" }), /* @__PURE__ */ B(sr, { mode: "dark" })]
			})]
		})
	});
}
// src/app/components/pages/design-preview/QualificationSection.tsx
function lr() {
	return /* @__PURE__ */ B(_, {
		title: "Selected presentation journeys",
		children: /* @__PURE__ */ V("div", {
			className: "type-body-chrome flex min-w-0 flex-col gap-3 p-4 text-basic-secondary",
			children: [
				/* @__PURE__ */ B("p", { children: "Use these production patterns together: readable reasoning and answers, calm navigation, one new-session flow from Home, a settings page with grouped sections, managed readiness and drawers with a clear way back. Keep a 4px spacing rhythm and 44px phone controls." }),
				/* @__PURE__ */ B("p", { children: "Samples document the treatment. Qualify complete journeys in the built standalone app and the exact packed presentation, including two independent views alongside host controls. Check light and dark, long and error content, keyboard focus, reduced motion and real 200% browser zoom." }),
				/* @__PURE__ */ B("p", { children: "Native inputs, the instance-owned overlay stack and specialized code, math, diff and terminal views retain their existing owners. A sample or passing fixture does not record human design acceptance or signed hosted qualification." })
			]
		})
	});
}
// src/app/components/pages/design-preview/ReasoningSection.tsx
var ur = "The build spends most of its time preparing images. I’ll check the cache key before changing the build steps.\n\nA stable key should include the lockfile and image directory so unchanged inputs can reuse the cache.";
function dr() {
	let [e, t] = R(!0);
	return /* @__PURE__ */ B(_, {
		title: "Conversation: reasoning and answer",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex min-w-0 flex-col gap-4",
			children: [
				/* @__PURE__ */ B("p", {
					className: "type-body-chrome text-basic-secondary",
					children: "Reasoning: 14px / 22px, secondary text, 12px paragraphs, 16px inset, 1px tertiary rule, no filled surface. Header and copy targets: 44px. Answer: existing 14px / 24px primary prose. Live opens; settled starts closed. A reader’s toggle, focus or selection wins on settlement. Activity remains a link to Insights; this is its reasoning detail, without a second heading."
				}),
				/* @__PURE__ */ B(u, {
					variant: s.Secondary,
					onClick: () => t(!e),
					children: e ? "Settle reasoning" : "Resume reasoning"
				}),
				/* @__PURE__ */ B(tt, {
					segment: {
						kind: "reasoning",
						key: "preview",
						text: ur,
						streaming: e,
						durationMs: e ? null : 2300
					},
					active: !1
				}),
				/* @__PURE__ */ B(ct, { children: "Use a stable image cache key to avoid rebuilding unchanged images." })
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
	return /* @__PURE__ */ B(_, {
		title: "Session avatars",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [fr.map((e) => /* @__PURE__ */ V("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ B(le, {
					id: e,
					size: 40
				}), /* @__PURE__ */ B("span", {
					className: "code code-small text-basic-muted",
					children: e
				})]
			}, e)), /* @__PURE__ */ V("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ B(Te, {}), /* @__PURE__ */ B("span", {
					className: "code code-small text-basic-muted",
					children: "unassigned"
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/SessionIdentitySection.tsx
var mr = [
	Ce.Small,
	Ce.Medium,
	Ce.Large
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
	return /* @__PURE__ */ V("div", {
		className: "grid w-fit grid-cols-[200px_repeat(12,32px)] items-center gap-y-3",
		children: [
			/* @__PURE__ */ B("span", {}),
			hr.map((e) => /* @__PURE__ */ B("span", {
				className: "col-span-3 type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			ke.map((e) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
				className: "type-body-chrome truncate text-basic-secondary",
				children: e.label
			}), hr.flatMap((t) => mr.map((n) => /* @__PURE__ */ B("span", {
				className: f("flex items-center justify-center", t.className),
				children: /* @__PURE__ */ B(be, {
					behavior: e.id,
					size: n
				})
			}, `${t.label}-${n}`)))] }, e.id))
		]
	});
}
function br({ isMobile: e }) {
	let t = /* @__PURE__ */ B(ot, {
		title: "Chat session 1",
		isMobile: e,
		onPin: vr,
		onRename: vr,
		onDelete: vr
	});
	return /* @__PURE__ */ V("div", {
		className: f("grid w-fit items-center gap-x-4 gap-y-2", e ? "grid-cols-[120px_repeat(4,240px)]" : "grid-cols-[120px_repeat(4,200px)]"),
		children: [
			/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e ? "Mobile" : "Desktop"
			}),
			gr.map((e) => /* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			_r.map((n) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
				className: "type-body-chrome text-basic-secondary",
				children: n.label
			}), gr.map((r) => /* @__PURE__ */ B(he, {
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
	return /* @__PURE__ */ B(_, {
		title: "Project navigation",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ B(yr, {}),
				/* @__PURE__ */ V("div", {
					className: "flex items-start gap-2",
					children: [
						/* @__PURE__ */ B(h, {
							title: "Fix the parser",
							behavior: "direct",
							showBehaviorIcon: !0,
							active: !0
						}),
						/* @__PURE__ */ B(h, {
							title: "Rewrite the store layer",
							behavior: "direct-with-orchestrator",
							showBehaviorIcon: !0
						}),
						/* @__PURE__ */ B(h, {
							title: "Investigating",
							behavior: "orchestrator",
							showBehaviorIcon: !0,
							running: !0
						}),
						/* @__PURE__ */ B(h, {
							title: "Without NAC",
							behavior: "direct"
						}),
						/* @__PURE__ */ B(h, {
							title: "Fork: Fix the parser",
							forkedFromTitle: "Fix the parser"
						}),
						/* @__PURE__ */ B(h, {
							title: "Fork running",
							forkedFromTitle: "Fix the parser",
							running: !0
						})
					]
				}),
				/* @__PURE__ */ B(br, { isMobile: !1 }),
				/* @__PURE__ */ B(br, { isMobile: !0 }),
				/* @__PURE__ */ V("div", {
					className: "flex flex-col gap-2 max-w-[320px]",
					children: [/* @__PURE__ */ B(Ge, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title"
					}), /* @__PURE__ */ B(Ge, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title",
						deleted: !0
					})]
				}),
				/* @__PURE__ */ V("div", {
					className: "flex flex-col gap-1 max-w-[320px]",
					children: [
						/* @__PURE__ */ B(De, {
							entityId: fr[3],
							name: "arcee-ai/nac",
							trailing: "4",
							active: !0
						}),
						/* @__PURE__ */ B(De, {
							entityId: fr[4],
							name: "arcee-ai/telos",
							trailing: "1",
							running: !0
						}),
						/* @__PURE__ */ B(De, {
							entityId: fr[5],
							name: "Unassigned session",
							variant: Ze.Orphan
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
	let [e, t] = R(!1);
	return /* @__PURE__ */ V(_, {
		title: "Shape, elevation and motion",
		children: [
			/* @__PURE__ */ B(U, {
				label: "Radius",
				hint: "One scale. Controls are pills; boxes step up.",
				children: /* @__PURE__ */ B("div", {
					className: "grid w-full grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-4 gap-y-5",
					children: Sr.map((e) => /* @__PURE__ */ V("div", {
						className: "flex min-w-0 flex-col gap-1.5",
						children: [
							/* @__PURE__ */ B("span", {
								"aria-hidden": !0,
								className: f("h-12 w-full border border-secondary bg-elevation-sublevel-variant-A", Cr[e.name])
							}),
							/* @__PURE__ */ B("code", {
								className: "truncate font-mono text-2xs text-basic-secondary",
								children: e.name
							}),
							/* @__PURE__ */ V("span", {
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
			/* @__PURE__ */ B(U, {
				label: "Elevation",
				hint: "Hairlines at rest; shadows only on floating layers.",
				children: /* @__PURE__ */ B("div", {
					className: "flex flex-wrap gap-4 rounded-card bg-elevation-ground p-4",
					children: wr.map((e) => /* @__PURE__ */ V("div", {
						className: f("flex h-20 w-[132px] flex-col justify-end rounded-card p-3", e.className),
						children: [/* @__PURE__ */ B("span", {
							className: "type-label text-basic-primary",
							children: e.name
						}), /* @__PURE__ */ B(yt, { children: e.token })]
					}, e.name))
				})
			}),
			/* @__PURE__ */ B(U, {
				label: "Motion",
				hint: "Quick ease-out, never bouncy; reduced motion turns it off.",
				children: /* @__PURE__ */ V("div", {
					className: "flex w-full flex-col gap-3",
					children: [
						/* @__PURE__ */ B("div", {
							className: "flex flex-wrap gap-4",
							children: Tr.map((e) => /* @__PURE__ */ V("div", {
								className: "flex flex-col",
								children: [/* @__PURE__ */ B(yt, { children: e.name }), /* @__PURE__ */ V("span", {
									className: "type-meta text-basic-tertiary",
									children: [
										e.value,
										" · ",
										e.use
									]
								})]
							}, e.name))
						}),
						/* @__PURE__ */ B("div", {
							className: "relative h-10 w-full max-w-[420px] rounded-pill bg-elevation-sublevel-variant-A",
							children: /* @__PURE__ */ B("span", {
								"aria-hidden": !0,
								className: "absolute top-1 size-8 rounded-pill bg-btn-primary transition-[left] duration-200 ease-[var(--ease-drawer)] motion-reduce:transition-none",
								style: { left: e ? "calc(100% - 36px)" : "4px" }
							})
						}),
						/* @__PURE__ */ B("div", { children: /* @__PURE__ */ B(u, {
							variant: s.Secondary,
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
var Dr = mt([
	"done",
	"working",
	"needs-answer",
	"idle"
]);
function Or() {
	return /* @__PURE__ */ V(_, {
		title: "Status",
		children: [
			/* @__PURE__ */ B(U, {
				label: "Ladder",
				hint: "Most urgent first; a row shows only its top rung.",
				children: /* @__PURE__ */ B("ol", {
					className: "flex w-full flex-col gap-2",
					children: lt.map((e, t) => /* @__PURE__ */ V("li", {
						className: "flex items-center gap-3",
						children: [
							/* @__PURE__ */ B("span", {
								className: "type-meta tabular w-4 text-right text-basic-muted",
								children: t + 1
							}),
							/* @__PURE__ */ B(D, {
								status: e,
								size: "md",
								labelled: !0
							}),
							Ve(e) ? /* @__PURE__ */ B("span", {
								className: "type-tag rounded-pill bg-danger-primary px-2 py-0.5 text-danger-primary",
								children: "Needs you"
							}) : null
						]
					}, e))
				})
			}),
			/* @__PURE__ */ V(U, {
				label: "Roll-up",
				hint: "A parent shows its most urgent child.",
				children: [
					/* @__PURE__ */ B("span", {
						className: "type-body-chrome text-basic-secondary",
						children: "done, working, needs an answer, idle"
					}),
					/* @__PURE__ */ B("span", {
						"aria-hidden": !0,
						className: "text-basic-muted",
						children: "→"
					}),
					/* @__PURE__ */ B(D, {
						status: Dr,
						size: "md",
						labelled: !0
					}),
					/* @__PURE__ */ V("code", {
						className: "code-small text-basic-muted",
						children: ["sessionStatus(…) = ", ft({
							running: !0,
							pendingQuestions: 1
						})]
					})
				]
			}),
			/* @__PURE__ */ B(U, {
				label: "Working",
				hint: "The only agent-working animation.",
				children: /* @__PURE__ */ V("div", {
					className: "flex items-center gap-2",
					children: [
						/* @__PURE__ */ B(D, { status: "working" }),
						/* @__PURE__ */ B("span", {
							className: "type-body-chrome focus-shimmer",
							children: "Running tests…"
						}),
						/* @__PURE__ */ B("span", {
							className: "type-meta tabular text-basic-muted",
							children: "1m 12s"
						})
					]
				})
			}),
			/* @__PURE__ */ V(U, {
				label: "Loaders",
				hint: "Plain and quiet, for everything that is not the agent.",
				children: [
					/* @__PURE__ */ B(o, {
						size: a.Small,
						"aria-label": "Loading"
					}),
					/* @__PURE__ */ B(Oe, { size: a.Medium }),
					/* @__PURE__ */ B(Xe, {
						rows: 3,
						className: "w-[200px]"
					}),
					/* @__PURE__ */ B("div", {
						className: "w-[200px] overflow-hidden rounded-pill bg-elevation-sublevel-variant-A",
						children: /* @__PURE__ */ B(Se, { active: !0 })
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
			status: S.Ready,
			behavior: "direct",
			...$
		}
	},
	{
		label: "Ready · direct + NAC",
		card: {
			title: "Child session title",
			status: S.Ready,
			behavior: "direct-with-orchestrator",
			...$
		}
	},
	{
		label: "Ready · managed orchestrator",
		card: {
			title: "Child session title",
			status: S.Ready,
			lineage: "managed-orchestrator",
			...$
		}
	},
	{
		label: "Running",
		card: {
			title: "Child session title",
			status: S.Running,
			behavior: "direct",
			...$
		}
	},
	{
		label: "Failed",
		card: {
			title: "Child session title",
			status: S.Failed,
			statusLabel: "Failed",
			behavior: "direct",
			...$
		}
	},
	{
		label: "Failed · cancelled",
		card: {
			title: "Child session title",
			status: S.Failed,
			statusLabel: "Cancelled",
			behavior: "direct",
			...$
		}
	},
	{
		label: "Not found",
		card: {
			title: "Child session title",
			status: S.NotFound,
			...$
		}
	},
	{
		label: "Static",
		card: {
			title: "Child session title",
			status: S.Ready,
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
	return /* @__PURE__ */ B(_, {
		title: "Subagent transcript card",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [/* @__PURE__ */ V("div", {
				className: "grid w-fit grid-cols-[200px_repeat(2,320px)] items-center gap-x-4 gap-y-3",
				children: [
					/* @__PURE__ */ B("span", {}),
					Ar.map((e) => /* @__PURE__ */ B("span", {
						className: "type-meta-strong text-basic-muted",
						children: e.label
					}, e.label)),
					kr.map((e) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e.label
					}), Ar.map((t) => /* @__PURE__ */ B(ue, {
						showBehaviorIcon: t.showBehaviorIcon,
						...e.card
					}, t.label))] }, e.label))
				]
			}), /* @__PURE__ */ V("div", {
				className: "flex flex-col gap-2",
				children: [/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Narrow container · 240px"
				}), /* @__PURE__ */ V("div", {
					className: "flex w-[240px] flex-col gap-3",
					children: [/* @__PURE__ */ B(ue, {
						title: jr,
						status: S.Ready,
						behavior: "direct",
						showBehaviorIcon: !0,
						...$
					}), /* @__PURE__ */ B(ue, {
						title: jr,
						status: S.Failed,
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
		leadingIcon: e.Globe
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
	return /* @__PURE__ */ B(_, {
		title: "Tools and reasoning badge",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(2,auto)] items-center justify-items-start gap-x-10 gap-y-3",
			children: [
				/* @__PURE__ */ B("span", {}),
				/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Default"
				}),
				/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Selected"
				}),
				Nr.map(({ caption: e, label: t, inProgress: n, disabled: r }) => /* @__PURE__ */ V(L, { children: [
					/* @__PURE__ */ B("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e
					}),
					/* @__PURE__ */ B(k, {
						label: t,
						inProgress: n,
						disabled: r,
						onClick: Fr
					}),
					/* @__PURE__ */ B(k, {
						label: t,
						inProgress: n,
						disabled: r,
						selected: !0,
						onClick: Fr
					})
				] }, e)),
				Pr.map(({ label: e, leadingIcon: t }, n) => /* @__PURE__ */ V(L, { children: [
					/* @__PURE__ */ B("span", {
						className: "type-body-chrome text-basic-secondary",
						children: n === 0 ? "In progress" : null
					}),
					/* @__PURE__ */ B(k, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						onClick: Fr
					}),
					/* @__PURE__ */ B(k, {
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
	return /* @__PURE__ */ B(_, {
		title: "Typography",
		children: /* @__PURE__ */ V("div", {
			className: "flex flex-col",
			children: [Lr.map((e) => /* @__PURE__ */ V("div", {
				className: "flex flex-col gap-1 border-b border-muted px-4 py-3 md:flex-row md:items-baseline md:gap-6",
				children: [/* @__PURE__ */ V("div", {
					className: "flex w-full shrink-0 flex-col md:w-[200px]",
					children: [/* @__PURE__ */ B(yt, { children: e.name }), /* @__PURE__ */ B("span", {
						className: "type-meta text-basic-muted",
						children: e.spec
					})]
				}), /* @__PURE__ */ B("div", {
					className: `${e.name} min-w-0 truncate text-basic-primary`,
					children: e.sample
				})]
			}, e.name)), /* @__PURE__ */ V("div", {
				className: "flex flex-col gap-1 px-4 py-3 md:flex-row md:items-baseline md:gap-6",
				children: [/* @__PURE__ */ V("div", {
					className: "flex w-full shrink-0 flex-col md:w-[200px]",
					children: [/* @__PURE__ */ B(yt, { children: "code-medium" }), /* @__PURE__ */ B("span", {
						className: "type-meta text-basic-muted",
						children: "IBM Plex Mono 12.5"
					})]
				}), /* @__PURE__ */ B("code", {
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
	let e = qe(), t = e?.setTheme;
	if (!t) return null;
	let n = e?.theme ?? "system";
	return /* @__PURE__ */ B("div", {
		role: "radiogroup",
		"aria-label": "Preview theme",
		className: "inline-flex items-center gap-0.5 rounded-pill bg-elevation-sublevel-variant-B p-0.5",
		children: Br.map((e) => /* @__PURE__ */ B("button", {
			type: "button",
			role: "radio",
			"aria-checked": n === e.id,
			onClick: () => t(e.id),
			className: f("type-label h-7 rounded-pill px-3 transition-colors duration-150 ease-out motion-reduce:transition-none", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-border-focus-outline)]", n === e.id ? "bg-elevation-level-1 text-basic-primary shadow-md" : "text-basic-tertiary hover:text-basic-primary"),
			children: e.label
		}, e.id))
	});
}
function Hr({ className: e }) {
	return /* @__PURE__ */ B("nav", {
		"aria-label": "Showcase contents",
		className: e,
		children: /* @__PURE__ */ B("ul", {
			className: "flex flex-col gap-0.5",
			children: zr.map((e) => /* @__PURE__ */ B("li", { children: /* @__PURE__ */ B("button", {
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
	return /* @__PURE__ */ V("div", {
		className: "h-full overflow-y-auto bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ V("header", {
			className: "sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-muted bg-elevation-ground/90 px-5 backdrop-blur-md",
			children: [
				/* @__PURE__ */ B(ye, { height: 16 }),
				/* @__PURE__ */ B("span", {
					className: "type-strong min-w-0 truncate text-basic-tertiary",
					children: "design system"
				}),
				/* @__PURE__ */ B("div", { className: "flex-1" }),
				/* @__PURE__ */ B(Vr, {})
			]
		}), /* @__PURE__ */ V("div", {
			className: "mx-auto flex w-full max-w-[1240px] gap-10 px-4 py-8 md:px-8 md:py-12",
			children: [/* @__PURE__ */ B(Hr, { className: "sticky top-[84px] hidden h-fit w-[184px] shrink-0 xl:block" }), /* @__PURE__ */ V("main", {
				className: "flex min-w-0 flex-1 flex-col gap-14",
				children: [
					/* @__PURE__ */ V("div", {
						className: "flex flex-col gap-3",
						children: [/* @__PURE__ */ B("h1", {
							className: "type-display text-basic-primary",
							children: "Focus"
						}), /* @__PURE__ */ B("p", {
							className: "type-body max-w-[62ch] text-basic-secondary",
							children: "Quiet, airy, confident. Warm-neutral paper with ink on it; colour only when it means something. Hairlines at rest, soft shadows on floating layers, pills for every control, and one status ladder everywhere."
						})]
					}),
					/* @__PURE__ */ V(H, {
						id: "foundations",
						title: "Foundations",
						description: "The palette in both themes, the one type scale, the radius scale, elevation and motion.",
						children: [
							/* @__PURE__ */ B(cr, {}),
							/* @__PURE__ */ B(Rr, {}),
							/* @__PURE__ */ B(Er, {})
						]
					}),
					/* @__PURE__ */ V(H, {
						id: "controls",
						title: "Controls",
						description: "Buttons, fields, choices and chips. Hover, press and keyboard focus are live.",
						children: [
							/* @__PURE__ */ B(It, {}),
							/* @__PURE__ */ B(Wr, {}),
							/* @__PURE__ */ B(zt, {}),
							/* @__PURE__ */ B(xt, {}),
							/* @__PURE__ */ B(er, {}),
							/* @__PURE__ */ B(Ht, {})
						]
					}),
					/* @__PURE__ */ V(H, {
						id: "feedback",
						title: "Status and feedback",
						description: "Needs approval, needs an answer, failed, working, waiting, done, idle — and the notices that explain them.",
						children: [
							/* @__PURE__ */ B(Or, {}),
							/* @__PURE__ */ B($n, {}),
							/* @__PURE__ */ B(Qn, {})
						]
					}),
					/* @__PURE__ */ B(H, {
						id: "overlays",
						title: "Floating layers",
						description: "Popovers, tooltips, toasts, drawers and sheets share one layer stack: Escape closes the top one and focus returns where it came from.",
						children: /* @__PURE__ */ B(ir, {})
					}),
					/* @__PURE__ */ V(H, {
						id: "conversation",
						title: "Conversation",
						description: "A centred 15px column: plain-prose answers, folded reasoning and tools, subagent cards.",
						children: [
							/* @__PURE__ */ B(dr, {}),
							/* @__PURE__ */ B(lr, {}),
							/* @__PURE__ */ B(Ir, {}),
							/* @__PURE__ */ B(Mr, {}),
							/* @__PURE__ */ B(Vt, {})
						]
					}),
					/* @__PURE__ */ V(H, {
						id: "navigation",
						title: "Sessions and navigation",
						description: "Session rows, tabs, avatars and identity in the sidebar and the header.",
						children: [
							/* @__PURE__ */ B(xr, {}),
							/* @__PURE__ */ B(pr, {}),
							/* @__PURE__ */ B(vt, {})
						]
					}),
					/* @__PURE__ */ V(H, {
						id: "workspace",
						title: "Workspace",
						description: "Files, diffs and insights inside the drawers.",
						children: [/* @__PURE__ */ B(ln, {}), /* @__PURE__ */ B(Jn, {})]
					})
				]
			})]
		})]
	});
}
function Wr() {
	let [e, t] = R(!1);
	return /* @__PURE__ */ V(z, { children: [/* @__PURE__ */ B(dn, { onOpenModal: () => t(!0) }), /* @__PURE__ */ V(te, {
		open: e,
		onClose: () => t(!1),
		title: "Delete session",
		size: oe.Small,
		footer: /* @__PURE__ */ V(z, { children: [/* @__PURE__ */ B(u, {
			variant: s.Secondary,
			onClick: () => t(!1),
			children: "Cancel"
		}), /* @__PURE__ */ B(u, {
			variant: s.SecondaryDestructive,
			onClick: () => t(!1),
			children: "Delete"
		})] }),
		children: [/* @__PURE__ */ B("p", { children: "“Fix the flaky parser test” and its transcript, subagents and schedules will be deleted. This cannot be undone." }), /* @__PURE__ */ B("p", {
			className: "type-meta mt-2 text-basic-tertiary",
			children: "The shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom."
		})]
	})] });
}
export { Ur as default };
