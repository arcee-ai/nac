import { O as e, Q as t, S as n, X as r, Z as i, _ as a, b as ee, c as te, et as o, f as ne, g as s, h as c, m as l, n as u, o as re, r as d, rt as f, t as ie, tt as p, u as ae, x as oe, y as se } from "./Toast-J9CfluTU.js";
import { $ as m, $t as ce, A as le, At as ue, B as h, C as de, Ct as fe, D as pe, E as me, F as he, G as ge, Gt as g, H as _e, Ht as _, I as ve, It as ye, J as be, Jt as xe, Kt as v, L as Se, Lt as Ce, M as we, Mt as y, N as Te, Nt as b, O as Ee, Ot as De, Pt as Oe, Q as x, Qt as S, R as ke, Rt as Ae, S as C, St as je, T as Me, U as w, Ut as T, V as Ne, Vt as Pe, W as Fe, Wt as E, Xt as Ie, Y as Le, Yt as D, Z as Re, Zt as ze, _t as Be, at as Ve, b as O, bt as He, ct as Ue, dt as We, et as Ge, ft as Ke, g as k, gt as A, h as qe, ht as Je, it as j, j as Ye, jt as Xe, k as Ze, kt as M, lt as Qe, mt as $e, n as et, nt as tt, q as N, qt as P, rt as F, st as nt, t as rt, tt as it, u as at, ut as I, vt as ot, wt as st, x as ct, xt as lt, y as ut, yt as dt, z as ft } from "./ChatSessionActions-B_Za4b2v.js";
import { Fragment as L, useEffect as pt, useRef as mt, useState as R } from "react";
import { Fragment as z, jsx as B, jsxs as V } from "react/jsx-runtime";
// src/app/components/pages/design-preview/AvatarsSection.tsx
function ht() {
	let [e, t] = R("Port the ArceeFM atoms");
	return /* @__PURE__ */ B(_, {
		title: "Avatars and editable header",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ V("div", {
				className: "flex flex-wrap items-center gap-4",
				children: [
					/* @__PURE__ */ B(g, {
						name: "Aleksy",
						size: v.Small
					}),
					/* @__PURE__ */ B(g, { name: "NAC Agent" }),
					/* @__PURE__ */ B(g, {
						name: "Opus",
						size: v.Large
					}),
					/* @__PURE__ */ B(g, {
						name: "🛠",
						glyph: !0,
						size: v.Large
					}),
					/* @__PURE__ */ B(g, {
						name: "Anthropic",
						size: v.XLarge,
						color: "var(--color-bg-info-primary)"
					})
				]
			}), /* @__PURE__ */ B($e, {
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
function W({ children: e }) {
	return /* @__PURE__ */ B("code", {
		className: "code-small text-basic-tertiary",
		children: e
	});
}
// src/app/components/pages/design-preview/BadgesSection.tsx
function gt() {
	return /* @__PURE__ */ V(z, { children: [
		/* @__PURE__ */ V(l, {
			variant: a.Secondary,
			size: s.Small,
			"aria-label": "Changes, 12 added, 3 removed",
			children: [/* @__PURE__ */ B("span", {
				className: "tabular text-success-primary",
				children: "+12"
			}), /* @__PURE__ */ B("span", {
				className: "tabular text-error-primary",
				children: "−3"
			})]
		}),
		/* @__PURE__ */ V(l, {
			variant: a.Secondary,
			size: s.Small,
			content: c.IconLeft,
			"aria-label": "3 agents, 1 running",
			children: [/* @__PURE__ */ B(A, { status: "working" }), "3 agents"]
		}),
		/* @__PURE__ */ V(l, {
			variant: a.Secondary,
			size: s.Small,
			content: c.IconLeft,
			children: [/* @__PURE__ */ B(o, { iconName: p.Flag }), "Goal"]
		}),
		/* @__PURE__ */ V(l, {
			variant: a.SecondaryHighlighted,
			size: s.Small,
			content: c.IconRight,
			children: ["Agent", /* @__PURE__ */ B(o, { iconName: p.Down })]
		})
	] });
}
function _t() {
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
						color: E.Neutral
					}),
					/* @__PURE__ */ B(T, {
						text: "Needs approval",
						color: E.Yellow
					}),
					/* @__PURE__ */ B(T, {
						text: "Failed",
						color: E.Red
					}),
					/* @__PURE__ */ B(T, {
						text: "Merged",
						color: E.Green
					}),
					/* @__PURE__ */ B(T, {
						text: "Docs",
						color: E.Blue
					}),
					/* @__PURE__ */ B(T, {
						text: "Idle",
						color: E.Gray
					}),
					/* @__PURE__ */ B(T, {
						text: "No wash",
						color: E.Red,
						background: !1
					})
				]
			}),
			/* @__PURE__ */ B(U, {
				label: "Chips",
				hint: "24px pills: header pills, composer chips.",
				children: /* @__PURE__ */ B(gt, {})
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
						size: ct.Large,
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
var vt = [
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
], yt = [
	{
		label: "Regular",
		variant: ce.Regular
	},
	{
		label: "Accent",
		variant: ce.Accent
	},
	{
		label: "Destructive",
		variant: ce.Destructive
	}
], bt = [
	{
		label: "small",
		size: S.Small
	},
	{
		label: "medium",
		size: S.Medium
	},
	{
		label: "large",
		size: S.Large
	}
], xt = [
	{
		label: "Small",
		size: m.Small
	},
	{
		label: "Medium",
		size: m.Medium
	},
	{
		label: "Large",
		size: m.Large
	}
], St = [
	{
		label: "Icon left",
		content: x.IconLeft
	},
	{
		label: "Icon right",
		content: x.IconRight
	},
	{
		label: "Icon",
		content: x.IconOnly
	},
	{
		label: "Text",
		content: x.TextOnly
	},
	{
		label: "Full",
		content: x.Full
	}
];
function Ct() {
	return /* @__PURE__ */ V("div", {
		className: "grid w-fit grid-cols-[160px_repeat(4,200px)] items-center gap-x-4 gap-y-2",
		children: [
			/* @__PURE__ */ B("span", {}),
			vt.map((e) => /* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			yt.flatMap((e) => bt.map((t) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ V("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), vt.map((n) => /* @__PURE__ */ V(ze, {
				variant: e.variant,
				size: t.size,
				active: n.active,
				disabled: n.disabled,
				children: [
					/* @__PURE__ */ B(o, { iconName: p.Search }),
					/* @__PURE__ */ B("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: "New session"
					}),
					/* @__PURE__ */ B(o, { iconName: p.Edit })
				]
			}, n.label))] }, `${e.label}-${t.label}`)))
		]
	});
}
function wt() {
	return /* @__PURE__ */ V("div", {
		className: "grid w-fit grid-cols-[160px_repeat(5,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ B("span", {}),
			St.map((e) => /* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			xt.flatMap((e) => vt.map((t) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ V("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label.toLowerCase()
				]
			}), St.map((n) => /* @__PURE__ */ B(Re, {
				size: e.size,
				content: n.content,
				active: t.active,
				disabled: t.disabled,
				iconName: p.Play,
				trailingIcon: p.Right,
				"aria-label": n.content === x.IconOnly ? "Run" : void 0,
				children: "Run"
			}, n.label))] }, `${e.label}-${t.label}`)))
		]
	});
}
function Tt() {
	return /* @__PURE__ */ V(z, { children: [/* @__PURE__ */ V("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ B("span", {
			className: "type-subheading text-basic-primary",
			children: "Rows (menus, lists)"
		}), /* @__PURE__ */ B(Ct, {})]
	}), /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ B("span", {
			className: "type-subheading text-basic-primary",
			children: "Tabs"
		}), /* @__PURE__ */ B(wt, {})]
	})] });
}
// src/app/components/pages/design-preview/ButtonsSection.tsx
var Et = [
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
], Dt = [
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
], Ot = [
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
], kt = [
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
function G({ variant: e, size: t = s.Medium, content: n = c.IconLeft, disabled: r = !1 }) {
	let i = n === c.Icon;
	return /* @__PURE__ */ V(l, {
		variant: e,
		size: t,
		content: n,
		disabled: r,
		"aria-label": i ? "Add" : void 0,
		children: [
			i || n === c.IconLeft ? /* @__PURE__ */ B(o, { iconName: p.Add }) : null,
			i ? null : "Label",
			n === c.IconRight ? /* @__PURE__ */ B(o, { iconName: p.Right }) : null
		]
	});
}
function At() {
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
			Et.map(({ label: e, variant: t }) => /* @__PURE__ */ V(L, { children: [
				/* @__PURE__ */ B("span", {
					className: "type-body-chrome text-basic-secondary",
					children: e
				}),
				/* @__PURE__ */ B(G, { variant: t }),
				/* @__PURE__ */ B(G, {
					variant: t,
					disabled: !0
				}),
				/* @__PURE__ */ B(G, {
					variant: t,
					content: c.Icon
				}),
				/* @__PURE__ */ B(G, {
					variant: t,
					content: c.Icon,
					disabled: !0
				})
			] }, e))
		]
	});
}
function jt() {
	return /* @__PURE__ */ V("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ B("span", {}),
			kt.map(({ label: e }) => /* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}, e)),
			Dt.flatMap((e) => Ot.map((t) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ V("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), kt.map(({ label: n, content: r }) => /* @__PURE__ */ B(G, {
				variant: e.variant,
				size: t.size,
				content: r
			}, n))] }, `${e.label}-${t.label}`)))
		]
	});
}
function Mt() {
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
							/* @__PURE__ */ B(l, {
								variant: a.Primary,
								children: "Primary"
							}),
							/* @__PURE__ */ B(l, {
								variant: a.Secondary,
								children: "Secondary"
							}),
							/* @__PURE__ */ B(l, {
								variant: a.Ghost,
								children: "Ghost"
							}),
							/* @__PURE__ */ B(l, {
								variant: a.Tertiary,
								children: "Tertiary"
							}),
							/* @__PURE__ */ B(l, {
								variant: a.SecondaryDestructive,
								children: "Delete"
							}),
							/* @__PURE__ */ B(l, {
								variant: a.GhostDestructive,
								children: "Remove"
							}),
							/* @__PURE__ */ B(l, {
								variant: a.Primary,
								loading: !0,
								children: "Loading"
							}),
							/* @__PURE__ */ B(l, {
								variant: a.Secondary,
								disabled: !0,
								children: "Disabled"
							}),
							/* @__PURE__ */ V(l, {
								variant: a.Secondary,
								content: c.IconLeft,
								children: [/* @__PURE__ */ B(o, { iconName: p.Add }), "New session"]
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
						/* @__PURE__ */ B(At, {}),
						/* @__PURE__ */ B(jt, {})
					]
				}),
				/* @__PURE__ */ B(Tt, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ChoicesSection.tsx
var Nt = [{
	id: "trace",
	name: "session-trace.txt",
	size: "12 KB"
}];
function Pt(e) {
	return {
		id: `${e.name}-${e.lastModified}`,
		name: e.name,
		size: `${Math.ceil(e.size / 1024)} KB`
	};
}
function Ft() {
	let [e, t] = R(!0), [n, r] = R("first"), [i, a] = R(Nt);
	return /* @__PURE__ */ B(_, {
		title: "Choices, multi-line and file input",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ V("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ B(De, {
						checked: e,
						onChange: t,
						children: "Skip permission prompts"
					}), /* @__PURE__ */ B(De, {
						checked: !1,
						onChange: () => {},
						disabled: !0,
						children: "Disabled"
					})]
				}),
				/* @__PURE__ */ V("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ B(pe, {
						name: "preview-choice",
						checked: n === "first",
						onChange: () => r("first"),
						children: "Working tree"
					}), /* @__PURE__ */ B(pe, {
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
					children: [/* @__PURE__ */ B(nt, {
						accept: ".txt,.md,.pdf",
						hint: "Text, Markdown or PDF.",
						onFilesSelected: (e) => a(e.map(Pt))
					}), /* @__PURE__ */ B(nt, {
						files: i,
						onRemove: (e) => a(i.filter((t) => t.id !== e))
					})]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/CodeBlockSection.tsx
var It = "pub enum AgentEvent {\n    RunStarted { run_id: String },\n    AssistantMessage {\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { run_id: String },\n}";
function Lt() {
	return /* @__PURE__ */ B(_, {
		title: "Code block and chat loader",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ B(d, {
				code: It,
				language: "rust",
				title: "events.rs",
				lineNumbers: !0,
				expandable: !0,
				maxHeight: "220px"
			}), /* @__PURE__ */ B(Pe, {})]
		})
	});
}
// src/app/components/pages/design-preview/DatesSection.tsx
function Rt() {
	let [e, t] = R(null), [n, r] = R({
		from: null,
		to: null
	});
	return /* @__PURE__ */ B(_, {
		title: "Dates",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ B(je, {
					label: "Created after",
					value: e,
					onChange: t,
					className: "w-[240px]"
				}),
				/* @__PURE__ */ B(je, {
					label: "Window",
					range: n,
					onRangeChange: r,
					hintText: "Two clicks pick the ends.",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ B(fe, {
					selected: e ? /* @__PURE__ */ new Date(`${e}T00:00:00`) : void 0,
					onSelect: (e) => t(`${e.getFullYear()}-${String(e.getMonth() + 1).padStart(2, "0")}-${String(e.getDate()).padStart(2, "0")}`),
					className: "rounded-[8px] border border-muted bg-elevation-level-2"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/FilesAtomsSection.tsx
var K = [
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
], zt = "src/app/components/index.tsx", Bt = "src/app/components/calendar/RecurringEventsTimeZonePicker.tsx", Vt = [
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
], Ht = [
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
], Ut = [
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
		path: Bt,
		additions: 1204,
		deletions: 377
	}
], Wt = [
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
], Gt = [
	{
		title: "File",
		variant: F.File
	},
	{
		title: "File, active",
		variant: F.File,
		active: !0
	},
	{
		title: "File, disabled",
		variant: F.File,
		disabled: !0
	},
	{
		title: "Folder",
		variant: F.Folder
	},
	{
		title: "Folder, open",
		variant: F.Folder,
		active: !0
	}
], Kt = "src/app/lib/parser.ts", q = (e, t, n, r, i = !0) => ({
	kind: e,
	old_lineno: t,
	new_lineno: n,
	content: r,
	has_trailing_newline: i
}), qt = {
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
			q("context", 1, 1, "import { tokenize } from \"./lexer\";"),
			q("delete", 2, null, "import type { Token } from \"./lexer\";"),
			q("insert", null, 2, "import { type Token, TokenKind } from \"./lexer\";"),
			q("context", 3, 3, "")
		]
	}, {
		function_context: null,
		old_start: 24,
		old_lines: 3,
		new_start: 24,
		new_lines: 4,
		lines: [
			q("context", 24, 24, "export function parse(source: string): Token[] {"),
			q("delete", 25, null, "  return tokenize(source);"),
			q("insert", null, 25, "  const tokens = tokenize(source);"),
			q("insert", null, 26, "  return tokens.filter((token) => token.kind !== TokenKind.Whitespace && token.kind !== TokenKind.Comment);"),
			q("context", 26, 27, "}", !1)
		]
	}]
}, J = "bg-elevation-ground p-2", Jt = () => {};
function Yt() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "File button"
		}), /* @__PURE__ */ V("div", {
			className: "grid w-fit grid-cols-[auto_repeat(3,auto)] items-center gap-x-4 gap-y-2",
			children: [
				/* @__PURE__ */ B("span", {}),
				K.map(({ size: e, title: t }) => /* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: t
				}, e)),
				Vt.map((e) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: e.title
				}), K.map(({ size: t }) => /* @__PURE__ */ B("div", {
					className: J,
					children: /* @__PURE__ */ B(Qe, {
						path: zt,
						size: t,
						active: e.active,
						disabled: e.disabled,
						additions: e.additions,
						deletions: e.deletions,
						onClick: Jt
					})
				}, t))] }, e.title))
			]
		})]
	});
}
function Xt() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "A long name in 200px"
		}), /* @__PURE__ */ B("div", {
			className: "flex flex-wrap items-start gap-4",
			children: K.map(({ size: e }) => /* @__PURE__ */ B("div", {
				className: `w-[200px] ${J}`,
				children: /* @__PURE__ */ B(Qe, {
					path: Bt,
					size: e,
					additions: 1204,
					deletions: 377,
					onClick: Jt
				})
			}, e))
		})]
	});
}
function Zt() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code changes badge"
		}), /* @__PURE__ */ V("div", {
			className: "grid w-fit grid-cols-[64px_repeat(3,auto)] items-center gap-x-6 gap-y-2",
			children: [
				/* @__PURE__ */ B("span", {}),
				Ht.map(({ title: e }) => /* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: e
				}, e)),
				K.map(({ badge: e, title: t }) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: t
				}), Ht.map((t) => /* @__PURE__ */ B(We, {
					size: e,
					additions: t.additions,
					deletions: t.deletions
				}, t.title))] }, e))
			]
		})]
	});
}
function Qt({ files: e, size: t, caption: n }) {
	let [r, i] = R(e[1]?.path ?? null);
	return /* @__PURE__ */ V("div", {
		className: "flex w-[280px] flex-col gap-2",
		children: [
			/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: n
			}),
			/* @__PURE__ */ B("div", {
				className: J,
				children: /* @__PURE__ */ B(Ue, {
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
function $t() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [K.map(({ size: e, title: t }) => /* @__PURE__ */ B(Qt, {
			size: e,
			files: Ut.slice(0, 5),
			caption: `List, 5 files, ${t}`
		}, e)), /* @__PURE__ */ B(Qt, {
			size: I.Small,
			files: Ut,
			caption: "List, 17 files, Small"
		})]
	});
}
function en() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Git status labels"
		}), /* @__PURE__ */ B("div", {
			className: `flex w-fit gap-3 ${J}`,
			children: Object.values(j).map((e) => /* @__PURE__ */ B(Ve, { status: e }, e))
		})]
	});
}
var tn = (e) => e === F.Folder ? "components" : "index.tsx";
function nn() {
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
					Gt.map(({ title: e }) => /* @__PURE__ */ B("span", {
						className: "type-meta-strong text-basic-muted",
						children: e
					}, e)),
					Wt.map(({ title: e, status: t }) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
						className: "type-meta-strong text-basic-tertiary",
						children: e
					}), Gt.map((e) => /* @__PURE__ */ B("div", {
						className: J,
						children: /* @__PURE__ */ B(it, {
							name: tn(e.variant),
							variant: e.variant,
							status: t,
							active: e.active,
							disabled: e.disabled,
							onClick: Jt
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
				children: Gt.filter((e) => !e.disabled).map((e) => /* @__PURE__ */ B("div", {
					className: `w-[280px] ${J}`,
					children: /* @__PURE__ */ B(it, {
						name: tn(e.variant),
						variant: e.variant,
						size: tt.Large,
						status: j.Changed,
						active: e.active,
						onClick: Jt
					})
				}, e.title))
			})
		]
	});
}
var rn = (e, t) => ({
	kind: e.kind === "insert" || e.kind === "delete" ? e.kind : "context",
	number: e.kind === "delete" ? e.old_lineno : e.new_lineno ?? e.old_lineno,
	content: e.content,
	tokens: t,
	trailing: e.has_trailing_newline ? null : /* @__PURE__ */ B("span", {
		className: "italic text-basic-muted",
		children: " No newline at end of file"
	})
});
function an() {
	let [e, t] = R(() => /* @__PURE__ */ new Map());
	return pt(() => {
		let e = !0;
		return re(Kt, [qt]).then((n) => {
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
				className: J,
				children: /* @__PURE__ */ B(st, {
					"aria-label": `Changes to ${Kt}`,
					hunks: qt.hunks.map((e) => e.lines.map((e) => rn(e, t?.get(e))))
				})
			})]
		}, e))
	});
}
function on() {
	return /* @__PURE__ */ B(_, {
		title: "Files",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ B(Yt, {}),
				/* @__PURE__ */ B(Xt, {}),
				/* @__PURE__ */ B(Zt, {}),
				/* @__PURE__ */ B($t, {}),
				/* @__PURE__ */ B(en, {}),
				/* @__PURE__ */ B(nn, {}),
				/* @__PURE__ */ B(an, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/InputsSection.tsx
var sn = [
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
function cn({ onOpenModal: e }) {
	let [t, n] = R("sonnet");
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
							leading: be.Icon,
							leadingIconName: p.Search,
							placeholder: "Filter sessions",
							hintText: "Matches name and cwd",
							className: "w-full max-w-[280px]"
						}),
						/* @__PURE__ */ B(Me, {
							items: sn,
							value: t,
							onValueChange: n,
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
					children: [/* @__PURE__ */ B(l, {
						variant: a.Secondary,
						onClick: e,
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
var ln = "The parser drops nested tables because the lexer resets its indent stack on every blank line. Check where resetIndent is called before changing it: the list renderer relies on the same reset.", un = "npm run typecheck", dn = JSON.stringify({
	cmd: un,
	workdir: "/workspace/demo-project",
	yield_time_ms: 1e4
}, null, 2), fn = "> nac-web@0.0.0 typecheck\n> tsc -p packages/nac-client/tsconfig.json --noEmit && tsc -b\n\nChecked src/app/components/inspector/insights/presentation/InsightDetailColumn.tsx without errors.", pn = `${fn}\nChecked 412 files in 6.1 s.\nFound 0 errors.`, mn = "Pause after the staging deploy and wait for my review before touching production.", hn = "resetIndent\\(", gn = JSON.stringify({
	pattern: hn,
	path: "src/app/lib",
	output_mode: "content"
}, null, 2), _n = "src/app/lib/lexer.ts:42\nsrc/app/lib/lexer.ts:118\nsrc/app/lib/parser/table.ts:7", vn = `${_n}\nsrc/app/lib/parser/list.ts:63\nsrc/app/lib/parser/list.ts:91`, yn = [
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
], Y = `${yn.join("|").slice(0, 110)}…`, bn = JSON.stringify({
	pattern: yn.join("|"),
	path: "src/app/lib",
	regex: !0
}, null, 2), xn = "The file changed on disk after it was read, so the edit was not applied. Read src/app/lib/lexer.ts again and repeat the edit against its current content; the old text no longer matches line 42.", Sn = `${xn.slice(0, 160).trimEnd()}...`, Cn = 1200;
function wn() {
	let [e, t] = R(w.Default);
	return pt(() => {
		if (e !== w.Loading) return;
		let n = window.setTimeout(() => t(w.Expanded), Cn);
		return () => window.clearTimeout(n);
	}, [e]), {
		state: e,
		showFull: () => t(w.Loading),
		hide: () => t(w.Default)
	};
}
function X({ title: e, shortContent: t, fullContent: n }) {
	let r = wn();
	return /* @__PURE__ */ B(_e, {
		title: e,
		state: r.state,
		shortContent: t,
		fullContent: n,
		onShowFull: r.showFull,
		onHide: r.hide
	});
}
function Tn() {
	let e = wn(), t = e.state === w.Expanded;
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Error, the message cut by its preview"
		}), /* @__PURE__ */ B("div", {
			className: "w-[542px] max-w-full bg-elevation-ground",
			children: /* @__PURE__ */ B(ft, {
				id: "preview-cut-error",
				icon: p.Edit,
				title: "Edit lexer.ts",
				state: h.Error,
				errorMessage: t ? xn : Sn,
				errorAction: /* @__PURE__ */ B(Fe, {
					expanded: t,
					loading: e.state === w.Loading,
					onClick: t ? e.hide : e.showFull
				})
			})
		})]
	});
}
var Z = () => {}, En = [
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
		state: w.Loading,
		shortContent: Y,
		onShowFull: Z
	},
	{
		label: "Expanded",
		title: "Input",
		state: w.Expanded,
		shortContent: Y,
		fullContent: bn,
		onHide: Z
	},
	{
		label: "Expanded, cut by the server",
		title: "Input",
		state: w.Expanded,
		shortContent: Y,
		fullContent: bn,
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
function Dn() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code displayer"
		}), /* @__PURE__ */ V("div", {
			className: "grid grid-cols-3 items-start gap-4",
			children: [En.map(({ label: e, ...t }) => /* @__PURE__ */ V("div", {
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
						fullContent: bn
					})
				})]
			})]
		})]
	});
}
var On = [
	{
		type: "Reasoning",
		icon: p.Brain,
		title: "Thoughts, 2.3 s",
		loadingTitle: "Thinking",
		copyText: ln,
		errorMessage: "The model stopped before it finished reasoning.",
		body: (e) => e === h.Default ? /* @__PURE__ */ B("p", { children: ln }) : null
	},
	{
		type: "Run Command (Error keeps the input)",
		icon: p.Terminal,
		title: "Run command",
		loadingTitle: "Running command",
		copyText: un,
		errorMessage: "Command exited with code 2.",
		body: (e) => {
			if (e === h.Loading) return null;
			let t = /* @__PURE__ */ B(X, {
				title: "Input",
				shortContent: un,
				fullContent: dn
			});
			return e === h.Error ? t : /* @__PURE__ */ V(z, { children: [t, /* @__PURE__ */ B(X, {
				title: "Output",
				shortContent: fn,
				fullContent: pn
			})] });
		}
	},
	{
		type: "Steer Session (Loading and Error keep the link)",
		icon: p.AddChat,
		title: "Steer session",
		loadingTitle: "Steer session",
		copyText: mn,
		errorMessage: "The session is no longer running.",
		body: (e) => e === h.Default ? /* @__PURE__ */ V(z, { children: [/* @__PURE__ */ B("p", { children: mn }), /* @__PURE__ */ B(Ne, {
			label: "Calendar rollout",
			href: "#/design"
		})] }) : /* @__PURE__ */ B(Ne, {
			label: "Calendar rollout",
			onClick: () => {}
		})
	},
	{
		type: "Search File",
		icon: p.SearchFile,
		title: "Search files",
		loadingTitle: "Search files",
		copyText: hn,
		errorMessage: "The pattern is not a valid regular expression.",
		body: (e) => {
			if (e === h.Loading) return null;
			let t = /* @__PURE__ */ B(X, {
				title: "Input",
				shortContent: hn,
				fullContent: gn
			});
			return e === h.Error ? t : /* @__PURE__ */ V(z, { children: [t, /* @__PURE__ */ B(X, {
				title: "Output",
				shortContent: _n,
				fullContent: vn
			})] });
		}
	}
], kn = [
	{
		state: h.Default,
		title: "Default"
	},
	{
		state: h.Loading,
		title: "Loading"
	},
	{
		state: h.Error,
		title: "Error"
	}
];
function An() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ B("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Stacked, the first one active"
		}), /* @__PURE__ */ B("div", {
			className: "flex w-[542px] max-w-full flex-col bg-elevation-ground",
			children: On.map((e, t) => /* @__PURE__ */ B(ft, {
				id: `preview-stacked-${e.icon}`,
				icon: e.icon,
				title: e.title,
				active: t === 0,
				copyText: e.copyText,
				children: e.body(h.Default)
			}, e.type))
		})]
	});
}
function jn() {
	return /* @__PURE__ */ V("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ B(Dn, {}),
			/* @__PURE__ */ B(An, {}),
			/* @__PURE__ */ B(Tn, {}),
			/* @__PURE__ */ V("div", {
				className: "grid grid-cols-3 items-start gap-x-4 gap-y-2",
				children: [kn.map(({ state: e, title: t }) => /* @__PURE__ */ B("span", {
					className: "type-meta-strong text-basic-muted",
					children: t
				}, e)), On.flatMap((e) => [!1, !0].map((t) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
					className: "col-span-3 pt-2 type-meta-strong text-basic-tertiary",
					children: t ? `${e.type}, active` : e.type
				}), kn.map(({ state: n }) => /* @__PURE__ */ B("div", {
					className: "min-w-0 bg-elevation-ground",
					children: /* @__PURE__ */ B(ft, {
						id: `preview-${e.icon}-${n}-${t}`,
						icon: e.icon,
						title: n === h.Loading ? e.loadingTitle : e.title,
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
var Mn = [
	{
		type: "Thoughts",
		icon: p.Brain,
		label: "Thoughts",
		meta: "13.8 s",
		runningLabel: "Thinking…"
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
], Nn = [
	{
		status: D.Ready,
		title: "Ready"
	},
	{
		status: D.Pending,
		title: "Pending"
	},
	{
		status: D.Running,
		title: "Running"
	},
	{
		status: D.Failed,
		title: "Failed or canceled"
	}
], Pn = ["Read File", "ToolsSegment"], Q = [
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
], Fn = "flex w-[268px] flex-col gap-1 bg-elevation-ground p-2", In = "flex w-[380px] flex-col gap-1 bg-elevation-ground p-2";
function Ln(e, t) {
	return t === D.Running ? e.runningLabel ?? e.label : t === D.Failed ? e.failedLabel ?? e.label : e.label;
}
function Rn(e, t) {
	return t === D.Running || t === D.Failed ? void 0 : e.meta;
}
function zn() {
	let e = [...Mn.map((e) => ({
		sample: e,
		active: !1
	})), ...Mn.filter((e) => Pn.includes(e.type)).map((e) => ({
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
			Nn.map(({ status: e, title: t }) => /* @__PURE__ */ B("span", {
				className: "px-2 type-meta-strong text-basic-muted",
				children: t
			}, e)),
			e.map(({ sample: e, active: t }) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
				className: "truncate type-meta-strong text-basic-tertiary",
				children: t ? `${e.type}, active` : e.type
			}), Nn.map(({ status: n }) => /* @__PURE__ */ B(P, {
				icon: e.icon,
				label: Ln(e, n),
				meta: Rn(e, n),
				status: n,
				selected: t || void 0,
				expanded: e.group ? t : void 0
			}, n))] }, `${e.type}-${t}`))
		]
	});
}
function Bn() {
	let [e, t] = R(!0), [n, r] = R("thoughts"), i = n === "group" || Q.some(({ key: e }) => e === n);
	return /* @__PURE__ */ V("div", {
		className: Fn,
		children: [
			/* @__PURE__ */ B(P, {
				icon: p.Right,
				label: "Total activity: 13.3s",
				meta: String(Q.length),
				expanded: e,
				selected: i,
				onClick: () => {
					t((e) => !e), r("group");
				}
			}),
			e ? /* @__PURE__ */ B(Ie, { children: Q.map((e) => /* @__PURE__ */ B(P, {
				icon: e.icon,
				label: e.label,
				meta: e.meta,
				selected: n === e.key,
				onClick: () => r(e.key)
			}, e.key)) }) : null,
			/* @__PURE__ */ B(P, {
				icon: p.Eye,
				label: "Calendar rollout",
				meta: "Read",
				onClick: () => {}
			}),
			/* @__PURE__ */ B(P, {
				icon: p.Right,
				label: "Total activity: 4.1s",
				meta: "5",
				expanded: !1
			}),
			/* @__PURE__ */ B(P, {
				icon: p.Brain,
				label: "Thoughts",
				meta: "2.1 s",
				selected: n === "last",
				onClick: () => r("last")
			})
		]
	});
}
function Vn() {
	return /* @__PURE__ */ V("div", {
		className: Fn,
		children: [
			/* @__PURE__ */ B(P, {
				icon: p.Chat,
				label: "impl/calendar-sync-recurring-events-and-time-zones",
				meta: "Read"
			}),
			/* @__PURE__ */ B(P, {
				icon: p.Plane,
				label: "Roll the recurring-events fix out to every calendar provider",
				meta: "Spawn"
			}),
			/* @__PURE__ */ B(P, {
				icon: p.Plane,
				label: "Investigate why the nightly export drops recurring events",
				meta: "Spawn",
				status: D.Pending,
				selected: !0
			})
		]
	});
}
function Hn() {
	let [e, t] = R(!0), [n, r] = R("review/calendar"), i = xe.Large;
	return /* @__PURE__ */ V("div", {
		className: In,
		children: [
			/* @__PURE__ */ B(P, {
				size: i,
				icon: p.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ V(Ie, {
				className: "py-2",
				children: [
					/* @__PURE__ */ B(P, {
						size: i,
						icon: p.Chat,
						label: "impl/calendar",
						meta: "Read",
						status: D.Running
					}),
					/* @__PURE__ */ B(P, {
						size: i,
						icon: p.Chat,
						label: "impl/recurring-events",
						meta: "Edit",
						status: D.Failed
					}),
					/* @__PURE__ */ B(P, {
						size: i,
						icon: p.Chat,
						label: "docs/calendar",
						meta: "Write",
						status: D.Pending
					}),
					/* @__PURE__ */ B(P, {
						size: i,
						icon: p.Chat,
						label: "review/calendar",
						meta: "Read",
						selected: n === "review/calendar",
						onClick: () => r("review/calendar")
					})
				]
			}),
			/* @__PURE__ */ B(P, {
				size: i,
				icon: p.Right,
				label: "Worked for 13.3s",
				meta: String(Q.length),
				expanded: e,
				onClick: () => t((e) => !e)
			}),
			e ? /* @__PURE__ */ B(Ie, { children: Q.map((e) => /* @__PURE__ */ B(P, {
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
function Un() {
	return /* @__PURE__ */ B(_, {
		title: "Insights",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ B(zn, {}),
				/* @__PURE__ */ V("div", {
					className: "flex flex-wrap items-start gap-6",
					children: [
						/* @__PURE__ */ B(Bn, {}),
						/* @__PURE__ */ B(Vn, {}),
						/* @__PURE__ */ B(Hn, {})
					]
				}),
				/* @__PURE__ */ B(jn, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ModelLoaderSection.tsx
var Wn = [{
	variant: Ae.Default,
	label: "Default"
}, {
	variant: Ae.Accent,
	label: "Accent"
}], Gn = [
	{
		size: Ce.Small,
		label: "Small 16px"
	},
	{
		size: Ce.Medium,
		label: "Medium 20px"
	},
	{
		size: Ce.Large,
		label: "Large 24px"
	}
], Kn = [
	1,
	2,
	3
];
function qn() {
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
				Kn.map((e) => /* @__PURE__ */ V("span", {
					className: "type-meta-strong text-basic-muted",
					children: ["Frame ", e]
				}, e)),
				Wn.flatMap(({ variant: e, label: t }) => Gn.map(({ size: n, label: r }) => /* @__PURE__ */ V(L, { children: [
					/* @__PURE__ */ V("span", {
						className: "type-body-chrome text-basic-secondary",
						children: [
							t,
							" · ",
							r
						]
					}),
					/* @__PURE__ */ B(ye, {
						size: n,
						variant: e
					}),
					Kn.map((t) => /* @__PURE__ */ B(ye, {
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
function Jn() {
	return /* @__PURE__ */ B(_, {
		title: "Notices",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ V("div", {
				className: "flex flex-wrap gap-3",
				children: [
					/* @__PURE__ */ B(Te, {
						variant: he.Info,
						title: "Read-only snapshot",
						className: "w-full max-w-[280px]",
						children: "Pick the working tree to edit files again."
					}),
					/* @__PURE__ */ B(Te, {
						variant: he.Error,
						title: "Run failed",
						className: "w-full max-w-[280px]",
						children: "The provider rejected the request."
					}),
					/* @__PURE__ */ B(Te, {
						variant: he.Success,
						title: "Branch switched",
						className: "w-full max-w-[280px]"
					})
				]
			}), /* @__PURE__ */ V("div", {
				className: "flex w-full max-w-[398px] flex-col gap-2",
				children: [
					/* @__PURE__ */ B(y, {
						variant: b.Danger,
						title: "Needs your answer",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ B(y, {
						variant: b.Error,
						title: "Provider rejected the request",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ B(y, {
						variant: b.Success,
						title: "Branch merged",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ B(y, {
						variant: b.Info,
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
function Yn() {
	let [e, t] = R(4), [n, r] = R(.7), [i, a] = R(["local"]), [ee, te] = R(1);
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
						"aria-label": "Parallel tasks"
					}), /* @__PURE__ */ V("div", {
						className: "flex items-center gap-4 w-[320px]",
						children: [/* @__PURE__ */ B(me, {
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
				/* @__PURE__ */ B(ut, {
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
var Xn = [
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
], Zn = [
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
function Qn() {
	let [e, t] = R([]), n = mt(0), r = mt(/* @__PURE__ */ new Set());
	pt(() => {
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
			let e = Zn[n.current % Zn.length], r = n.current++;
			t((t) => [...t, {
				id: r,
				...e,
				dismissing: !1
			}]), i(() => a(r), 3e3);
		},
		dismiss: a
	};
}
function $n() {
	let [t, i] = R(!1), [te, u] = R(!1), [re, d] = R(!1), { toasts: f, show: ae, dismiss: m } = Qn();
	return /* @__PURE__ */ V(_, {
		title: "Overlays",
		children: [
			/* @__PURE__ */ V(U, {
				label: "Popover",
				hint: "Overlay surface, 14px corner, 32px rows. A sheet on phones.",
				children: [
					/* @__PURE__ */ B(ee, {
						open: t,
						onClose: () => i(!1),
						placement: r.BottomRight,
						size: oe.Small,
						sticky: !0,
						content: Xn.map((e) => /* @__PURE__ */ V(ze, {
							size: S.Medium,
							onClick: () => i(!1),
							children: [/* @__PURE__ */ B(o, { iconName: e.icon }), /* @__PURE__ */ B("span", {
								className: "min-w-0 flex-1 truncate text-left",
								children: e.label
							})]
						}, e.label)),
						children: /* @__PURE__ */ V(l, {
							variant: a.Secondary,
							content: c.IconRight,
							"aria-expanded": t,
							onClick: () => i((e) => !e),
							children: ["Open popover", /* @__PURE__ */ B(o, { iconName: p.Down })]
						})
					}),
					/* @__PURE__ */ B(ne, { value: "nac" }),
					/* @__PURE__ */ B(e, { keys: ["cmd", "k"] })
				]
			}),
			/* @__PURE__ */ V(U, {
				label: "Tooltip",
				hint: "An inverse ink chip, 12px, with its shortcut.",
				children: [/* @__PURE__ */ B(se, {
					title: "New session",
					keyboardShortcuts: ["cmd", "n"],
					position: r.BottomCenter,
					children: /* @__PURE__ */ B(l, {
						variant: a.Ghost,
						content: c.Icon,
						"aria-label": "New session",
						children: /* @__PURE__ */ B(o, { iconName: p.Add })
					})
				}), /* @__PURE__ */ B(se, {
					title: "Pin session",
					description: "Keeps it at the top of its project.",
					position: r.BottomCenter,
					sticky: !0,
					showTooltipOnMobile: !0,
					children: /* @__PURE__ */ B(l, {
						variant: a.Ghost,
						content: c.Icon,
						"aria-label": "Pin",
						children: /* @__PURE__ */ B(o, { iconName: p.Pin })
					})
				})]
			}),
			/* @__PURE__ */ B(U, {
				label: "Toast",
				hint: "A small pill at the bottom centre; errors read in red.",
				children: /* @__PURE__ */ B(l, {
					variant: a.Secondary,
					onClick: ae,
					children: "Show a toast"
				})
			}),
			/* @__PURE__ */ V(U, {
				label: "Drawer and sheet",
				hint: "Right drawer on desktop, bottom sheet on phones.",
				children: [/* @__PURE__ */ B(l, {
					variant: a.Secondary,
					onClick: () => u(!0),
					children: "Open drawer"
				}), /* @__PURE__ */ B(l, {
					variant: a.Secondary,
					onClick: () => d(!0),
					children: "Open bottom sheet"
				})]
			}),
			/* @__PURE__ */ B(lt, {
				open: te,
				onClose: () => u(!1),
				title: "Changes",
				headerActions: /* @__PURE__ */ B(l, {
					variant: a.Ghost,
					size: s.Small,
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
			/* @__PURE__ */ B(n, {
				open: re,
				onClose: () => d(!1),
				children: /* @__PURE__ */ B("div", {
					className: "flex flex-col px-2",
					children: Xn.map((e) => /* @__PURE__ */ V(ze, {
						size: S.Large,
						onClick: () => d(!1),
						children: [/* @__PURE__ */ B(o, { iconName: e.icon }), /* @__PURE__ */ B("span", {
							className: "min-w-0 flex-1 truncate text-left",
							children: e.label
						})]
					}, e.label))
				})
			}),
			f.length > 0 ? /* @__PURE__ */ B("div", {
				className: "pointer-events-none fixed inset-x-0 bottom-[calc(20px+env(safe-area-inset-bottom))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2",
				children: f.map((e) => /* @__PURE__ */ B(ie, {
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
var er = [
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
function tr({ swatch: e }) {
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
function nr({ mode: e }) {
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
		}), er.map((e) => /* @__PURE__ */ V("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-[var(--f-ink-3)]",
				children: e.label
			}), /* @__PURE__ */ B("div", {
				className: "grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-x-2.5 gap-y-3",
				children: e.swatches.map((e) => /* @__PURE__ */ B(tr, { swatch: e }, e.token))
			})]
		}, e.label))]
	});
}
function rr() {
	return /* @__PURE__ */ B(_, {
		title: "Palette",
		children: /* @__PURE__ */ V("div", {
			className: "flex flex-col gap-4 p-4",
			children: [/* @__PURE__ */ B("ul", {
				className: "type-body-chrome flex flex-col gap-1 text-basic-secondary",
				children: er.map((e) => /* @__PURE__ */ V("li", { children: [
					/* @__PURE__ */ V("span", {
						className: "text-basic-primary",
						children: [e.label, "."]
					}),
					" ",
					e.note
				] }, e.label))
			}), /* @__PURE__ */ V("div", {
				className: "flex flex-col gap-4 lg:flex-row",
				children: [/* @__PURE__ */ B(nr, { mode: "light" }), /* @__PURE__ */ B(nr, { mode: "dark" })]
			})]
		})
	});
}
// src/app/components/pages/design-preview/QualificationSection.tsx
function ir() {
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
var ar = "The build spends most of its time preparing images. I’ll check the cache key before changing the build steps.\n\nA stable key should include the lockfile and image directory so unchanged inputs can reuse the cache.";
function or() {
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
				/* @__PURE__ */ B(l, {
					variant: a.Secondary,
					onClick: () => t(!e),
					children: e ? "Settle reasoning" : "Resume reasoning"
				}),
				/* @__PURE__ */ B(et, {
					segment: {
						kind: "reasoning",
						key: "preview",
						text: ar,
						streaming: e,
						durationMs: e ? null : 2300
					},
					active: !1
				}),
				/* @__PURE__ */ B(at, { children: "Use a stable image cache key to avoid rebuilding unchanged images." })
			]
		})
	});
}
// src/app/components/pages/design-preview/samples.ts
var sr = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
];
// src/app/components/pages/design-preview/SessionAvatarsSection.tsx
function cr() {
	return /* @__PURE__ */ B(_, {
		title: "Session avatars",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [sr.map((e) => /* @__PURE__ */ V("div", {
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
				children: [/* @__PURE__ */ B(Xe, {}), /* @__PURE__ */ B("span", {
					className: "code code-small text-basic-muted",
					children: "unassigned"
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/SessionIdentitySection.tsx
var lr = [
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
], ur = [
	{
		label: "Direct agent",
		sample: { behavior: "direct" }
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
		label: "Disabled",
		sample: {
			behavior: "direct",
			disabled: !0
		}
	}
], dr = () => {};
function fr({ isMobile: e }) {
	let t = /* @__PURE__ */ B(rt, {
		title: "Chat session 1",
		isMobile: e,
		onPin: dr,
		onRename: dr,
		onDelete: dr
	});
	return /* @__PURE__ */ V("div", {
		className: f("grid w-fit items-center gap-x-4 gap-y-2", e ? "grid-cols-[120px_repeat(4,240px)]" : "grid-cols-[120px_repeat(4,200px)]"),
		children: [
			/* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e ? "Mobile" : "Desktop"
			}),
			lr.map((e) => /* @__PURE__ */ B("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			ur.map((n) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
				className: "type-body-chrome text-basic-secondary",
				children: n.label
			}), lr.map((r) => /* @__PURE__ */ B(Oe, {
				title: "Chat session 1",
				isMobile: e,
				actions: t,
				...n.sample,
				...r.sample
			}, r.label))] }, n.label))
		]
	});
}
function pr() {
	return /* @__PURE__ */ B(_, {
		title: "Project navigation",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ V("div", {
					className: "flex items-start gap-2",
					children: [
						/* @__PURE__ */ B(M, {
							title: "Rewrite the store layer",
							behavior: "direct",
							active: !0
						}),
						/* @__PURE__ */ B(M, {
							title: "Investigating",
							behavior: "direct",
							running: !0
						}),
						/* @__PURE__ */ B(M, {
							title: "Fork: Fix the parser",
							forkedFromTitle: "Fix the parser"
						}),
						/* @__PURE__ */ B(M, {
							title: "Fork running",
							forkedFromTitle: "Fix the parser",
							running: !0
						})
					]
				}),
				/* @__PURE__ */ B(fr, { isMobile: !1 }),
				/* @__PURE__ */ B(fr, { isMobile: !0 }),
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
						/* @__PURE__ */ B(Ee, {
							entityId: sr[3],
							name: "arcee-ai/nac",
							trailing: "4",
							active: !0
						}),
						/* @__PURE__ */ B(Ee, {
							entityId: sr[4],
							name: "arcee-ai/telos",
							trailing: "1",
							running: !0
						}),
						/* @__PURE__ */ B(Ee, {
							entityId: sr[5],
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
var mr = [
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
], hr = {
	"rounded-xs": "rounded-xs",
	"rounded-sm": "rounded-sm",
	"rounded-md": "rounded-md",
	"rounded-lg": "rounded-lg",
	"rounded-card": "rounded-card",
	"rounded-sheet": "rounded-sheet",
	"rounded-composer": "rounded-composer",
	"rounded-pill": "rounded-pill"
}, gr = [
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
], _r = [
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
function vr() {
	let [e, t] = R(!1);
	return /* @__PURE__ */ V(_, {
		title: "Shape, elevation and motion",
		children: [
			/* @__PURE__ */ B(U, {
				label: "Radius",
				hint: "One scale. Controls are pills; boxes step up.",
				children: /* @__PURE__ */ B("div", {
					className: "grid w-full grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-4 gap-y-5",
					children: mr.map((e) => /* @__PURE__ */ V("div", {
						className: "flex min-w-0 flex-col gap-1.5",
						children: [
							/* @__PURE__ */ B("span", {
								"aria-hidden": !0,
								className: f("h-12 w-full border border-secondary bg-elevation-sublevel-variant-A", hr[e.name])
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
					children: gr.map((e) => /* @__PURE__ */ V("div", {
						className: f("flex h-20 w-[132px] flex-col justify-end rounded-card p-3", e.className),
						children: [/* @__PURE__ */ B("span", {
							className: "type-label text-basic-primary",
							children: e.name
						}), /* @__PURE__ */ B(W, { children: e.token })]
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
							children: _r.map((e) => /* @__PURE__ */ V("div", {
								className: "flex flex-col",
								children: [/* @__PURE__ */ B(W, { children: e.name }), /* @__PURE__ */ V("span", {
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
						/* @__PURE__ */ B("div", { children: /* @__PURE__ */ B(l, {
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
var yr = ot([
	"done",
	"working",
	"needs-answer",
	"idle"
]);
function br() {
	return /* @__PURE__ */ V(_, {
		title: "Status",
		children: [
			/* @__PURE__ */ B(U, {
				label: "Ladder",
				hint: "Most urgent first; a row shows only its top rung.",
				children: /* @__PURE__ */ B("ol", {
					className: "flex w-full flex-col gap-2",
					children: Be.map((e, t) => /* @__PURE__ */ V("li", {
						className: "flex items-center gap-3",
						children: [
							/* @__PURE__ */ B("span", {
								className: "type-meta tabular w-4 text-right text-basic-muted",
								children: t + 1
							}),
							/* @__PURE__ */ B(A, {
								status: e,
								size: "md",
								labelled: !0
							}),
							dt(e) ? /* @__PURE__ */ B("span", {
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
					/* @__PURE__ */ B(A, {
						status: yr,
						size: "md",
						labelled: !0
					}),
					/* @__PURE__ */ V("code", {
						className: "code-small text-basic-muted",
						children: ["sessionStatus(…) = ", He({
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
						/* @__PURE__ */ B(A, { status: "working" }),
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
					/* @__PURE__ */ B(i, {
						size: t.Small,
						"aria-label": "Loading"
					}),
					/* @__PURE__ */ B(ke, { size: t.Medium }),
					/* @__PURE__ */ B(ue, {
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
}, xr = [
	{
		label: "Ready · direct agent",
		card: {
			title: "Child session title",
			status: C.Ready,
			behavior: "direct",
			...$
		}
	},
	{
		label: "Running",
		card: {
			title: "Child session title",
			status: C.Running,
			behavior: "direct",
			...$
		}
	},
	{
		label: "Failed",
		card: {
			title: "Child session title",
			status: C.Failed,
			statusLabel: "Failed",
			behavior: "direct",
			...$
		}
	},
	{
		label: "Failed · cancelled",
		card: {
			title: "Child session title",
			status: C.Failed,
			statusLabel: "Cancelled",
			behavior: "direct",
			...$
		}
	},
	{
		label: "Not found",
		card: {
			title: "Child session title",
			status: C.NotFound,
			...$
		}
	},
	{
		label: "Static",
		card: {
			title: "Child session title",
			status: C.Ready,
			behavior: "direct"
		}
	}
], Sr = [{
	label: "Child session",
	showBehaviorIcon: !1
}], Cr = "Investigate the flaky parser tests in the store layer";
function wr() {
	return /* @__PURE__ */ B(_, {
		title: "Subagent transcript card",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ V("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [/* @__PURE__ */ V("div", {
				className: "grid w-fit grid-cols-[200px_320px] items-center gap-x-4 gap-y-3",
				children: [
					/* @__PURE__ */ B("span", {}),
					Sr.map((e) => /* @__PURE__ */ B("span", {
						className: "type-meta-strong text-basic-muted",
						children: e.label
					}, e.label)),
					xr.map((e) => /* @__PURE__ */ V(L, { children: [/* @__PURE__ */ B("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e.label
					}), Sr.map((t) => /* @__PURE__ */ B(de, {
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
					children: [/* @__PURE__ */ B(de, {
						title: Cr,
						status: C.Ready,
						behavior: "direct",
						showBehaviorIcon: !1,
						...$
					}), /* @__PURE__ */ B(de, {
						title: Cr,
						status: C.Failed,
						statusLabel: "Cancelled",
						behavior: "direct",
						showBehaviorIcon: !1,
						...$
					})]
				})]
			})]
		})
	});
}
// src/app/components/pages/design-preview/ToolsBadgeSection.tsx
var Tr = [
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
], Er = [
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
	{ label: "Checking session status…" },
	{ label: "Steering session…" },
	{ label: "Reading session…" },
	{ label: "Waiting for session…" },
	{ label: "Deleting session…" }
], Dr = () => {};
function Or() {
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
				Tr.map(({ caption: e, label: t, inProgress: n, disabled: r }) => /* @__PURE__ */ V(L, { children: [
					/* @__PURE__ */ B("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e
					}),
					/* @__PURE__ */ B(k, {
						label: t,
						inProgress: n,
						disabled: r,
						onClick: Dr
					}),
					/* @__PURE__ */ B(k, {
						label: t,
						inProgress: n,
						disabled: r,
						selected: !0,
						onClick: Dr
					})
				] }, e)),
				Er.map(({ label: e, leadingIcon: t }, n) => /* @__PURE__ */ V(L, { children: [
					/* @__PURE__ */ B("span", {
						className: "type-body-chrome text-basic-secondary",
						children: n === 0 ? "In progress" : null
					}),
					/* @__PURE__ */ B(k, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						onClick: Dr
					}),
					/* @__PURE__ */ B(k, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						selected: !0,
						onClick: Dr
					})
				] }, e))
			]
		})
	});
}
// src/app/components/pages/design-preview/TypographySection.tsx
var kr = [
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
function Ar() {
	return /* @__PURE__ */ B(_, {
		title: "Typography",
		children: /* @__PURE__ */ V("div", {
			className: "flex flex-col",
			children: [kr.map((e) => /* @__PURE__ */ V("div", {
				className: "flex flex-col gap-1 border-b border-muted px-4 py-3 md:flex-row md:items-baseline md:gap-6",
				children: [/* @__PURE__ */ V("div", {
					className: "flex w-full shrink-0 flex-col md:w-[200px]",
					children: [/* @__PURE__ */ B(W, { children: e.name }), /* @__PURE__ */ B("span", {
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
					children: [/* @__PURE__ */ B(W, { children: "code-medium" }), /* @__PURE__ */ B("span", {
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
var jr = [
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
], Mr = [
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
function Nr() {
	let e = qe(), t = e?.setTheme;
	if (!t) return null;
	let n = e?.theme ?? "system";
	return /* @__PURE__ */ B("div", {
		role: "radiogroup",
		"aria-label": "Preview theme",
		className: "inline-flex items-center gap-0.5 rounded-pill bg-elevation-sublevel-variant-B p-0.5",
		children: Mr.map((e) => /* @__PURE__ */ B("button", {
			type: "button",
			role: "radio",
			"aria-checked": n === e.id,
			onClick: () => t(e.id),
			className: f("type-label h-7 rounded-pill px-3 transition-colors duration-150 ease-out motion-reduce:transition-none", "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-border-focus-outline)]", n === e.id ? "bg-elevation-level-1 text-basic-primary shadow-md" : "text-basic-tertiary hover:text-basic-primary"),
			children: e.label
		}, e.id))
	});
}
function Pr({ className: e }) {
	return /* @__PURE__ */ B("nav", {
		"aria-label": "Showcase contents",
		className: e,
		children: /* @__PURE__ */ B("ul", {
			className: "flex flex-col gap-0.5",
			children: jr.map((e) => /* @__PURE__ */ B("li", { children: /* @__PURE__ */ B("button", {
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
function Fr() {
	return /* @__PURE__ */ V("div", {
		className: "h-full overflow-y-auto bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ V("header", {
			className: "sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-muted bg-elevation-ground/90 px-5 backdrop-blur-md",
			children: [
				/* @__PURE__ */ B(ve, { height: 16 }),
				/* @__PURE__ */ B("span", {
					className: "type-strong min-w-0 truncate text-basic-tertiary",
					children: "design system"
				}),
				/* @__PURE__ */ B("div", { className: "flex-1" }),
				/* @__PURE__ */ B(Nr, {})
			]
		}), /* @__PURE__ */ V("div", {
			className: "mx-auto flex w-full max-w-[1240px] gap-10 px-4 py-8 md:px-8 md:py-12",
			children: [/* @__PURE__ */ B(Pr, { className: "sticky top-[84px] hidden h-fit w-[184px] shrink-0 xl:block" }), /* @__PURE__ */ V("main", {
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
							/* @__PURE__ */ B(rr, {}),
							/* @__PURE__ */ B(Ar, {}),
							/* @__PURE__ */ B(vr, {})
						]
					}),
					/* @__PURE__ */ V(H, {
						id: "controls",
						title: "Controls",
						description: "Buttons, fields, choices and chips. Hover, press and keyboard focus are live.",
						children: [
							/* @__PURE__ */ B(Mt, {}),
							/* @__PURE__ */ B(Ir, {}),
							/* @__PURE__ */ B(Ft, {}),
							/* @__PURE__ */ B(_t, {}),
							/* @__PURE__ */ B(Yn, {}),
							/* @__PURE__ */ B(Rt, {})
						]
					}),
					/* @__PURE__ */ V(H, {
						id: "feedback",
						title: "Status and feedback",
						description: "Needs approval, needs an answer, failed, working, waiting, done, idle — and the notices that explain them.",
						children: [
							/* @__PURE__ */ B(br, {}),
							/* @__PURE__ */ B(Jn, {}),
							/* @__PURE__ */ B(qn, {})
						]
					}),
					/* @__PURE__ */ B(H, {
						id: "overlays",
						title: "Floating layers",
						description: "Popovers, tooltips, toasts, drawers and sheets share one layer stack: Escape closes the top one and focus returns where it came from.",
						children: /* @__PURE__ */ B($n, {})
					}),
					/* @__PURE__ */ V(H, {
						id: "conversation",
						title: "Conversation",
						description: "A centred 15px column: plain-prose answers, folded reasoning and tools, subagent cards.",
						children: [
							/* @__PURE__ */ B(or, {}),
							/* @__PURE__ */ B(ir, {}),
							/* @__PURE__ */ B(Or, {}),
							/* @__PURE__ */ B(wr, {}),
							/* @__PURE__ */ B(Lt, {})
						]
					}),
					/* @__PURE__ */ V(H, {
						id: "navigation",
						title: "Sessions and navigation",
						description: "Session rows, tabs, avatars and identity in the sidebar and the header.",
						children: [
							/* @__PURE__ */ B(pr, {}),
							/* @__PURE__ */ B(cr, {}),
							/* @__PURE__ */ B(ht, {})
						]
					}),
					/* @__PURE__ */ V(H, {
						id: "workspace",
						title: "Workspace",
						description: "Files, diffs and insights inside the drawers.",
						children: [/* @__PURE__ */ B(on, {}), /* @__PURE__ */ B(Un, {})]
					})
				]
			})]
		})]
	});
}
function Ir() {
	let [e, t] = R(!1);
	return /* @__PURE__ */ V(z, { children: [/* @__PURE__ */ B(cn, { onOpenModal: () => t(!0) }), /* @__PURE__ */ V(te, {
		open: e,
		onClose: () => t(!1),
		title: "Delete session",
		size: ae.Small,
		footer: /* @__PURE__ */ V(z, { children: [/* @__PURE__ */ B(l, {
			variant: a.Secondary,
			onClick: () => t(!1),
			children: "Cancel"
		}), /* @__PURE__ */ B(l, {
			variant: a.SecondaryDestructive,
			onClick: () => t(!1),
			children: "Delete"
		})] }),
		children: [/* @__PURE__ */ B("p", { children: "“Fix the flaky parser test” and its transcript, subagents and schedules will be deleted. This cannot be undone." }), /* @__PURE__ */ B("p", {
			className: "type-meta mt-2 text-basic-tertiary",
			children: "The shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom."
		})]
	})] });
}
export { Fr as default };
