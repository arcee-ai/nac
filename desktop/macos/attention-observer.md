# ALL-350 attention characterization

This is the independent first milestone of ALL-350, based on engine foundation
`5aa65f4e7231c8eed910ae039cdf92a112a31fbb`. It provides deterministic,
content-free transition fixtures before selection of a native notification
adapter. It is not wired into the app, built into the app bundle, or a completed
notification feature. It creates no network subscriptions, timers, system
notifications, permission prompts, navigation, or mutation capabilities.

## Current authoritative evidence

- `crates/nac-core/src/events.rs`: `SessionEventEnvelope` carries session,
  event epoch/sequence and optional run identities. Top-level `RunCompleted`
  establishes successful session-run completion. `AgentEvent::RunFinished`
  is lower-level progress and does not establish that completion. Failure,
  cancellation and an absent active run do not establish success.
- `crates/nac-core/src/session_service.rs`: `ActiveRunSnapshot.run_id` is
  current run identity. `SessionFrontendSnapshot.thread_event_boundary` is
  the canonical session projection boundary, alongside heavy transcript state.
- `crates/nac-core/src/permissions/broker.rs`: live requests are held by the
  broker; `PermissionAsked`, `PermissionReplied` and `PermissionDismissed`
  establish their transitions. Both synchronous and asynchronous publication
  omit run context. A `PermissionRequest` has `id` and `session_id`, with no
  run ID. Guessing its run from a UI snapshot would invent authority. In
  particular, terminal/human-shell and model runs have separate lifetimes.
- `crates/nac-server/src/application/sessions.rs::permission_state`: obtains
  current broker requests, grants and reviews by attaching the session.
  `PermissionStateResponse.authorizable_review_ids` distinguishes blocked
  reviews that may still be authorized for one retry from historical reviews.
- `crates/nac-server/src/application/session_runs.rs::subscribe_events`:
  attaches each individual session and acquires a client subscription. Delivery
  in `delivery/session_runs.rs::session_event_stream` carries all session
  events and assistant deltas. This is not an existing app-wide metadata feed.
- `web/src/app/services/queries/keys.ts`: session lists have no event stream.
  `web/src/app/store/attentionStore.ts` compares active/inactive list states;
  this UI dot heuristic cannot identify exact successful runs or decisions.
- `web/packages/nac-client/src/eventStream.ts` already owns SSE ordering,
  reconnect, replay and backpressure for shared web workflows. The fixture
  reducer does not add a second reconnect loop or replace that owner.
- Existing `src/tests/presentation.rs` verifies boundary-before-replay-before-
  live SSE ordering. `src/tests/recovery.rs` verifies restart epoch rotation
  and idempotent interrupted-run recovery. These are relevant source contracts,
  not fresh execution receipts for this milestone.

## Fixture contract

`AttentionObserver` consumes normalized session facts, not a new wire schema.
The `Session` baseline requires current state and its boundary to be obtained
atomically. Current independent HTTP snapshot and permission reads do **not**
provide this combined atomic contract. An integrated producer must supply it;
the fixture must not be connected directly to those separate reads.

One serialized owner supplies the verified engine incarnation and a strictly
increasing source generation. Baseline is accepted once per generation and
emits nothing, including for existing pending requests. Old source callbacks
and old baseline reads cannot change a replacement. A reconnect within an
unbroken source reuses its sequence frontier and suppresses replay. Recovery
with a new source generation must take a new canonical baseline before live
delivery; it cannot turn retained historical completions into fresh notices.

For the current run, only an exact top-level successful completion emits a
completion notice. Duplicate starts cannot resurrect an already completed run.
Requests are deduplicated by session/request identity, including when resolution
arrives before a semantic repeat of an ask. Resolution removes pending state
and emits a content-free removal receipt. Neither run completion nor view
changes implicitly resolve a request. A request with an explicit stale run ID
is ignored; the actual broker's absent run ID remains absent.

Capacities are explicit constructor arguments for characterization, not chosen
product defaults. Counts and identifier byte lengths are bounded. Unknown
sessions, gaps, epoch changes, invalid identities and capacity exhaustion stop
delivery and release retained state. No item is silently evicted while claiming
continuous delivery. Recovery requires a strictly newer source generation and
current canonical rebaseline. A producer must preserve replay boundaries so
events older than that baseline cannot be reintroduced as new live events.
This policy may suppress events across a gap; it does not prove lossless
notification delivery. The integrated producer's replay/reconciliation policy
remains an acceptance gate.

`retention` reports actual retained session, identity and pending-request counts.
`retire()` is terminal, idempotent and releases them all. No callbacks, streams
or timers are acquired by this reducer. These counts do not measure the future
app's retained subscriptions, CPU or wakeups.

## Pending-decision coverage at the future join

ALL-472's accepted PR #495 head
`29ffb7cbd2bdcf0339a329b3c5890f0490d7cfec` was inspected read-only. It is
**absent from this milestone's baseline**. Its `QuestionRequest` carries exact
session/request/run/generation identities; `QuestionRecord` adds revision and
pending/answered/cancelled status. Questions are separate from permissions.
That revision adds no question `SessionEvent`; the focused web query currently
polls its session every second. That polling is not an app-wide background
notification architecture.

Recommendation for full ALL-350: include pending human-decision questions in
addition to live permission asks, keeping their distinct identities and
resolution rules. Only current `authorizable_review_ids`, rather than every
blocked historical review, can establish an outstanding review decision.
This fixture currently characterizes permission requests and successful runs;
it does not characterize questions or review decisions. The coherent join
must explicitly consume accepted supplier code and qualify those decisions.
No supplier store/API implementation is copied, no dependency is added here,
and this milestone does not declare narrower full-ticket acceptance.

## Bounded authoritative feed options

1. **Recommended for evaluation:** a focused Rust application projection with
   one bounded app-wide metadata subscription, an identified current-state
   baseline and replay frontier. Existing event owners publish only successful
   run/decision identities after their authoritative transitions. Durable
   questions publish after commit; broker requests retain their own lifetime.
   Delivery could use an additive read-only metadata SSE endpoint. It must
   preserve access/ownership and avoid attaching or recovering idle sessions,
   acquiring interactive approval authority, or collecting transcript content.
   Publication, snapshot and gap semantics need owner tests before an adapter.
2. A metadata feed over a separately allocated private app/engine observation
   channel could consume the same Rust projection. This avoids a public HTTP
   schema but requires explicit framing, bounded flow control and lifecycle
   ownership. The existing private launch/control channel establishes engine
   identity and stop ownership; it is not already this observation contract.
3. Extending existing session SSE and listing sessions would reuse transport
   but still requires many retained session clients, attaches services and
   streams unrelated content. Reject it as the default ALL-350 solution.
   Polling all sessions or rendering hidden transcripts has the same problem.

Options 1/2 require coordinator allocation and architecture/API adjudication.
Neither has been implemented or selected as a settled product contract here.
Keep shared web transport/Effect and native commands/lifecycle with their owners.

## Verification and remaining acceptance

Run without any GUI interaction, under the shared browser/Mac lease:

```sh
python3 /tmp/nac-35-01a18fbf/gate.py browser python3 desktop/macos/attention_contract.py
```

The runner compiles Foundation-only Swift with the discovered SDK explicitly
selected, targeting the existing preview's Apple Silicon macOS 14 candidate.
It executes seven deterministic scenario groups and prints source/binary
hashes, compiler, target and source revision. Temporary binaries are removed.
This is compile/execution evidence on the host OS, not macOS 14 qualification.

Full ALL-350 still requires accepted ALL-346 native commands and ALL-344
lifecycle; the bounded authoritative feed; explicit opt-in, mute/denial/Focus/
privacy behavior without repeated prompts; click activation of the existing
app/current canonical session with resolved requests shown resolved; reset,
opt-out, close/reopen, Quit, failure/recovery/cleanup journeys in the actual
app/system WKWebView on the approved isolated host; exclusive matched hidden
idle CPU/wakeup/observer measurements with/without notifications; and signed
build OS-delivery evidence separate from a mock center. Click handling must
never answer, execute, grant, or replay a command. No signing identity or
notification delivery evidence is supplied by these fixtures.
