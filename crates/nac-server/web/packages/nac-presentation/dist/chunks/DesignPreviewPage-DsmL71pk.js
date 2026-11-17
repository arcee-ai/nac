import { O as e, Q as t, S as n, X as r, Z as i, _ as a, b as ee, c as te, et as o, f as ne, g as s, h as c, m as l, n as u, nt as d, o as f, r as re, t as ie, tt as p, u as ae, x as oe, y as se } from "./Toast-phk3tngI.js";
import { $ as m, $t as h, A as ce, At as le, B as g, C as ue, Ct as de, D as fe, E as pe, Et as me, F as he, Ft as _, G as ge, Gt as _e, H as ve, I as ye, It as be, J as xe, Jt as Se, L as Ce, Lt as we, M as Te, Mt as Ee, N as De, Nt as Oe, O as ke, Pt as v, Q as Ae, Qt as y, R as je, Rt as Me, S as b, St as Ne, T as Pe, Tt as Fe, U as x, Ut as Ie, V as Le, W as Re, Wt as ze, Xt as S, Y as Be, Yt as C, Zt as w, an as T, at as E, b as Ve, bt as He, ct as Ue, dt as We, en as D, et as Ge, ft as Ke, g as O, gt as qe, h as Je, ht as Ye, in as Xe, it as k, j as Ze, jt as A, k as Qe, lt as $e, n as et, nn as j, nt as tt, on as nt, ot as rt, pt as it, q as M, rn as N, rt as at, t as ot, tn as st, tt as ct, u as lt, ut, vt as P, wt as dt, x as ft, xt as pt, y as mt, yt as ht, z as gt, zt as _t } from "./ChatSessionActions-BrgekTOc.js";
import { Fragment as F, useEffect as vt, useRef as yt, useState as I } from "react";
import { Fragment as L, jsx as R, jsxs as z } from "react/jsx-runtime";
// src/app/components/pages/design-preview/AvatarsSection.tsx
function bt() {
	let [e, t] = I("Port the ArceeFM atoms");
	return /* @__PURE__ */ R(C, {
		title: "Avatars and editable header",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ z("div", {
				className: "flex flex-wrap items-center gap-4",
				children: [
					/* @__PURE__ */ R(y, {
						name: "Aleksy",
						size: h.Small
					}),
					/* @__PURE__ */ R(y, { name: "NAC Orchestrator" }),
					/* @__PURE__ */ R(y, {
						name: "Opus",
						size: h.Large
					}),
					/* @__PURE__ */ R(y, {
						name: "🛠",
						glyph: !0,
						size: h.Large
					}),
					/* @__PURE__ */ R(y, {
						name: "Anthropic",
						size: h.XLarge,
						color: "var(--color-bg-info-primary)"
					})
				]
			}), /* @__PURE__ */ R(Ye, {
				value: e,
				onCommit: t,
				size: qe.Medium,
				className: "max-w-[360px]"
			})]
		})
	});
}
// src/app/components/pages/design-preview/Showcase.tsx
function B({ id: e, title: t, description: n, children: r }) {
	return /* @__PURE__ */ z("section", {
		id: e,
		"aria-labelledby": `${e}-title`,
		className: "flex scroll-mt-20 flex-col gap-4",
		children: [/* @__PURE__ */ z("div", {
			className: "flex flex-col gap-1",
			children: [/* @__PURE__ */ R("h2", {
				id: `${e}-title`,
				className: "type-title text-basic-primary",
				children: t
			}), /* @__PURE__ */ R("p", {
				className: "type-body-chrome max-w-[60ch] text-basic-tertiary",
				children: n
			})]
		}), /* @__PURE__ */ R("div", {
			className: "flex flex-col gap-4",
			children: r
		})]
	});
}
function V({ label: e, hint: t, className: n, children: r }) {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2 border-b border-muted px-4 py-4 last:border-b-0 md:flex-row md:gap-6",
		children: [/* @__PURE__ */ z("div", {
			className: "flex w-full shrink-0 flex-col gap-0.5 md:w-[168px]",
			children: [/* @__PURE__ */ R("span", {
				className: "type-label text-basic-primary",
				children: e
			}), t ? /* @__PURE__ */ R("span", {
				className: "type-meta text-basic-tertiary",
				children: t
			}) : null]
		}), /* @__PURE__ */ R("div", {
			className: d("flex min-w-0 flex-1 flex-wrap items-center gap-3", n),
			children: r
		})]
	});
}
function H({ children: e }) {
	return /* @__PURE__ */ R("code", {
		className: "code-small text-basic-tertiary",
		children: e
	});
}
// src/app/components/pages/design-preview/BadgesSection.tsx
function xt() {
	return /* @__PURE__ */ z(L, { children: [
		/* @__PURE__ */ z(l, {
			variant: a.Secondary,
			size: s.Small,
			"aria-label": "Changes, 12 added, 3 removed",
			children: [/* @__PURE__ */ R("span", {
				className: "tabular text-success-primary",
				children: "+12"
			}), /* @__PURE__ */ R("span", {
				className: "tabular text-error-primary",
				children: "−3"
			})]
		}),
		/* @__PURE__ */ z(l, {
			variant: a.Secondary,
			size: s.Small,
			content: c.IconLeft,
			"aria-label": "3 agents, 1 running",
			children: [/* @__PURE__ */ R(P, { status: "working" }), "3 agents"]
		}),
		/* @__PURE__ */ z(l, {
			variant: a.Secondary,
			size: s.Small,
			content: c.IconLeft,
			children: [/* @__PURE__ */ R(o, { iconName: p.Flag }), "Goal"]
		}),
		/* @__PURE__ */ z(l, {
			variant: a.SecondaryHighlighted,
			size: s.Small,
			content: c.IconRight,
			children: ["Agent", /* @__PURE__ */ R(o, { iconName: p.Down })]
		})
	] });
}
function St() {
	let [e, t] = I(!0), [n, r] = I(!1);
	return /* @__PURE__ */ z(C, {
		title: "Badges, chips and switches",
		children: [
			/* @__PURE__ */ z(V, {
				label: "Badges",
				hint: "11px, sentence case, a soft wash.",
				children: [
					/* @__PURE__ */ R(S, {
						text: "Running",
						color: w.Neutral
					}),
					/* @__PURE__ */ R(S, {
						text: "Needs approval",
						color: w.Yellow
					}),
					/* @__PURE__ */ R(S, {
						text: "Failed",
						color: w.Red
					}),
					/* @__PURE__ */ R(S, {
						text: "Merged",
						color: w.Green
					}),
					/* @__PURE__ */ R(S, {
						text: "Docs",
						color: w.Blue
					}),
					/* @__PURE__ */ R(S, {
						text: "Idle",
						color: w.Gray
					}),
					/* @__PURE__ */ R(S, {
						text: "No wash",
						color: w.Red,
						background: !1
					})
				]
			}),
			/* @__PURE__ */ R(V, {
				label: "Chips",
				hint: "24px pills: header pills, composer chips.",
				children: /* @__PURE__ */ R(xt, {})
			}),
			/* @__PURE__ */ z(V, {
				label: "Switch",
				hint: "Ink track when on, in either theme.",
				children: [
					/* @__PURE__ */ R(Ve, {
						checked: e,
						onChange: t,
						"aria-label": "Notifications"
					}),
					/* @__PURE__ */ R(Ve, {
						checked: n,
						onChange: r,
						size: ft.Large,
						"aria-label": "Large switch"
					}),
					/* @__PURE__ */ R(Ve, {
						checked: !0,
						disabled: !0,
						"aria-label": "On, disabled"
					}),
					/* @__PURE__ */ R(Ve, {
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
var Ct = [
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
], wt = [
	{
		label: "Regular",
		variant: nt.Regular
	},
	{
		label: "Accent",
		variant: nt.Accent
	},
	{
		label: "Destructive",
		variant: nt.Destructive
	}
], Tt = [
	{
		label: "small",
		size: T.Small
	},
	{
		label: "medium",
		size: T.Medium
	},
	{
		label: "large",
		size: T.Large
	}
], Et = [
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
], Dt = [
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
function Ot() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[160px_repeat(4,200px)] items-center gap-x-4 gap-y-2",
		children: [
			/* @__PURE__ */ R("span", {}),
			Ct.map((e) => /* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			wt.flatMap((e) => Tt.map((t) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ z("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), Ct.map((n) => /* @__PURE__ */ z(Xe, {
				variant: e.variant,
				size: t.size,
				active: n.active,
				disabled: n.disabled,
				children: [
					/* @__PURE__ */ R(o, { iconName: p.Search }),
					/* @__PURE__ */ R("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: "New session"
					}),
					/* @__PURE__ */ R(o, { iconName: p.Edit })
				]
			}, n.label))] }, `${e.label}-${t.label}`)))
		]
	});
}
function kt() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[160px_repeat(5,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ R("span", {}),
			Dt.map((e) => /* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			Et.flatMap((e) => Ct.map((t) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ z("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label.toLowerCase()
				]
			}), Dt.map((n) => /* @__PURE__ */ R(Ae, {
				size: e.size,
				content: n.content,
				active: t.active,
				disabled: t.disabled,
				iconName: p.Play,
				trailingIcon: p.Right,
				"aria-label": n.content === m.IconOnly ? "Run" : void 0,
				children: "Run"
			}, n.label))] }, `${e.label}-${t.label}`)))
		]
	});
}
function At() {
	return /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ z("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ R("span", {
			className: "type-subheading text-basic-primary",
			children: "Rows (menus, lists)"
		}), /* @__PURE__ */ R(Ot, {})]
	}), /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ R("span", {
			className: "type-subheading text-basic-primary",
			children: "Tabs"
		}), /* @__PURE__ */ R(kt, {})]
	})] });
}
// src/app/components/pages/design-preview/ButtonsSection.tsx
var jt = [
	{
		label: "Primary",
		variant: a.Primary
	},
	{
		label: "Secondary",
		variant: a.Secondary
	},
	{
		label: "Secondary highlighted",
		variant: a.SecondaryHighlighted
	},
	{
		label: "Secondary destructive",
		variant: a.SecondaryDestructive
	},
	{
		label: "Secondary accent",
		variant: a.SecondaryAccent
	},
	{
		label: "Secondary accent highlighted",
		variant: a.SecondaryAccentHighlighted
	},
	{
		label: "Ghost",
		variant: a.Ghost
	},
	{
		label: "Ghost highlighted",
		variant: a.GhostHighlighted
	},
	{
		label: "Ghost destructive",
		variant: a.GhostDestructive
	},
	{
		label: "Ghost accent",
		variant: a.GhostAccent
	},
	{
		label: "Ghost highlighted accent",
		variant: a.GhostHighlightedAccent
	},
	{
		label: "Tertiary",
		variant: a.Tertiary
	},
	{
		label: "Tertiary destructive",
		variant: a.TertiaryDestructive
	},
	{
		label: "Tertiary accent",
		variant: a.TertiaryAccent
	}
], Mt = [
	{
		label: "Secondary",
		variant: a.Secondary
	},
	{
		label: "Ghost highlighted",
		variant: a.GhostHighlighted
	},
	{
		label: "Tertiary",
		variant: a.Tertiary
	}
], Nt = [
	{
		label: "small",
		size: s.Small
	},
	{
		label: "medium",
		size: s.Medium
	},
	{
		label: "large",
		size: s.Large
	}
], Pt = [
	{
		label: "Icon",
		content: c.Icon
	},
	{
		label: "Icon left",
		content: c.IconLeft
	},
	{
		label: "Text",
		content: c.Text
	},
	{
		label: "Icon right",
		content: c.IconRight
	}
];
function U({ variant: e, size: t = s.Medium, content: n = c.IconLeft, disabled: r = !1 }) {
	let i = n === c.Icon;
	return /* @__PURE__ */ z(l, {
		variant: e,
		size: t,
		content: n,
		disabled: r,
		"aria-label": i ? "Add" : void 0,
		children: [
			i || n === c.IconLeft ? /* @__PURE__ */ R(o, { iconName: p.Add }) : null,
			i ? null : "Label",
			n === c.IconRight ? /* @__PURE__ */ R(o, { iconName: p.Right }) : null
		]
	});
}
function Ft() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ R("span", {}),
			[
				"Default",
				"Disabled",
				"Icon",
				"Icon, disabled"
			].map((e) => /* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}, e)),
			jt.map(({ label: e, variant: t }) => /* @__PURE__ */ z(F, { children: [
				/* @__PURE__ */ R("span", {
					className: "type-body-chrome text-basic-secondary",
					children: e
				}),
				/* @__PURE__ */ R(U, { variant: t }),
				/* @__PURE__ */ R(U, {
					variant: t,
					disabled: !0
				}),
				/* @__PURE__ */ R(U, {
					variant: t,
					content: c.Icon
				}),
				/* @__PURE__ */ R(U, {
					variant: t,
					content: c.Icon,
					disabled: !0
				})
			] }, e))
		]
	});
}
function It() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ R("span", {}),
			Pt.map(({ label: e }) => /* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}, e)),
			Mt.flatMap((e) => Nt.map((t) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ z("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), Pt.map(({ label: n, content: r }) => /* @__PURE__ */ R(U, {
				variant: e.variant,
				size: t.size,
				content: r
			}, n))] }, `${e.label}-${t.label}`)))
		]
	});
}
function Lt() {
	return /* @__PURE__ */ R(C, {
		title: "Buttons",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-8 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ R("p", {
						className: "type-body-chrome text-basic-tertiary",
						children: "Every control is a pill. Primary is ink; secondary is a surface with a hairline; ghost and tertiary carry no box until hovered. Accent variants are ink washes: there is no brand hue. Small 24, medium 32, large 40."
					}), /* @__PURE__ */ z("div", {
						className: "flex flex-wrap items-center gap-3",
						children: [
							/* @__PURE__ */ R(l, {
								variant: a.Primary,
								children: "Primary"
							}),
							/* @__PURE__ */ R(l, {
								variant: a.Secondary,
								children: "Secondary"
							}),
							/* @__PURE__ */ R(l, {
								variant: a.Ghost,
								children: "Ghost"
							}),
							/* @__PURE__ */ R(l, {
								variant: a.Tertiary,
								children: "Tertiary"
							}),
							/* @__PURE__ */ R(l, {
								variant: a.SecondaryDestructive,
								children: "Delete"
							}),
							/* @__PURE__ */ R(l, {
								variant: a.GhostDestructive,
								children: "Remove"
							}),
							/* @__PURE__ */ R(l, {
								variant: a.Primary,
								loading: !0,
								children: "Loading"
							}),
							/* @__PURE__ */ R(l, {
								variant: a.Secondary,
								disabled: !0,
								children: "Disabled"
							}),
							/* @__PURE__ */ z(l, {
								variant: a.Secondary,
								content: c.IconLeft,
								children: [/* @__PURE__ */ R(o, { iconName: p.Add }), "New session"]
							})
						]
					})]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-3",
					children: [
						/* @__PURE__ */ R("span", {
							className: "type-subheading text-basic-primary",
							children: "Variants and states"
						}),
						/* @__PURE__ */ R(Ft, {}),
						/* @__PURE__ */ R(It, {})
					]
				}),
				/* @__PURE__ */ R(At, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ChoicesSection.tsx
var Rt = [{
	id: "trace",
	name: "session-trace.txt",
	size: "12 KB"
}];
function zt(e) {
	return {
		id: `${e.name}-${e.lastModified}`,
		name: e.name,
		size: `${Math.ceil(e.size / 1024)} KB`
	};
}
function Bt() {
	let [e, t] = I(!0), [n, r] = I("first"), [i, a] = I(Rt);
	return /* @__PURE__ */ R(C, {
		title: "Choices, multi-line and file input",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ R(le, {
						checked: e,
						onChange: t,
						children: "Skip permission prompts"
					}), /* @__PURE__ */ R(le, {
						checked: !1,
						onChange: () => {},
						disabled: !0,
						children: "Disabled"
					})]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ R(fe, {
						name: "preview-choice",
						checked: n === "first",
						onChange: () => r("first"),
						children: "Working tree"
					}), /* @__PURE__ */ R(fe, {
						name: "preview-choice",
						checked: n === "second",
						onChange: () => r("second"),
						children: "Latest snapshot"
					})]
				}),
				/* @__PURE__ */ R(ge, {
					label: "System prompt",
					rows: 3,
					placeholder: "Extra instructions for the agent",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ z("div", {
					className: "flex w-[320px] flex-col gap-2",
					children: [/* @__PURE__ */ R(Ue, {
						accept: ".txt,.md,.pdf",
						hint: "Text, Markdown or PDF.",
						onFilesSelected: (e) => a(e.map(zt))
					}), /* @__PURE__ */ R(Ue, {
						files: i,
						onRemove: (e) => a(i.filter((t) => t.id !== e))
					})]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/CodeBlockSection.tsx
var Vt = "pub enum AgentEvent {\n    RunStarted { thread_name: Option<String> },\n    AssistantMessage {\n        thread_name: Option<String>,\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { thread_name: Option<String> },\n}";
function Ht() {
	return /* @__PURE__ */ R(C, {
		title: "Code block and chat loader",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ R(re, {
				code: Vt,
				language: "rust",
				title: "events.rs",
				lineNumbers: !0,
				expandable: !0,
				maxHeight: "220px"
			}), /* @__PURE__ */ R(Se, {})]
		})
	});
}
// src/app/components/pages/design-preview/DatesSection.tsx
function Ut() {
	let [e, t] = I(null), [n, r] = I({
		from: null,
		to: null
	});
	return /* @__PURE__ */ R(C, {
		title: "Dates",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ R(dt, {
					label: "Created after",
					value: e,
					onChange: t,
					className: "w-[240px]"
				}),
				/* @__PURE__ */ R(dt, {
					label: "Window",
					range: n,
					onRangeChange: r,
					hintText: "Two clicks pick the ends.",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ R(Fe, {
					selected: e ? /* @__PURE__ */ new Date(`${e}T00:00:00`) : void 0,
					onSelect: (e) => t(`${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`),
					className: "rounded-[8px] border border-muted bg-elevation-level-2"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/FilesAtomsSection.tsx
var W = [
	{
		size: We.Large,
		badge: it.Large,
		title: "Large"
	},
	{
		size: We.Medium,
		badge: it.Medium,
		title: "Medium"
	},
	{
		size: We.Small,
		badge: it.Small,
		title: "Small"
	}
], Wt = "src/app/components/index.tsx", Gt = "src/app/components/calendar/RecurringEventsTimeZonePicker.tsx", Kt = [
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
], qt = [
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
], Jt = [
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
		path: Gt,
		additions: 1204,
		deletions: 377
	}
], Yt = [
	{
		title: "Default",
		status: null
	},
	{
		title: "Changed",
		status: E.Changed
	},
	{
		title: "Added",
		status: E.Added
	},
	{
		title: "Deleted",
		status: E.Deleted
	},
	{
		title: "Changed name",
		status: E.ChangedName
	},
	{
		title: "Copied",
		status: E.Copied
	},
	{
		title: "Changed type",
		status: E.ChangedType
	},
	{
		title: "Conflict",
		status: E.Conflict
	},
	{
		title: "Not tracked",
		status: E.NotTracked
	},
	{
		title: "Ignored",
		status: E.Ignored
	}
], Xt = [
	{
		title: "File",
		variant: k.File
	},
	{
		title: "File, active",
		variant: k.File,
		active: !0
	},
	{
		title: "File, disabled",
		variant: k.File,
		disabled: !0
	},
	{
		title: "Folder",
		variant: k.Folder
	},
	{
		title: "Folder, open",
		variant: k.Folder,
		active: !0
	}
], Zt = "src/app/lib/parser.ts", G = (e, t, n, r, i = !0) => ({
	kind: e,
	old_lineno: t,
	new_lineno: n,
	content: r,
	has_trailing_newline: i
}), Qt = {
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
			G("context", 1, 1, "import { tokenize } from \"./lexer\";"),
			G("delete", 2, null, "import type { Token } from \"./lexer\";"),
			G("insert", null, 2, "import { type Token, TokenKind } from \"./lexer\";"),
			G("context", 3, 3, "")
		]
	}, {
		function_context: null,
		old_start: 24,
		old_lines: 3,
		new_start: 24,
		new_lines: 4,
		lines: [
			G("context", 24, 24, "export function parse(source: string): Token[] {"),
			G("delete", 25, null, "  return tokenize(source);"),
			G("insert", null, 25, "  const tokens = tokenize(source);"),
			G("insert", null, 26, "  return tokens.filter((token) => token.kind !== TokenKind.Whitespace && token.kind !== TokenKind.Comment);"),
			G("context", 26, 27, "}", !1)
		]
	}]
}, K = "bg-elevation-ground p-2", q = () => {};
function $t() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "File button"
		}), /* @__PURE__ */ z("div", {
			className: "grid w-fit grid-cols-[auto_repeat(3,auto)] items-center gap-x-4 gap-y-2",
			children: [
				/* @__PURE__ */ R("span", {}),
				W.map(({ size: e, title: t }) => /* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-muted",
					children: t
				}, e)),
				Kt.map((e) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: e.title
				}), W.map(({ size: t }) => /* @__PURE__ */ R("div", {
					className: K,
					children: /* @__PURE__ */ R(ut, {
						path: Wt,
						size: t,
						active: e.active,
						disabled: e.disabled,
						additions: e.additions,
						deletions: e.deletions,
						onClick: q
					})
				}, t))] }, e.title))
			]
		})]
	});
}
function en() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "A long name in 200px"
		}), /* @__PURE__ */ R("div", {
			className: "flex flex-wrap items-start gap-4",
			children: W.map(({ size: e }) => /* @__PURE__ */ R("div", {
				className: `w-[200px] ${K}`,
				children: /* @__PURE__ */ R(ut, {
					path: Gt,
					size: e,
					additions: 1204,
					deletions: 377,
					onClick: q
				})
			}, e))
		})]
	});
}
function tn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code changes badge"
		}), /* @__PURE__ */ z("div", {
			className: "grid w-fit grid-cols-[64px_repeat(3,auto)] items-center gap-x-6 gap-y-2",
			children: [
				/* @__PURE__ */ R("span", {}),
				qt.map(({ title: e }) => /* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-muted",
					children: e
				}, e)),
				W.map(({ badge: e, title: t }) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: t
				}), qt.map((t) => /* @__PURE__ */ R(Ke, {
					size: e,
					additions: t.additions,
					deletions: t.deletions
				}, t.title))] }, e))
			]
		})]
	});
}
function nn({ files: e, size: t, caption: n }) {
	let [r, i] = I(e[1]?.path ?? null);
	return /* @__PURE__ */ z("div", {
		className: "flex w-[280px] flex-col gap-2",
		children: [
			/* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: n
			}),
			/* @__PURE__ */ R("div", {
				className: K,
				children: /* @__PURE__ */ R($e, {
					"aria-label": "Changed files",
					size: t,
					files: e.map((e) => ({
						...e,
						active: e.path === r
					})),
					onOpen: i
				})
			}),
			/* @__PURE__ */ z("span", {
				className: "type-meta-strong text-basic-tertiary",
				children: ["Open file: ", r ?? "none"]
			})
		]
	});
}
function rn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [W.map(({ size: e, title: t }) => /* @__PURE__ */ R(nn, {
			size: e,
			files: Jt.slice(0, 5),
			caption: `List, 5 files, ${t}`
		}, e)), /* @__PURE__ */ R(nn, {
			size: We.Small,
			files: Jt,
			caption: "List, 17 files, Small"
		})]
	});
}
function an() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Git status labels"
		}), /* @__PURE__ */ R("div", {
			className: `flex w-fit gap-3 ${K}`,
			children: Object.values(E).map((e) => /* @__PURE__ */ R(rt, { status: e }, e))
		})]
	});
}
var on = (e) => e === k.Folder ? "components" : "index.tsx";
function sn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: "File list tab button, Small"
			}),
			/* @__PURE__ */ z("div", {
				className: "grid w-fit grid-cols-[auto_repeat(5,160px)] items-center gap-x-3 gap-y-1",
				children: [
					/* @__PURE__ */ R("span", {}),
					Xt.map(({ title: e }) => /* @__PURE__ */ R("span", {
						className: "type-meta-strong text-basic-muted",
						children: e
					}, e)),
					Yt.map(({ title: e, status: t }) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
						className: "type-meta-strong text-basic-tertiary",
						children: e
					}), Xt.map((e) => /* @__PURE__ */ R("div", {
						className: K,
						children: /* @__PURE__ */ R(tt, {
							name: on(e.variant),
							variant: e.variant,
							status: t,
							active: e.active,
							disabled: e.disabled,
							onClick: q
						})
					}, e.title))] }, e))
				]
			}),
			/* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: "File list tab button, Large"
			}),
			/* @__PURE__ */ R("div", {
				className: "flex flex-wrap items-start gap-4",
				children: Xt.filter((e) => !e.disabled).map((e) => /* @__PURE__ */ R("div", {
					className: `w-[280px] ${K}`,
					children: /* @__PURE__ */ R(tt, {
						name: on(e.variant),
						variant: e.variant,
						size: at.Large,
						status: E.Changed,
						active: e.active,
						onClick: q
					})
				}, e.title))
			})
		]
	});
}
var cn = (e, t) => ({
	kind: e.kind === "insert" || e.kind === "delete" ? e.kind : "context",
	number: e.kind === "delete" ? e.old_lineno : e.new_lineno ?? e.old_lineno,
	content: e.content,
	tokens: t,
	trailing: e.has_trailing_newline ? null : /* @__PURE__ */ R("span", {
		className: "italic text-basic-muted",
		children: " No newline at end of file"
	})
});
function ln() {
	let [e, t] = I(() => /* @__PURE__ */ new Map());
	return vt(() => {
		let e = !0;
		return f(Zt, [Qt]).then((n) => {
			e && t(n);
		}), () => {
			e = !1;
		};
	}, []), /* @__PURE__ */ R("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [{
			title: "Code displayer, two hunks",
			tokens: e
		}, {
			title: "Code displayer without tokens",
			tokens: null
		}].map(({ title: e, tokens: t }) => /* @__PURE__ */ z("div", {
			className: "flex w-[480px] flex-col gap-2",
			children: [/* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}), /* @__PURE__ */ R("div", {
				className: K,
				children: /* @__PURE__ */ R(me, {
					"aria-label": `Changes to ${Zt}`,
					hunks: Qt.hunks.map((e) => e.lines.map((e) => cn(e, t?.get(e))))
				})
			})]
		}, e))
	});
}
function un() {
	return /* @__PURE__ */ R(C, {
		title: "Files",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ R($t, {}),
				/* @__PURE__ */ R(en, {}),
				/* @__PURE__ */ R(tn, {}),
				/* @__PURE__ */ R(rn, {}),
				/* @__PURE__ */ R(an, {}),
				/* @__PURE__ */ R(sn, {}),
				/* @__PURE__ */ R(ln, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/InputsSection.tsx
var dn = [
	{
		id: "sonnet",
		label: "Claude Sonnet",
		icon: p.Brain
	},
	{
		id: "opus",
		label: "Claude Opus",
		icon: p.Brain
	},
	{
		id: "gpt",
		label: "GPT",
		icon: p.Ai
	}
];
function fn({ onOpenModal: e }) {
	let [t, n] = I("sonnet");
	return /* @__PURE__ */ R(C, {
		title: "Inputs",
		children: /* @__PURE__ */ z("div", {
			className: "flex flex-col gap-5 p-4",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-end gap-4",
					children: [
						/* @__PURE__ */ R(M, {
							label: "Working directory",
							inputSize: Be.Medium,
							placeholder: "/Users/me/project",
							className: "w-full max-w-[320px]"
						}),
						/* @__PURE__ */ R(M, {
							label: "Search",
							inputSize: Be.Medium,
							leading: xe.Icon,
							leadingIconName: p.Search,
							placeholder: "Filter sessions",
							hintText: "Matches name and cwd",
							className: "w-full max-w-[280px]"
						}),
						/* @__PURE__ */ R(Pe, {
							items: dn,
							value: t,
							onValueChange: n,
							placeholder: "Pick a model"
						})
					]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-end gap-4",
					children: [/* @__PURE__ */ R(M, {
						label: "Project name",
						placeholder: "nac",
						hintText: "Large: forms and dialogs. 44px on touch screens.",
						className: "w-full max-w-[320px]"
					}), /* @__PURE__ */ R(M, {
						label: "Base URL",
						defaultValue: "api.example",
						validation: !0,
						validationText: "Enter a full URL, including https://",
						className: "w-full max-w-[320px]"
					})]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-center gap-3",
					children: [/* @__PURE__ */ R(l, {
						variant: a.Secondary,
						onClick: e,
						children: "Open modal"
					}), /* @__PURE__ */ R("span", {
						className: "type-meta text-basic-tertiary",
						children: "A confirmation dialog: 20px corners, 52px header, pill actions."
					})]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/InsightItemsPreview.tsx
var pn = "The parser drops nested tables because the lexer resets its indent stack on every blank line. Check where resetIndent is called before changing it: the list renderer relies on the same reset.", mn = "npm run typecheck", hn = JSON.stringify({
	cmd: mn,
	workdir: "/workspace/demo-project",
	yield_time_ms: 1e4
}, null, 2), gn = "> nac-web@0.0.0 typecheck\n> tsc -p packages/nac-client/tsconfig.json --noEmit && tsc -b\n\nChecked src/app/components/inspector/insights/presentation/InsightDetailColumn.tsx without errors.", _n = `${gn}\nChecked 412 files in 6.1 s.\nFound 0 errors.`, vn = "Pause after the staging deploy and wait for my review before touching production.", yn = "resetIndent\\(", bn = JSON.stringify({
	pattern: yn,
	path: "src/app/lib",
	output_mode: "content"
}, null, 2), xn = "src/app/lib/lexer.ts:42\nsrc/app/lib/lexer.ts:118\nsrc/app/lib/parser/table.ts:7", Sn = `${xn}\nsrc/app/lib/parser/list.ts:63\nsrc/app/lib/parser/list.ts:91`, Cn = [
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
], J = `${Cn.join("|").slice(0, 110)}…`, wn = JSON.stringify({
	pattern: Cn.join("|"),
	path: "src/app/lib",
	regex: !0
}, null, 2), Tn = "The file changed on disk after it was read, so the edit was not applied. Read src/app/lib/lexer.ts again and repeat the edit against its current content; the old text no longer matches line 42.", En = `${Tn.slice(0, 160).trimEnd()}...`, Dn = 1200;
function On() {
	let [e, t] = I(x.Default);
	return vt(() => {
		if (e !== x.Loading) return;
		let n = window.setTimeout(() => t(x.Expanded), Dn);
		return () => window.clearTimeout(n);
	}, [e]), {
		state: e,
		showFull: () => t(x.Loading),
		hide: () => t(x.Default)
	};
}
function Y({ title: e, shortContent: t, fullContent: n }) {
	let r = On();
	return /* @__PURE__ */ R(ve, {
		title: e,
		state: r.state,
		shortContent: t,
		fullContent: n,
		onShowFull: r.showFull,
		onHide: r.hide
	});
}
function kn() {
	let e = On(), t = e.state === x.Expanded;
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Error, the message cut by its preview"
		}), /* @__PURE__ */ R("div", {
			className: "w-[542px] max-w-full bg-elevation-ground",
			children: /* @__PURE__ */ R(gt, {
				id: "preview-cut-error",
				icon: p.Edit,
				title: "Edit lexer.ts",
				state: g.Error,
				errorMessage: t ? Tn : En,
				errorAction: /* @__PURE__ */ R(Re, {
					expanded: t,
					loading: e.state === x.Loading,
					onClick: t ? e.hide : e.showFull
				})
			})
		})]
	});
}
var X = () => {}, An = [
	{
		label: "Default, with Show full",
		title: "Input",
		shortContent: J,
		onShowFull: X
	},
	{
		label: "Default, without Show full",
		title: "Input",
		shortContent: J
	},
	{
		label: "Default, without a preview",
		title: "Input",
		shortContent: "",
		onShowFull: X
	},
	{
		label: "Default, the load failed (Show full retries)",
		title: "Input",
		shortContent: J,
		onShowFull: X,
		error: "Could not load the full input."
	},
	{
		label: "Loading",
		title: "Input",
		state: x.Loading,
		shortContent: J,
		onShowFull: X
	},
	{
		label: "Expanded",
		title: "Input",
		state: x.Expanded,
		shortContent: J,
		fullContent: wn,
		onHide: X
	},
	{
		label: "Expanded, cut by the server",
		title: "Input",
		state: x.Expanded,
		shortContent: J,
		fullContent: wn,
		onHide: X,
		note: "The server cut this input at its size limit."
	},
	{
		label: "Without heading",
		title: "Input",
		showHeading: !1,
		shortContent: J,
		onShowFull: X
	}
];
function jn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code displayer"
		}), /* @__PURE__ */ z("div", {
			className: "grid grid-cols-3 items-start gap-4",
			children: [An.map(({ label: e, ...t }) => /* @__PURE__ */ z("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: e
				}), /* @__PURE__ */ R("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ R(ve, { ...t })
				})]
			}, e)), /* @__PURE__ */ z("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: "Interactive"
				}), /* @__PURE__ */ R("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ R(Y, {
						title: "Input",
						shortContent: J,
						fullContent: wn
					})
				})]
			})]
		})]
	});
}
var Mn = [
	{
		type: "Reasoning",
		icon: p.Brain,
		title: "Thoughts, 2.3 s",
		loadingTitle: "Thinking",
		copyText: pn,
		errorMessage: "The model stopped before it finished reasoning.",
		body: (e) => e === g.Default ? /* @__PURE__ */ R("p", { children: pn }) : null
	},
	{
		type: "Run Command (Error keeps the input)",
		icon: p.Terminal,
		title: "Run command",
		loadingTitle: "Running command",
		copyText: mn,
		errorMessage: "Command exited with code 2.",
		body: (e) => {
			if (e === g.Loading) return null;
			let t = /* @__PURE__ */ R(Y, {
				title: "Input",
				shortContent: mn,
				fullContent: hn
			});
			return e === g.Error ? t : /* @__PURE__ */ z(L, { children: [t, /* @__PURE__ */ R(Y, {
				title: "Output",
				shortContent: gn,
				fullContent: _n
			})] });
		}
	},
	{
		type: "Steer Session (Loading and Error keep the link)",
		icon: p.AddChat,
		title: "Steer session",
		loadingTitle: "Steer session",
		copyText: vn,
		errorMessage: "The session is no longer running.",
		body: (e) => e === g.Default ? /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R("p", { children: vn }), /* @__PURE__ */ R(Le, {
			label: "Calendar rollout",
			href: "#/design"
		})] }) : /* @__PURE__ */ R(Le, {
			label: "Calendar rollout",
			onClick: () => {}
		})
	},
	{
		type: "Search File",
		icon: p.SearchFile,
		title: "Search files",
		loadingTitle: "Search files",
		copyText: yn,
		errorMessage: "The pattern is not a valid regular expression.",
		body: (e) => {
			if (e === g.Loading) return null;
			let t = /* @__PURE__ */ R(Y, {
				title: "Input",
				shortContent: yn,
				fullContent: bn
			});
			return e === g.Error ? t : /* @__PURE__ */ z(L, { children: [t, /* @__PURE__ */ R(Y, {
				title: "Output",
				shortContent: xn,
				fullContent: Sn
			})] });
		}
	}
], Nn = [
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
function Pn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Stacked, the first one active"
		}), /* @__PURE__ */ R("div", {
			className: "flex w-[542px] max-w-full flex-col bg-elevation-ground",
			children: Mn.map((e, t) => /* @__PURE__ */ R(gt, {
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
function Fn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ R(jn, {}),
			/* @__PURE__ */ R(Pn, {}),
			/* @__PURE__ */ R(kn, {}),
			/* @__PURE__ */ z("div", {
				className: "grid grid-cols-3 items-start gap-x-4 gap-y-2",
				children: [Nn.map(({ state: e, title: t }) => /* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-muted",
					children: t
				}, e)), Mn.flatMap((e) => [!1, !0].map((t) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
					className: "col-span-3 pt-2 type-meta-strong text-basic-tertiary",
					children: t ? `${e.type}, active` : e.type
				}), Nn.map(({ state: n }) => /* @__PURE__ */ R("div", {
					className: "min-w-0 bg-elevation-ground",
					children: /* @__PURE__ */ R(gt, {
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
var In = [
	{
		type: "Thread",
		icon: p.Chat,
		label: "impl/calendar",
		meta: "Thread, 3"
	},
	{
		type: "Thoughts",
		icon: p.Brain,
		label: "Thoughts",
		meta: "13.8 s",
		runningLabel: "Thinking…"
	},
	{
		type: "Define Workset",
		icon: p.Checklist,
		label: "calendar-sync",
		meta: "Workset",
		failedLabel: "Define Workset",
		runningLabel: "Defining Workset…"
	},
	{
		type: "Delete Workset",
		icon: p.Trash,
		label: "Deleted: impl/calendar",
		failedLabel: "Delete thread",
		runningLabel: "Deleting…"
	},
	{
		type: "Read File",
		icon: p.ReadFile,
		label: "index.tsx",
		meta: "Read",
		failedLabel: "Read File",
		runningLabel: "Reading File…"
	},
	{
		type: "Write File",
		icon: p.FileUpload,
		label: "index.tsx",
		meta: "Write",
		failedLabel: "Create File",
		runningLabel: "Creating File…"
	},
	{
		type: "Edit File",
		icon: p.Edit,
		label: "index.tsx",
		meta: "Edit",
		failedLabel: "Edit File",
		runningLabel: "Editing File…"
	},
	{
		type: "Glob",
		icon: p.SearchFiles,
		label: "Find files",
		meta: "Glob",
		runningLabel: "Find files…"
	},
	{
		type: "Grep",
		icon: p.SearchFile,
		label: "Search files",
		meta: "Grep",
		runningLabel: "Search files…"
	},
	{
		type: "Run Terminal",
		icon: p.Terminal,
		label: "Run command",
		meta: "Exec",
		runningLabel: "Running command…"
	},
	{
		type: "Use Terminal",
		icon: p.WriteCommand,
		label: "Write command",
		meta: "Write",
		runningLabel: "Write command…"
	},
	{
		type: "Read Output Command",
		icon: p.ScreenView,
		label: "Read Output Command",
		meta: "Read",
		runningLabel: "Read Output Command…"
	},
	{
		type: "Create goal",
		icon: p.Flag,
		label: "Create goal",
		meta: "Create",
		runningLabel: "Creating goal…"
	},
	{
		type: "Read goal",
		icon: p.Goal,
		label: "Get goal",
		meta: "Read",
		runningLabel: "Get goal…"
	},
	{
		type: "Update goal",
		icon: p.Checklist,
		label: "Update goal",
		meta: "Edit",
		runningLabel: "Updating goal…"
	},
	{
		type: "Spawn Session - Agent",
		icon: p.Plane,
		label: "Calendar sync agent",
		meta: "Spawn",
		failedLabel: "Spawn Agent",
		runningLabel: "Spawn Agent…"
	},
	{
		type: "Spawn Session - Orchestrator",
		icon: p.Orchestrator,
		label: "Calendar rollout",
		meta: "Spawn",
		failedLabel: "Spawn Orchestrator",
		runningLabel: "Spawn Orchestrator…"
	},
	{
		type: "Check session status",
		icon: p.Info,
		label: "Calendar sync agent",
		meta: "Check",
		failedLabel: "Check session status",
		runningLabel: "Checking session status…"
	},
	{
		type: "Steer Session",
		icon: p.AddChat,
		label: "Calendar rollout",
		meta: "Steer",
		failedLabel: "Steer session",
		runningLabel: "Steer session…"
	},
	{
		type: "Session Read",
		icon: p.Eye,
		label: "Calendar rollout",
		meta: "Read",
		failedLabel: "Read session",
		runningLabel: "Reading session…"
	},
	{
		type: "Session Wait",
		icon: p.Timelaps,
		label: "Calendar rollout",
		meta: "Wait",
		failedLabel: "Wait for session",
		runningLabel: "Wait for session…"
	},
	{
		type: "Cancel session",
		icon: p.Trash,
		label: "Calendar sync agent",
		meta: "Delete",
		failedLabel: "Delete session",
		runningLabel: "Deleting session…"
	},
	{
		type: "ToolsSegment",
		icon: p.Right,
		label: "Total activity: 13.3s",
		meta: "12",
		runningLabel: "Working…",
		group: !0
	},
	{
		type: "Web search",
		icon: p.Search,
		label: "tokio select timeout",
		meta: "Search",
		runningLabel: "Searching the web…"
	},
	{
		type: "Web fetch",
		icon: p.Globe,
		label: "docs.rs",
		meta: "Fetch",
		runningLabel: "Fetching docs.rs…"
	},
	{
		type: "Other tool",
		icon: p.Code,
		label: "MCP · list_issues",
		meta: "Tool",
		runningLabel: "Running list_issues…"
	}
], Ln = [
	{
		status: j.Ready,
		title: "Ready"
	},
	{
		status: j.Pending,
		title: "Pending"
	},
	{
		status: j.Running,
		title: "Running"
	},
	{
		status: j.Failed,
		title: "Failed or canceled"
	}
], Rn = [
	"Thread",
	"Read File",
	"ToolsSegment"
], Z = [
	{
		key: "thoughts",
		icon: p.Brain,
		label: "Thoughts",
		meta: "13.8 s"
	},
	{
		key: "read",
		icon: p.ReadFile,
		label: "index.tsx",
		meta: "Read"
	},
	{
		key: "write",
		icon: p.FileUpload,
		label: "index.tsx",
		meta: "Write"
	}
], zn = [
	"impl/calendar",
	"impl/recurring-events",
	"review/calendar",
	"docs/calendar"
], Bn = "flex w-[268px] flex-col gap-1 bg-elevation-ground p-2", Vn = "flex w-[380px] flex-col gap-1 bg-elevation-ground p-2";
function Hn(e, t) {
	return t === j.Running ? e.runningLabel ?? e.label : t === j.Failed ? e.failedLabel ?? e.label : e.label;
}
function Un(e, t) {
	return (t === j.Running || t === j.Failed) && e.type !== "Thread" ? void 0 : e.meta;
}
function Wn() {
	let e = [...In.map((e) => ({
		sample: e,
		active: !1
	})), ...In.filter((e) => Rn.includes(e.type)).map((e) => ({
		sample: e,
		active: !0
	}))];
	return /* @__PURE__ */ z("div", {
		className: "grid grid-cols-[136px_repeat(4,minmax(0,1fr))] items-center gap-x-3 gap-y-1",
		children: [
			/* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: "Type"
			}),
			Ln.map(({ status: e, title: t }) => /* @__PURE__ */ R("span", {
				className: "px-2 type-meta-strong text-basic-muted",
				children: t
			}, e)),
			e.map(({ sample: e, active: t }) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
				className: "truncate type-meta-strong text-basic-tertiary",
				children: t ? `${e.type}, active` : e.type
			}), Ln.map(({ status: n }) => /* @__PURE__ */ R(D, {
				icon: e.icon,
				label: Hn(e, n),
				meta: Un(e, n),
				status: n,
				selected: t || void 0,
				expanded: e.group ? t : void 0
			}, n))] }, `${e.type}-${t}`))
		]
	});
}
function Gn() {
	let [e, t] = I(!0), [n, r] = I("thoughts"), i = n === "group" || Z.some(({ key: e }) => e === n);
	return /* @__PURE__ */ z("div", {
		className: Bn,
		children: [
			/* @__PURE__ */ R(D, {
				icon: p.Right,
				label: "Total activity: 13.3s",
				meta: String(Z.length),
				expanded: e,
				selected: i,
				onClick: () => {
					t((e) => !e), r("group");
				}
			}),
			e ? /* @__PURE__ */ R(N, { children: Z.map((e) => /* @__PURE__ */ R(D, {
				icon: e.icon,
				label: e.label,
				meta: e.meta,
				selected: n === e.key,
				onClick: () => r(e.key)
			}, e.key)) }) : null,
			/* @__PURE__ */ R(D, {
				icon: p.Eye,
				label: "Calendar rollout",
				meta: "Read",
				onClick: () => {}
			}),
			/* @__PURE__ */ R(D, {
				icon: p.Right,
				label: "Total activity: 4.1s",
				meta: "5",
				expanded: !1
			}),
			/* @__PURE__ */ R(D, {
				icon: p.Orchestrator,
				label: "Calendar rollout",
				meta: "Spawn",
				onClick: () => {}
			}),
			/* @__PURE__ */ R(D, {
				icon: p.Brain,
				label: "Thoughts",
				meta: "2.1 s",
				selected: n === "last",
				onClick: () => r("last")
			})
		]
	});
}
function Kn() {
	let [e, t] = I(zn[0]), n = (n) => /* @__PURE__ */ R(D, {
		icon: p.Chat,
		label: n,
		meta: "Thread, 3",
		selected: e === n,
		onClick: () => t(n)
	}, n);
	return /* @__PURE__ */ z("div", {
		className: Bn,
		children: [
			/* @__PURE__ */ R(D, {
				icon: p.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ R(N, { children: zn.map(n) }),
			/* @__PURE__ */ R(D, {
				icon: p.Right,
				label: "Total activity: 13.3s",
				meta: "12",
				expanded: !1
			}),
			/* @__PURE__ */ R(N, { children: n("impl/time-zones") }),
			/* @__PURE__ */ R(D, {
				icon: p.Brain,
				label: "Thoughts",
				meta: "2.1 s"
			})
		]
	});
}
function qn() {
	return /* @__PURE__ */ z("div", {
		className: Bn,
		children: [
			/* @__PURE__ */ R(D, {
				icon: p.Chat,
				label: "impl/calendar-sync-recurring-events-and-time-zones",
				meta: "Thread, 12"
			}),
			/* @__PURE__ */ R(D, {
				icon: p.Orchestrator,
				label: "Roll the recurring-events fix out to every calendar provider",
				meta: "Spawn"
			}),
			/* @__PURE__ */ R(D, {
				icon: p.Plane,
				label: "Investigate why the nightly export drops recurring events",
				meta: "Spawn",
				status: j.Pending,
				selected: !0
			})
		]
	});
}
function Jn() {
	let [e, t] = I(!0), [n, r] = I("review/calendar"), i = st.Large;
	return /* @__PURE__ */ z("div", {
		className: Vn,
		children: [
			/* @__PURE__ */ R(D, {
				size: i,
				icon: p.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ z(N, {
				className: "py-2",
				children: [
					/* @__PURE__ */ R(D, {
						size: i,
						icon: p.Chat,
						label: "impl/calendar",
						meta: "Thread, 3",
						status: j.Running
					}),
					/* @__PURE__ */ R(D, {
						size: i,
						icon: p.Chat,
						label: "impl/recurring-events",
						meta: "Thread, 2",
						status: j.Failed
					}),
					/* @__PURE__ */ R(D, {
						size: i,
						icon: p.Chat,
						label: "docs/calendar",
						meta: "Thread, 1",
						status: j.Pending
					}),
					/* @__PURE__ */ R(D, {
						size: i,
						icon: p.Chat,
						label: "review/calendar",
						meta: "Thread, 3",
						selected: n === "review/calendar",
						onClick: () => r("review/calendar")
					})
				]
			}),
			/* @__PURE__ */ R(D, {
				size: i,
				icon: p.Right,
				label: "Worked for 13.3s",
				meta: String(Z.length),
				expanded: e,
				onClick: () => t((e) => !e)
			}),
			e ? /* @__PURE__ */ R(N, { children: Z.map((e) => /* @__PURE__ */ R(D, {
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
function Yn() {
	return /* @__PURE__ */ R(C, {
		title: "Insights",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ R(Wn, {}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-start gap-6",
					children: [
						/* @__PURE__ */ R(Gn, {}),
						/* @__PURE__ */ R(Kn, {}),
						/* @__PURE__ */ R(qn, {}),
						/* @__PURE__ */ R(Jn, {})
					]
				}),
				/* @__PURE__ */ R(Fn, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ModelLoaderSection.tsx
var Xn = [{
	variant: _e.Default,
	label: "Default"
}, {
	variant: _e.Accent,
	label: "Accent"
}], Zn = [
	{
		size: ze.Small,
		label: "Small 16px"
	},
	{
		size: ze.Medium,
		label: "Medium 20px"
	},
	{
		size: ze.Large,
		label: "Large 24px"
	}
], Qn = [
	1,
	2,
	3
];
function $n() {
	return /* @__PURE__ */ R(C, {
		title: "Model loader",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(4,72px)] items-center gap-x-4 gap-y-3",
			children: [
				/* @__PURE__ */ R("span", {}),
				/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Animated"
				}),
				Qn.map((e) => /* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-muted",
					children: ["Frame ", e]
				}, e)),
				Xn.flatMap(({ variant: e, label: t }) => Zn.map(({ size: n, label: r }) => /* @__PURE__ */ z(F, { children: [
					/* @__PURE__ */ z("span", {
						className: "type-body-chrome text-basic-secondary",
						children: [
							t,
							" · ",
							r
						]
					}),
					/* @__PURE__ */ R(Ie, {
						size: n,
						variant: e
					}),
					Qn.map((t) => /* @__PURE__ */ R(Ie, {
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
function er() {
	return /* @__PURE__ */ R(C, {
		title: "Notices",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ z("div", {
				className: "flex flex-wrap gap-3",
				children: [
					/* @__PURE__ */ R(De, {
						variant: he.Info,
						title: "Read-only snapshot",
						className: "w-full max-w-[280px]",
						children: "Pick the working tree to edit files again."
					}),
					/* @__PURE__ */ R(De, {
						variant: he.Error,
						title: "Run failed",
						className: "w-full max-w-[280px]",
						children: "The provider rejected the request."
					}),
					/* @__PURE__ */ R(De, {
						variant: he.Success,
						title: "Branch switched",
						className: "w-full max-w-[280px]"
					})
				]
			}), /* @__PURE__ */ z("div", {
				className: "flex w-full max-w-[398px] flex-col gap-2",
				children: [
					/* @__PURE__ */ R(v, {
						variant: _.Danger,
						title: "Needs your answer",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ R(v, {
						variant: _.Error,
						title: "Provider rejected the request",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ R(v, {
						variant: _.Success,
						title: "Branch merged",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ R(v, {
						variant: _.Info,
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
function tr() {
	let [e, t] = I(4), [n, r] = I(.7), [i, a] = I(["local"]), [ee, te] = I(1);
	return /* @__PURE__ */ R(C, {
		title: "Numeric inputs, tags and pagination",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-center gap-8",
					children: [/* @__PURE__ */ R(Te, {
						value: e,
						onChange: t,
						min: 1,
						max: 16,
						"aria-label": "Parallel threads"
					}), /* @__PURE__ */ z("div", {
						className: "flex items-center gap-4 w-[320px]",
						children: [/* @__PURE__ */ R(pe, {
							min: 0,
							max: 2,
							step: .1,
							value: n,
							onChange: r,
							label: "Temperature"
						}), /* @__PURE__ */ R("span", {
							className: "code code-small text-basic-muted w-8 shrink-0",
							children: n.toFixed(1)
						})]
					})]
				}),
				/* @__PURE__ */ R(mt, {
					tags: [
						"local",
						"docker",
						"remote",
						"sandbox"
					],
					selected: i,
					onChange: a
				}),
				/* @__PURE__ */ R(Ze, {
					page: ee,
					pageSize: 10,
					totalItems: 84,
					itemLabel: "sessions",
					onPageChange: te,
					className: "border-t border-muted"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/OverlaysSection.tsx
var nr = [
	{
		icon: p.Edit,
		label: "Rename"
	},
	{
		icon: p.FileCopy,
		label: "Copy link"
	},
	{
		icon: p.Pin,
		label: "Pin to top"
	}
], rr = [
	{
		variant: u.Success,
		content: "Session settings saved"
	},
	{
		variant: u.Danger,
		content: "Connection lost. Retrying…"
	},
	{
		variant: u.Error,
		content: "Could not update pin"
	}
];
function ir() {
	let [e, t] = I([]), n = yt(0), r = yt(/* @__PURE__ */ new Set());
	vt(() => {
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
			let e = rr[n.current % rr.length], r = n.current++;
			t((t) => [...t, {
				id: r,
				...e,
				dismissing: !1
			}]), i(() => a(r), 3e3);
		},
		dismiss: a
	};
}
function ar() {
	let [t, i] = I(!1), [te, u] = I(!1), [d, f] = I(!1), { toasts: re, show: ae, dismiss: m } = ir();
	return /* @__PURE__ */ z(C, {
		title: "Overlays",
		children: [
			/* @__PURE__ */ z(V, {
				label: "Popover",
				hint: "Overlay surface, 14px corner, 32px rows. A sheet on phones.",
				children: [
					/* @__PURE__ */ R(ee, {
						open: t,
						onClose: () => i(!1),
						placement: r.BottomRight,
						size: oe.Small,
						sticky: !0,
						content: nr.map((e) => /* @__PURE__ */ z(Xe, {
							size: T.Medium,
							onClick: () => i(!1),
							children: [/* @__PURE__ */ R(o, { iconName: e.icon }), /* @__PURE__ */ R("span", {
								className: "min-w-0 flex-1 truncate text-left",
								children: e.label
							})]
						}, e.label)),
						children: /* @__PURE__ */ z(l, {
							variant: a.Secondary,
							content: c.IconRight,
							"aria-expanded": t,
							onClick: () => i((e) => !e),
							children: ["Open popover", /* @__PURE__ */ R(o, { iconName: p.Down })]
						})
					}),
					/* @__PURE__ */ R(ne, { value: "nac" }),
					/* @__PURE__ */ R(e, { keys: ["cmd", "k"] })
				]
			}),
			/* @__PURE__ */ z(V, {
				label: "Tooltip",
				hint: "An inverse ink chip, 12px, with its shortcut.",
				children: [/* @__PURE__ */ R(se, {
					title: "New session",
					keyboardShortcuts: ["cmd", "n"],
					position: r.BottomCenter,
					children: /* @__PURE__ */ R(l, {
						variant: a.Ghost,
						content: c.Icon,
						"aria-label": "New session",
						children: /* @__PURE__ */ R(o, { iconName: p.Add })
					})
				}), /* @__PURE__ */ R(se, {
					title: "Pin session",
					description: "Keeps it at the top of its project.",
					position: r.BottomCenter,
					sticky: !0,
					showTooltipOnMobile: !0,
					children: /* @__PURE__ */ R(l, {
						variant: a.Ghost,
						content: c.Icon,
						"aria-label": "Pin",
						children: /* @__PURE__ */ R(o, { iconName: p.Pin })
					})
				})]
			}),
			/* @__PURE__ */ R(V, {
				label: "Toast",
				hint: "A small pill at the bottom centre; errors read in red.",
				children: /* @__PURE__ */ R(l, {
					variant: a.Secondary,
					onClick: ae,
					children: "Show a toast"
				})
			}),
			/* @__PURE__ */ z(V, {
				label: "Drawer and sheet",
				hint: "Right drawer on desktop, bottom sheet on phones.",
				children: [/* @__PURE__ */ R(l, {
					variant: a.Secondary,
					onClick: () => u(!0),
					children: "Open drawer"
				}), /* @__PURE__ */ R(l, {
					variant: a.Secondary,
					onClick: () => f(!0),
					children: "Open bottom sheet"
				})]
			}),
			/* @__PURE__ */ R(de, {
				open: te,
				onClose: () => u(!1),
				title: "Changes",
				headerActions: /* @__PURE__ */ R(l, {
					variant: a.Ghost,
					size: s.Small,
					children: "All changes"
				}),
				children: /* @__PURE__ */ z("div", {
					className: "type-body-chrome flex flex-col gap-3 p-4 text-basic-secondary",
					children: [/* @__PURE__ */ R("p", { children: "Drawers carry everything that is not the conversation: changes, subagents, terminal, goal, schedules and insights. They open from the header pills." }), /* @__PURE__ */ R("p", {
						className: "text-basic-tertiary",
						children: "Escape or the close button returns focus here."
					})]
				})
			}),
			/* @__PURE__ */ R(n, {
				open: d,
				onClose: () => f(!1),
				children: /* @__PURE__ */ R("div", {
					className: "flex flex-col px-2",
					children: nr.map((e) => /* @__PURE__ */ z(Xe, {
						size: T.Large,
						onClick: () => f(!1),
						children: [/* @__PURE__ */ R(o, { iconName: e.icon }), /* @__PURE__ */ R("span", {
							className: "min-w-0 flex-1 truncate text-left",
							children: e.label
						})]
					}, e.label))
				})
			}),
			re.length > 0 ? /* @__PURE__ */ R("div", {
				className: "pointer-events-none fixed inset-x-0 bottom-[calc(20px+env(safe-area-inset-bottom))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2",
				children: re.map((e) => /* @__PURE__ */ R(ie, {
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
var or = [
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
function sr({ swatch: e }) {
	return /* @__PURE__ */ z("div", {
		className: "flex min-w-0 flex-col gap-1",
		children: [
			/* @__PURE__ */ R("span", {
				"aria-hidden": !0,
				className: d("h-10 w-full rounded-md", e.line ? "border-2" : "shadow-[inset_0_0_0_1px_var(--f-line)]"),
				style: e.line ? {
					borderColor: `var(${e.token})`,
					background: "var(--f-surface)"
				} : { background: `var(${e.token})` }
			}),
			/* @__PURE__ */ R("span", {
				className: "type-meta-strong mt-0.5 truncate text-[var(--f-ink)]",
				children: e.name
			}),
			/* @__PURE__ */ R("code", {
				className: "truncate font-mono text-2xs text-[var(--f-ink-3)]",
				children: e.token
			})
		]
	});
}
function cr({ mode: e }) {
	return /* @__PURE__ */ z("div", {
		className: d(e, "flex min-w-0 flex-1 flex-col gap-5 rounded-card border border-[var(--f-line)] bg-[var(--f-ground)] p-4 text-[var(--f-ink)]"),
		children: [/* @__PURE__ */ z("div", {
			className: "flex items-baseline justify-between gap-2",
			children: [/* @__PURE__ */ R("span", {
				className: "type-strong",
				children: e === "light" ? "Light" : "Dark"
			}), /* @__PURE__ */ R("span", {
				className: "type-meta text-[var(--f-ink-3)]",
				children: e === "light" ? "Ink on warm paper" : "Designed, not inverted"
			})]
		}), or.map((e) => /* @__PURE__ */ z("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ R("span", {
				className: "type-meta-strong text-[var(--f-ink-3)]",
				children: e.label
			}), /* @__PURE__ */ R("div", {
				className: "grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-x-2.5 gap-y-3",
				children: e.swatches.map((e) => /* @__PURE__ */ R(sr, { swatch: e }, e.token))
			})]
		}, e.label))]
	});
}
function lr() {
	return /* @__PURE__ */ R(C, {
		title: "Palette",
		children: /* @__PURE__ */ z("div", {
			className: "flex flex-col gap-4 p-4",
			children: [/* @__PURE__ */ R("ul", {
				className: "type-body-chrome flex flex-col gap-1 text-basic-secondary",
				children: or.map((e) => /* @__PURE__ */ z("li", { children: [
					/* @__PURE__ */ z("span", {
						className: "text-basic-primary",
						children: [e.label, "."]
					}),
					" ",
					e.note
				] }, e.label))
			}), /* @__PURE__ */ z("div", {
				className: "flex flex-col gap-4 lg:flex-row",
				children: [/* @__PURE__ */ R(cr, { mode: "light" }), /* @__PURE__ */ R(cr, { mode: "dark" })]
			})]
		})
	});
}
// src/app/components/pages/design-preview/QualificationSection.tsx
function ur() {
	return /* @__PURE__ */ R(C, {
		title: "Selected presentation journeys",
		children: /* @__PURE__ */ z("div", {
			className: "type-body-chrome flex min-w-0 flex-col gap-3 p-4 text-basic-secondary",
			children: [
				/* @__PURE__ */ R("p", { children: "Use these production patterns together: readable reasoning and answers, calm navigation, one new-session flow from Home, a settings page with grouped sections, managed readiness and drawers with a clear way back. Keep a 4px spacing rhythm and 44px phone controls." }),
				/* @__PURE__ */ R("p", { children: "Samples document the treatment. Qualify complete journeys in the built standalone app and the exact packed presentation, including two independent views alongside host controls. Check light and dark, long and error content, keyboard focus, reduced motion and real 200% browser zoom." }),
				/* @__PURE__ */ R("p", { children: "Native inputs, the instance-owned overlay stack and specialized code, math, diff and terminal views retain their existing owners. A sample or passing fixture does not record human design acceptance or signed hosted qualification." })
			]
		})
	});
}
// src/app/components/pages/design-preview/ReasoningSection.tsx
var dr = "The build spends most of its time preparing images. I’ll check the cache key before changing the build steps.\n\nA stable key should include the lockfile and image directory so unchanged inputs can reuse the cache.";
function fr() {
	let [e, t] = I(!0);
	return /* @__PURE__ */ R(C, {
		title: "Conversation: reasoning and answer",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex min-w-0 flex-col gap-4",
			children: [
				/* @__PURE__ */ R("p", {
					className: "type-body-chrome text-basic-secondary",
					children: "Reasoning: 14px / 22px, secondary text, 12px paragraphs, 16px inset, 1px tertiary rule, no filled surface. Header and copy targets: 44px. Answer: existing 14px / 24px primary prose. Live opens; settled starts closed. A reader’s toggle, focus or selection wins on settlement. Activity remains a link to Insights; this is its reasoning detail, without a second heading."
				}),
				/* @__PURE__ */ R(l, {
					variant: a.Secondary,
					onClick: () => t(!e),
					children: e ? "Settle reasoning" : "Resume reasoning"
				}),
				/* @__PURE__ */ R(et, {
					segment: {
						kind: "reasoning",
						key: "preview",
						text: dr,
						streaming: e,
						durationMs: e ? null : 2300
					},
					active: !1
				}),
				/* @__PURE__ */ R(lt, { children: "Use a stable image cache key to avoid rebuilding unchanged images." })
			]
		})
	});
}
// src/app/components/pages/design-preview/samples.ts
var pr = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
];
// src/app/components/pages/design-preview/SessionAvatarsSection.tsx
function mr() {
	return /* @__PURE__ */ R(C, {
		title: "Session avatars",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [pr.map((e) => /* @__PURE__ */ z("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ R(ce, {
					id: e,
					size: 40
				}), /* @__PURE__ */ R("span", {
					className: "code code-small text-basic-muted",
					children: e
				})]
			}, e)), /* @__PURE__ */ z("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ R(Oe, {}), /* @__PURE__ */ R("span", {
					className: "code code-small text-basic-muted",
					children: "unassigned"
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/SessionIdentitySection.tsx
var hr = [
	Me.Small,
	Me.Medium,
	Me.Large
], gr = [
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
], _r = [
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
], vr = [
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
], yr = () => {};
function br() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[200px_repeat(12,32px)] items-center gap-y-3",
		children: [
			/* @__PURE__ */ R("span", {}),
			gr.map((e) => /* @__PURE__ */ R("span", {
				className: "col-span-3 type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			_t.map((e) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
				className: "type-body-chrome truncate text-basic-secondary",
				children: e.label
			}), gr.flatMap((t) => hr.map((n) => /* @__PURE__ */ R("span", {
				className: d("flex items-center justify-center", t.className),
				children: /* @__PURE__ */ R(we, {
					behavior: e.id,
					size: n
				})
			}, `${t.label}-${n}`)))] }, e.id))
		]
	});
}
function xr({ isMobile: e }) {
	let t = /* @__PURE__ */ R(ot, {
		title: "Chat session 1",
		isMobile: e,
		onPin: yr,
		onRename: yr,
		onDelete: yr
	});
	return /* @__PURE__ */ z("div", {
		className: d("grid w-fit items-center gap-x-4 gap-y-2", e ? "grid-cols-[120px_repeat(4,240px)]" : "grid-cols-[120px_repeat(4,200px)]"),
		children: [
			/* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e ? "Mobile" : "Desktop"
			}),
			_r.map((e) => /* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			vr.map((n) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
				className: "type-body-chrome text-basic-secondary",
				children: n.label
			}), _r.map((r) => /* @__PURE__ */ R(be, {
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
function Sr() {
	return /* @__PURE__ */ R(C, {
		title: "Project navigation",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ R(br, {}),
				/* @__PURE__ */ z("div", {
					className: "flex items-start gap-2",
					children: [
						/* @__PURE__ */ R(A, {
							title: "Fix the parser",
							behavior: "direct",
							showBehaviorIcon: !0,
							active: !0
						}),
						/* @__PURE__ */ R(A, {
							title: "Rewrite the store layer",
							behavior: "direct-with-orchestrator",
							showBehaviorIcon: !0
						}),
						/* @__PURE__ */ R(A, {
							title: "Investigating",
							behavior: "orchestrator",
							showBehaviorIcon: !0,
							running: !0
						}),
						/* @__PURE__ */ R(A, {
							title: "Without NAC",
							behavior: "direct"
						}),
						/* @__PURE__ */ R(A, {
							title: "Fork: Fix the parser",
							forkedFromTitle: "Fix the parser"
						}),
						/* @__PURE__ */ R(A, {
							title: "Fork running",
							forkedFromTitle: "Fix the parser",
							running: !0
						})
					]
				}),
				/* @__PURE__ */ R(xr, { isMobile: !1 }),
				/* @__PURE__ */ R(xr, { isMobile: !0 }),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2 max-w-[320px]",
					children: [/* @__PURE__ */ R(ct, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title"
					}), /* @__PURE__ */ R(ct, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title",
						deleted: !0
					})]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-1 max-w-[320px]",
					children: [
						/* @__PURE__ */ R(ke, {
							entityId: pr[3],
							name: "arcee-ai/nac",
							trailing: "4",
							active: !0
						}),
						/* @__PURE__ */ R(ke, {
							entityId: pr[4],
							name: "arcee-ai/telos",
							trailing: "1",
							running: !0
						}),
						/* @__PURE__ */ R(ke, {
							entityId: pr[5],
							name: "Unassigned session",
							variant: Qe.Orphan
						})
					]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/ShapeSection.tsx
var Cr = [
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
], wr = {
	"rounded-xs": "rounded-xs",
	"rounded-sm": "rounded-sm",
	"rounded-md": "rounded-md",
	"rounded-lg": "rounded-lg",
	"rounded-card": "rounded-card",
	"rounded-sheet": "rounded-sheet",
	"rounded-composer": "rounded-composer",
	"rounded-pill": "rounded-pill"
}, Tr = [
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
], Er = [
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
function Dr() {
	let [e, t] = I(!1);
	return /* @__PURE__ */ z(C, {
		title: "Shape, elevation and motion",
		children: [
			/* @__PURE__ */ R(V, {
				label: "Radius",
				hint: "One scale. Controls are pills; boxes step up.",
				children: /* @__PURE__ */ R("div", {
					className: "grid w-full grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-4 gap-y-5",
					children: Cr.map((e) => /* @__PURE__ */ z("div", {
						className: "flex min-w-0 flex-col gap-1.5",
						children: [
							/* @__PURE__ */ R("span", {
								"aria-hidden": !0,
								className: d("h-12 w-full border border-secondary bg-elevation-sublevel-variant-A", wr[e.name])
							}),
							/* @__PURE__ */ R("code", {
								className: "truncate font-mono text-2xs text-basic-secondary",
								children: e.name
							}),
							/* @__PURE__ */ z("span", {
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
			/* @__PURE__ */ R(V, {
				label: "Elevation",
				hint: "Hairlines at rest; shadows only on floating layers.",
				children: /* @__PURE__ */ R("div", {
					className: "flex flex-wrap gap-4 rounded-card bg-elevation-ground p-4",
					children: Tr.map((e) => /* @__PURE__ */ z("div", {
						className: d("flex h-20 w-[132px] flex-col justify-end rounded-card p-3", e.className),
						children: [/* @__PURE__ */ R("span", {
							className: "type-label text-basic-primary",
							children: e.name
						}), /* @__PURE__ */ R(H, { children: e.token })]
					}, e.name))
				})
			}),
			/* @__PURE__ */ R(V, {
				label: "Motion",
				hint: "Quick ease-out, never bouncy; reduced motion turns it off.",
				children: /* @__PURE__ */ z("div", {
					className: "flex w-full flex-col gap-3",
					children: [
						/* @__PURE__ */ R("div", {
							className: "flex flex-wrap gap-4",
							children: Er.map((e) => /* @__PURE__ */ z("div", {
								className: "flex flex-col",
								children: [/* @__PURE__ */ R(H, { children: e.name }), /* @__PURE__ */ z("span", {
									className: "type-meta text-basic-tertiary",
									children: [
										e.value,
										" · ",
										e.use
									]
								})]
							}, e.name))
						}),
						/* @__PURE__ */ R("div", {
							className: "relative h-10 w-full max-w-[420px] rounded-pill bg-elevation-sublevel-variant-A",
							children: /* @__PURE__ */ R("span", {
								"aria-hidden": !0,
								className: "absolute top-1 size-8 rounded-pill bg-btn-primary transition-[left] duration-200 ease-[var(--ease-drawer)] motion-reduce:transition-none",
								style: { left: e ? "calc(100% - 36px)" : "4px" }
							})
						}),
						/* @__PURE__ */ R("div", { children: /* @__PURE__ */ R(l, {
							variant: a.Secondary,
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
var Or = He([
	"done",
	"working",
	"needs-answer",
	"idle"
]);
function kr() {
	return /* @__PURE__ */ z(C, {
		title: "Status",
		children: [
			/* @__PURE__ */ R(V, {
				label: "Ladder",
				hint: "Most urgent first; a row shows only its top rung.",
				children: /* @__PURE__ */ R("ol", {
					className: "flex w-full flex-col gap-2",
					children: ht.map((e, t) => /* @__PURE__ */ z("li", {
						className: "flex items-center gap-3",
						children: [
							/* @__PURE__ */ R("span", {
								className: "type-meta tabular w-4 text-right text-basic-muted",
								children: t + 1
							}),
							/* @__PURE__ */ R(P, {
								status: e,
								size: "md",
								labelled: !0
							}),
							pt(e) ? /* @__PURE__ */ R("span", {
								className: "type-tag rounded-pill bg-danger-primary px-2 py-0.5 text-danger-primary",
								children: "Needs you"
							}) : null
						]
					}, e))
				})
			}),
			/* @__PURE__ */ z(V, {
				label: "Roll-up",
				hint: "A parent shows its most urgent child.",
				children: [
					/* @__PURE__ */ R("span", {
						className: "type-body-chrome text-basic-secondary",
						children: "done, working, needs an answer, idle"
					}),
					/* @__PURE__ */ R("span", {
						"aria-hidden": !0,
						className: "text-basic-muted",
						children: "→"
					}),
					/* @__PURE__ */ R(P, {
						status: Or,
						size: "md",
						labelled: !0
					}),
					/* @__PURE__ */ z("code", {
						className: "code-small text-basic-muted",
						children: ["sessionStatus(…) = ", Ne({
							running: !0,
							pendingQuestions: 1
						})]
					})
				]
			}),
			/* @__PURE__ */ R(V, {
				label: "Working",
				hint: "The only agent-working animation.",
				children: /* @__PURE__ */ z("div", {
					className: "flex items-center gap-2",
					children: [
						/* @__PURE__ */ R(P, { status: "working" }),
						/* @__PURE__ */ R("span", {
							className: "type-body-chrome focus-shimmer",
							children: "Running tests…"
						}),
						/* @__PURE__ */ R("span", {
							className: "type-meta tabular text-basic-muted",
							children: "1m 12s"
						})
					]
				})
			}),
			/* @__PURE__ */ z(V, {
				label: "Loaders",
				hint: "Plain and quiet, for everything that is not the agent.",
				children: [
					/* @__PURE__ */ R(i, {
						size: t.Small,
						"aria-label": "Loading"
					}),
					/* @__PURE__ */ R(je, { size: t.Medium }),
					/* @__PURE__ */ R(Ee, {
						rows: 3,
						className: "w-[200px]"
					}),
					/* @__PURE__ */ R("div", {
						className: "w-[200px] overflow-hidden rounded-pill bg-elevation-sublevel-variant-A",
						children: /* @__PURE__ */ R(Ce, { active: !0 })
					})
				]
			})
		]
	});
}
var Q = {
	onOpen: () => {},
	sessionHref: "#/design"
}, Ar = [
	{
		label: "Ready · direct agent",
		card: {
			title: "Child session title",
			status: b.Ready,
			behavior: "direct",
			...Q
		}
	},
	{
		label: "Ready · direct + NAC",
		card: {
			title: "Child session title",
			status: b.Ready,
			behavior: "direct-with-orchestrator",
			...Q
		}
	},
	{
		label: "Ready · managed orchestrator",
		card: {
			title: "Child session title",
			status: b.Ready,
			lineage: "managed-orchestrator",
			...Q
		}
	},
	{
		label: "Running",
		card: {
			title: "Child session title",
			status: b.Running,
			behavior: "direct",
			...Q
		}
	},
	{
		label: "Failed",
		card: {
			title: "Child session title",
			status: b.Failed,
			statusLabel: "Failed",
			behavior: "direct",
			...Q
		}
	},
	{
		label: "Failed · cancelled",
		card: {
			title: "Child session title",
			status: b.Failed,
			statusLabel: "Cancelled",
			behavior: "direct",
			...Q
		}
	},
	{
		label: "Not found",
		card: {
			title: "Child session title",
			status: b.NotFound,
			...Q
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
], jr = [{
	label: "NAC on",
	showBehaviorIcon: !0
}, {
	label: "NAC off",
	showBehaviorIcon: !1
}], Mr = "Investigate the flaky parser tests in the store layer";
function Nr() {
	return /* @__PURE__ */ R(C, {
		title: "Subagent transcript card",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [/* @__PURE__ */ z("div", {
				className: "grid w-fit grid-cols-[200px_repeat(2,320px)] items-center gap-x-4 gap-y-3",
				children: [
					/* @__PURE__ */ R("span", {}),
					jr.map((e) => /* @__PURE__ */ R("span", {
						className: "type-meta-strong text-basic-muted",
						children: e.label
					}, e.label)),
					Ar.map((e) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e.label
					}), jr.map((t) => /* @__PURE__ */ R(ue, {
						showBehaviorIcon: t.showBehaviorIcon,
						...e.card
					}, t.label))] }, e.label))
				]
			}), /* @__PURE__ */ z("div", {
				className: "flex flex-col gap-2",
				children: [/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Narrow container · 240px"
				}), /* @__PURE__ */ z("div", {
					className: "flex w-[240px] flex-col gap-3",
					children: [/* @__PURE__ */ R(ue, {
						title: Mr,
						status: b.Ready,
						behavior: "direct",
						showBehaviorIcon: !0,
						...Q
					}), /* @__PURE__ */ R(ue, {
						title: Mr,
						status: b.Failed,
						statusLabel: "Cancelled",
						behavior: "direct",
						showBehaviorIcon: !0,
						...Q
					})]
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/ToolsBadgeSection.tsx
var Pr = [
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
], Fr = [
	{ label: "Thinking…" },
	{ label: "Searching the web…" },
	{
		label: "Fetching arcee.ai…",
		leadingIcon: p.Globe
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
], $ = () => {};
function Ir() {
	return /* @__PURE__ */ R(C, {
		title: "Tools and reasoning badge",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(2,auto)] items-center justify-items-start gap-x-10 gap-y-3",
			children: [
				/* @__PURE__ */ R("span", {}),
				/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Default"
				}),
				/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-muted",
					children: "Selected"
				}),
				Pr.map(({ caption: e, label: t, inProgress: n, disabled: r }) => /* @__PURE__ */ z(F, { children: [
					/* @__PURE__ */ R("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e
					}),
					/* @__PURE__ */ R(O, {
						label: t,
						inProgress: n,
						disabled: r,
						onClick: $
					}),
					/* @__PURE__ */ R(O, {
						label: t,
						inProgress: n,
						disabled: r,
						selected: !0,
						onClick: $
					})
				] }, e)),
				Fr.map(({ label: e, leadingIcon: t }, n) => /* @__PURE__ */ z(F, { children: [
					/* @__PURE__ */ R("span", {
						className: "type-body-chrome text-basic-secondary",
						children: n === 0 ? "In progress" : null
					}),
					/* @__PURE__ */ R(O, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						onClick: $
					}),
					/* @__PURE__ */ R(O, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						selected: !0,
						onClick: $
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
	return /* @__PURE__ */ R(C, {
		title: "Typography",
		children: /* @__PURE__ */ z("div", {
			className: "flex flex-col",
			children: [Lr.map((e) => /* @__PURE__ */ z("div", {
				className: "flex flex-col gap-1 border-b border-muted px-4 py-3 md:flex-row md:items-baseline md:gap-6",
				children: [/* @__PURE__ */ z("div", {
					className: "flex w-full shrink-0 flex-col md:w-[200px]",
					children: [/* @__PURE__ */ R(H, { children: e.name }), /* @__PURE__ */ R("span", {
						className: "type-meta text-basic-muted",
						children: e.spec
					})]
				}), /* @__PURE__ */ R("div", {
					className: `${e.name} min-w-0 truncate text-basic-primary`,
					children: e.sample
				})]
			}, e.name)), /* @__PURE__ */ z("div", {
				className: "flex flex-col gap-1 px-4 py-3 md:flex-row md:items-baseline md:gap-6",
				children: [/* @__PURE__ */ z("div", {
					className: "flex w-full shrink-0 flex-col md:w-[200px]",
					children: [/* @__PURE__ */ R(H, { children: "code-medium" }), /* @__PURE__ */ R("span", {
						className: "type-meta text-basic-muted",
						children: "IBM Plex Mono 12.5"
					})]
				}), /* @__PURE__ */ R("code", {
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
	let e = Je(), t = e?.setTheme;
	if (!t) return null;
	let n = e?.theme ?? "system";
	return /* @__PURE__ */ R("div", {
		role: "radiogroup",
		"aria-label": "Preview theme",
		className: "inline-flex items-center gap-0.5 rounded-pill bg-elevation-sublevel-variant-B p-0.5",
		children: Br.map((e) => /* @__PURE__ */ R("button", {
			type: "button",
			role: "radio",
			"aria-checked": n === e.id,
			onClick: () => t(e.id),
			className: d("type-label h-7 rounded-pill px-3 transition-colors duration-150 ease-out motion-reduce:transition-none", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-border-focus-outline)]", n === e.id ? "bg-elevation-level-1 text-basic-primary shadow-md" : "text-basic-tertiary hover:text-basic-primary"),
			children: e.label
		}, e.id))
	});
}
function Hr({ className: e }) {
	return /* @__PURE__ */ R("nav", {
		"aria-label": "Showcase contents",
		className: e,
		children: /* @__PURE__ */ R("ul", {
			className: "flex flex-col gap-0.5",
			children: zr.map((e) => /* @__PURE__ */ R("li", { children: /* @__PURE__ */ R("button", {
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
	return /* @__PURE__ */ z("div", {
		className: "h-full overflow-y-auto bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ z("header", {
			className: "sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-muted bg-elevation-ground/90 px-5 backdrop-blur-md",
			children: [
				/* @__PURE__ */ R(ye, { height: 16 }),
				/* @__PURE__ */ R("span", {
					className: "type-strong min-w-0 truncate text-basic-tertiary",
					children: "design system"
				}),
				/* @__PURE__ */ R("div", { className: "flex-1" }),
				/* @__PURE__ */ R(Vr, {})
			]
		}), /* @__PURE__ */ z("div", {
			className: "mx-auto flex w-full max-w-[1240px] gap-10 px-4 py-8 md:px-8 md:py-12",
			children: [/* @__PURE__ */ R(Hr, { className: "sticky top-[84px] hidden h-fit w-[184px] shrink-0 xl:block" }), /* @__PURE__ */ z("main", {
				className: "flex min-w-0 flex-1 flex-col gap-14",
				children: [
					/* @__PURE__ */ z("div", {
						className: "flex flex-col gap-3",
						children: [/* @__PURE__ */ R("h1", {
							className: "type-display text-basic-primary",
							children: "Focus"
						}), /* @__PURE__ */ R("p", {
							className: "type-body max-w-[62ch] text-basic-secondary",
							children: "Quiet, airy, confident. Warm-neutral paper with ink on it; colour only when it means something. Hairlines at rest, soft shadows on floating layers, pills for every control, and one status ladder everywhere."
						})]
					}),
					/* @__PURE__ */ z(B, {
						id: "foundations",
						title: "Foundations",
						description: "The palette in both themes, the one type scale, the radius scale, elevation and motion.",
						children: [
							/* @__PURE__ */ R(lr, {}),
							/* @__PURE__ */ R(Rr, {}),
							/* @__PURE__ */ R(Dr, {})
						]
					}),
					/* @__PURE__ */ z(B, {
						id: "controls",
						title: "Controls",
						description: "Buttons, fields, choices and chips. Hover, press and keyboard focus are live.",
						children: [
							/* @__PURE__ */ R(Lt, {}),
							/* @__PURE__ */ R(Wr, {}),
							/* @__PURE__ */ R(Bt, {}),
							/* @__PURE__ */ R(St, {}),
							/* @__PURE__ */ R(tr, {}),
							/* @__PURE__ */ R(Ut, {})
						]
					}),
					/* @__PURE__ */ z(B, {
						id: "feedback",
						title: "Status and feedback",
						description: "Needs approval, needs an answer, failed, working, waiting, done, idle — and the notices that explain them.",
						children: [
							/* @__PURE__ */ R(kr, {}),
							/* @__PURE__ */ R(er, {}),
							/* @__PURE__ */ R($n, {})
						]
					}),
					/* @__PURE__ */ R(B, {
						id: "overlays",
						title: "Floating layers",
						description: "Popovers, tooltips, toasts, drawers and sheets share one layer stack: Escape closes the top one and focus returns where it came from.",
						children: /* @__PURE__ */ R(ar, {})
					}),
					/* @__PURE__ */ z(B, {
						id: "conversation",
						title: "Conversation",
						description: "A centred 15px column: plain-prose answers, folded reasoning and tools, subagent cards.",
						children: [
							/* @__PURE__ */ R(fr, {}),
							/* @__PURE__ */ R(ur, {}),
							/* @__PURE__ */ R(Ir, {}),
							/* @__PURE__ */ R(Nr, {}),
							/* @__PURE__ */ R(Ht, {})
						]
					}),
					/* @__PURE__ */ z(B, {
						id: "navigation",
						title: "Sessions and navigation",
						description: "Session rows, tabs, avatars and identity in the sidebar and the header.",
						children: [
							/* @__PURE__ */ R(Sr, {}),
							/* @__PURE__ */ R(mr, {}),
							/* @__PURE__ */ R(bt, {})
						]
					}),
					/* @__PURE__ */ z(B, {
						id: "workspace",
						title: "Workspace",
						description: "Files, diffs and insights inside the drawers.",
						children: [/* @__PURE__ */ R(un, {}), /* @__PURE__ */ R(Yn, {})]
					})
				]
			})]
		})]
	});
}
function Wr() {
	let [e, t] = I(!1);
	return /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R(fn, { onOpenModal: () => t(!0) }), /* @__PURE__ */ z(te, {
		open: e,
		onClose: () => t(!1),
		title: "Delete session",
		size: ae.Small,
		footer: /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R(l, {
			variant: a.Secondary,
			onClick: () => t(!1),
			children: "Cancel"
		}), /* @__PURE__ */ R(l, {
			variant: a.SecondaryDestructive,
			onClick: () => t(!1),
			children: "Delete"
		})] }),
		children: [/* @__PURE__ */ R("p", { children: "“Fix the flaky parser test” and its transcript, subagents and schedules will be deleted. This cannot be undone." }), /* @__PURE__ */ R("p", {
			className: "type-meta mt-2 text-basic-tertiary",
			children: "The shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom."
		})]
	})] });
}
export { Ur as default };
