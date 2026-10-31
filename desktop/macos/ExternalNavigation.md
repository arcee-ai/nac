# Native external navigation and existing sign-in

`ExternalNavigation` owns only the system-browser handoff. `NativeCommands`
retains the sole WKUIDelegate and `PreviewApp` retains navigation lifecycle
observation. Rust owns credentials, provider polling, MCP PKCE/state, callback
listeners, cancellation and token persistence. No auth URL is sent through
`nacUIReceipt` or printed by the adapter.

The current document must belong to the exact live engine receipt, view and
NAC origin. The read-only `currentDocument(in:) -> NativeDocumentBinding?`
accessors expose correlation to focused shell adapters; they grant no operation
authority. They return nil during document replacement, UI-owner unregistration,
launch retirement, failure and for another view or origin.

Only activated external HTTP(S) links and WebKit-admitted new-window actions
may reach NSWorkspace. URL userinfo, downloads, subframe sources, existing-view
script/redirect navigation, unsafe schemes, retired launches and same-NAC-origin
popups are refused. OAuth query/state values remain intact for the OS opener.
External content receives no shell-owned WKWebView or native bridge.

macOS WKPreferences defaults automatic JavaScript windows to **enabled**.
NativeCommands explicitly disables `javaScriptCanOpenWindowsAutomatically`
before loading the page, so WebKit applies its public user-interaction gate.
The public WKNavigationAction API supplies no portable gesture-authority bit.
The adapter admits `.other` only for a new-window action which passed that
gate; main-frame external links require `.linkActivated`. Existing asynchronous
device-login auto-open can be blocked after its request completes; the shared
provider's explicit Open button remains the user retry path. No private WebKit
properties, synthetic trusted input or global popup preference are used.

The NAC serving origin uses the engine's actual assigned loopback port. Local
MCP OAuth deliberately uses the separate Rust-owned
`http://localhost:1456/mcp_library/oauth/callback` listener; Codex provider loopback sign-in uses
its existing provider-specific listener. Configured remote MCP callback origins
remain under the existing server validation. This adapter changes none of them.
The existing UI polls after handoff and asks users to return to NAC. Denial,
expiry and cancellation remain server/React states. An OS opener failure shows
a fixed shell-owned retry message without including the destination URL.

## Evidence boundary

The Swift policy contracts and complete-module typecheck establish source-level
scheme/origin/lifecycle decisions. They do not establish actual WK action
ordering, trusted input, external-browser delivery, vendor authentication,
timeout/restart completion, minimum-OS support or release acceptance.

Actual browser qualification requires the production app and HTTP auth owners,
deterministic local doubles, a genuinely isolated browser/profile and bounded
owned cleanup. The locked shared local console is not an external-browser
acceptance environment. A named recording-opener WK fixture must report that
system-browser acceptance remains open. ALL-157 Clerk migration stays separate;
ordinary browser/CLI and offline API-key workflows retain their owners.

`ExternalNavigationSmoke` is the explicitly named
`external-navigation-recording` PREVIEW_SMOKE scenario. Its bounded observations
contain navigation classifications and booleans, never destinations. For this
scenario alone the adapter records admitted actions instead of calling
NSWorkspace. `external_navigation_recording.py` launches the built app and
requires the evidence to report `system_browser_qualified=false`. It can qualify
WK callback ordering, popup rejection and document correlation; it cannot
qualify an actual browser opening or an auth callback completing. The common
builder/PreviewSmoke owner must integrate the source list and named dispatch
before this fixture can run. Those hooks are included in the shared builder;
a source typecheck or successful compilation alone is not a fixture pass. The
fixture waits for the live loaded document before evaluating JavaScript,
bounds each WK evaluation and records the existing ownership checkpoint so a
failed run still has exact app/engine/profile cleanup evidence.

Native `callAsyncJavaScript` execution is a separate popup context: an actual
recording observed WebKit delivering its `.other` popup despite the disabled
automatic-window preference. A null `window.open` result means the shell
returned no child WK view; it does not establish that WebKit blocked delivery.
The fixture preserves that counterexample as a positive control. Its separate
document-start observer schedules a page-owned timer, records public
`navigator.userActivation.isActive` and `hasBeenActive`, and attempts a popup
only after observing inactive state. Missing public activation support fails
coverage. Delegate deltas and a subsequent main-link control establish whether
that page-owned attempt escaped; elapsed time alone establishes nothing.

`ExternalAuthSmoke` is the separately named `external-auth` scenario. It uses
production MCP controls and the actual NSWorkspace opener, preserving callback
URLs inside the server/React/browser flow. `external_auth_fixture.py` provides
the local authorization/token double and sanitized browser observations. Its
unit tests establish the double's callback/PKCE/single-use/expiry behavior, not
the app handoff. The scripted native scenario covers success, denial, wrong
state and cancellation, while explicitly leaving timeout/restart, device-owner
integration and offline qualification open until their evidence exists.

`external_auth_smoke.py` refuses non-hosted execution and locked or unobserved
consoles before any app/browser launch. An approved hosted Mac contract must
also supply a disposable browser/profile and owned cleanup; CI environment
variables alone do not establish isolation. The fixture does not change the
default browser, close unrelated tabs or qualify a real vendor. Its common
builder/PreviewSmoke hook is included; hosted execution remains an integration
gate.

## Closed device-owner fixture

`native-auth-fixture` is an explicit, nondefault server Cargo feature. It uses
the existing local Arcee login constructor and the ordinary register, poll,
cancel, status and credential owners. The double retains legacy `nac-cli`,
canonical stored issuer/inference URLs and existing credential persistence.
Only the service transport is local. Signed-in model enumeration is explicitly
a deterministic read double; it qualifies neither inference nor vendor access.

Feature builds require the dev track and force the existing build ID to start
with `native-auth-fixture-v1-`, including when a build ID override is supplied.
The v1 identity keeps exactly its original four fields and launch equality.
Normal builds retain their build ID behavior. Ordinary shells reject the marker
before configuration/store discovery; only `NATIVE_AUTH_FIXTURE` accepts it.
The single `preview.sh auth-build` producer requires that actual engine before
replacing bundle files, compiles the explicit test flags and uses the distinct
`ai.arcee.nac.native-auth-fixture` bundle ID. Every normal mode refuses it.
Existing distribution admission rejects its mode, flags, ID and marked identity.

Before configuration discovery, the fixture validates an externally owned
temporary UUID root, current-UID private directories, a no-follow private owner
record bound to source/run, exact HOME/NAC_HOME/XDG/workspace/store selections,
and a literal ephemeral IPv4 loopback service origin. Ambient provider keys,
managed config and origin/host overrides fail admission. Serving additionally
requires the validated desktop channel and ephemeral loopback bind. Identity
inspection is pure; other effectful CLI commands fail closed. The fixture
runner constructs a closed child environment rather than inheriting secrets.

After admission a closed route allowlist permits shared onboarding/auth reads
and the specific Arcee login/model-read operations. Harness, configuration,
inference and future routes fail before handlers. Normal Origin/Host middleware
still applies. No fixture token can reach a provider through session creation
or model enumeration; normal executables contain no fixture environment adapter.

`device_auth_contract.py` exercises actual marked-engine success, denial,
expiry, timeout, cancellation, fresh-process credential readback, old-handle
404/no replay, Origin refusals and effect exclusion using HTTP approval doubles.
It explicitly provides no app/browser qualification. `DeviceAuthSmoke.swift`
and hosted-only `device_auth_smoke.py` drive the actual shared provider UI and
system-browser path. The runner owns the profile across Quit/relaunch and
removes it only after bounded owned app/engine retirement. Real-browser runs
require the coordinator-approved disposable hosted browser/profile contract;
the runner never creates such a contract from environment flags. Real vendors,
physical input, offline behavior and supported-OS qualification remain separate
evidence obligations.
