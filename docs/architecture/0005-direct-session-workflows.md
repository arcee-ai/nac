# Direct session workflow ownership

## Decision

The browser's direct-session application boundary is
`crates/nac-server/web/src/app/features/direct-session/`. It owns conversation
command ordering and the observation lease. The established orchestrator uses
the same observation boundary without changing its durable behavior. React
continues to own editing, selection, IME, attachments, local command parsing,
dialog state and navigation. Server validation and persisted session topology
remain server responsibilities.

Pin Effect **3.22.2** (stable v3, MIT) in the locked web dependency tree. This
boundary uses the v3 Context.Tag, Effect and Scope APIs. It does not depend on
v4 release candidates, Atom, Effect's HTTP stack or an additional server cache.
External service-design references informed the ownership decision; no external
implementation or skills were installed/copied.

## Owners

| Responsibility                                                                 | Single owner                                             |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| Endpoint, credentials, request IDs, HTTP errors, version negotiation           | `packages/nac-client`, through existing facades          |
| Prompt admission, dispatch uncertainty                                         | Typed client admission result; workflow consumes it once |
| SSE ordering, duplicate suppression, replay, reconnect, backpressure           | Typed client event subscription                          |
| Server data, query retry, invalidation, polling, request cancellation          | TanStack query owners                                    |
| Snapshot/tail/history generation and abort fence                               | `sessionRefresh`                                         |
| Burst coalescing, snapshot priority, epoch recovery, subscription/read release | Scoped `SessionObservation` workflow                     |
| Create → canonical snapshot acceptance → caller navigation                     | `createChat` with browser query adapter                  |
| Prompt optimistic projection, admission → rejection/reconciliation             | `submitPrompt` with origin-bound query adapter           |
| Idle submit versus direct durable inbox versus classic steering                | `deliverPrompt`                                          |
| Stop optimistic state, failure rollback and settlement                         | `stopRun` with `makeStopPorts`                           |
| Live/optimistic presentation projection                                        | `runtimeStore`                                           |
| Text, slash selection, goal editor, attachments, draft clearing                | Composer                                                 |

There is no second reconnect loop, snapshot cache, replay cursor, admission
retry or generation counter in Effect. Commands explicitly disable TanStack
mutation retries, including when an embedding root has a retry default.
Existing inbox/permission/goal mutations remain their query owners' contracts.

## Lifetime and composition

An observation activation binds a QueryClient and session ID to explicit
capabilities. Browser adapters project wire events, cache operations and live
state into the narrow observation port. Message reads and subscriptions can be
supplied by another endpoint composition; both must use the same endpoint as
that root's queries. A QueryClient belongs to one endpoint. Changing endpoints
requires a fresh cache/root, rather than reusing identical wire IDs in an old
cache. `sessionRefreshKey` binds fences to that cache owner without changing
server session IDs.

The React bridge acquires a fresh Scope synchronously on activation and closes
it synchronously on cleanup. StrictMode cleanup therefore finishes before the
replacement activation acquires its listener. The lease owns its subscription,
debounce timers and read controller. Closing it aborts tail/history reads,
cancels snapshot/thread queries and releases transient thread pages; it never
calls durable cancellation. A monotonically unique canonical generation also
rejects responses from an earlier activation of the same chat. An endpoint or
session switch cannot consume a new activation's destructive replacement flag.

Command settlement deliberately outlives the view. The client sends once;
accepted admission invalidates the originating session. A not-sent command
clears its optimistic prompt; uncertain admission preserves it and requests a
canonical replacement. The optional submit AbortSignal is forwarded to the
existing client, which distinguishes pre-dispatch cancellation from uncertainty
after dispatch. Disconnect/unmount does not imply server cancellation or
permission to retry.

Presentation activation identity is separate from the read generation: it
only prevents late local command callbacks from painting a different/reopened
view. Cache settlement still belongs to the original QueryClient/session.
Stop rollback restores only the snapshot/summary objects still owned by that
request, preserves newer fetches and other list entries, and reconciles the
origin. A terminal stream event supersedes optimistic Stop presentation.

The Effect boundary passes the deletion test: deleting observation removes
burst/recovery priority and resource ownership; deleting command workflows
removes admission/rollback ordering and the distinct direct/classic delivery
paths. Pure formatting, parsers and React props have no Effect dependency.

## Presentation and compatibility

The direct workspace keeps the conversation and composer primary. Model and
reasoning controls remain visible on narrow/mobile layouts. Secondary desktop
readings use the keyboard-accessible Run details disclosure. Files, revisions,
History, traditional children, permission grants, goals, inbox delivery/edit/
cancel, rich tool results, attachments and compaction retain their existing
owners and controls. Opt-in orchestration and hybrid sessions retain their
panels, immutable identity and classic running-input steering.

The composer still resolves its slash catalog before dispatch, deduplicates
while loading, preserves ordinary prompts if metadata fails, and clears only
an accepted unchanged draft. The integrated MCP catalog/notification owners
must continue to supply their existing session-bound command and live-only
notification contracts through the facades; this change does not fork them.

## Verification and production evidence

Adjacent tests characterize StrictMode, navigation with delayed reads,
disposed/reopened generations, endpoint/cache isolation, uncertain/not-sent
admission without replay, late command settlement and targeted Stop rollback.
The typed client's tests retain ordered replay, gaps, duplicate and backpressure
coverage. Production embedded tests exercise policy off/on with the same binary,
creation, queue/edit/cancel/stop, streaming, reload and child inspection.

`e2e/direct-workflow.e2e.ts` records production React root commits through the
DevTools hook, native EventSource acquisition/release, and browser request
counts at fixed journey boundaries. It uses the ordinary production build,
not the development-only perfDebug/Profiler. Set `NAC_DIRECT_EVIDENCE_DIR` to
save JSON evidence. A read-only extracted committed bundle can be supplied with
`NAC_DIRECT_BASELINE_ASSETS`; the same loopback server/provider then isolates
frontend differences. Both desktop and 390×844 runs cover open, durable input,
rapid navigation, Stop, completion, reload and exit. Commit counts and polling
requests are observations rather than timing-independent performance limits.

Compare production JS file counts, summed bytes and per-file deterministic
`gzip.compress(..., mtime=0)` bytes with the exact baseline. The ALL-119 hosted
persistence baseline is separately held/unavailable; local scripted-provider
coverage is not evidence that its hosted incident is fixed. Container image
execution requires container infrastructure and is a separate coverage lane.
