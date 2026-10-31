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
`http://localhost:1456/callback` listener; Codex provider loopback sign-in uses
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
before this fixture can run; a source typecheck alone is not a fixture pass.
