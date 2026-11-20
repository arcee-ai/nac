import { $ as e, J as t, O as n, Q as r, S as i, X as a, Y as o, _ as s, b as ee, c as te, f as ne, g as c, h as l, m as u, n as d, o as re, r as ie, t as ae, tt as f, u as oe, x as se, y as ce } from "./Toast-D4LVKlSc.js";
import { $ as p, $t as m, A as le, At as ue, B as h, C as de, Ct as fe, D as pe, E as me, F as he, Ft as ge, G as _e, Gt as g, H as ve, Ht as ye, I as be, J as xe, Jt as _, Kt as v, L as Se, Lt as Ce, M as we, Mt as Te, N as Ee, Nt as y, O as De, Pt as b, Q as x, Qt as Oe, R as ke, Rt as Ae, S, St as je, T as Me, Tt as Ne, U as C, Ut as w, V as Pe, W as Fe, Wt as T, Xt as E, Y as Ie, Yt as Le, Z as Re, Zt as ze, at as Be, b as D, bt as Ve, ct as He, dt as Ue, en as We, et as Ge, ft as Ke, g as O, gt as k, h as qe, ht as Je, it as A, j as Ye, jt as Xe, k as Ze, kt as Qe, lt as $e, mt as et, n as tt, nt, q as j, qt as M, rt as N, st as rt, t as it, tt as at, u as ot, ut as P, vt as st, wt as ct, x as lt, xt as ut, y as dt, yt as ft, z as pt, zt as mt } from "./ChatSessionActions-DYDBwOX4.js";
import { Fragment as F, useEffect as ht, useRef as gt, useState as I } from "react";
import { Fragment as L, jsx as R, jsxs as z } from "react/jsx-runtime";
// src/app/components/pages/design-preview/AvatarsSection.tsx
function _t() {
	let [e, t] = I("Port the ArceeFM atoms");
	return /* @__PURE__ */ R(w, {
		title: "Avatars and editable header",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ z("div", {
				className: "flex flex-wrap items-center gap-4",
				children: [
					/* @__PURE__ */ R(v, {
						name: "Aleksy",
						size: M.Small
					}),
					/* @__PURE__ */ R(v, { name: "NAC Agent" }),
					/* @__PURE__ */ R(v, {
						name: "Opus",
						size: M.Large
					}),
					/* @__PURE__ */ R(v, {
						name: "🛠",
						glyph: !0,
						size: M.Large
					}),
					/* @__PURE__ */ R(v, {
						name: "Anthropic",
						size: M.XLarge,
						color: "var(--color-bg-info-primary)"
					})
				]
			}), /* @__PURE__ */ R(et, {
				value: e,
				onCommit: t,
				size: Je.Medium,
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
			className: f("flex min-w-0 flex-1 flex-wrap items-center gap-3", n),
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
function vt() {
	return /* @__PURE__ */ z(L, { children: [
		/* @__PURE__ */ z(u, {
			variant: s.Secondary,
			size: c.Small,
			"aria-label": "Changes, 12 added, 3 removed",
			children: [/* @__PURE__ */ R("span", {
				className: "tabular text-success-primary",
				children: "+12"
			}), /* @__PURE__ */ R("span", {
				className: "tabular text-error-primary",
				children: "−3"
			})]
		}),
		/* @__PURE__ */ z(u, {
			variant: s.Secondary,
			size: c.Small,
			content: l.IconLeft,
			"aria-label": "3 agents, 1 running",
			children: [/* @__PURE__ */ R(k, { status: "working" }), "3 agents"]
		}),
		/* @__PURE__ */ z(u, {
			variant: s.Secondary,
			size: c.Small,
			content: l.IconLeft,
			children: [/* @__PURE__ */ R(r, { iconName: e.Flag }), "Goal"]
		}),
		/* @__PURE__ */ z(u, {
			variant: s.SecondaryHighlighted,
			size: c.Small,
			content: l.IconRight,
			children: ["Agent", /* @__PURE__ */ R(r, { iconName: e.Down })]
		})
	] });
}
function yt() {
	let [e, t] = I(!0), [n, r] = I(!1);
	return /* @__PURE__ */ z(w, {
		title: "Badges, chips and switches",
		children: [
			/* @__PURE__ */ z(V, {
				label: "Badges",
				hint: "11px, sentence case, a soft wash.",
				children: [
					/* @__PURE__ */ R(T, {
						text: "Running",
						color: g.Neutral
					}),
					/* @__PURE__ */ R(T, {
						text: "Needs approval",
						color: g.Yellow
					}),
					/* @__PURE__ */ R(T, {
						text: "Failed",
						color: g.Red
					}),
					/* @__PURE__ */ R(T, {
						text: "Merged",
						color: g.Green
					}),
					/* @__PURE__ */ R(T, {
						text: "Docs",
						color: g.Blue
					}),
					/* @__PURE__ */ R(T, {
						text: "Idle",
						color: g.Gray
					}),
					/* @__PURE__ */ R(T, {
						text: "No wash",
						color: g.Red,
						background: !1
					})
				]
			}),
			/* @__PURE__ */ R(V, {
				label: "Chips",
				hint: "24px pills: header pills, composer chips.",
				children: /* @__PURE__ */ R(vt, {})
			}),
			/* @__PURE__ */ z(V, {
				label: "Switch",
				hint: "Ink track when on, in either theme.",
				children: [
					/* @__PURE__ */ R(D, {
						checked: e,
						onChange: t,
						"aria-label": "Notifications"
					}),
					/* @__PURE__ */ R(D, {
						checked: n,
						onChange: r,
						size: lt.Large,
						"aria-label": "Large switch"
					}),
					/* @__PURE__ */ R(D, {
						checked: !0,
						disabled: !0,
						"aria-label": "On, disabled"
					}),
					/* @__PURE__ */ R(D, {
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
var bt = [
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
], xt = [
	{
		label: "Regular",
		variant: We.Regular
	},
	{
		label: "Accent",
		variant: We.Accent
	},
	{
		label: "Destructive",
		variant: We.Destructive
	}
], St = [
	{
		label: "small",
		size: m.Small
	},
	{
		label: "medium",
		size: m.Medium
	},
	{
		label: "large",
		size: m.Large
	}
], Ct = [
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
], wt = [
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
function Tt() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[160px_repeat(4,200px)] items-center gap-x-4 gap-y-2",
		children: [
			/* @__PURE__ */ R("span", {}),
			bt.map((e) => /* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			xt.flatMap((t) => St.map((n) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ z("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					t.label,
					", ",
					n.label
				]
			}), bt.map((i) => /* @__PURE__ */ z(Oe, {
				variant: t.variant,
				size: n.size,
				active: i.active,
				disabled: i.disabled,
				children: [
					/* @__PURE__ */ R(r, { iconName: e.Search }),
					/* @__PURE__ */ R("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: "New session"
					}),
					/* @__PURE__ */ R(r, { iconName: e.Edit })
				]
			}, i.label))] }, `${t.label}-${n.label}`)))
		]
	});
}
function Et() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[160px_repeat(5,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ R("span", {}),
			wt.map((e) => /* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			Ct.flatMap((t) => bt.map((n) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ z("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					t.label,
					", ",
					n.label.toLowerCase()
				]
			}), wt.map((r) => /* @__PURE__ */ R(Re, {
				size: t.size,
				content: r.content,
				active: n.active,
				disabled: n.disabled,
				iconName: e.Play,
				trailingIcon: e.Right,
				"aria-label": r.content === x.IconOnly ? "Run" : void 0,
				children: "Run"
			}, r.label))] }, `${t.label}-${n.label}`)))
		]
	});
}
function Dt() {
	return /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ z("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ R("span", {
			className: "type-subheading text-basic-primary",
			children: "Rows (menus, lists)"
		}), /* @__PURE__ */ R(Tt, {})]
	}), /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ R("span", {
			className: "type-subheading text-basic-primary",
			children: "Tabs"
		}), /* @__PURE__ */ R(Et, {})]
	})] });
}
// src/app/components/pages/design-preview/ButtonsSection.tsx
var Ot = [
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
], kt = [
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
], At = [
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
], jt = [
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
function U({ variant: t, size: n = c.Medium, content: i = l.IconLeft, disabled: a = !1 }) {
	let o = i === l.Icon;
	return /* @__PURE__ */ z(u, {
		variant: t,
		size: n,
		content: i,
		disabled: a,
		"aria-label": o ? "Add" : void 0,
		children: [
			o || i === l.IconLeft ? /* @__PURE__ */ R(r, { iconName: e.Add }) : null,
			o ? null : "Label",
			i === l.IconRight ? /* @__PURE__ */ R(r, { iconName: e.Right }) : null
		]
	});
}
function Mt() {
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
			Ot.map(({ label: e, variant: t }) => /* @__PURE__ */ z(F, { children: [
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
					content: l.Icon
				}),
				/* @__PURE__ */ R(U, {
					variant: t,
					content: l.Icon,
					disabled: !0
				})
			] }, e))
		]
	});
}
function Nt() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ R("span", {}),
			jt.map(({ label: e }) => /* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e
			}, e)),
			kt.flatMap((e) => At.map((t) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ z("span", {
				className: "type-body-chrome text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), jt.map(({ label: n, content: r }) => /* @__PURE__ */ R(U, {
				variant: e.variant,
				size: t.size,
				content: r
			}, n))] }, `${e.label}-${t.label}`)))
		]
	});
}
function Pt() {
	return /* @__PURE__ */ R(w, {
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
							/* @__PURE__ */ R(u, {
								variant: s.Primary,
								children: "Primary"
							}),
							/* @__PURE__ */ R(u, {
								variant: s.Secondary,
								children: "Secondary"
							}),
							/* @__PURE__ */ R(u, {
								variant: s.Ghost,
								children: "Ghost"
							}),
							/* @__PURE__ */ R(u, {
								variant: s.Tertiary,
								children: "Tertiary"
							}),
							/* @__PURE__ */ R(u, {
								variant: s.SecondaryDestructive,
								children: "Delete"
							}),
							/* @__PURE__ */ R(u, {
								variant: s.GhostDestructive,
								children: "Remove"
							}),
							/* @__PURE__ */ R(u, {
								variant: s.Primary,
								loading: !0,
								children: "Loading"
							}),
							/* @__PURE__ */ R(u, {
								variant: s.Secondary,
								disabled: !0,
								children: "Disabled"
							}),
							/* @__PURE__ */ z(u, {
								variant: s.Secondary,
								content: l.IconLeft,
								children: [/* @__PURE__ */ R(r, { iconName: e.Add }), "New session"]
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
						/* @__PURE__ */ R(Mt, {}),
						/* @__PURE__ */ R(Nt, {})
					]
				}),
				/* @__PURE__ */ R(Dt, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ChoicesSection.tsx
var Ft = [{
	id: "trace",
	name: "session-trace.txt",
	size: "12 KB"
}];
function It(e) {
	return {
		id: `${e.name}-${e.lastModified}`,
		name: e.name,
		size: `${Math.ceil(e.size / 1024)} KB`
	};
}
function Lt() {
	let [e, t] = I(!0), [n, r] = I("first"), [i, a] = I(Ft);
	return /* @__PURE__ */ R(w, {
		title: "Choices, multi-line and file input",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ R(Qe, {
						checked: e,
						onChange: t,
						children: "Skip permission prompts"
					}), /* @__PURE__ */ R(Qe, {
						checked: !1,
						onChange: () => {},
						disabled: !0,
						children: "Disabled"
					})]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ R(pe, {
						name: "preview-choice",
						checked: n === "first",
						onChange: () => r("first"),
						children: "Working tree"
					}), /* @__PURE__ */ R(pe, {
						name: "preview-choice",
						checked: n === "second",
						onChange: () => r("second"),
						children: "Latest snapshot"
					})]
				}),
				/* @__PURE__ */ R(_e, {
					label: "System prompt",
					rows: 3,
					placeholder: "Extra instructions for the agent",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ z("div", {
					className: "flex w-[320px] flex-col gap-2",
					children: [/* @__PURE__ */ R(rt, {
						accept: ".txt,.md,.pdf",
						hint: "Text, Markdown or PDF.",
						onFilesSelected: (e) => a(e.map(It))
					}), /* @__PURE__ */ R(rt, {
						files: i,
						onRemove: (e) => a(i.filter((t) => t.id !== e))
					})]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/CodeBlockSection.tsx
var Rt = "pub enum AgentEvent {\n    RunStarted { run_id: String },\n    AssistantMessage {\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { run_id: String },\n}";
function zt() {
	return /* @__PURE__ */ R(w, {
		title: "Code block and chat loader",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ R(ie, {
				code: Rt,
				language: "rust",
				title: "events.rs",
				lineNumbers: !0,
				expandable: !0,
				maxHeight: "220px"
			}), /* @__PURE__ */ R(ye, {})]
		})
	});
}
// src/app/components/pages/design-preview/DatesSection.tsx
function Bt() {
	let [e, t] = I(null), [n, r] = I({
		from: null,
		to: null
	});
	return /* @__PURE__ */ R(w, {
		title: "Dates",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ R(fe, {
					label: "Created after",
					value: e,
					onChange: t,
					className: "w-[240px]"
				}),
				/* @__PURE__ */ R(fe, {
					label: "Window",
					range: n,
					onRangeChange: r,
					hintText: "Two clicks pick the ends.",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ R(ct, {
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
		size: P.Large,
		badge: Ke.Large,
		title: "Large"
	},
	{
		size: P.Medium,
		badge: Ke.Medium,
		title: "Medium"
	},
	{
		size: P.Small,
		badge: Ke.Small,
		title: "Small"
	}
], Vt = "src/app/components/index.tsx", Ht = "src/app/components/calendar/RecurringEventsTimeZonePicker.tsx", Ut = [
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
], Wt = [
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
], Gt = [
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
		path: Ht,
		additions: 1204,
		deletions: 377
	}
], Kt = [
	{
		title: "Default",
		status: null
	},
	{
		title: "Changed",
		status: A.Changed
	},
	{
		title: "Added",
		status: A.Added
	},
	{
		title: "Deleted",
		status: A.Deleted
	},
	{
		title: "Changed name",
		status: A.ChangedName
	},
	{
		title: "Copied",
		status: A.Copied
	},
	{
		title: "Changed type",
		status: A.ChangedType
	},
	{
		title: "Conflict",
		status: A.Conflict
	},
	{
		title: "Not tracked",
		status: A.NotTracked
	},
	{
		title: "Ignored",
		status: A.Ignored
	}
], qt = [
	{
		title: "File",
		variant: N.File
	},
	{
		title: "File, active",
		variant: N.File,
		active: !0
	},
	{
		title: "File, disabled",
		variant: N.File,
		disabled: !0
	},
	{
		title: "Folder",
		variant: N.Folder
	},
	{
		title: "Folder, open",
		variant: N.Folder,
		active: !0
	}
], Jt = "src/app/lib/parser.ts", G = (e, t, n, r, i = !0) => ({
	kind: e,
	old_lineno: t,
	new_lineno: n,
	content: r,
	has_trailing_newline: i
}), Yt = {
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
function Xt() {
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
				Ut.map((e) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: e.title
				}), W.map(({ size: t }) => /* @__PURE__ */ R("div", {
					className: K,
					children: /* @__PURE__ */ R($e, {
						path: Vt,
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
function Zt() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "A long name in 200px"
		}), /* @__PURE__ */ R("div", {
			className: "flex flex-wrap items-start gap-4",
			children: W.map(({ size: e }) => /* @__PURE__ */ R("div", {
				className: `w-[200px] ${K}`,
				children: /* @__PURE__ */ R($e, {
					path: Ht,
					size: e,
					additions: 1204,
					deletions: 377,
					onClick: q
				})
			}, e))
		})]
	});
}
function Qt() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code changes badge"
		}), /* @__PURE__ */ z("div", {
			className: "grid w-fit grid-cols-[64px_repeat(3,auto)] items-center gap-x-6 gap-y-2",
			children: [
				/* @__PURE__ */ R("span", {}),
				Wt.map(({ title: e }) => /* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-muted",
					children: e
				}, e)),
				W.map(({ badge: e, title: t }) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-tertiary",
					children: t
				}), Wt.map((t) => /* @__PURE__ */ R(Ue, {
					size: e,
					additions: t.additions,
					deletions: t.deletions
				}, t.title))] }, e))
			]
		})]
	});
}
function $t({ files: e, size: t, caption: n }) {
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
				children: /* @__PURE__ */ R(He, {
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
function en() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [W.map(({ size: e, title: t }) => /* @__PURE__ */ R($t, {
			size: e,
			files: Gt.slice(0, 5),
			caption: `List, 5 files, ${t}`
		}, e)), /* @__PURE__ */ R($t, {
			size: P.Small,
			files: Gt,
			caption: "List, 17 files, Small"
		})]
	});
}
function tn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Git status labels"
		}), /* @__PURE__ */ R("div", {
			className: `flex w-fit gap-3 ${K}`,
			children: Object.values(A).map((e) => /* @__PURE__ */ R(Be, { status: e }, e))
		})]
	});
}
var nn = (e) => e === N.Folder ? "components" : "index.tsx";
function rn() {
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
					qt.map(({ title: e }) => /* @__PURE__ */ R("span", {
						className: "type-meta-strong text-basic-muted",
						children: e
					}, e)),
					Kt.map(({ title: e, status: t }) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
						className: "type-meta-strong text-basic-tertiary",
						children: e
					}), qt.map((e) => /* @__PURE__ */ R("div", {
						className: K,
						children: /* @__PURE__ */ R(at, {
							name: nn(e.variant),
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
				children: qt.filter((e) => !e.disabled).map((e) => /* @__PURE__ */ R("div", {
					className: `w-[280px] ${K}`,
					children: /* @__PURE__ */ R(at, {
						name: nn(e.variant),
						variant: e.variant,
						size: nt.Large,
						status: A.Changed,
						active: e.active,
						onClick: q
					})
				}, e.title))
			})
		]
	});
}
var an = (e, t) => ({
	kind: e.kind === "insert" || e.kind === "delete" ? e.kind : "context",
	number: e.kind === "delete" ? e.old_lineno : e.new_lineno ?? e.old_lineno,
	content: e.content,
	tokens: t,
	trailing: e.has_trailing_newline ? null : /* @__PURE__ */ R("span", {
		className: "italic text-basic-muted",
		children: " No newline at end of file"
	})
});
function on() {
	let [e, t] = I(() => /* @__PURE__ */ new Map());
	return ht(() => {
		let e = !0;
		return re(Jt, [Yt]).then((n) => {
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
				children: /* @__PURE__ */ R(Ne, {
					"aria-label": `Changes to ${Jt}`,
					hunks: Yt.hunks.map((e) => e.lines.map((e) => an(e, t?.get(e))))
				})
			})]
		}, e))
	});
}
function sn() {
	return /* @__PURE__ */ R(w, {
		title: "Files",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ R(Xt, {}),
				/* @__PURE__ */ R(Zt, {}),
				/* @__PURE__ */ R(Qt, {}),
				/* @__PURE__ */ R(en, {}),
				/* @__PURE__ */ R(tn, {}),
				/* @__PURE__ */ R(rn, {}),
				/* @__PURE__ */ R(on, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/InputsSection.tsx
var cn = [
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
function ln({ onOpenModal: t }) {
	let [n, r] = I("sonnet");
	return /* @__PURE__ */ R(w, {
		title: "Inputs",
		children: /* @__PURE__ */ z("div", {
			className: "flex flex-col gap-5 p-4",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-end gap-4",
					children: [
						/* @__PURE__ */ R(j, {
							label: "Working directory",
							inputSize: Ie.Medium,
							placeholder: "/Users/me/project",
							className: "w-full max-w-[320px]"
						}),
						/* @__PURE__ */ R(j, {
							label: "Search",
							inputSize: Ie.Medium,
							leading: xe.Icon,
							leadingIconName: e.Search,
							placeholder: "Filter sessions",
							hintText: "Matches name and cwd",
							className: "w-full max-w-[280px]"
						}),
						/* @__PURE__ */ R(Me, {
							items: cn,
							value: n,
							onValueChange: r,
							placeholder: "Pick a model"
						})
					]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-end gap-4",
					children: [/* @__PURE__ */ R(j, {
						label: "Project name",
						placeholder: "nac",
						hintText: "Large: forms and dialogs. 44px on touch screens.",
						className: "w-full max-w-[320px]"
					}), /* @__PURE__ */ R(j, {
						label: "Base URL",
						defaultValue: "api.example",
						validation: !0,
						validationText: "Enter a full URL, including https://",
						className: "w-full max-w-[320px]"
					})]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-center gap-3",
					children: [/* @__PURE__ */ R(u, {
						variant: s.Secondary,
						onClick: t,
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
var un = "The parser drops nested tables because the lexer resets its indent stack on every blank line. Check where resetIndent is called before changing it: the list renderer relies on the same reset.", dn = "npm run typecheck", fn = JSON.stringify({
	cmd: dn,
	workdir: "/workspace/demo-project",
	yield_time_ms: 1e4
}, null, 2), pn = "> nac-web@0.0.0 typecheck\n> tsc -p packages/nac-client/tsconfig.json --noEmit && tsc -b\n\nChecked src/app/components/inspector/insights/presentation/InsightDetailColumn.tsx without errors.", mn = `${pn}\nChecked 412 files in 6.1 s.\nFound 0 errors.`, hn = "Pause after the staging deploy and wait for my review before touching production.", gn = "resetIndent\\(", _n = JSON.stringify({
	pattern: gn,
	path: "src/app/lib",
	output_mode: "content"
}, null, 2), vn = "src/app/lib/lexer.ts:42\nsrc/app/lib/lexer.ts:118\nsrc/app/lib/parser/table.ts:7", yn = `${vn}\nsrc/app/lib/parser/list.ts:63\nsrc/app/lib/parser/list.ts:91`, bn = [
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
], J = `${bn.join("|").slice(0, 110)}…`, xn = JSON.stringify({
	pattern: bn.join("|"),
	path: "src/app/lib",
	regex: !0
}, null, 2), Sn = "The file changed on disk after it was read, so the edit was not applied. Read src/app/lib/lexer.ts again and repeat the edit against its current content; the old text no longer matches line 42.", Cn = `${Sn.slice(0, 160).trimEnd()}...`, wn = 1200;
function Tn() {
	let [e, t] = I(C.Default);
	return ht(() => {
		if (e !== C.Loading) return;
		let n = window.setTimeout(() => t(C.Expanded), wn);
		return () => window.clearTimeout(n);
	}, [e]), {
		state: e,
		showFull: () => t(C.Loading),
		hide: () => t(C.Default)
	};
}
function Y({ title: e, shortContent: t, fullContent: n }) {
	let r = Tn();
	return /* @__PURE__ */ R(ve, {
		title: e,
		state: r.state,
		shortContent: t,
		fullContent: n,
		onShowFull: r.showFull,
		onHide: r.hide
	});
}
function En() {
	let t = Tn(), n = t.state === C.Expanded;
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Error, the message cut by its preview"
		}), /* @__PURE__ */ R("div", {
			className: "w-[542px] max-w-full bg-elevation-ground",
			children: /* @__PURE__ */ R(pt, {
				id: "preview-cut-error",
				icon: e.Edit,
				title: "Edit lexer.ts",
				state: h.Error,
				errorMessage: n ? Sn : Cn,
				errorAction: /* @__PURE__ */ R(Fe, {
					expanded: n,
					loading: t.state === C.Loading,
					onClick: n ? t.hide : t.showFull
				})
			})
		})]
	});
}
var X = () => {}, Dn = [
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
		state: C.Loading,
		shortContent: J,
		onShowFull: X
	},
	{
		label: "Expanded",
		title: "Input",
		state: C.Expanded,
		shortContent: J,
		fullContent: xn,
		onHide: X
	},
	{
		label: "Expanded, cut by the server",
		title: "Input",
		state: C.Expanded,
		shortContent: J,
		fullContent: xn,
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
function On() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Code displayer"
		}), /* @__PURE__ */ z("div", {
			className: "grid grid-cols-3 items-start gap-4",
			children: [Dn.map(({ label: e, ...t }) => /* @__PURE__ */ z("div", {
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
						fullContent: xn
					})
				})]
			})]
		})]
	});
}
var kn = [
	{
		type: "Reasoning",
		icon: e.Brain,
		title: "Thoughts, 2.3 s",
		loadingTitle: "Thinking",
		copyText: un,
		errorMessage: "The model stopped before it finished reasoning.",
		body: (e) => e === h.Default ? /* @__PURE__ */ R("p", { children: un }) : null
	},
	{
		type: "Run Command (Error keeps the input)",
		icon: e.Terminal,
		title: "Run command",
		loadingTitle: "Running command",
		copyText: dn,
		errorMessage: "Command exited with code 2.",
		body: (e) => {
			if (e === h.Loading) return null;
			let t = /* @__PURE__ */ R(Y, {
				title: "Input",
				shortContent: dn,
				fullContent: fn
			});
			return e === h.Error ? t : /* @__PURE__ */ z(L, { children: [t, /* @__PURE__ */ R(Y, {
				title: "Output",
				shortContent: pn,
				fullContent: mn
			})] });
		}
	},
	{
		type: "Steer Session (Loading and Error keep the link)",
		icon: e.AddChat,
		title: "Steer session",
		loadingTitle: "Steer session",
		copyText: hn,
		errorMessage: "The session is no longer running.",
		body: (e) => e === h.Default ? /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R("p", { children: hn }), /* @__PURE__ */ R(Pe, {
			label: "Calendar rollout",
			href: "#/design"
		})] }) : /* @__PURE__ */ R(Pe, {
			label: "Calendar rollout",
			onClick: () => {}
		})
	},
	{
		type: "Search File",
		icon: e.SearchFile,
		title: "Search files",
		loadingTitle: "Search files",
		copyText: gn,
		errorMessage: "The pattern is not a valid regular expression.",
		body: (e) => {
			if (e === h.Loading) return null;
			let t = /* @__PURE__ */ R(Y, {
				title: "Input",
				shortContent: gn,
				fullContent: _n
			});
			return e === h.Error ? t : /* @__PURE__ */ z(L, { children: [t, /* @__PURE__ */ R(Y, {
				title: "Output",
				shortContent: vn,
				fullContent: yn
			})] });
		}
	}
], An = [
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
function jn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "type-meta-strong text-basic-muted",
			children: "Stacked, the first one active"
		}), /* @__PURE__ */ R("div", {
			className: "flex w-[542px] max-w-full flex-col bg-elevation-ground",
			children: kn.map((e, t) => /* @__PURE__ */ R(pt, {
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
function Mn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ R(On, {}),
			/* @__PURE__ */ R(jn, {}),
			/* @__PURE__ */ R(En, {}),
			/* @__PURE__ */ z("div", {
				className: "grid grid-cols-3 items-start gap-x-4 gap-y-2",
				children: [An.map(({ state: e, title: t }) => /* @__PURE__ */ R("span", {
					className: "type-meta-strong text-basic-muted",
					children: t
				}, e)), kn.flatMap((e) => [!1, !0].map((t) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
					className: "col-span-3 pt-2 type-meta-strong text-basic-tertiary",
					children: t ? `${e.type}, active` : e.type
				}), An.map(({ state: n }) => /* @__PURE__ */ R("div", {
					className: "min-w-0 bg-elevation-ground",
					children: /* @__PURE__ */ R(pt, {
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
var Nn = [
	{
		type: "Thoughts",
		icon: e.Brain,
		label: "Thoughts",
		meta: "13.8 s",
		runningLabel: "Thinking…"
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
], Pn = [
	{
		status: E.Ready,
		title: "Ready"
	},
	{
		status: E.Pending,
		title: "Pending"
	},
	{
		status: E.Running,
		title: "Running"
	},
	{
		status: E.Failed,
		title: "Failed or canceled"
	}
], Fn = ["Read File", "ToolsSegment"], Z = [
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
], In = "flex w-[268px] flex-col gap-1 bg-elevation-ground p-2", Ln = "flex w-[380px] flex-col gap-1 bg-elevation-ground p-2";
function Rn(e, t) {
	return t === E.Running ? e.runningLabel ?? e.label : t === E.Failed ? e.failedLabel ?? e.label : e.label;
}
function zn(e, t) {
	return t === E.Running || t === E.Failed ? void 0 : e.meta;
}
function Bn() {
	let e = [...Nn.map((e) => ({
		sample: e,
		active: !1
	})), ...Nn.filter((e) => Fn.includes(e.type)).map((e) => ({
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
			Pn.map(({ status: e, title: t }) => /* @__PURE__ */ R("span", {
				className: "px-2 type-meta-strong text-basic-muted",
				children: t
			}, e)),
			e.map(({ sample: e, active: t }) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
				className: "truncate type-meta-strong text-basic-tertiary",
				children: t ? `${e.type}, active` : e.type
			}), Pn.map(({ status: n }) => /* @__PURE__ */ R(_, {
				icon: e.icon,
				label: Rn(e, n),
				meta: zn(e, n),
				status: n,
				selected: t || void 0,
				expanded: e.group ? t : void 0
			}, n))] }, `${e.type}-${t}`))
		]
	});
}
function Vn() {
	let [t, n] = I(!0), [r, i] = I("thoughts"), a = r === "group" || Z.some(({ key: e }) => e === r);
	return /* @__PURE__ */ z("div", {
		className: In,
		children: [
			/* @__PURE__ */ R(_, {
				icon: e.Right,
				label: "Total activity: 13.3s",
				meta: String(Z.length),
				expanded: t,
				selected: a,
				onClick: () => {
					n((e) => !e), i("group");
				}
			}),
			t ? /* @__PURE__ */ R(ze, { children: Z.map((e) => /* @__PURE__ */ R(_, {
				icon: e.icon,
				label: e.label,
				meta: e.meta,
				selected: r === e.key,
				onClick: () => i(e.key)
			}, e.key)) }) : null,
			/* @__PURE__ */ R(_, {
				icon: e.Eye,
				label: "Calendar rollout",
				meta: "Read",
				onClick: () => {}
			}),
			/* @__PURE__ */ R(_, {
				icon: e.Right,
				label: "Total activity: 4.1s",
				meta: "5",
				expanded: !1
			}),
			/* @__PURE__ */ R(_, {
				icon: e.Brain,
				label: "Thoughts",
				meta: "2.1 s",
				selected: r === "last",
				onClick: () => i("last")
			})
		]
	});
}
function Hn() {
	return /* @__PURE__ */ z("div", {
		className: In,
		children: [
			/* @__PURE__ */ R(_, {
				icon: e.Chat,
				label: "impl/calendar-sync-recurring-events-and-time-zones",
				meta: "Read"
			}),
			/* @__PURE__ */ R(_, {
				icon: e.Plane,
				label: "Roll the recurring-events fix out to every calendar provider",
				meta: "Spawn"
			}),
			/* @__PURE__ */ R(_, {
				icon: e.Plane,
				label: "Investigate why the nightly export drops recurring events",
				meta: "Spawn",
				status: E.Pending,
				selected: !0
			})
		]
	});
}
function Un() {
	let [t, n] = I(!0), [r, i] = I("review/calendar"), a = Le.Large;
	return /* @__PURE__ */ z("div", {
		className: Ln,
		children: [
			/* @__PURE__ */ R(_, {
				size: a,
				icon: e.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ z(ze, {
				className: "py-2",
				children: [
					/* @__PURE__ */ R(_, {
						size: a,
						icon: e.Chat,
						label: "impl/calendar",
						meta: "Read",
						status: E.Running
					}),
					/* @__PURE__ */ R(_, {
						size: a,
						icon: e.Chat,
						label: "impl/recurring-events",
						meta: "Edit",
						status: E.Failed
					}),
					/* @__PURE__ */ R(_, {
						size: a,
						icon: e.Chat,
						label: "docs/calendar",
						meta: "Write",
						status: E.Pending
					}),
					/* @__PURE__ */ R(_, {
						size: a,
						icon: e.Chat,
						label: "review/calendar",
						meta: "Read",
						selected: r === "review/calendar",
						onClick: () => i("review/calendar")
					})
				]
			}),
			/* @__PURE__ */ R(_, {
				size: a,
				icon: e.Right,
				label: "Worked for 13.3s",
				meta: String(Z.length),
				expanded: t,
				onClick: () => n((e) => !e)
			}),
			t ? /* @__PURE__ */ R(ze, { children: Z.map((e) => /* @__PURE__ */ R(_, {
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
function Wn() {
	return /* @__PURE__ */ R(w, {
		title: "Insights",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ R(Bn, {}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-start gap-6",
					children: [
						/* @__PURE__ */ R(Vn, {}),
						/* @__PURE__ */ R(Hn, {}),
						/* @__PURE__ */ R(Un, {})
					]
				}),
				/* @__PURE__ */ R(Mn, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ModelLoaderSection.tsx
var Gn = [{
	variant: mt.Default,
	label: "Default"
}, {
	variant: mt.Accent,
	label: "Accent"
}], Kn = [
	{
		size: Ae.Small,
		label: "Small 16px"
	},
	{
		size: Ae.Medium,
		label: "Medium 20px"
	},
	{
		size: Ae.Large,
		label: "Large 24px"
	}
], qn = [
	1,
	2,
	3
];
function Jn() {
	return /* @__PURE__ */ R(w, {
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
				qn.map((e) => /* @__PURE__ */ z("span", {
					className: "type-meta-strong text-basic-muted",
					children: ["Frame ", e]
				}, e)),
				Gn.flatMap(({ variant: e, label: t }) => Kn.map(({ size: n, label: r }) => /* @__PURE__ */ z(F, { children: [
					/* @__PURE__ */ z("span", {
						className: "type-body-chrome text-basic-secondary",
						children: [
							t,
							" · ",
							r
						]
					}),
					/* @__PURE__ */ R(Ce, {
						size: n,
						variant: e
					}),
					qn.map((t) => /* @__PURE__ */ R(Ce, {
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
function Yn() {
	return /* @__PURE__ */ R(w, {
		title: "Notices",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ z("div", {
				className: "flex flex-wrap gap-3",
				children: [
					/* @__PURE__ */ R(Ee, {
						variant: he.Info,
						title: "Read-only snapshot",
						className: "w-full max-w-[280px]",
						children: "Pick the working tree to edit files again."
					}),
					/* @__PURE__ */ R(Ee, {
						variant: he.Error,
						title: "Run failed",
						className: "w-full max-w-[280px]",
						children: "The provider rejected the request."
					}),
					/* @__PURE__ */ R(Ee, {
						variant: he.Success,
						title: "Branch switched",
						className: "w-full max-w-[280px]"
					})
				]
			}), /* @__PURE__ */ z("div", {
				className: "flex w-full max-w-[398px] flex-col gap-2",
				children: [
					/* @__PURE__ */ R(y, {
						variant: b.Danger,
						title: "Needs your answer",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ R(y, {
						variant: b.Error,
						title: "Provider rejected the request",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ R(y, {
						variant: b.Success,
						title: "Branch merged",
						action: {
							label: "Open",
							onClick: () => {}
						},
						children: "One line that says what happened and what to do next."
					}),
					/* @__PURE__ */ R(y, {
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
function Xn() {
	let [e, t] = I(4), [n, r] = I(.7), [i, a] = I(["local"]), [o, s] = I(1);
	return /* @__PURE__ */ R(w, {
		title: "Numeric inputs, tags and pagination",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-center gap-8",
					children: [/* @__PURE__ */ R(we, {
						value: e,
						onChange: t,
						min: 1,
						max: 16,
						"aria-label": "Parallel tasks"
					}), /* @__PURE__ */ z("div", {
						className: "flex items-center gap-4 w-[320px]",
						children: [/* @__PURE__ */ R(me, {
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
				/* @__PURE__ */ R(dt, {
					tags: [
						"local",
						"docker",
						"remote",
						"sandbox"
					],
					selected: i,
					onChange: a
				}),
				/* @__PURE__ */ R(Ye, {
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
var Zn = [
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
], Qn = [
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
function $n() {
	let [e, t] = I([]), n = gt(0), r = gt(/* @__PURE__ */ new Set());
	ht(() => {
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
			let e = Qn[n.current % Qn.length], r = n.current++;
			t((t) => [...t, {
				id: r,
				...e,
				dismissing: !1
			}]), i(() => a(r), 3e3);
		},
		dismiss: a
	};
}
function er() {
	let [a, o] = I(!1), [te, d] = I(!1), [re, ie] = I(!1), { toasts: f, show: oe, dismiss: p } = $n();
	return /* @__PURE__ */ z(w, {
		title: "Overlays",
		children: [
			/* @__PURE__ */ z(V, {
				label: "Popover",
				hint: "Overlay surface, 14px corner, 32px rows. A sheet on phones.",
				children: [
					/* @__PURE__ */ R(ee, {
						open: a,
						onClose: () => o(!1),
						placement: t.BottomRight,
						size: se.Small,
						sticky: !0,
						content: Zn.map((e) => /* @__PURE__ */ z(Oe, {
							size: m.Medium,
							onClick: () => o(!1),
							children: [/* @__PURE__ */ R(r, { iconName: e.icon }), /* @__PURE__ */ R("span", {
								className: "min-w-0 flex-1 truncate text-left",
								children: e.label
							})]
						}, e.label)),
						children: /* @__PURE__ */ z(u, {
							variant: s.Secondary,
							content: l.IconRight,
							"aria-expanded": a,
							onClick: () => o((e) => !e),
							children: ["Open popover", /* @__PURE__ */ R(r, { iconName: e.Down })]
						})
					}),
					/* @__PURE__ */ R(ne, { value: "nac" }),
					/* @__PURE__ */ R(n, { keys: ["cmd", "k"] })
				]
			}),
			/* @__PURE__ */ z(V, {
				label: "Tooltip",
				hint: "An inverse ink chip, 12px, with its shortcut.",
				children: [/* @__PURE__ */ R(ce, {
					title: "New session",
					keyboardShortcuts: ["cmd", "n"],
					position: t.BottomCenter,
					children: /* @__PURE__ */ R(u, {
						variant: s.Ghost,
						content: l.Icon,
						"aria-label": "New session",
						children: /* @__PURE__ */ R(r, { iconName: e.Add })
					})
				}), /* @__PURE__ */ R(ce, {
					title: "Pin session",
					description: "Keeps it at the top of its project.",
					position: t.BottomCenter,
					sticky: !0,
					showTooltipOnMobile: !0,
					children: /* @__PURE__ */ R(u, {
						variant: s.Ghost,
						content: l.Icon,
						"aria-label": "Pin",
						children: /* @__PURE__ */ R(r, { iconName: e.Pin })
					})
				})]
			}),
			/* @__PURE__ */ R(V, {
				label: "Toast",
				hint: "A small pill at the bottom centre; errors read in red.",
				children: /* @__PURE__ */ R(u, {
					variant: s.Secondary,
					onClick: oe,
					children: "Show a toast"
				})
			}),
			/* @__PURE__ */ z(V, {
				label: "Drawer and sheet",
				hint: "Right drawer on desktop, bottom sheet on phones.",
				children: [/* @__PURE__ */ R(u, {
					variant: s.Secondary,
					onClick: () => d(!0),
					children: "Open drawer"
				}), /* @__PURE__ */ R(u, {
					variant: s.Secondary,
					onClick: () => ie(!0),
					children: "Open bottom sheet"
				})]
			}),
			/* @__PURE__ */ R(je, {
				open: te,
				onClose: () => d(!1),
				title: "Changes",
				headerActions: /* @__PURE__ */ R(u, {
					variant: s.Ghost,
					size: c.Small,
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
			/* @__PURE__ */ R(i, {
				open: re,
				onClose: () => ie(!1),
				children: /* @__PURE__ */ R("div", {
					className: "flex flex-col px-2",
					children: Zn.map((e) => /* @__PURE__ */ z(Oe, {
						size: m.Large,
						onClick: () => ie(!1),
						children: [/* @__PURE__ */ R(r, { iconName: e.icon }), /* @__PURE__ */ R("span", {
							className: "min-w-0 flex-1 truncate text-left",
							children: e.label
						})]
					}, e.label))
				})
			}),
			f.length > 0 ? /* @__PURE__ */ R("div", {
				className: "pointer-events-none fixed inset-x-0 bottom-[calc(20px+env(safe-area-inset-bottom))] z-[1100] mx-auto flex w-[min(480px,calc(100%-2rem))] flex-col items-center gap-2",
				children: f.map((e) => /* @__PURE__ */ R(ae, {
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
var tr = [
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
function nr({ swatch: e }) {
	return /* @__PURE__ */ z("div", {
		className: "flex min-w-0 flex-col gap-1",
		children: [
			/* @__PURE__ */ R("span", {
				"aria-hidden": !0,
				className: f("h-10 w-full rounded-md", e.line ? "border-2" : "shadow-[inset_0_0_0_1px_var(--f-line)]"),
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
function rr({ mode: e }) {
	return /* @__PURE__ */ z("div", {
		className: f(e, "flex min-w-0 flex-1 flex-col gap-5 rounded-card border border-[var(--f-line)] bg-[var(--f-ground)] p-4 text-[var(--f-ink)]"),
		children: [/* @__PURE__ */ z("div", {
			className: "flex items-baseline justify-between gap-2",
			children: [/* @__PURE__ */ R("span", {
				className: "type-strong",
				children: e === "light" ? "Light" : "Dark"
			}), /* @__PURE__ */ R("span", {
				className: "type-meta text-[var(--f-ink-3)]",
				children: e === "light" ? "Ink on warm paper" : "Designed, not inverted"
			})]
		}), tr.map((e) => /* @__PURE__ */ z("div", {
			className: "flex flex-col gap-2",
			children: [/* @__PURE__ */ R("span", {
				className: "type-meta-strong text-[var(--f-ink-3)]",
				children: e.label
			}), /* @__PURE__ */ R("div", {
				className: "grid grid-cols-[repeat(auto-fill,minmax(68px,1fr))] gap-x-2.5 gap-y-3",
				children: e.swatches.map((e) => /* @__PURE__ */ R(nr, { swatch: e }, e.token))
			})]
		}, e.label))]
	});
}
function ir() {
	return /* @__PURE__ */ R(w, {
		title: "Palette",
		children: /* @__PURE__ */ z("div", {
			className: "flex flex-col gap-4 p-4",
			children: [/* @__PURE__ */ R("ul", {
				className: "type-body-chrome flex flex-col gap-1 text-basic-secondary",
				children: tr.map((e) => /* @__PURE__ */ z("li", { children: [
					/* @__PURE__ */ z("span", {
						className: "text-basic-primary",
						children: [e.label, "."]
					}),
					" ",
					e.note
				] }, e.label))
			}), /* @__PURE__ */ z("div", {
				className: "flex flex-col gap-4 lg:flex-row",
				children: [/* @__PURE__ */ R(rr, { mode: "light" }), /* @__PURE__ */ R(rr, { mode: "dark" })]
			})]
		})
	});
}
// src/app/components/pages/design-preview/QualificationSection.tsx
function ar() {
	return /* @__PURE__ */ R(w, {
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
var or = "The build spends most of its time preparing images. I’ll check the cache key before changing the build steps.\n\nA stable key should include the lockfile and image directory so unchanged inputs can reuse the cache.";
function sr() {
	let [e, t] = I(!0);
	return /* @__PURE__ */ R(w, {
		title: "Conversation: reasoning and answer",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex min-w-0 flex-col gap-4",
			children: [
				/* @__PURE__ */ R("p", {
					className: "type-body-chrome text-basic-secondary",
					children: "Reasoning: 14px / 22px, secondary text, 12px paragraphs, 16px inset, 1px tertiary rule, no filled surface. Header and copy targets: 44px. Answer: existing 14px / 24px primary prose. Live opens; settled starts closed. A reader’s toggle, focus or selection wins on settlement. Activity remains a link to Insights; this is its reasoning detail, without a second heading."
				}),
				/* @__PURE__ */ R(u, {
					variant: s.Secondary,
					onClick: () => t(!e),
					children: e ? "Settle reasoning" : "Resume reasoning"
				}),
				/* @__PURE__ */ R(tt, {
					segment: {
						kind: "reasoning",
						key: "preview",
						text: or,
						streaming: e,
						durationMs: e ? null : 2300
					},
					active: !1
				}),
				/* @__PURE__ */ R(ot, { children: "Use a stable image cache key to avoid rebuilding unchanged images." })
			]
		})
	});
}
// src/app/components/pages/design-preview/samples.ts
var Q = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
];
// src/app/components/pages/design-preview/SessionAvatarsSection.tsx
function cr() {
	return /* @__PURE__ */ R(w, {
		title: "Session avatars",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [Q.map((e) => /* @__PURE__ */ z("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ R(le, {
					id: e,
					size: 40
				}), /* @__PURE__ */ R("span", {
					className: "code code-small text-basic-muted",
					children: e
				})]
			}, e)), /* @__PURE__ */ z("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ R(Te, {}), /* @__PURE__ */ R("span", {
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
	let t = /* @__PURE__ */ R(it, {
		title: "Chat session 1",
		isMobile: e,
		onPin: dr,
		onRename: dr,
		onDelete: dr
	});
	return /* @__PURE__ */ z("div", {
		className: f("grid w-fit items-center gap-x-4 gap-y-2", e ? "grid-cols-[120px_repeat(4,240px)]" : "grid-cols-[120px_repeat(4,200px)]"),
		children: [
			/* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e ? "Mobile" : "Desktop"
			}),
			lr.map((e) => /* @__PURE__ */ R("span", {
				className: "type-meta-strong text-basic-muted",
				children: e.label
			}, e.label)),
			ur.map((n) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
				className: "type-body-chrome text-basic-secondary",
				children: n.label
			}), lr.map((r) => /* @__PURE__ */ R(ge, {
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
	return /* @__PURE__ */ R(w, {
		title: "Project navigation",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex items-start gap-2",
					children: [
						/* @__PURE__ */ R(ue, {
							title: "Rewrite the store layer",
							behavior: "direct",
							active: !0
						}),
						/* @__PURE__ */ R(ue, {
							title: "Investigating",
							behavior: "direct",
							running: !0
						}),
						/* @__PURE__ */ R(ue, {
							title: "Fork: Fix the parser",
							forkedFromTitle: "Fix the parser"
						}),
						/* @__PURE__ */ R(ue, {
							title: "Fork running",
							forkedFromTitle: "Fix the parser",
							running: !0
						})
					]
				}),
				/* @__PURE__ */ R(fr, { isMobile: !1 }),
				/* @__PURE__ */ R(fr, { isMobile: !0 }),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2 max-w-[320px]",
					children: [/* @__PURE__ */ R(Ge, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title"
					}), /* @__PURE__ */ R(Ge, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title",
						deleted: !0
					})]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-1 max-w-[320px]",
					children: [
						/* @__PURE__ */ R(De, {
							entityId: Q[3],
							name: "arcee-ai/nac",
							trailing: "4",
							active: !0
						}),
						/* @__PURE__ */ R(De, {
							entityId: Q[4],
							name: "arcee-ai/telos",
							trailing: "1",
							running: !0
						}),
						/* @__PURE__ */ R(De, {
							entityId: Q[5],
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
	let [e, t] = I(!1);
	return /* @__PURE__ */ z(w, {
		title: "Shape, elevation and motion",
		children: [
			/* @__PURE__ */ R(V, {
				label: "Radius",
				hint: "One scale. Controls are pills; boxes step up.",
				children: /* @__PURE__ */ R("div", {
					className: "grid w-full grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-4 gap-y-5",
					children: mr.map((e) => /* @__PURE__ */ z("div", {
						className: "flex min-w-0 flex-col gap-1.5",
						children: [
							/* @__PURE__ */ R("span", {
								"aria-hidden": !0,
								className: f("h-12 w-full border border-secondary bg-elevation-sublevel-variant-A", hr[e.name])
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
					children: gr.map((e) => /* @__PURE__ */ z("div", {
						className: f("flex h-20 w-[132px] flex-col justify-end rounded-card p-3", e.className),
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
							children: _r.map((e) => /* @__PURE__ */ z("div", {
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
						/* @__PURE__ */ R("div", { children: /* @__PURE__ */ R(u, {
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
var yr = ft([
	"done",
	"working",
	"needs-answer",
	"idle"
]);
function br() {
	return /* @__PURE__ */ z(w, {
		title: "Status",
		children: [
			/* @__PURE__ */ R(V, {
				label: "Ladder",
				hint: "Most urgent first; a row shows only its top rung.",
				children: /* @__PURE__ */ R("ol", {
					className: "flex w-full flex-col gap-2",
					children: st.map((e, t) => /* @__PURE__ */ z("li", {
						className: "flex items-center gap-3",
						children: [
							/* @__PURE__ */ R("span", {
								className: "type-meta tabular w-4 text-right text-basic-muted",
								children: t + 1
							}),
							/* @__PURE__ */ R(k, {
								status: e,
								size: "md",
								labelled: !0
							}),
							Ve(e) ? /* @__PURE__ */ R("span", {
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
					/* @__PURE__ */ R(k, {
						status: yr,
						size: "md",
						labelled: !0
					}),
					/* @__PURE__ */ z("code", {
						className: "code-small text-basic-muted",
						children: ["sessionStatus(…) = ", ut({
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
						/* @__PURE__ */ R(k, { status: "working" }),
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
					/* @__PURE__ */ R(o, {
						size: a.Small,
						"aria-label": "Loading"
					}),
					/* @__PURE__ */ R(ke, { size: a.Medium }),
					/* @__PURE__ */ R(Xe, {
						rows: 3,
						className: "w-[200px]"
					}),
					/* @__PURE__ */ R("div", {
						className: "w-[200px] overflow-hidden rounded-pill bg-elevation-sublevel-variant-A",
						children: /* @__PURE__ */ R(Se, { active: !0 })
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
			status: S.Ready,
			behavior: "direct",
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
], Sr = [{
	label: "Child session",
	showBehaviorIcon: !1
}], Cr = "Investigate the flaky parser tests in the store layer";
function wr() {
	return /* @__PURE__ */ R(w, {
		title: "Subagent transcript card",
		bodyClassName: "overflow-x-auto",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [/* @__PURE__ */ z("div", {
				className: "grid w-fit grid-cols-[200px_320px] items-center gap-x-4 gap-y-3",
				children: [
					/* @__PURE__ */ R("span", {}),
					Sr.map((e) => /* @__PURE__ */ R("span", {
						className: "type-meta-strong text-basic-muted",
						children: e.label
					}, e.label)),
					xr.map((e) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e.label
					}), Sr.map((t) => /* @__PURE__ */ R(de, {
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
					children: [/* @__PURE__ */ R(de, {
						title: Cr,
						status: S.Ready,
						behavior: "direct",
						showBehaviorIcon: !1,
						...$
					}), /* @__PURE__ */ R(de, {
						title: Cr,
						status: S.Failed,
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
	{ label: "Checking session status…" },
	{ label: "Steering session…" },
	{ label: "Reading session…" },
	{ label: "Waiting for session…" },
	{ label: "Deleting session…" }
], Dr = () => {};
function Or() {
	return /* @__PURE__ */ R(w, {
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
				Tr.map(({ caption: e, label: t, inProgress: n, disabled: r }) => /* @__PURE__ */ z(F, { children: [
					/* @__PURE__ */ R("span", {
						className: "type-body-chrome text-basic-secondary",
						children: e
					}),
					/* @__PURE__ */ R(O, {
						label: t,
						inProgress: n,
						disabled: r,
						onClick: Dr
					}),
					/* @__PURE__ */ R(O, {
						label: t,
						inProgress: n,
						disabled: r,
						selected: !0,
						onClick: Dr
					})
				] }, e)),
				Er.map(({ label: e, leadingIcon: t }, n) => /* @__PURE__ */ z(F, { children: [
					/* @__PURE__ */ R("span", {
						className: "type-body-chrome text-basic-secondary",
						children: n === 0 ? "In progress" : null
					}),
					/* @__PURE__ */ R(O, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						onClick: Dr
					}),
					/* @__PURE__ */ R(O, {
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
	return /* @__PURE__ */ R(w, {
		title: "Typography",
		children: /* @__PURE__ */ z("div", {
			className: "flex flex-col",
			children: [kr.map((e) => /* @__PURE__ */ z("div", {
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
	return /* @__PURE__ */ R("div", {
		role: "radiogroup",
		"aria-label": "Preview theme",
		className: "inline-flex items-center gap-0.5 rounded-pill bg-elevation-sublevel-variant-B p-0.5",
		children: Mr.map((e) => /* @__PURE__ */ R("button", {
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
	return /* @__PURE__ */ R("nav", {
		"aria-label": "Showcase contents",
		className: e,
		children: /* @__PURE__ */ R("ul", {
			className: "flex flex-col gap-0.5",
			children: jr.map((e) => /* @__PURE__ */ R("li", { children: /* @__PURE__ */ R("button", {
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
	return /* @__PURE__ */ z("div", {
		className: "h-full overflow-y-auto bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ z("header", {
			className: "sticky top-0 z-20 flex h-[52px] items-center gap-3 border-b border-muted bg-elevation-ground/90 px-5 backdrop-blur-md",
			children: [
				/* @__PURE__ */ R(be, { height: 16 }),
				/* @__PURE__ */ R("span", {
					className: "type-strong min-w-0 truncate text-basic-tertiary",
					children: "design system"
				}),
				/* @__PURE__ */ R("div", { className: "flex-1" }),
				/* @__PURE__ */ R(Nr, {})
			]
		}), /* @__PURE__ */ z("div", {
			className: "mx-auto flex w-full max-w-[1240px] gap-10 px-4 py-8 md:px-8 md:py-12",
			children: [/* @__PURE__ */ R(Pr, { className: "sticky top-[84px] hidden h-fit w-[184px] shrink-0 xl:block" }), /* @__PURE__ */ z("main", {
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
							/* @__PURE__ */ R(ir, {}),
							/* @__PURE__ */ R(Ar, {}),
							/* @__PURE__ */ R(vr, {})
						]
					}),
					/* @__PURE__ */ z(B, {
						id: "controls",
						title: "Controls",
						description: "Buttons, fields, choices and chips. Hover, press and keyboard focus are live.",
						children: [
							/* @__PURE__ */ R(Pt, {}),
							/* @__PURE__ */ R(Ir, {}),
							/* @__PURE__ */ R(Lt, {}),
							/* @__PURE__ */ R(yt, {}),
							/* @__PURE__ */ R(Xn, {}),
							/* @__PURE__ */ R(Bt, {})
						]
					}),
					/* @__PURE__ */ z(B, {
						id: "feedback",
						title: "Status and feedback",
						description: "Needs approval, needs an answer, failed, working, waiting, done, idle — and the notices that explain them.",
						children: [
							/* @__PURE__ */ R(br, {}),
							/* @__PURE__ */ R(Yn, {}),
							/* @__PURE__ */ R(Jn, {})
						]
					}),
					/* @__PURE__ */ R(B, {
						id: "overlays",
						title: "Floating layers",
						description: "Popovers, tooltips, toasts, drawers and sheets share one layer stack: Escape closes the top one and focus returns where it came from.",
						children: /* @__PURE__ */ R(er, {})
					}),
					/* @__PURE__ */ z(B, {
						id: "conversation",
						title: "Conversation",
						description: "A centred 15px column: plain-prose answers, folded reasoning and tools, subagent cards.",
						children: [
							/* @__PURE__ */ R(sr, {}),
							/* @__PURE__ */ R(ar, {}),
							/* @__PURE__ */ R(Or, {}),
							/* @__PURE__ */ R(wr, {}),
							/* @__PURE__ */ R(zt, {})
						]
					}),
					/* @__PURE__ */ z(B, {
						id: "navigation",
						title: "Sessions and navigation",
						description: "Session rows, tabs, avatars and identity in the sidebar and the header.",
						children: [
							/* @__PURE__ */ R(pr, {}),
							/* @__PURE__ */ R(cr, {}),
							/* @__PURE__ */ R(_t, {})
						]
					}),
					/* @__PURE__ */ z(B, {
						id: "workspace",
						title: "Workspace",
						description: "Files, diffs and insights inside the drawers.",
						children: [/* @__PURE__ */ R(sn, {}), /* @__PURE__ */ R(Wn, {})]
					})
				]
			})]
		})]
	});
}
function Ir() {
	let [e, t] = I(!1);
	return /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R(ln, { onOpenModal: () => t(!0) }), /* @__PURE__ */ z(te, {
		open: e,
		onClose: () => t(!1),
		title: "Delete session",
		size: oe.Small,
		footer: /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R(u, {
			variant: s.Secondary,
			onClick: () => t(!1),
			children: "Cancel"
		}), /* @__PURE__ */ R(u, {
			variant: s.SecondaryDestructive,
			onClick: () => t(!1),
			children: "Delete"
		})] }),
		children: [/* @__PURE__ */ R("p", { children: "“Fix the flaky parser test” and its transcript, subagents and schedules will be deleted. This cannot be undone." }), /* @__PURE__ */ R("p", {
			className: "type-meta mt-2 text-basic-tertiary",
			children: "The shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom."
		})]
	})] });
}
export { Fr as default };
