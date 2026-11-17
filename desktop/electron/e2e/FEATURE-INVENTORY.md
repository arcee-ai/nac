# Actual-Electron feature inventory, version 1

Baseline: dev `c49d4723d4ed87454f55f5f8092bc9c53ac9dc58`, November 17, 2026.
Route sources: `crates/nac-server/web/src/App.tsx` and
`src/app/lib/routes.ts`; feature owners under `src/app/features/` and
`src/app/components/`. This inventory describes executable scope, not a claim
that every scenario passed on a hosted runner. Use the exact candidate's
`identity.json`, `scenarios.json` and `cleanup.json` for observed verdicts.
ALL-642's original Mac/Linux acceptance stays broader than this Mac CI slice.

## Route and feature mapping

“Covered” means an actual-app scenario exists; its assertions define the limit.
“Added” identifies this slice's scenarios. “Deferred” means no actual-Electron
workflow claim, even when browser tests exist. Browser scenarios below are in
`crates/nac-server/web/e2e/`; reuse those owners for future actual-app expansion.

| Current surface | Actual-Electron scenario / status | Remaining workflow evidence |
| --- | --- | --- |
| `/`, empty project list | Covered: `fixture.ts` readiness; `native.spec.ts` New Project | Bulk project edit/delete and empty/error variants deferred; browser `navigation.e2e.ts` |
| Project creation/configuration | Covered: `native.spec.ts`, `workflow.spec.ts` | Native folder success is manual; form-wide validation deferred, browser `setup.e2e.ts`, `new-folder.e2e.ts` |
| `/project/:projectId` redirect | Deferred | Browser `product-context.e2e.ts`, `navigation.e2e.ts`; API-created project is not redirect acceptance |
| `/task-schedules`, project task schedules | Deferred | Browser `fresh-interval-tasks.e2e.ts`, `calendar-native.e2e.ts`; actual clock/wake and schedule execution deferred |
| `/session/:sessionId/:panel?`, default Insights | Added: `ci-smoke.spec.ts` current panel deep links, shared composer and Node absence | Admission smoke only; content and actions remain separately scoped below |
| Legacy Sessions panel | Added: deep link resolves to Insights | Filtering, bulk actions, archived sessions deferred; browser `navigation.e2e.ts` |
| Insights / legacy Threads panel | Added: both deep-link smoke | Complete reasoning/tool grouping/long-history variants deferred; browser `insights.e2e.ts`, `reasoning.e2e.ts` |
| Subagents (`delegated`) | Added: deep-link smoke | Child navigation, continuation, messages and managed orchestrators deferred; browser `subagents-panel.e2e.ts`, `subagent-continuation.e2e.ts`, `subagent-orchestrators.e2e.ts` |
| Files panel | Covered: representative tool write and file result, `workflow.spec.ts`; added deep-link smoke | Tree/source switching, Git status/diff/stage, revisions/revert deferred; browser `files-source.e2e.ts`, `review.e2e.ts`, `inspector-revert.e2e.ts` |
| Terminal panel | Covered: `workflow.spec.ts` trusted Chromium key input, output, resize, Ctrl-C, open-PTY Quit and parent death | Paste/multiline/selection/reconnect/retained-history workflows deferred; browser `terminal-local-acceptance.e2e.ts`, `terminal-selection.e2e.ts`, `terminal-history.e2e.ts` |
| Heartbeats panel | Added: deep-link smoke | Create/edit/cancel/attention and calendar/interval semantics deferred; browser `heartbeats.e2e.ts`, `heartbeat-attention.e2e.ts` |
| Worksets panel | Added: orchestrator deep-link smoke | Workset selection and context mutations deferred; browser `inspector-worksets.e2e.ts` |
| History panel (phone bottom bar) | Added: desktop deep-link smoke only | Phone geometry/revision actions deferred; browser `inspector-panel-hydration.e2e.ts`, `inspector-revert.e2e.ts` |
| `/design` and unknown-route fallback | Deferred | Browser `src/App.designRoute.test.tsx`; showcase is not ordinary startup |
| Direct chat streaming/tool turn | Covered: `workflow.spec.ts`, `performance.spec.ts` | Complete large transcript, token/usage accounting and model/tool variants deferred |
| `orchestrator`, `direct-with-orchestrator` | Partial: `workflow.spec.ts` API creation and immutable metadata assertions | End-to-end execution of these topologies deferred; browser `direct-workflow.e2e.ts`, `subagent-orchestrators.e2e.ts` |
| Steering/queue/inbox | Deferred | Browser `permission-queue.e2e.ts`, `subagent-message-recovery.e2e.ts`, `internal-completions.e2e.ts` |
| Questions and approvals | Covered: `workflow.spec.ts` Allow once and one question; manual mode/no human-shell grant assertions | Coordination, remembered grants, hard/configured denies and other approval modes deferred; browser `task-question-coordination.e2e.ts`, `permission-queue.e2e.ts` |
| Goal/budget controls | Deferred | Browser `goal-objective.e2e.ts`, `exact-goal-wait.e2e.ts`, `peer-goal-coordination.e2e.ts` |
| Models/settings/provider account | Covered: `native.spec.ts` native Settings menu, modal guard and device-sign-in UI actor | Real vendor/browser auth is separate manual evidence; complete settings/model editing deferred; browser `provider-sign-in.e2e.ts` |
| MCP library/OAuth | Covered: `native.spec.ts` local Rust PKCE success/denial/wrong-state/cancel through actual native bridge | OS browser opener is doubled; full MCP tool execution/config matrix deferred; browser `mcp-arguments.e2e.ts`, `settings-mcp-visual.e2e.ts` |
| Local/SSH/Podman backend selection | Partial: local only in current app scenarios | SSH/Podman actual-app construction/admission deferred; browser `setup-ssh.e2e.ts`, `human-shell.e2e.ts`; no backend switching by approval |
| Navigation/tabs/drafts | Covered: representative route/menu/modal guards and retained document, `native.spec.ts`, `lifecycle.spec.ts` | Full tabs/draft/restart matrix deferred; browser `prompt-drafts.e2e.ts`, `navigation-header.e2e.ts` |
| Durable state/recovery/Swift fixture migration | Peer-owned ALL-639 follow-up specs discovered automatically when integrated | Do not infer acceptance from this baseline; inspect integrated scenario verdicts and storage owner's fixture controls |
| Default-off notification frontier/target response | Peer-owned ALL-641 follow-up specs discovered automatically when integrated | Delivery/click/authorization on signed OS candidate stays separate; no interactive permission expectation in CI |
| Native menu/Edit/links/folder cancellation | Covered: `native.spec.ts` actual main/preload, trusted links, wrong frames/stale document, OS opener double, helper EOF/reap | AppKit folder success/Finder reveal/real browser are manual, `NATIVE-MANUAL.md`, `NATIVE-ACCEPTANCE.md` (historical revisions only) |
| Renderer sandbox / isolation / Node off / throttling | Covered: `workflow.spec.ts`; added exact package/launch/store identity in `ci-smoke.spec.ts` | No `--no-sandbox`, alternative IPC or fixed-port adoption permitted |
| Close/reopen, protected Quit, crash/contention/Retry | Covered: `lifecycle.spec.ts`, `startup-quit.spec.ts`, `load-failure.spec.ts`, `startup-cleanup.spec.ts` | Main-controller dialog outcomes/faults are explicit test actors; actual startup sheet clicks are manual |
| Long transcript/streaming/terminal pressure | Covered: `performance.spec.ts` bounded optimized DOM/rAF workflow and >=256 KiB pressure | Not paint, physical input or frozen-budget performance parity; full soak/hardware cohorts deferred |
| Managed/remote/hosted product routes and overlays | Deferred beyond shared local workspace | Browser `managed.e2e.ts`, `remote.e2e.ts`, `hosted-surfaces.e2e.ts`; no managed credential/account usage in this lane |

## CI selection and evidence limits

`NAC_ELECTRON_CI=1` discovers every `*.spec.ts`, including newly integrated peer
specs. The explicit excluded files are development defaults, manual startup Quit,
manual relocated native acceptance, PR visual capture, windowless native Quit,
the two opt-in frame/CPU diagnostics, and `notification-adapter.spec.ts`'s opt-in
OS authorization/delivery probe. Regular integrated notification journey specs
remain selected; native delivery is not implied by those actors.
`performance.spec.ts`'s ordinary bounded
workflow remains included. Its opt-in Swift comparison requires a separately
qualified comparator. The windowless file's installed-API arity control remains
available locally; excluding that file does not claim its manual sheet passed.
`startup-cleanup.spec.ts` uses a no-engine fault helper in the source shell;
ordinary Candidate scenarios use the exact normal packaged executable.

The CI runner rejects skipped, failed or unsupported selected cases, retries zero
times, retains per-case verdicts and fixture cleanup receipts, and independently
checks for remaining exact-candidate/private-fixture processes. No process list,
profile, store, screenshot, video, trace, raw attachment or personal data is
uploaded. Logs are capped at 256 KiB per phase, structured files at 256 KiB.
Private fixtures and any unexported raw diagnostics remain local to that runner.
An unavailable/locked Aqua console fails before app launch under the same
read-only prerequisite contract as the Swift hosted lane. Automation does not
unlock the console or request/change accessibility or privacy settings.

Hosted Mac execution is established only by an exact-head Actions run and these
packets. Linux Wayland/X11, physical keyboard/CJK/IME, VoiceOver/AX, actual system
sleep/wake, signed notification delivery, minimum-host/release packaging,
replacement/update, real paint, performance budgets and final qualification
remain deferred to the existing broader tickets. Trusted Chromium events and
DOM/rAF counters cannot establish those observations.
