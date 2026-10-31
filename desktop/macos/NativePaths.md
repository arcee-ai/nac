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

`NativePathJourney.swift` supplies the owned public XCTest folder-selection
journey for the ALL-354 runner to compose under `NATIVE_UI_TESTS`. It requires
the runner's exact app/binary/console/window checks before every input. Its
owned ASCII parent must contain a fresh directory whose name has spaces and
Unicode, with an existing saved fixture model available in the shared form.
It drives actual NSOpenPanel cancellation and document replacement while a
sheet is pending, verifies a successor form retains its own folder, and selects
the Unicode/spaces folder. It moves that owned folder before normal submission,
observes server rejection, restores/reselects it, and explicitly retries normal
project/first-chat creation. It then invokes Reveal in Finder and observes the
selected file through Finder accessibility. `NativePathSmoke` observes the real
panel/document callbacks and verifies stale/outside/missing/symlink/file-URL
reveal denials through the actual WKWebView and shared server. It has no
standalone launch or hosted dispatch, does not provision permissions, and does
not qualify physical IME or paste.

Full acceptance additionally requires integration of the separately owned common
shell wiring and frozen ALL-354 XCTest harness, plus actual `.app`/system
WKWebView runs of these journeys, SSH/Podman exclusion, engine failure with a
pending native sheet, bounded cleanup and supplier ALL-342/346 gates. These remain
explicit gates until recorded against the exact joined source and binaries;
Chromium, pure fixtures and this checked-in driver are not substitutes.
