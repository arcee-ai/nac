# Local folders and Finder reveal (ALL-347)

The optional `NativeDirectoryPort` is injected into the existing immutable
presentation runtime. `PathPickerModal` uses it only for an explicit directory
request from normal Create Project's **Local** execution choice. Browser-only,
file/config, SSH and Podman pickers retain their existing API browsing. A
selected path is form data. The existing setup sequence and server project
admission still normalize, validate and reject it; selection creates no grant,
bookmark, Keychain record, directory or backend change.

`NativePathBridge` installs a separate `nacLocalPaths` handler before the view's
first load. It consumes the verified engine receipt and the command owner's
read-only `currentDocument(in:)` correlation closure. It does not add operations
to `nacUIReceipt`. Each completed navigation activates a separate path document
binding. Requests require the exact view/controller/main frame, verified
scheme/host/port, current launch/view/document and a positive Int32 request ID.
Bodies are JSON strings limited to 20,480 UTF-8 bytes; initial paths are limited
to 16,384 bytes. Only exact `choose` and `cancel` shapes are accepted. Choose IDs
increase within a document; one native panel can be pending. Requests from a
background/hidden window or a window with another native sheet are rejected.

`NativeFolderPanel` creates a directory-only, single-selection NSOpenPanel with
directory creation disabled. It never follows a file URL from JavaScript. An
initial absolute path is only a panel starting location. Missing/moved chosen
directories return cancellation, and server admission revalidates again later.
Cancellation, supersession, runtime closure, navigation and actual bridge
retirement fence late callbacks. Source correlation is checked at choose and
completion. Ordinary hidden-window lifetime does not retire the menu bridge.

The shell composition owner must construct this bridge after `commands.bind()`
and before the first load, forward the same navigation-start/finish callbacks,
and retire it in the common failure/actual-stop/view-replacement funnel. It must
include `NativeFolderSelection.swift`, `NativeFolderPanel.swift`,
`NativePathRequest.swift`, `NativePathScript.swift` and `NativePathBridge.swift`
in its existing sole app builder. These common files remain separately owned.
Window close/hide calls `cancelPending()` while retaining the intact document;
it does not retire commands or force a new engine launch.

The Files panel's explicit **Reveal in Finder** control appears only with the
native Local capability, a matching current session/root and no historical
revision. It observes cached session eligibility without attaching/recovering a
session. The existing HTTP client sends a relative path and the root observed in
the current snapshot to `POST /sessions/{session_id}/workspace/reveal`. Rust
resolves the current durable session and Git target, rejects SSH and every
Podman session, and compares the expected root. It opens every relative path
component with no-follow descriptors, permits only existing regular files or
directories, and compares pinned device/inode identities before handing the
path to `/usr/bin/open -R` as an argument. The fixed opener uses the existing
process supervisor with a five-second timeout and reap/cleanup. No shell or raw
file URL is accepted. Finder's subsequent path-based OS operation remains owned
by macOS; this is not a filesystem lock or grant. Existing default-app opening
and its missing-parent fallback remain unchanged.

## Evidence and integration contract

Pure Swift request/lifetime fixtures and exact-script Node fixtures cover stale,
malformed/oversized, cancellation and retirement behavior. Shared React tests
cover explicit Local opt-in, unchanged API browsing, runtime/form replacement,
single dispatch and stale reveal settlement. Rust tests cover current backend
and root binding, traversal, symlinks, missing/moved/replaced paths and HTTP
Origin denial. They do not establish native acceptance.

`NativePathJourney.swift` supplies two owned public XCTest journeys for ALL-354
under `NATIVE_UI_TESTS`. It requires exact app/binary/console/window checks before
every input, plus a mandatory H-owned `observePhase` closure with no fallback.
The helper creates no sidecars, reads no app-profile files and performs no
filesystem move or restore. The closure reads only H's already-bound, observed
app evidence JSON. H must independently bind that known file to the exact
source, app binary/PID, window, engine launch and run; it must not discover an
alternate writable/readable location or merely echo an unverified record.
The existing app publisher atomically writes the JSON from the app process;
app write authority never transfers to XCTest.

The `paths_phase` record has `version: 1`, `name`, `sequence`, `run`, `source`,
`app_pid`, `window`, `engine_pid`, `operation`, `launch`, `view`, and `document`.
H supplies the corresponding `NativePathJourney.Scope` from its verified initial
binding and decodes each `NativePathJourney.Phase` from the same known file.
The helper rejects identity mismatches, unknown operations, skipped/backward
phases, changes within a sequence, and unexpected document replacement.
Re-reading an unchanged atomic record is allowed. Normal order is `ready` (0),
`document-reloaded` (1), `folder-moved` (2), `folder-restored` (3), then
`reveal-observed` (4). Only phase 1 changes the document, retaining its launch
and view; later phases must retain that exact successor. The failure case is
`ready` (0), then `failure-panel-observed` (1) on its initial document.
Readiness and phase 0 are published in one atomic app record.

The normal journey uses existing Create chat/New Project/Local/SSH/Sandbox and
Files controls. It proves the unconnected SSH form has no Local picker and
Podman retains the API browser; live SSH/container execution is separate
infrastructure coverage. After real NSOpenPanel Cancel, XCTest navigates inside
the second actual panel through an ASCII parent and visible unique Unicode
folder, without selecting. The app fixture observes its own pending panel's
`directoryURL`, exact bridge choice/cancel counts and current document, then
reloads the actual view once. It publishes phase 1 only after the old sheet is
gone and a distinct current document is ready. XCTest verifies the replacement
form retained its original path.

After the first actual completed folder selection reaches the normal enabled
form, the app moves only its freshly created fixture directory to a fixed
unique sibling and publishes phase 2. XCTest waits for that record, then submits
the real form. The app observes an actual visible error containing this folder
and `does not exist`, restores its own directory, and publishes phase 3.
XCTest independently verifies the error, waits for restoration, reselects via
NSOpenPanel and explicitly retries normal project/first-chat creation. No
form values, errors or server responses are synthesized by the fixture.

Every run creates a fresh UUID in both the spaces/Unicode folder and
extensionless reveal leaf. Before explicit reveal, public XCTest records all
Finder windows' public identifiers, frames and counts matching this unique
title/leaf; the target must be absent. Afterward exactly one matching titled
window must expose the exact selected leaf. Observations include the run,
folder and leaf as public XCTest result-bundle attachments. The helper never
activates Finder or sends later NAC input. These content observations do not
establish stable OS window identity or guarded close authority. The revealed
window is left open and explicitly recorded as a desktop cleanup residual.

A fixture-only observer is installed in the verified initial and successor
page documents. It records only trusted clicks on the existing enabled Reveal
button. It exposes a read closure, has no command or fetch replacement, and
cannot change UI, invoke product operations or accept caller control verbs.
Installation/current-document identities are retained. Missing, duplicate,
stale, wrong-route or replayed observations fail. App code verifies the same
launch/document both before and after each script observation. A real click
starts a fixed 45-second observation grace and the existing six actual HTTP
reveal-denial checks. The app then uses ordinary bounded engine/profile cleanup
without waiting for an XCTest control write. The grace and app receipt grant
no Finder success: the actual successful XCTest result and selection attachments
are independently required, along with engine reaping and profile removal.
H must allow up to 90 seconds for app settlement after the helper returns.
Fixture input phases have a shared 240-second bound; the grace is separate.

For `paths-failure-xctest`, XCTest opens and navigates inside the first actual
panel to the run's unique folder without selecting. The app observes that
specific pending panel and current document, publishes its phase, then uses the
existing owned-engine channel-loss seam exactly once. It requires actual app
failure, invalidated launch identity, retired path handler and no attached
sheet before the existing cleanup. No timer alone infers that XCTest saw the
panel; its real navigation causes the predeclared transition.

`test_native_path_fixture.py` executes the actual extracted observer in Node
and Foundation-only scope/phase implementation in Swift, covering trusted
input filtering, duplicate/stale/replayed events and finite phase/identity
controls. Its static no-write and source/mode audits are audits only. These
controls do not qualify XCTest sandbox reads, NSOpenPanel directory transitions,
trusted WKWebView events, native input, Finder selection or cleanup.

Full acceptance still requires root-inspected coherent source/build exclusions,
the exact frozen ALL-354 runner and actual `.app`/system WKWebView executions,
plus supplier ALL-342/346 qualification and the final independent ticket review.
The read-only H adapter, helper's actual XCTest compilation and both native
journeys remain unqualified until recorded against exact joined source and
binaries. Physical IME/paste, VoiceOver, minimum-OS/signing/vendor-auth coverage
remain separate. Chromium, parsed source, pure fixtures and app receipts are
not substitutes. No permission, sandbox, TCC, entitlement or ownership change
is authorized to make a fixture pass.
