# ALL-350 attention characterization

The Swift fixture is the independent first milestone of ALL-350, based on
engine foundation
`5aa65f4e7231c8eed910ae039cdf92a112a31fbb`. It provides deterministic,
content-free transition fixtures before selection of a native notification
adapter. It is not wired into the app, built into the app bundle, or a completed
notification feature. It creates no network subscriptions, timers, system
notifications, permission prompts, navigation, or mutation capabilities.

## Current Rust feed and its limits

The source candidate through `f3896096`, joined on supplier
`7bb6e1520510562468e6baef2709c58a53ccaeb8`, implements the focused Rust
application projection described below as option 1. Its inward contracts live
in `crates/nac-core/src/events/attention.rs`; canonical metadata reads and
postcommit dirty hints belong to `store/attention.rs` and the existing store
writers. The optional service observer in `session_service/attention.rs`
publishes typed operation and settlement metadata. The server composes these
in `application/attention_runtime.rs` and its `projection.rs`, with bounded
current state and replay in `application/attention.rs`.

`delivery/attention.rs` serves the private read-only `GET /attention/events`
SSE endpoint. The native launch owner enables it only after validating the
selected store and actual listener; ordinary construction leaves observation
inert. Request guards precede observer reservation and bootstrap. Observation
uses existing cached services and canonical metadata reads without attaching
or recovering idle sessions, creating work, or becoming an interactive approver.

At that revision, the feed projects canonical pending structured questions for
supported primary direct local sessions, including resolution after configuration,
project, cancellation and failure/recovery commits. Completed work requires an
exact current completed goal/version/last-run receipt, successful known
settlement and verified idle continuation disposition, with no conflicting
accounting, continuation, retry, inbox, question or manual operation. A raw
`RunCompleted` event is insufficient. Ordinary goal-free completion remains
`Unknown`; live permissions and actionable reviews were gaps, addressed by the
producer addendum below. Unsupported topology coverage remains an explicit gap.

Initial baselines are silent. Engine/source epochs, revisions and binding tokens
fence stale reads and callbacks; replay gaps, lag and capacity exhaustion require
reset/rebaseline. Retention is bounded to 1,024 sources/identities and 1 MiB of
current metadata, with 256 replay records/256 KiB. One physical observation
lifetime includes an accepted read still finishing after its waiter is dropped.
Closing observation detaches its callbacks and reader; these contracts do not
promise lossless historical notification delivery or measured idle CPU/wakeups.

The Foundation-only Swift `AttentionObserver` remains an isolated historical
characterization fixture. It is **not a consumer of this native SSE feed** and
has no notification-center, preferences, activation or app-lifecycle integration.
Its `runCompleted` input must not be connected directly to raw `RunCompleted`
events or treated as the current goal-backed completion contract. Full ALL-350
native acceptance remains unmet.

## Current broker producer addendum

The child source candidate at `4ad13e5c` adds bounded observation of actual
pending permission requests and current authorizable blocked reviews in the
existing cached direct-session broker. Atomic registration supplies a current
baseline; subsequent membership changes publish only exact session/request or
review UUIDs, fenced by a process-local broker owner UUID and revision. Broker
identity is not run identity. No request content, resources, grant authority or
new session attachment is introduced. The weak service bridge does not retain
the service or broker.

Owner loss silently replaces live broker evidence with `Unknown`, without
claiming that outstanding decisions resolved. Replacement owners require a
fresh baseline. If retry enqueue rolls back and restores the same review UUID,
its authoritative pending state reopens with `new_attention=false`; committed
enqueue with a failed wake leaves it removed. Permission/question terminal
tombstones remain unchanged. Broker snapshots are bounded to 256 decisions and
16 KiB of metadata; invalid identity, overflow or exhausted revision makes
observation unavailable and requires feed reset, without changing real decisions.

Completion additionally requires current available broker evidence with no
pending decisions. Exact goal-backed completion, goal-free `Unknown`, unsupported
topologies and every native consumer/OS acceptance gap below remain unchanged.
The isolated Swift fixture is still not a consumer of this feed.

## Foundation HTTP consumer milestone

The separate `NativeAttentionObserver` consumes the actual metadata wire contract
through Foundation/URLSession, with bounded incremental framing in
`AttentionFeedProtocol.swift`. It does not reinterpret the historical reducer's
raw `runCompleted` input. The producer base `2ea596fa` adds actual successful
goal-free settlement plus exact read-only canonical proof; ordinary empty wakes,
unknown ownership and unsupported facets still cannot establish completion.

One serialized profile/engine owner holds one GET and one cancellable retry
owner. Current source epochs, source revisions and subscription generations fence
old callbacks. Baselines, source replacements, checkpoints and review restoration
with `new_attention=false` are silent. A typed completion candidate waits for its
matching availability update: the writer can publish work before availability.
Lost weak broker ownership is unknown, never a decision-resolution receipt.
The HTTP runtime creates a new observation lifetime per GET; generic hub replay
does not establish cross-HTTP lossless history. Reconnect installs a fresh silent
baseline and never reconstructs notices from transcripts or separate reads.

The consumer has only generic private notification/navigation sinks. Its console
fixture uses a mock center, including rejected delivery and late acknowledgments;
there are no UserNotifications/AppKit imports, system permission/settings calls,
or approval/command/grant methods. A click carries its binding for revalidation
and requests current-session navigation only. Actual existing-app activation and
React navigation still require the separately allocated qualified ALL-344/346
join; the frozen command bridge has no session-target action.

`attention_feed_contract.py` builds immutable ordinary and existing review-fixture
Rust binaries under the caller's shared Rust lease, then compiles/runs the
Foundation fixtures under its shared browser/Mac lease. In a fresh worktree run
the repository's gated setup first. Use a new owned output directory per run:

```sh
# Inside the shared Rust lease; copies binaries before releasing that lease:
python3 desktop/macos/attention_feed_contract.py --source-ref FULL_ADMITTED_COMMIT_SHA --build-producers --output /tmp/attention-producers-UNIQUE
# Inside the shared browser/Mac lease:
python3 desktop/macos/attention_feed_contract.py --source-ref FULL_ADMITTED_COMMIT_SHA --producer-receipt /tmp/attention-producers-UNIQUE/producer-binaries.json --output /tmp/attention-results-UNIQUE
```

Only the explicit fixture driver mutates disposable REST state. Real Ask coverage
owns an ordinary interactive test client; the native stream remains passive.
Fixtures use real queued runs, questions and broker IDs, exact private launch
receipts, a local scripted provider and dummy credentials in owned profiles.
They characterize actual HTTP/mock-center behavior, quiet connection retention,
cache eviction, engine replacement, and bounded cleanup. The runner separately
labels adversarial loopback transport frames. Compiler target macOS 14 is not
supported-OS qualification. These fixtures establish no actual app/WKWebView,
signed OS delivery, trusted input, Focus behavior or measured idle CPU/wakeups.
Every remaining full ALL-350 native acceptance gate below remains open.

For N1, supply the exact clean committed candidate in both phases. Producer
receipts bind its HEAD/tree, executable hash and embedded source identity;
qualification rejects a dirty or different checkout. Builds consume the allocated
v5 target and jobs2 contract. No Rust equivalence to the historical e9 producer
is assumed. Named common sources and main files define each Swift program.
The frame envelope oracle includes the bounded historical completion page.

Legacy queue/decision cases retain their current-state notice semantics. The
separate `semantic-pages` cases drive the actual Foundation page parser and
URLSession backpressure with explicit accepted/rejected mock page ACKs. Their
checkpoint is a test double, with no durable storage, app or system delivery
claim. The indicator fixture characterizes unknown projection versus real
resolution, including muted/denied operation and retained completion counts.
All-three real-producer semantic completion/restart/queued/disconnected replay,
actual app/WK checkpoint/OS cases and performance remain separately required.

The 1,024 identity union includes silent current pending decisions as well as
seen identities, candidates and current work. A labelled faulted-stream fixture
accepts 1,024 silent review identities, rejects the 1,025th, and verifies terminal
unavailable state with drained transport and empty retained evidence. The actual
Rust producer independently enforces its own identity cap; this fixture tests
the consumer's defensive bound rather than a conforming producer sequence.

## Historical fixture evidence

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

In the historical fixture, only an exact top-level successful completion for
its current run emits a completion notice. This does not establish eligibility
for the current Rust feed's goal-backed completion. Duplicate starts cannot
resurrect an already completed run.
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
notification delivery. The current Rust feed implements its own bounded
replay/reconciliation contract; native consumer recovery remains an acceptance
gate.

`retention` reports actual retained session, identity and pending-request counts.
`retire()` is terminal, idempotent and releases them all. No callbacks, streams
or timers are acquired by this reducer. These counts do not measure the future
app's retained subscriptions, CPU or wakeups.

## Historical pending-decision join evidence

ALL-472's accepted PR #495 head
`29ffb7cbd2bdcf0339a329b3c5890f0490d7cfec` was inspected read-only. It is
**absent from the historical fixture's baseline**; the current Rust feed uses
the later joined supplier named above. Its `QuestionRequest` carries exact
session/request/run/generation identities; `QuestionRecord` adds revision and
pending/answered/cancelled status. Questions are separate from permissions.
That revision adds no question `SessionEvent`; the focused web query currently
polls its session every second. That polling is not an app-wide background
notification architecture.

Full ALL-350 requires pending human-decision questions and live permission
asks, keeping their distinct identities and resolution rules. Only current
`authorizable_review_ids`, rather than every blocked historical review, can
establish an outstanding review decision.
This fixture currently characterizes permission requests and successful runs;
it does not characterize questions or review decisions. The current Rust feed
has real question coverage; live permission/review producers were unimplemented
through `f3896096` and are covered by the current broker producer addendum above.
No supplier store/API implementation is copied, no dependency is added here,
and this milestone does not declare narrower full-ticket acceptance.

## Historical bounded authoritative feed options

1. **Subsequently implemented by the current Rust feed:** a focused Rust
   application projection with
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

These options record the earlier architecture evaluation. Option 1 is now the
implemented source contract described above; option 2 remains an alternative,
not a second implemented channel. Shared web transport/Effect and native
commands/lifecycle remain with their owners.

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
lifecycle; full pending-decision/topology coverage and native consumption of the
bounded feed; explicit opt-in, mute/denial/Focus/privacy behavior without repeated
prompts; click activation of the existing
app/current canonical session with resolved requests shown resolved; reset,
opt-out, close/reopen, Quit, failure/recovery/cleanup journeys in the actual
app/system WKWebView on the approved isolated host; exclusive matched hidden
idle CPU/wakeup/observer measurements with/without notifications; and signed
build OS-delivery evidence separate from a mock center. Click handling must
never answer, execute, grant, or replay a command. No signing identity or
notification delivery evidence is supplied by these fixtures.

### Attention fixture execution custody

The app driver now requires `APP OUTPUT INSTANCE_OBSERVER FULL_SOURCE_REF`.
Its clean exact-HEAD/tree guard and app receipt must agree with that full commit.
Each launch/control checks the active console UID, Aqua domain and observed
Root-unlocked bit. An available CGS lock wins. App identity includes its launch
time; the first owned window and control nonce stay pinned. A two-second control
envelope is published atomically; the fixture app repeats lock, UID, focus,
window and nonce checks at consumption. Unknown/locked state or focus loss
retires controls. Cleanup uses a separate nonce-bound stop-only verb without
activation or focus restoration. These controls require actual Aqua execution
before acceptance; Python fakes and Swift typechecks are preparation evidence.

The standalone port test is run only through `notification_port_fixture.py
PORT_PROGRAM CLEANUP_HELPER FRESH_OUTPUT FULL_SOURCE_REF`. Compile its existing
source group with `NotificationPortFixture.swift`; compile the same group with
`NotificationPortCleanup.swift` replacing the test main for the companion.
Both receive the controller-created canonical root and inherited directory fd;
neither discovers a profile or accepts an arbitrary WebKit UUID. The controller
owns a unique 0700 TMPDIR and reaps its exact child before calling the companion,
including after assertion failure. The companion uses WorkspaceStorageProfile,
removes that UUID only, and revalidates the root after the asynchronous callback.
Only an exact receipt permits descriptor-relative filesystem cleanup. A live
child, replacement root, unexpected temp entry, symlink or cleanup failure
retains evidence and fails the episode. No native runtime qualification is
implied by the accompanying inert directory tests.

Cleanup after custody loss uses the ATTENTION_SMOKE-only
`cleanupAttentionFixture` entry in the existing AppQuit/AppLifecycle owner.
It pins the same launch/stop, retires through PreviewApp and waits for the real
engine owner to reap; it does not call the interactive `stopFixture` helper.
An existing Quit or recovery sheet stays in place without answering/dismissing
it. Old answers and queued presentations cannot undo cleanup or restart work.
Responder changes (including a late recovery retirement), window fronting and
timeout UI are suppressed for this intent. The 20/23-second engine policy and
26-second lifecycle timeout remain; timeout retains the original callback and
does not claim reap. Only actual completion permits normal termination, even
when it arrives after that timeout. Ordinary finish and product Quit retain
their previous confirmation/Cancel/Stop behavior. Source fences and lifecycle
typechecks are not actual AppKit cleanup evidence.
