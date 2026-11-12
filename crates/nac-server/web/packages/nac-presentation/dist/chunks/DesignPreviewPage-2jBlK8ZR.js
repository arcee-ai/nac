import { B as e, F as t, I as n, L as r, S as i, V as a, _ as o, b as ee, c as te, f as ne, g as s, h as c, m as l, o as re, r as ie, y as ae, z as u } from "./Toast-B7_2n5HZ.js";
import { $ as oe, A as se, At as ce, B as le, Bt as ue, Ct as d, D as de, Dt as f, E as fe, Et as p, F as pe, Ft as me, Gt as m, H as h, Ht as g, I as he, It as _, J as ge, Jt as v, Kt as y, L as _e, Lt as ve, M as ye, O as be, Ot as xe, P as Se, Qt as b, R as x, St as Ce, T as we, Tt as Te, U as Ee, Ut as S, V as De, Vt as C, W as Oe, Wt as w, X as ke, Xt as Ae, Y as je, Yt as T, Zt as Me, _ as Ne, _t as Pe, at as E, b as D, bt as Fe, dt as Ie, et as O, f as Le, ft as k, gt as Re, it as ze, j as Be, jt as Ve, k as He, kt as Ue, l as We, lt as Ge, m as A, mt as Ke, nt as qe, ot as j, pt as Je, qt as Ye, rt as Xe, st as Ze, t as Qe, tt as M, ut as $e, v as et, w as tt, wt as nt, x as N, xt as rt, yt as it, z as P } from "./ReasoningItem-brS52YsB.js";
import { Fragment as F, useEffect as at, useState as I } from "react";
import { Fragment as L, jsx as R, jsxs as z } from "react/jsx-runtime";
// src/app/components/pages/design-preview/AvatarsSection.tsx
function ot() {
	let [e, t] = I("Port the ArceeFM atoms");
	return /* @__PURE__ */ R(C, {
		title: "Avatars and editable header",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ z("div", {
				className: "flex flex-wrap items-center gap-4",
				children: [
					/* @__PURE__ */ R(w, {
						name: "Aleksy",
						size: m.Small
					}),
					/* @__PURE__ */ R(w, { name: "NAC Orchestrator" }),
					/* @__PURE__ */ R(w, {
						name: "Opus",
						size: m.Large
					}),
					/* @__PURE__ */ R(w, {
						name: "🛠",
						glyph: !0,
						size: m.Large
					}),
					/* @__PURE__ */ R(w, {
						name: "Anthropic",
						size: m.XLarge,
						color: "var(--color-bg-info-primary)"
					})
				]
			}), /* @__PURE__ */ R(Re, {
				value: e,
				onCommit: t,
				size: Pe.Medium,
				className: "max-w-[360px]"
			})]
		})
	});
}
// src/app/components/pages/design-preview/BadgesSection.tsx
function st() {
	let [i, a] = I(!0);
	return /* @__PURE__ */ R(C, {
		title: "Badges, loader, switch, tooltip",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [
				/* @__PURE__ */ R(g, {
					text: "Running",
					color: S.Green
				}),
				/* @__PURE__ */ R(g, {
					text: "Queued",
					color: S.Blue
				}),
				/* @__PURE__ */ R(g, {
					text: "Failed",
					color: S.Red
				}),
				/* @__PURE__ */ R(g, {
					text: "Idle",
					color: S.Gray
				}),
				/* @__PURE__ */ R(n, { size: r.Small }),
				/* @__PURE__ */ R(et, {
					checked: i,
					onChange: a
				}),
				/* @__PURE__ */ R(ae, {
					title: "Pin session",
					description: "Keeps the card at the top of the board.",
					position: t.BottomCenter,
					sticky: !0,
					showTooltipOnMobile: !0,
					children: /* @__PURE__ */ R(u, { iconName: e.Pin })
				}),
				/* @__PURE__ */ R(u, { iconName: e.Unpin })
			]
		})
	});
}
// src/app/components/pages/design-preview/TabsPreview.tsx
var B = [
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
], ct = [
	{
		label: "Regular",
		variant: b.Regular
	},
	{
		label: "Accent",
		variant: b.Accent
	},
	{
		label: "Destructive",
		variant: b.Destructive
	}
], lt = [
	{
		label: "small",
		size: Me.Small
	},
	{
		label: "medium",
		size: Me.Medium
	},
	{
		label: "large",
		size: Me.Large
	}
], ut = [
	{
		label: "Small",
		size: M.Small
	},
	{
		label: "Medium",
		size: M.Medium
	},
	{
		label: "Large",
		size: M.Large
	}
], dt = [
	{
		label: "Icon left",
		content: O.IconLeft
	},
	{
		label: "Icon right",
		content: O.IconRight
	},
	{
		label: "Icon",
		content: O.IconOnly
	},
	{
		label: "Text",
		content: O.TextOnly
	},
	{
		label: "Full",
		content: O.Full
	}
];
function ft() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[160px_repeat(4,200px)] items-center gap-x-4 gap-y-2",
		children: [
			/* @__PURE__ */ R("span", {}),
			B.map((e) => /* @__PURE__ */ R("span", {
				className: "label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			ct.flatMap((t) => lt.map((n) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ z("span", {
				className: "label-small text-basic-secondary",
				children: [
					t.label,
					", ",
					n.label
				]
			}), B.map((r) => /* @__PURE__ */ z(Ae, {
				variant: t.variant,
				size: n.size,
				active: r.active,
				disabled: r.disabled,
				children: [
					/* @__PURE__ */ R(u, { iconName: e.Search }),
					/* @__PURE__ */ R("span", {
						className: "flex-1 min-w-0 truncate text-left",
						children: "New chat"
					}),
					/* @__PURE__ */ R(u, { iconName: e.Edit })
				]
			}, r.label))] }, `${t.label}-${n.label}`)))
		]
	});
}
function pt() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[160px_repeat(5,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ R("span", {}),
			dt.map((e) => /* @__PURE__ */ R("span", {
				className: "label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			ut.flatMap((t) => B.map((n) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ z("span", {
				className: "label-small text-basic-secondary",
				children: [
					t.label,
					", ",
					n.label.toLowerCase()
				]
			}), dt.map((r) => /* @__PURE__ */ R(oe, {
				size: t.size,
				content: r.content,
				active: n.active,
				disabled: n.disabled,
				iconName: e.Play,
				trailingIcon: e.Right,
				"aria-label": r.content === O.IconOnly ? "Run" : void 0,
				children: "Run"
			}, r.label))] }, `${t.label}-${n.label}`)))
		]
	});
}
function mt() {
	return /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ z("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ R("span", {
			className: "label-medium text-basic-primary",
			children: "Tab button"
		}), /* @__PURE__ */ R(ft, {})]
	}), /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-3",
		children: [/* @__PURE__ */ R("span", {
			className: "label-medium text-basic-primary",
			children: "Horizontal tab item"
		}), /* @__PURE__ */ R(pt, {})]
	})] });
}
// src/app/components/pages/design-preview/ButtonsSection.tsx
var ht = [
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
], gt = [
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
], _t = [
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
], vt = [
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
function V({ variant: t, size: n = s.Medium, content: r = c.IconLeft, disabled: i = !1 }) {
	let a = r === c.Icon;
	return /* @__PURE__ */ z(l, {
		variant: t,
		size: n,
		content: r,
		disabled: i,
		"aria-label": a ? "Add" : void 0,
		children: [
			a || r === c.IconLeft ? /* @__PURE__ */ R(u, { iconName: e.Add }) : null,
			a ? null : "Label",
			r === c.IconRight ? /* @__PURE__ */ R(u, { iconName: e.Right }) : null
		]
	});
}
function yt() {
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
				className: "label-micro text-basic-muted",
				children: e
			}, e)),
			ht.map(({ label: e, variant: t }) => /* @__PURE__ */ z(F, { children: [
				/* @__PURE__ */ R("span", {
					className: "label-small text-basic-secondary",
					children: e
				}),
				/* @__PURE__ */ R(V, { variant: t }),
				/* @__PURE__ */ R(V, {
					variant: t,
					disabled: !0
				}),
				/* @__PURE__ */ R(V, {
					variant: t,
					content: c.Icon
				}),
				/* @__PURE__ */ R(V, {
					variant: t,
					content: c.Icon,
					disabled: !0
				})
			] }, e))
		]
	});
}
function bt() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[200px_repeat(4,max-content)] items-center justify-items-start gap-x-6 gap-y-3",
		children: [
			/* @__PURE__ */ R("span", {}),
			vt.map(({ label: e }) => /* @__PURE__ */ R("span", {
				className: "label-micro text-basic-muted",
				children: e
			}, e)),
			gt.flatMap((e) => _t.map((t) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ z("span", {
				className: "label-small text-basic-secondary",
				children: [
					e.label,
					", ",
					t.label
				]
			}), vt.map(({ label: n, content: r }) => /* @__PURE__ */ R(V, {
				variant: e.variant,
				size: t.size,
				content: r
			}, n))] }, `${e.label}-${t.label}`)))
		]
	});
}
function xt() {
	return /* @__PURE__ */ R(C, {
		title: "Buttons",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-8 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-center gap-3",
					children: [
						/* @__PURE__ */ R(l, {
							variant: o.Primary,
							children: "Primary"
						}),
						/* @__PURE__ */ R(l, {
							variant: o.Secondary,
							children: "Secondary"
						}),
						/* @__PURE__ */ R(l, {
							variant: o.Tertiary,
							children: "Tertiary"
						}),
						/* @__PURE__ */ R(l, {
							variant: o.Ghost,
							children: "Ghost"
						}),
						/* @__PURE__ */ R(l, {
							variant: o.GhostDestructive,
							children: "Destructive"
						}),
						/* @__PURE__ */ R(l, {
							variant: o.Primary,
							loading: !0,
							children: "Loading"
						}),
						/* @__PURE__ */ R(l, {
							variant: o.Secondary,
							disabled: !0,
							children: "Disabled"
						}),
						/* @__PURE__ */ z(l, {
							variant: o.Secondary,
							content: c.IconLeft,
							children: [/* @__PURE__ */ R(u, { iconName: e.Add }), "With icon"]
						})
					]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-3",
					children: [
						/* @__PURE__ */ R("span", {
							className: "label-medium text-basic-primary",
							children: "Button"
						}),
						/* @__PURE__ */ R(yt, {}),
						/* @__PURE__ */ R(bt, {})
					]
				}),
				/* @__PURE__ */ R(mt, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ChoicesSection.tsx
var St = [{
	id: "trace",
	name: "session-trace.txt",
	size: "12 KB"
}];
function Ct(e) {
	return {
		id: `${e.name}-${e.lastModified}`,
		name: e.name,
		size: `${Math.ceil(e.size / 1024)} KB`
	};
}
function wt() {
	let [e, t] = I(!0), [n, r] = I("first"), [i, a] = I(St);
	return /* @__PURE__ */ R(C, {
		title: "Choices, multi-line and file input",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ R(Ce, {
						checked: e,
						onChange: t,
						children: "Skip permission prompts"
					}), /* @__PURE__ */ R(Ce, {
						checked: !1,
						onChange: () => {},
						disabled: !0,
						children: "Disabled"
					})]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2",
					children: [/* @__PURE__ */ R(de, {
						name: "preview-choice",
						checked: n === "first",
						onChange: () => r("first"),
						children: "Working tree"
					}), /* @__PURE__ */ R(de, {
						name: "preview-choice",
						checked: n === "second",
						onChange: () => r("second"),
						children: "Latest snapshot"
					})]
				}),
				/* @__PURE__ */ R(Oe, {
					label: "System prompt",
					rows: 3,
					placeholder: "Extra instructions for the agent",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ z("div", {
					className: "flex w-[320px] flex-col gap-2",
					children: [/* @__PURE__ */ R(Ge, {
						accept: ".txt,.md,.pdf",
						hint: "Text, Markdown or PDF.",
						onFilesSelected: (e) => a(e.map(Ct))
					}), /* @__PURE__ */ R(Ge, {
						files: i,
						onRemove: (e) => a(i.filter((t) => t.id !== e))
					})]
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/CodeBlockSection.tsx
var Tt = "pub enum AgentEvent {\n    RunStarted { thread_name: Option<String> },\n    AssistantMessage {\n        thread_name: Option<String>,\n        content: String,\n        usage: Option<TokenUsage>,\n    },\n    RunFinished { thread_name: Option<String> },\n}";
function Et() {
	return /* @__PURE__ */ R(C, {
		title: "Code block and chat loader",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [/* @__PURE__ */ R(ie, {
				code: Tt,
				language: "rust",
				title: "events.rs",
				lineNumbers: !0,
				expandable: !0,
				maxHeight: "220px"
			}), /* @__PURE__ */ R(ue, {})]
		})
	});
}
// src/app/components/pages/design-preview/DatesSection.tsx
function Dt() {
	let [e, t] = I(null), [n, r] = I({
		from: null,
		to: null
	});
	return /* @__PURE__ */ R(C, {
		title: "Dates",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-start gap-6",
			children: [
				/* @__PURE__ */ R(it, {
					label: "Created after",
					value: e,
					onChange: t,
					className: "w-[240px]"
				}),
				/* @__PURE__ */ R(it, {
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
var H = [
	{
		size: k.Large,
		badge: Ke.Large,
		title: "Large"
	},
	{
		size: k.Medium,
		badge: Ke.Medium,
		title: "Medium"
	},
	{
		size: k.Small,
		badge: Ke.Small,
		title: "Small"
	}
], Ot = "src/app/components/index.tsx", kt = "src/app/components/calendar/RecurringEventsTimeZonePicker.tsx", At = [
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
], jt = [
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
], Mt = [
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
		path: kt,
		additions: 1204,
		deletions: 377
	}
], Nt = [
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
], U = [
	{
		title: "File",
		variant: E.File
	},
	{
		title: "File, active",
		variant: E.File,
		active: !0
	},
	{
		title: "File, disabled",
		variant: E.File,
		disabled: !0
	},
	{
		title: "Folder",
		variant: E.Folder
	},
	{
		title: "Folder, open",
		variant: E.Folder,
		active: !0
	}
], Pt = "src/app/lib/parser.ts", W = (e, t, n, r, i = !0) => ({
	kind: e,
	old_lineno: t,
	new_lineno: n,
	content: r,
	has_trailing_newline: i
}), Ft = {
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
			W("context", 1, 1, "import { tokenize } from \"./lexer\";"),
			W("delete", 2, null, "import type { Token } from \"./lexer\";"),
			W("insert", null, 2, "import { type Token, TokenKind } from \"./lexer\";"),
			W("context", 3, 3, "")
		]
	}, {
		function_context: null,
		old_start: 24,
		old_lines: 3,
		new_start: 24,
		new_lines: 4,
		lines: [
			W("context", 24, 24, "export function parse(source: string): Token[] {"),
			W("delete", 25, null, "  return tokenize(source);"),
			W("insert", null, 25, "  const tokens = tokenize(source);"),
			W("insert", null, 26, "  return tokens.filter((token) => token.kind !== TokenKind.Whitespace && token.kind !== TokenKind.Comment);"),
			W("context", 26, 27, "}", !1)
		]
	}]
}, G = "bg-elevation-ground p-2", K = () => {};
function It() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "label-micro text-basic-muted",
			children: "File button"
		}), /* @__PURE__ */ z("div", {
			className: "grid w-fit grid-cols-[auto_repeat(3,auto)] items-center gap-x-4 gap-y-2",
			children: [
				/* @__PURE__ */ R("span", {}),
				H.map(({ size: e, title: t }) => /* @__PURE__ */ R("span", {
					className: "label-micro text-basic-muted",
					children: t
				}, e)),
				At.map((e) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
					className: "label-micro text-basic-tertiary",
					children: e.title
				}), H.map(({ size: t }) => /* @__PURE__ */ R("div", {
					className: G,
					children: /* @__PURE__ */ R(Ie, {
						path: Ot,
						size: t,
						active: e.active,
						disabled: e.disabled,
						additions: e.additions,
						deletions: e.deletions,
						onClick: K
					})
				}, t))] }, e.title))
			]
		})]
	});
}
function Lt() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "label-micro text-basic-muted",
			children: "A long name in 200px"
		}), /* @__PURE__ */ R("div", {
			className: "flex flex-wrap items-start gap-4",
			children: H.map(({ size: e }) => /* @__PURE__ */ R("div", {
				className: `w-[200px] ${G}`,
				children: /* @__PURE__ */ R(Ie, {
					path: kt,
					size: e,
					additions: 1204,
					deletions: 377,
					onClick: K
				})
			}, e))
		})]
	});
}
function Rt() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "label-micro text-basic-muted",
			children: "Code changes badge"
		}), /* @__PURE__ */ z("div", {
			className: "grid w-fit grid-cols-[64px_repeat(3,auto)] items-center gap-x-6 gap-y-2",
			children: [
				/* @__PURE__ */ R("span", {}),
				jt.map(({ title: e }) => /* @__PURE__ */ R("span", {
					className: "label-micro text-basic-muted",
					children: e
				}, e)),
				H.map(({ badge: e, title: t }) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
					className: "label-micro text-basic-tertiary",
					children: t
				}), jt.map((t) => /* @__PURE__ */ R(Je, {
					size: e,
					additions: t.additions,
					deletions: t.deletions
				}, t.title))] }, e))
			]
		})]
	});
}
function zt({ files: e, size: t, caption: n }) {
	let [r, i] = I(e[1]?.path ?? null);
	return /* @__PURE__ */ z("div", {
		className: "flex w-[280px] flex-col gap-2",
		children: [
			/* @__PURE__ */ R("span", {
				className: "label-micro text-basic-muted",
				children: n
			}),
			/* @__PURE__ */ R("div", {
				className: G,
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
				className: "label-micro text-basic-tertiary",
				children: ["Open file: ", r ?? "none"]
			})
		]
	});
}
function Bt() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-wrap items-start gap-6",
		children: [H.map(({ size: e, title: t }) => /* @__PURE__ */ R(zt, {
			size: e,
			files: Mt.slice(0, 5),
			caption: `List, 5 files, ${t}`
		}, e)), /* @__PURE__ */ R(zt, {
			size: k.Small,
			files: Mt,
			caption: "List, 17 files, Small"
		})]
	});
}
function Vt() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "label-micro text-basic-muted",
			children: "Git status labels"
		}), /* @__PURE__ */ R("div", {
			className: `flex w-fit gap-3 ${G}`,
			children: Object.values(j).map((e) => /* @__PURE__ */ R(Ze, { status: e }, e))
		})]
	});
}
var Ht = (e) => e === E.Folder ? "components" : "index.tsx";
function Ut() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [
			/* @__PURE__ */ R("span", {
				className: "label-micro text-basic-muted",
				children: "File list tab button, Small"
			}),
			/* @__PURE__ */ z("div", {
				className: "grid w-fit grid-cols-[auto_repeat(5,160px)] items-center gap-x-3 gap-y-1",
				children: [
					/* @__PURE__ */ R("span", {}),
					U.map(({ title: e }) => /* @__PURE__ */ R("span", {
						className: "label-micro text-basic-muted",
						children: e
					}, e)),
					Nt.map(({ title: e, status: t }) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
						className: "label-micro text-basic-tertiary",
						children: e
					}), U.map((e) => /* @__PURE__ */ R("div", {
						className: G,
						children: /* @__PURE__ */ R(Xe, {
							name: Ht(e.variant),
							variant: e.variant,
							status: t,
							active: e.active,
							disabled: e.disabled,
							onClick: K
						})
					}, e.title))] }, e))
				]
			}),
			/* @__PURE__ */ R("span", {
				className: "label-micro text-basic-muted",
				children: "File list tab button, Large"
			}),
			/* @__PURE__ */ R("div", {
				className: "flex flex-wrap items-start gap-4",
				children: U.filter((e) => !e.disabled).map((e) => /* @__PURE__ */ R("div", {
					className: `w-[280px] ${G}`,
					children: /* @__PURE__ */ R(Xe, {
						name: Ht(e.variant),
						variant: e.variant,
						size: ze.Large,
						status: j.Changed,
						active: e.active,
						onClick: K
					})
				}, e.title))
			})
		]
	});
}
var Wt = (e, t) => ({
	kind: e.kind === "insert" || e.kind === "delete" ? e.kind : "context",
	number: e.kind === "delete" ? e.old_lineno : e.new_lineno ?? e.old_lineno,
	content: e.content,
	tokens: t,
	trailing: e.has_trailing_newline ? null : /* @__PURE__ */ R("span", {
		className: "italic text-basic-muted",
		children: " No newline at end of file"
	})
});
function Gt() {
	let [e, t] = I(() => /* @__PURE__ */ new Map());
	return at(() => {
		let e = !0;
		return re(Pt, [Ft]).then((n) => {
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
				className: "label-micro text-basic-muted",
				children: e
			}), /* @__PURE__ */ R("div", {
				className: G,
				children: /* @__PURE__ */ R(rt, {
					"aria-label": `Changes to ${Pt}`,
					hunks: Ft.hunks.map((e) => e.lines.map((e) => Wt(e, t?.get(e))))
				})
			})]
		}, e))
	});
}
function Kt() {
	return /* @__PURE__ */ R(C, {
		title: "Files",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ R(It, {}),
				/* @__PURE__ */ R(Lt, {}),
				/* @__PURE__ */ R(Rt, {}),
				/* @__PURE__ */ R(Bt, {}),
				/* @__PURE__ */ R(Vt, {}),
				/* @__PURE__ */ R(Ut, {}),
				/* @__PURE__ */ R(Gt, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/InputsSection.tsx
var qt = [
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
function Jt({ onOpenModal: t }) {
	let [n, r] = I("sonnet");
	return /* @__PURE__ */ R(C, {
		title: "Inputs",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-end gap-4",
			children: [
				/* @__PURE__ */ R(ge, {
					label: "Working directory",
					inputSize: ke.Medium,
					placeholder: "/Users/me/project",
					className: "w-[320px]"
				}),
				/* @__PURE__ */ R(ge, {
					label: "Search",
					inputSize: ke.Medium,
					leading: je.Icon,
					leadingIconName: e.Search,
					placeholder: "Filter sessions",
					hintText: "Matches name and cwd",
					className: "w-[280px]"
				}),
				/* @__PURE__ */ R(we, {
					items: qt,
					value: n,
					onValueChange: r,
					placeholder: "Pick a model"
				}),
				/* @__PURE__ */ R(l, {
					variant: o.Secondary,
					onClick: t,
					children: "Open modal"
				})
			]
		})
	});
}
// src/app/components/pages/design-preview/InsightItemsPreview.tsx
var Yt = "The parser drops nested tables because the lexer resets its indent stack on every blank line. Check where resetIndent is called before changing it: the list renderer relies on the same reset.", Xt = "npm run typecheck", Zt = JSON.stringify({
	cmd: Xt,
	workdir: "/workspace/demo-project",
	yield_time_ms: 1e4
}, null, 2), Qt = "> nac-web@0.0.0 typecheck\n> tsc -p packages/nac-client/tsconfig.json --noEmit && tsc -b\n\nChecked src/app/components/inspector/insights/presentation/InsightDetailColumn.tsx without errors.", $t = `${Qt}\nChecked 412 files in 6.1 s.\nFound 0 errors.`, en = "Pause after the staging deploy and wait for my review before touching production.", tn = "resetIndent\\(", nn = JSON.stringify({
	pattern: tn,
	path: "src/app/lib",
	output_mode: "content"
}, null, 2), rn = "src/app/lib/lexer.ts:42\nsrc/app/lib/lexer.ts:118\nsrc/app/lib/parser/table.ts:7", an = `${rn}\nsrc/app/lib/parser/list.ts:63\nsrc/app/lib/parser/list.ts:91`, on = [
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
], q = `${on.join("|").slice(0, 110)}…`, sn = JSON.stringify({
	pattern: on.join("|"),
	path: "src/app/lib",
	regex: !0
}, null, 2), cn = "The file changed on disk after it was read, so the edit was not applied. Read src/app/lib/lexer.ts again and repeat the edit against its current content; the old text no longer matches line 42.", ln = `${cn.slice(0, 160).trimEnd()}...`, un = 1200;
function dn() {
	let [e, t] = I(h.Default);
	return at(() => {
		if (e !== h.Loading) return;
		let n = window.setTimeout(() => t(h.Expanded), un);
		return () => window.clearTimeout(n);
	}, [e]), {
		state: e,
		showFull: () => t(h.Loading),
		hide: () => t(h.Default)
	};
}
function J({ title: e, shortContent: t, fullContent: n }) {
	let r = dn();
	return /* @__PURE__ */ R(De, {
		title: e,
		state: r.state,
		shortContent: t,
		fullContent: n,
		onShowFull: r.showFull,
		onHide: r.hide
	});
}
function fn() {
	let t = dn(), n = t.state === h.Expanded;
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "label-micro text-basic-muted",
			children: "Error, the message cut by its preview"
		}), /* @__PURE__ */ R("div", {
			className: "w-[542px] max-w-full bg-elevation-ground",
			children: /* @__PURE__ */ R(x, {
				id: "preview-cut-error",
				icon: e.Edit,
				title: "Edit lexer.ts",
				state: P.Error,
				errorMessage: n ? cn : ln,
				errorAction: /* @__PURE__ */ R(Ee, {
					expanded: n,
					loading: t.state === h.Loading,
					onClick: n ? t.hide : t.showFull
				})
			})
		})]
	});
}
var Y = () => {}, pn = [
	{
		label: "Default, with Show full",
		title: "Input",
		shortContent: q,
		onShowFull: Y
	},
	{
		label: "Default, without Show full",
		title: "Input",
		shortContent: q
	},
	{
		label: "Default, without a preview",
		title: "Input",
		shortContent: "",
		onShowFull: Y
	},
	{
		label: "Default, the load failed (Show full retries)",
		title: "Input",
		shortContent: q,
		onShowFull: Y,
		error: "Could not load the full input."
	},
	{
		label: "Loading",
		title: "Input",
		state: h.Loading,
		shortContent: q,
		onShowFull: Y
	},
	{
		label: "Expanded",
		title: "Input",
		state: h.Expanded,
		shortContent: q,
		fullContent: sn,
		onHide: Y
	},
	{
		label: "Expanded, cut by the server",
		title: "Input",
		state: h.Expanded,
		shortContent: q,
		fullContent: sn,
		onHide: Y,
		note: "The server cut this input at its size limit."
	},
	{
		label: "Without heading",
		title: "Input",
		showHeading: !1,
		shortContent: q,
		onShowFull: Y
	}
];
function mn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "label-micro text-basic-muted",
			children: "Code displayer"
		}), /* @__PURE__ */ z("div", {
			className: "grid grid-cols-3 items-start gap-4",
			children: [pn.map(({ label: e, ...t }) => /* @__PURE__ */ z("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ R("span", {
					className: "label-micro text-basic-tertiary",
					children: e
				}), /* @__PURE__ */ R("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ R(De, { ...t })
				})]
			}, e)), /* @__PURE__ */ z("div", {
				className: "flex min-w-0 flex-col gap-2",
				children: [/* @__PURE__ */ R("span", {
					className: "label-micro text-basic-tertiary",
					children: "Interactive"
				}), /* @__PURE__ */ R("div", {
					className: "bg-elevation-ground p-4",
					children: /* @__PURE__ */ R(J, {
						title: "Input",
						shortContent: q,
						fullContent: sn
					})
				})]
			})]
		})]
	});
}
var hn = [
	{
		type: "Reasoning",
		icon: e.Brain,
		title: "Thoughts, 2.3 s",
		loadingTitle: "Thinking",
		copyText: Yt,
		errorMessage: "The model stopped before it finished reasoning.",
		body: (e) => e === P.Default ? /* @__PURE__ */ R("p", { children: Yt }) : null
	},
	{
		type: "Run Command (Error keeps the input)",
		icon: e.Terminal,
		title: "Run command",
		loadingTitle: "Running command",
		copyText: Xt,
		errorMessage: "Command exited with code 2.",
		body: (e) => {
			if (e === P.Loading) return null;
			let t = /* @__PURE__ */ R(J, {
				title: "Input",
				shortContent: Xt,
				fullContent: Zt
			});
			return e === P.Error ? t : /* @__PURE__ */ z(L, { children: [t, /* @__PURE__ */ R(J, {
				title: "Output",
				shortContent: Qt,
				fullContent: $t
			})] });
		}
	},
	{
		type: "Steer Session (Loading and Error keep the link)",
		icon: e.AddChat,
		title: "Steer session",
		loadingTitle: "Steer session",
		copyText: en,
		errorMessage: "The session is no longer running.",
		body: (e) => e === P.Default ? /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R("p", { children: en }), /* @__PURE__ */ R(le, {
			label: "Calendar rollout",
			href: "#/design"
		})] }) : /* @__PURE__ */ R(le, {
			label: "Calendar rollout",
			onClick: () => {}
		})
	},
	{
		type: "Search File",
		icon: e.SearchFile,
		title: "Search files",
		loadingTitle: "Search files",
		copyText: tn,
		errorMessage: "The pattern is not a valid regular expression.",
		body: (e) => {
			if (e === P.Loading) return null;
			let t = /* @__PURE__ */ R(J, {
				title: "Input",
				shortContent: tn,
				fullContent: nn
			});
			return e === P.Error ? t : /* @__PURE__ */ z(L, { children: [t, /* @__PURE__ */ R(J, {
				title: "Output",
				shortContent: rn,
				fullContent: an
			})] });
		}
	}
], gn = [
	{
		state: P.Default,
		title: "Default"
	},
	{
		state: P.Loading,
		title: "Loading"
	},
	{
		state: P.Error,
		title: "Error"
	}
];
function _n() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-2",
		children: [/* @__PURE__ */ R("span", {
			className: "label-micro text-basic-muted",
			children: "Stacked, the first one active"
		}), /* @__PURE__ */ R("div", {
			className: "flex w-[542px] max-w-full flex-col bg-elevation-ground",
			children: hn.map((e, t) => /* @__PURE__ */ R(x, {
				id: `preview-stacked-${e.icon}`,
				icon: e.icon,
				title: e.title,
				active: t === 0,
				copyText: e.copyText,
				children: e.body(P.Default)
			}, e.type))
		})]
	});
}
function vn() {
	return /* @__PURE__ */ z("div", {
		className: "flex flex-col gap-6",
		children: [
			/* @__PURE__ */ R(mn, {}),
			/* @__PURE__ */ R(_n, {}),
			/* @__PURE__ */ R(fn, {}),
			/* @__PURE__ */ z("div", {
				className: "grid grid-cols-3 items-start gap-x-4 gap-y-2",
				children: [gn.map(({ state: e, title: t }) => /* @__PURE__ */ R("span", {
					className: "label-micro text-basic-muted",
					children: t
				}, e)), hn.flatMap((e) => [!1, !0].map((t) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
					className: "col-span-3 pt-2 label-micro text-basic-tertiary",
					children: t ? `${e.type}, active` : e.type
				}), gn.map(({ state: n }) => /* @__PURE__ */ R("div", {
					className: "min-w-0 bg-elevation-ground",
					children: /* @__PURE__ */ R(x, {
						id: `preview-${e.icon}-${n}-${t}`,
						icon: e.icon,
						title: n === P.Loading ? e.loadingTitle : e.title,
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
var yn = [
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
], bn = [
	{
		status: v.Ready,
		title: "Ready"
	},
	{
		status: v.Pending,
		title: "Pending"
	},
	{
		status: v.Running,
		title: "Running"
	},
	{
		status: v.Failed,
		title: "Failed or canceled"
	}
], xn = [
	"Thread",
	"Read File",
	"ToolsSegment"
], X = [
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
], Sn = [
	"impl/calendar",
	"impl/recurring-events",
	"review/calendar",
	"docs/calendar"
], Z = "flex w-[268px] flex-col gap-1 bg-elevation-ground p-2", Cn = "flex w-[380px] flex-col gap-1 bg-elevation-ground p-2";
function wn(e, t) {
	return t === v.Running ? e.runningLabel ?? e.label : t === v.Failed ? e.failedLabel ?? e.label : e.label;
}
function Tn(e, t) {
	return (t === v.Running || t === v.Failed) && e.type !== "Thread" ? void 0 : e.meta;
}
function En() {
	let e = [...yn.map((e) => ({
		sample: e,
		active: !1
	})), ...yn.filter((e) => xn.includes(e.type)).map((e) => ({
		sample: e,
		active: !0
	}))];
	return /* @__PURE__ */ z("div", {
		className: "grid grid-cols-[136px_repeat(4,minmax(0,1fr))] items-center gap-x-3 gap-y-1",
		children: [
			/* @__PURE__ */ R("span", {
				className: "label-micro text-basic-muted",
				children: "Type"
			}),
			bn.map(({ status: e, title: t }) => /* @__PURE__ */ R("span", {
				className: "px-2 label-micro text-basic-muted",
				children: t
			}, e)),
			e.map(({ sample: e, active: t }) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
				className: "truncate label-micro text-basic-tertiary",
				children: t ? `${e.type}, active` : e.type
			}), bn.map(({ status: n }) => /* @__PURE__ */ R(y, {
				icon: e.icon,
				label: wn(e, n),
				meta: Tn(e, n),
				status: n,
				selected: t || void 0,
				expanded: e.group ? t : void 0
			}, n))] }, `${e.type}-${t}`))
		]
	});
}
function Dn() {
	let [t, n] = I(!0), [r, i] = I("thoughts"), a = r === "group" || X.some(({ key: e }) => e === r);
	return /* @__PURE__ */ z("div", {
		className: Z,
		children: [
			/* @__PURE__ */ R(y, {
				icon: e.Right,
				label: "Total activity: 13.3s",
				meta: String(X.length),
				expanded: t,
				selected: a,
				onClick: () => {
					n((e) => !e), i("group");
				}
			}),
			t ? /* @__PURE__ */ R(T, { children: X.map((e) => /* @__PURE__ */ R(y, {
				icon: e.icon,
				label: e.label,
				meta: e.meta,
				selected: r === e.key,
				onClick: () => i(e.key)
			}, e.key)) }) : null,
			/* @__PURE__ */ R(y, {
				icon: e.Eye,
				label: "Calendar rollout",
				meta: "Read",
				onClick: () => {}
			}),
			/* @__PURE__ */ R(y, {
				icon: e.Right,
				label: "Total activity: 4.1s",
				meta: "5",
				expanded: !1
			}),
			/* @__PURE__ */ R(y, {
				icon: e.Orchestrator,
				label: "Calendar rollout",
				meta: "Spawn",
				onClick: () => {}
			}),
			/* @__PURE__ */ R(y, {
				icon: e.Brain,
				label: "Thoughts",
				meta: "2.1 s",
				selected: r === "last",
				onClick: () => i("last")
			})
		]
	});
}
function On() {
	let [t, n] = I(Sn[0]), r = (r) => /* @__PURE__ */ R(y, {
		icon: e.Chat,
		label: r,
		meta: "Thread, 3",
		selected: t === r,
		onClick: () => n(r)
	}, r);
	return /* @__PURE__ */ z("div", {
		className: Z,
		children: [
			/* @__PURE__ */ R(y, {
				icon: e.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ R(T, { children: Sn.map(r) }),
			/* @__PURE__ */ R(y, {
				icon: e.Right,
				label: "Total activity: 13.3s",
				meta: "12",
				expanded: !1
			}),
			/* @__PURE__ */ R(T, { children: r("impl/time-zones") }),
			/* @__PURE__ */ R(y, {
				icon: e.Brain,
				label: "Thoughts",
				meta: "2.1 s"
			})
		]
	});
}
function kn() {
	return /* @__PURE__ */ z("div", {
		className: Z,
		children: [
			/* @__PURE__ */ R(y, {
				icon: e.Chat,
				label: "impl/calendar-sync-recurring-events-and-time-zones",
				meta: "Thread, 12"
			}),
			/* @__PURE__ */ R(y, {
				icon: e.Orchestrator,
				label: "Roll the recurring-events fix out to every calendar provider",
				meta: "Spawn"
			}),
			/* @__PURE__ */ R(y, {
				icon: e.Plane,
				label: "Investigate why the nightly export drops recurring events",
				meta: "Spawn",
				status: v.Pending,
				selected: !0
			})
		]
	});
}
function An() {
	let [t, n] = I(!0), [r, i] = I("review/calendar"), a = Ye.Large;
	return /* @__PURE__ */ z("div", {
		className: Cn,
		children: [
			/* @__PURE__ */ R(y, {
				size: a,
				icon: e.Brain,
				label: "Thoughts",
				meta: "13.8 s"
			}),
			/* @__PURE__ */ z(T, {
				className: "py-2",
				children: [
					/* @__PURE__ */ R(y, {
						size: a,
						icon: e.Chat,
						label: "impl/calendar",
						meta: "Thread, 3",
						status: v.Running
					}),
					/* @__PURE__ */ R(y, {
						size: a,
						icon: e.Chat,
						label: "impl/recurring-events",
						meta: "Thread, 2",
						status: v.Failed
					}),
					/* @__PURE__ */ R(y, {
						size: a,
						icon: e.Chat,
						label: "docs/calendar",
						meta: "Thread, 1",
						status: v.Pending
					}),
					/* @__PURE__ */ R(y, {
						size: a,
						icon: e.Chat,
						label: "review/calendar",
						meta: "Thread, 3",
						selected: r === "review/calendar",
						onClick: () => i("review/calendar")
					})
				]
			}),
			/* @__PURE__ */ R(y, {
				size: a,
				icon: e.Right,
				label: "Worked for 13.3s",
				meta: String(X.length),
				expanded: t,
				onClick: () => n((e) => !e)
			}),
			t ? /* @__PURE__ */ R(T, { children: X.map((e) => /* @__PURE__ */ R(y, {
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
function jn() {
	return /* @__PURE__ */ R(C, {
		title: "Insights",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ R(En, {}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-start gap-6",
					children: [
						/* @__PURE__ */ R(Dn, {}),
						/* @__PURE__ */ R(On, {}),
						/* @__PURE__ */ R(kn, {}),
						/* @__PURE__ */ R(An, {})
					]
				}),
				/* @__PURE__ */ R(vn, {})
			]
		})
	});
}
// src/app/components/pages/design-preview/ModelLoaderSection.tsx
var Mn = [{
	variant: ve.Default,
	label: "Default"
}, {
	variant: ve.Accent,
	label: "Accent"
}], Nn = [
	{
		size: _.Small,
		label: "Small 16px"
	},
	{
		size: _.Medium,
		label: "Medium 20px"
	},
	{
		size: _.Large,
		label: "Large 24px"
	}
], Pn = [
	1,
	2,
	3
];
function Fn() {
	return /* @__PURE__ */ R(C, {
		title: "Model loader",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(4,72px)] items-center gap-x-4 gap-y-3",
			children: [
				/* @__PURE__ */ R("span", {}),
				/* @__PURE__ */ R("span", {
					className: "label-micro text-basic-muted",
					children: "Animated"
				}),
				Pn.map((e) => /* @__PURE__ */ z("span", {
					className: "label-micro text-basic-muted",
					children: ["Frame ", e]
				}, e)),
				Mn.flatMap(({ variant: e, label: t }) => Nn.map(({ size: n, label: r }) => /* @__PURE__ */ z(F, { children: [
					/* @__PURE__ */ z("span", {
						className: "label-small text-basic-secondary",
						children: [
							t,
							" · ",
							r
						]
					}),
					/* @__PURE__ */ R(me, {
						size: n,
						variant: e
					}),
					Pn.map((t) => /* @__PURE__ */ R(me, {
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
function In() {
	return /* @__PURE__ */ R(C, {
		title: "Notices and loaders",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-4",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap gap-3",
					children: [
						/* @__PURE__ */ R(ye, {
							variant: Se.Info,
							title: "Read-only snapshot",
							className: "w-[280px]",
							children: "Pick the working tree to edit files again."
						}),
						/* @__PURE__ */ R(ye, {
							variant: Se.Error,
							title: "Run failed",
							className: "w-[280px]",
							children: "The provider rejected the request."
						}),
						/* @__PURE__ */ R(ye, {
							variant: Se.Success,
							title: "Branch switched",
							className: "w-[280px]"
						})
					]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2 w-[398px]",
					children: [
						/* @__PURE__ */ R(p, {
							variant: f.Danger,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						}),
						/* @__PURE__ */ R(p, {
							variant: f.Error,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						}),
						/* @__PURE__ */ R(p, {
							variant: f.Success,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						}),
						/* @__PURE__ */ R(p, {
							variant: f.Info,
							title: "Message Title",
							action: {
								label: "Message CTA",
								onClick: () => {}
							},
							children: "Message description"
						})
					]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-center gap-6",
					children: [
						/* @__PURE__ */ R(_e, { size: r.Medium }),
						/* @__PURE__ */ R(nt, {
							rows: 3,
							className: "w-[200px]"
						}),
						/* @__PURE__ */ R(he, {
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
function Ln() {
	let [e, t] = I(4), [n, r] = I(.7), [i, a] = I(["local"]), [o, ee] = I(1);
	return /* @__PURE__ */ R(C, {
		title: "Numeric inputs, tags and pagination",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6",
			children: [
				/* @__PURE__ */ z("div", {
					className: "flex flex-wrap items-center gap-8",
					children: [/* @__PURE__ */ R(Be, {
						value: e,
						onChange: t,
						min: 1,
						max: 16,
						"aria-label": "Parallel threads"
					}), /* @__PURE__ */ z("div", {
						className: "flex items-center gap-4 w-[320px]",
						children: [/* @__PURE__ */ R(fe, {
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
				/* @__PURE__ */ R(Ne, {
					tags: [
						"local",
						"docker",
						"remote",
						"sandbox"
					],
					selected: i,
					onChange: a
				}),
				/* @__PURE__ */ R(se, {
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
// src/app/components/pages/design-preview/PopoverSection.tsx
function Rn() {
	let [e, n] = I(!1);
	return /* @__PURE__ */ R(C, {
		title: "Popover, copy, shortcuts",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [
				/* @__PURE__ */ R(ee, {
					open: e,
					onClose: () => n(!1),
					placement: t.BottomRight,
					sticky: !0,
					content: /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R("div", {
						className: "label-small text-basic-primary px-2 py-1",
						children: "Anchored panel"
					}), /* @__PURE__ */ R("div", {
						className: "text-micro text-basic-muted px-2 pb-1",
						children: "Closes on Escape or a click outside. On a phone it becomes a bottom sheet instead."
					})] }),
					children: /* @__PURE__ */ R(l, {
						variant: o.Secondary,
						onClick: () => n((e) => !e),
						children: "Open popover"
					})
				}),
				/* @__PURE__ */ R(ne, { value: "nac" }),
				/* @__PURE__ */ R(i, { keys: [
					"cmd",
					"shift",
					"k"
				] })
			]
		})
	});
}
// src/app/components/pages/design-preview/ReasoningSection.tsx
var zn = "The build spends most of its time preparing images. I’ll check the cache key before changing the build steps.\n\nA stable key should include the lockfile and image directory so unchanged inputs can reuse the cache.";
function Bn() {
	let [e, t] = I(!0);
	return /* @__PURE__ */ R(C, {
		title: "Conversation: reasoning and answer",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex min-w-0 flex-col gap-4",
			children: [
				/* @__PURE__ */ R("p", {
					className: "text-small text-basic-secondary",
					children: "Reasoning: 14px / 22px, secondary text, 12px paragraphs, 16px inset, 1px tertiary rule, no filled surface. Header and copy targets: 44px. Answer: existing 14px / 24px primary prose. Live opens; settled starts closed. A reader’s toggle, focus or selection wins on settlement. Activity remains a link to Insights; this is its reasoning detail, without a second heading."
				}),
				/* @__PURE__ */ R(l, {
					variant: o.Secondary,
					onClick: () => t(!e),
					children: e ? "Settle reasoning" : "Resume reasoning"
				}),
				/* @__PURE__ */ R(Qe, {
					segment: {
						kind: "reasoning",
						key: "preview",
						text: zn,
						streaming: e,
						durationMs: e ? null : 2300
					},
					active: !1
				}),
				/* @__PURE__ */ R(We, { children: "Use a stable image cache key to avoid rebuilding unchanged images." })
			]
		})
	});
}
// src/app/components/pages/design-preview/QualificationSection.tsx
function Vn() {
	return /* @__PURE__ */ R(C, {
		title: "Selected presentation journeys",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex min-w-0 flex-col gap-3 text-small text-basic-secondary",
			children: [
				/* @__PURE__ */ R("p", { children: "Use these production patterns together: readable reasoning and answers, calm navigation, clear launch forms, grouped settings, managed readiness and an inspector with a clear return path. Keep Arcee/Telos identity, a 4px spacing rhythm and 44px phone controls." }),
				/* @__PURE__ */ R("p", { children: "Samples document the treatment. Qualify complete journeys in the built standalone app and the exact packed presentation, including two independent views alongside host controls. Check long and error content, keyboard focus, reduced motion and real 200% browser zoom. The supported product theme is currently dark." }),
				/* @__PURE__ */ R("p", { children: "Native inputs, the instance-owned overlay stack and specialized code, math, diff and terminal views retain their existing owners. A sample or passing fixture does not record human design acceptance or signed hosted qualification." })
			]
		})
	});
}
// src/app/components/pages/design-preview/samples.ts
var Hn = [
	"9f2c1ab4",
	"3de77c01",
	"b81004ff",
	"22aa93de",
	"7c0518ba",
	"e4419d27"
];
// src/app/components/pages/design-preview/SessionAvatarsSection.tsx
function Un() {
	return /* @__PURE__ */ R(C, {
		title: "Session avatars",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-wrap items-center gap-4",
			children: [Hn.map((e) => /* @__PURE__ */ z("div", {
				className: "flex items-center gap-2",
				children: [/* @__PURE__ */ R(tt, {
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
var Wn = [
	ce.Small,
	ce.Medium,
	ce.Large
], Gn = [
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
], Kn = [
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
], qn = [
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
], Jn = () => {};
function Yn() {
	return /* @__PURE__ */ z("div", {
		className: "grid w-fit grid-cols-[200px_repeat(12,32px)] items-center gap-y-3",
		children: [
			/* @__PURE__ */ R("span", {}),
			Gn.map((e) => /* @__PURE__ */ R("span", {
				className: "col-span-3 label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			Ve.map((e) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
				className: "label-small truncate text-basic-secondary",
				children: e.label
			}), Gn.flatMap((t) => Wn.map((n) => /* @__PURE__ */ R("span", {
				className: a("flex items-center justify-center", t.className),
				children: /* @__PURE__ */ R(Ue, {
					behavior: e.id,
					size: n
				})
			}, `${t.label}-${n}`)))] }, e.id))
		]
	});
}
function Xn({ isMobile: e }) {
	let t = /* @__PURE__ */ R(Le, {
		title: "Chat session 1",
		isMobile: e,
		onPin: Jn,
		onRename: Jn,
		onDelete: Jn
	});
	return /* @__PURE__ */ z("div", {
		className: a("grid w-fit items-center gap-x-4 gap-y-2", e ? "grid-cols-[120px_repeat(4,240px)]" : "grid-cols-[120px_repeat(4,200px)]"),
		children: [
			/* @__PURE__ */ R("span", {
				className: "label-micro text-basic-muted",
				children: e ? "Mobile" : "Desktop"
			}),
			Kn.map((e) => /* @__PURE__ */ R("span", {
				className: "label-micro text-basic-muted",
				children: e.label
			}, e.label)),
			qn.map((n) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
				className: "label-small text-basic-secondary",
				children: n.label
			}), Kn.map((r) => /* @__PURE__ */ R(xe, {
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
function Zn() {
	return /* @__PURE__ */ R(C, {
		title: "Project navigation",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [
				/* @__PURE__ */ R(Yn, {}),
				/* @__PURE__ */ z("div", {
					className: "flex items-start gap-2",
					children: [
						/* @__PURE__ */ R(d, {
							title: "Fix the parser",
							behavior: "direct",
							showBehaviorIcon: !0,
							active: !0
						}),
						/* @__PURE__ */ R(d, {
							title: "Rewrite the store layer",
							behavior: "direct-with-orchestrator",
							showBehaviorIcon: !0
						}),
						/* @__PURE__ */ R(d, {
							title: "Investigating",
							behavior: "orchestrator",
							showBehaviorIcon: !0,
							running: !0
						}),
						/* @__PURE__ */ R(d, {
							title: "Without NAC",
							behavior: "direct"
						}),
						/* @__PURE__ */ R(d, {
							title: "Fork: Fix the parser",
							forkedFromTitle: "Fix the parser"
						}),
						/* @__PURE__ */ R(d, {
							title: "Fork running",
							forkedFromTitle: "Fix the parser",
							running: !0
						})
					]
				}),
				/* @__PURE__ */ R(Xn, { isMobile: !1 }),
				/* @__PURE__ */ R(Xn, { isMobile: !0 }),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-2 max-w-[320px]",
					children: [/* @__PURE__ */ R(qe, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title"
					}), /* @__PURE__ */ R(qe, {
						sessionId: "14231vsd7897-aaaa",
						title: "Fork: Session title",
						deleted: !0
					})]
				}),
				/* @__PURE__ */ z("div", {
					className: "flex flex-col gap-1 max-w-[320px]",
					children: [
						/* @__PURE__ */ R(be, {
							name: "arcee-ai/nac",
							trailing: "4",
							active: !0
						}),
						/* @__PURE__ */ R(be, {
							name: "arcee-ai/telos",
							trailing: "1",
							running: !0
						}),
						/* @__PURE__ */ R(be, {
							name: "Unassigned session",
							variant: He.Orphan
						})
					]
				})
			]
		})
	});
}
var Q = {
	onOpen: () => {},
	sessionHref: "#/design"
}, Qn = [
	{
		label: "Ready · direct agent",
		card: {
			title: "Child session title",
			status: D.Ready,
			behavior: "direct",
			...Q
		}
	},
	{
		label: "Ready · direct + NAC",
		card: {
			title: "Child session title",
			status: D.Ready,
			behavior: "direct-with-orchestrator",
			...Q
		}
	},
	{
		label: "Ready · managed orchestrator",
		card: {
			title: "Child session title",
			status: D.Ready,
			lineage: "managed-orchestrator",
			...Q
		}
	},
	{
		label: "Running",
		card: {
			title: "Child session title",
			status: D.Running,
			behavior: "direct",
			...Q
		}
	},
	{
		label: "Failed",
		card: {
			title: "Child session title",
			status: D.Failed,
			statusLabel: "Failed",
			behavior: "direct",
			...Q
		}
	},
	{
		label: "Failed · cancelled",
		card: {
			title: "Child session title",
			status: D.Failed,
			statusLabel: "Cancelled",
			behavior: "direct",
			...Q
		}
	},
	{
		label: "Not found",
		card: {
			title: "Child session title",
			status: D.NotFound,
			...Q
		}
	},
	{
		label: "Static",
		card: {
			title: "Child session title",
			status: D.Ready,
			behavior: "direct"
		}
	}
], $n = [{
	label: "NAC on",
	showBehaviorIcon: !0
}, {
	label: "NAC off",
	showBehaviorIcon: !1
}], er = "Investigate the flaky parser tests in the store layer";
function tr() {
	return /* @__PURE__ */ R(C, {
		title: "Subagent transcript card",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-6 overflow-x-auto [&>*]:shrink-0",
			children: [/* @__PURE__ */ z("div", {
				className: "grid w-fit grid-cols-[200px_repeat(2,320px)] items-center gap-x-4 gap-y-3",
				children: [
					/* @__PURE__ */ R("span", {}),
					$n.map((e) => /* @__PURE__ */ R("span", {
						className: "label-micro text-basic-muted",
						children: e.label
					}, e.label)),
					Qn.map((e) => /* @__PURE__ */ z(F, { children: [/* @__PURE__ */ R("span", {
						className: "label-small text-basic-secondary",
						children: e.label
					}), $n.map((t) => /* @__PURE__ */ R(N, {
						showBehaviorIcon: t.showBehaviorIcon,
						...e.card
					}, t.label))] }, e.label))
				]
			}), /* @__PURE__ */ z("div", {
				className: "flex flex-col gap-2",
				children: [/* @__PURE__ */ R("span", {
					className: "label-micro text-basic-muted",
					children: "Narrow container · 240px"
				}), /* @__PURE__ */ z("div", {
					className: "flex w-[240px] flex-col gap-3",
					children: [/* @__PURE__ */ R(N, {
						title: er,
						status: D.Ready,
						behavior: "direct",
						showBehaviorIcon: !0,
						...Q
					}), /* @__PURE__ */ R(N, {
						title: er,
						status: D.Failed,
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
var nr = [
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
], rr = [
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
], $ = () => {};
function ir() {
	return /* @__PURE__ */ R(C, {
		title: "Tools and reasoning badge",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 grid w-fit grid-cols-[160px_repeat(2,auto)] items-center justify-items-start gap-x-10 gap-y-3",
			children: [
				/* @__PURE__ */ R("span", {}),
				/* @__PURE__ */ R("span", {
					className: "label-micro text-basic-muted",
					children: "Default"
				}),
				/* @__PURE__ */ R("span", {
					className: "label-micro text-basic-muted",
					children: "Selected"
				}),
				nr.map(({ caption: e, label: t, inProgress: n, disabled: r }) => /* @__PURE__ */ z(F, { children: [
					/* @__PURE__ */ R("span", {
						className: "label-small text-basic-secondary",
						children: e
					}),
					/* @__PURE__ */ R(A, {
						label: t,
						inProgress: n,
						disabled: r,
						onClick: $
					}),
					/* @__PURE__ */ R(A, {
						label: t,
						inProgress: n,
						disabled: r,
						selected: !0,
						onClick: $
					})
				] }, e)),
				rr.map(({ label: e, leadingIcon: t }, n) => /* @__PURE__ */ z(F, { children: [
					/* @__PURE__ */ R("span", {
						className: "label-small text-basic-secondary",
						children: n === 0 ? "In progress" : null
					}),
					/* @__PURE__ */ R(A, {
						label: e,
						inProgress: !0,
						leadingIcon: t,
						onClick: $
					}),
					/* @__PURE__ */ R(A, {
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
function ar() {
	return /* @__PURE__ */ R(C, {
		title: "Typography",
		children: /* @__PURE__ */ z("div", {
			className: "p-4 flex flex-col gap-2",
			children: [
				/* @__PURE__ */ R("div", {
					className: "title",
					children: "Title"
				}),
				/* @__PURE__ */ R("div", {
					className: "header-medium",
					children: "Header medium"
				}),
				/* @__PURE__ */ R("div", {
					className: "label-small text-basic-secondary",
					children: "Label small"
				}),
				/* @__PURE__ */ R("div", {
					className: "paragraph-medium text-basic-secondary",
					children: "Paragraph medium on the secondary text token."
				}),
				/* @__PURE__ */ R("div", {
					className: "code code-small text-basic-muted",
					children: "code-small / IBM Plex Mono"
				})
			]
		})
	});
}
// src/app/components/pages/DesignPreviewPage.tsx
function or() {
	return /* @__PURE__ */ z("div", {
		className: "h-full overflow-y-auto bg-elevation-ground text-basic-primary",
		children: [/* @__PURE__ */ z("header", {
			className: "flex items-center gap-4 h-14 px-6 border-b border-secondary",
			children: [/* @__PURE__ */ R(pe, { height: 18 }), /* @__PURE__ */ R("span", {
				className: "text-basic-muted label-small",
				children: "design system"
			})]
		}), /* @__PURE__ */ z("main", {
			className: "p-6 flex flex-col gap-6 max-w-[1100px]",
			children: [
				/* @__PURE__ */ R(Bn, {}),
				/* @__PURE__ */ R(Vn, {}),
				/* @__PURE__ */ R(xt, {}),
				/* @__PURE__ */ R(st, {}),
				/* @__PURE__ */ R(sr, {}),
				/* @__PURE__ */ R(Rn, {}),
				/* @__PURE__ */ R(wt, {}),
				/* @__PURE__ */ R(In, {}),
				/* @__PURE__ */ R(Un, {}),
				/* @__PURE__ */ R(Zn, {}),
				/* @__PURE__ */ R(Fn, {}),
				/* @__PURE__ */ R(ir, {}),
				/* @__PURE__ */ R(jn, {}),
				/* @__PURE__ */ R(Kt, {}),
				/* @__PURE__ */ R(tr, {}),
				/* @__PURE__ */ R(ot, {}),
				/* @__PURE__ */ R(Ln, {}),
				/* @__PURE__ */ R(Dt, {}),
				/* @__PURE__ */ R(Et, {}),
				/* @__PURE__ */ R(ar, {})
			]
		})]
	});
}
function sr() {
	let [e, t] = I(!1);
	return /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R(Jt, { onOpenModal: () => t(!0) }), /* @__PURE__ */ R(te, {
		open: e,
		onClose: () => t(!1),
		title: "Delete session",
		footer: /* @__PURE__ */ z(L, { children: [/* @__PURE__ */ R(l, {
			variant: o.Secondary,
			onClick: () => t(!1),
			children: "Cancel"
		}), /* @__PURE__ */ R(l, {
			variant: o.SecondaryDestructive,
			onClick: () => t(!1),
			children: "Delete"
		})] }),
		children: "This is the shared modal shell: overlay click, Escape and a Tab focus trap all come from the atom."
	})] });
}
export { or as default };
