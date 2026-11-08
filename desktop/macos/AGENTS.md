# macOS local startup and development preview

This owner contains the ALL-340 disposable AppKit/WKWebView preview and the
ALL-341 private identified engine launch/control seam, and ALL-342 normal local
startup, ALL-343 app reopen and safe store-conflict retry, ALL-344 close/Quit,
and ALL-345 workspace recovery plus ALL-349 presentation storage. Read the
root guide before changes. Swift owns only the window, isolated fixture, and
its exact bundled child. Rust remains the execution/persistence/permission
authority; the production React UI and HTTP/SSE client remain shared.

- Bundle `nac-web` and its existing embedded assets. No second frontend build,
  native chat client or arbitrary native operation handler. NativeCommands owns
  the bounded UI-only page-world adapter: named actions go to shared React owners;
  web-to-native messages report readiness/settlement. The separate bounded
  presentation-storage protocol writes only allowlisted bytes in the selected
  private profile; it grants no API, process, permission or caller-path authority.
- Preview builds create a private temporary HOME/NAC_HOME/workspace/store.
  `LOCAL_APP` builds use DesktopStartup and the bundled Rust preflight to reuse
  normal configuration, credential and track owners. Never seed/delete a normal
  profile. All qualification uses externally owned disposable profiles; never
  open/migrate a personal store for evidence. Read readiness only from the exact
  launched child, never attach to a fixed/default port. Normal LOCAL_APP WebKit
  uses a persistent UUID profile selected from verified track/canonical-store
  identity and the launch's home namespace. Disposable preview remains ephemeral.
- PreviewEngine accepts EngineLaunchConfiguration(cwd, store, environment).
  The PreviewProfile/provider adapter retains isolated fixture semantics.
  DesktopStartup never parses TOML, copies credential stores or executes a shell.
  Config preflight retains normal publication recovery and prepares selected
  parent directories through the Rust owner; it opens no DB or serving lease.
- The loopback provider and two configuration-seeding requests are disposable
  test infrastructure. They never operate on user stores or expose real keys.
- Window close quits the disposable preview, with bounded child cleanup before
  deleting its profile. Normal LOCAL_APP close keeps the same window/document,
  bridge, streams and owned engine; AppInstance reopens it. AppLifecycle/AppQuit
  own explicit native Cancel or Stop and Quit. Normal-app Quit retains one
  originating terminateLater transaction through confirmation and cleanup;
  Cancel replies false and preserves work. Stop replies true only after owned
  shutdown completion. NACApplication fences native duplicates using both the
  delegate-owned transaction and the original public call through reply unwind.
  The canonical builder selects NACApplication only for LOCAL_APP. Test-only
  ATTENTION_SMOKE cleanup reuses that transaction when present; without one it
  requests local termination only after exact-owned cleanup has settled.
  Preview keeps its existing NSApplication shutdown. Unknown activity requires
  confirmation; a parent run alone never proves idle. Stop retires NativeCommands
  and releases the WK document before PreviewEngine.stop. The engine retains its
  existing Rust 20-second watchdog and owned 23-second fallback. A later 26-second
  UI wait reports pending cleanup without another stop/signal, keeps
  the original callback and shows a truthful retired-workspace failure state.
  A bounded half-second presentation checkpoint barrier after owned engine
  cleanup does not change the existing 20/23/26-second watchdog/control policy.
  Failure/timeout is not a successful durable flush. Signing/distribution remain separate.
  EngineProtocol/PreviewEngine own the private bounded
  launch channel; it conveys identity, never API/permission authority.
- `WorkspaceRecovery` distinguishes renderer/navigation/connection loss and
  sleep/wake from engine exit. Renderer recovery retains the verified engine;
  explicit Restart waits through existing `PreviewEngine.stop` and reuses the
  selected launch configuration through `AppQuit`'s existing launch fencing.
  It adds no daemon, wake lock, process supervisor or alternative backend.
  `WorkspaceRetirement` closes the live page runtime/React Effects, drops native
  view ownership and waits for actual weak release before revalidation. A dead
  renderer cannot acknowledge JavaScript disposal; document destruction remains
  required. `WorkspaceReadiness` is a bounded read supplement to the private
  receipt, never launch identity or authorization by itself.
- The optional page-world lifetime registration and exact-schema
  `connection_lost` readiness fact expose no API, input, filesystem, shell or
  permission action. Mutations keep their existing uncertainty/readback owner;
  only failed GETs signal connection loss. Replacement loads canonical state,
  never pending intents or terminal bytes. Old terminal handles and process-local
  output are not restored after engine restart. WorkspaceStorage retains the
  normal profile's website store and opaque presentation checkpoint. React's
  existing preference/ALL-336 text owners interpret its bounded records; Swift
  stores no query/domain model. WorkspaceCheckpoint owns private no-follow
  directory/file descriptors, an exclusive presentation lease, and ordered
  atomic replacements, including clear tombstones. A successor cannot hydrate
  over an old profile's pending final writes merely because Rust released its
  domain serving lease. Profile contention/failure stays explicit and uses
  isolated memory storage; never attach to another owner or select another store.
  WorkspaceStorageBridge reuses NativeCommands' launch/view/document identity,
  rejects stale/frame/origin/sequence/schema mismatches and drains accepted writes
  before replacement hydration. Native compilation, file-fault and actual
  cross-Quit/profile/port evidence are required before acceptance.
- `AppInstance` owns existing-window presentation, not singleton/store authority.
  Ordinary normal-app launches use LaunchServices reopening. `StoreConflictRetry`
  fences each failed child's retirement; only explicit native Retry restarts the
  pinned selected configuration through the ordinary Rust serving lease.
  Preserve PreviewApp's common private `fail(String)` funnel and the engine's
  receipt invalidation before callbacks. A LOCAL_APP view failure retains a
  verified ready engine with a live Quit owner, including while hidden; it
  retires the broken view's commands and reports that work continues until
  explicit Quit. An invalid/retiring engine still uses ordinary owned cleanup.
  NativeCommands owns menus/bridge and retires through the common fail/actual-stop
  funnel. Hiding an intact window does not retire its bridge. Native Edit stays
  in the AppKit/WK responder chain; never synthesize trusted terminal intent.
- The read-only `BundleIdentity.sh` helper maps the exact bundled engine identity's track to approved
  normal bundle IDs. Preview and instance-smoke identities stay separate. Normal
  source lists and binaries exclude all preview providers and smoke definitions;
  `build-receipt.json` records the selected source list and hashes. The existing
  builder is the single app writer; packaging consumes its output.
- Keep smoke instrumentation behind `PREVIEW_SMOKE`; it may inspect/drive the
  DOM but must not become an app bridge or replace production workflows.
- Run `./desktop/macos/preview.sh smoke` on an actual Aqua macOS session and the
  existing production-embedded browser regressions. WebKit absence is an
  acceptance gap, never a pass. See README.md for prerequisites and evidence.
- Every native slice must extend and run checked-in actual-app/WKWebView E2E
  journeys for its changed user behavior and relevant startup, lifecycle,
  recovery, failure and cleanup seams. Record exact candidate source/binary
  identity and bounded fixture cleanup. Unit tests and browser emulation alone
  do not establish native acceptance. ALL-354 owns broader full-Xcode CI;
  signing, supported-OS/hardware, real provider authentication and trusted OS
  input remain the evidence obligations of their owning tickets. Scripted DOM
  interaction cannot prove those contracts.

Startup qualification keeps process custody separate from UI eligibility. The
single preinstalled metadata owner commits only complete, valid process records;
a sticky UI rejection never authorizes input or a new window binding. Positive
process history plus a fresh exact kernel identity may still support cleanup.
Helper, app/engine, and profile settlement are separate proofs. Cleanup success
cannot clear the original UI failure, infer completed input, or admit another case.
Configured-local interactions use the explicitly accepted public-coordinate/global
AX ownership preflight in startup_xctest/AX-WITNESS-CONTRACT.md. Additional raw CG
surfaces do not veto that contract or prove association. Initial singleton root
binding, exact retained root/process, sticky refusal, freshness, resource and
positive cleanup requirements remain. Pointer dispatch uses the checked public
coordinate; its accepted last-instant dynamics are not atomic delivery proof.

Shared-host execution instructions supplied by the user take precedence over
local defaults. Keep all builds and use of a shared binary inside its lease.

The cohesive `test_ci_startup_observer.py` test module may exceed 800 lines
because it keeps deterministic kernel/AppKit adapters, exact production snapshot
compilation and custody/launch-race assertions in one auditable fixture owner.
Each selected batch compiles that fixture once; the file remains below 2,000 lines.

The cohesive `test_ci_startup_attachments.py` module may exceed 800 lines because
it owns the synthetic SDK inventory, shared payload fixtures, strict success
validators and failure-only diagnostic retention together. Keeping those controls
beside one collector prevents divergent fixture admission; it remains below 2,000 lines.

A new, unadmitted native-image candidate may be observed during a bundled-engine
spawn. Recovery is limited to a positively observed same-PID/birth/UID/owned-app-
parent native-to-engine image transition and one fresh full tuple with coherent
bookends. Never rebind a known identity, reuse rejected argv/environment, infer
role from flags, omit an ambiguous candidate, or normalize paths to pass checks.
Prohibited environment/parse/denial failures remain sticky; a disappearance in
the recovery path grants no retirement or input authority.
