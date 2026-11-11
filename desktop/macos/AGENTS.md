# macOS local startup and development preview

This owner contains the ALL-340 disposable AppKit/WKWebView preview and the
ALL-341 private identified engine launch/control seam, and ALL-342 normal local
startup, plus ALL-343 app reopen and safe store-conflict retry. Read the
root guide before changes. Swift owns only the window, isolated fixture, and
its exact bundled child. Rust remains the execution/persistence/permission
authority; the production React UI and HTTP/SSE client remain shared.

- Bundle `nac-web` and its existing embedded assets. No second frontend build,
  native chat client or privileged script message handler. NativeCommands owns
  the bounded UI-only page-world adapter: named actions go to shared React owners;
  web-to-native messages report only readiness/settlement, never operation authority.
- Preview builds create a private temporary HOME/NAC_HOME/workspace/store.
  `LOCAL_APP` builds use DesktopStartup and the bundled Rust preflight to reuse
  normal configuration, credential and track owners. Never seed/delete a normal
  profile. All qualification uses externally owned disposable profiles; never
  open/migrate a personal store for evidence. Read readiness only from the exact
  launched child, never attach to a fixed/default port. WebKit remains
  nonpersistent until the separately owned preference/storage slice.
- PreviewEngine accepts EngineLaunchConfiguration(cwd, store, environment).
  The PreviewProfile/provider adapter retains isolated fixture semantics.
  DesktopStartup never parses TOML, copies credential stores or executes a shell.
  Config preflight retains normal publication recovery and prepares selected
  parent directories through the Rust owner; it opens no DB or serving lease.
- The loopback provider and two configuration-seeding requests are disposable
  test infrastructure. They never operate on user stores or expose real keys.
- Window close quits this preview, with bounded child cleanup before deleting
  its profile. Consumer close/reopen/Quit, persistent preferences, signing, and distribution
  belong to later tickets. EngineProtocol/PreviewEngine own the private bounded
  launch channel; it conveys identity, never API/permission authority.
- `AppInstance` owns existing-window presentation, not singleton/store authority.
  Ordinary normal-app launches use LaunchServices reopening. `StoreConflictRetry`
  fences each failed child's retirement; only explicit native Retry restarts the
  pinned selected configuration through the ordinary Rust serving lease.
  Preserve PreviewApp's common private `fail(String)` funnel and the engine's
  receipt invalidation before callbacks. NativeCommands owns menus/bridge and retires through the common fail/actual-stop
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
