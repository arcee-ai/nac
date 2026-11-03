# Native workspace commands (ALL-346)

`NativeCommands` supplies AppKit menus. Workspace actions are `newSession`,
`settings` and `projects`. React's existing sidebar/product navigation owners
open the shared UI. New Session opens a dialog; the command never submits a
session or sends terminal input. Edit selectors use AppKit's current responder
chain. The bridge does not read/write the pasteboard or synthesize input events.

The optional `DesktopCommandPort` is injected at presentation composition.
An ordinary browser supplies no port. One `DesktopCommandOwner` connects below
existing feature providers and forwards to their owners. It rechecks document
focus, presentation keyboard ownership and modal layers before acting. Shared
layer primitives retain focus restoration. Native code also checks the active
application, key window and actual WebView responder before sending a command.

`NativeCommandBridge` belongs to one actual WKWebView and a verified live
`EngineReceipt`. That receipt identifies the launch, not the server's independent
`NativeRuntimeScope.incarnation`, a document, a human-operation capability or
permission. The bridge generates its own view UUID and a new document UUID after
each completed navigation. Navigation start clears readiness and pending work.
Late navigation completions and JavaScript completions cannot affect a successor.
Retirement removes the message handler and disables menu delivery.

The script is deliberately in `WKContentWorld.page` so it can reach the existing
React application. A content world scopes JavaScript variables; it does not
isolate the DOM. Page world provides no security boundary against same-origin
script. See [Apple's content-world documentation](https://developer.apple.com/documentation/webkit/wkcontentworld).
The security boundary is the absence of privileged operations: web-to-native
messages can only report readiness, retirement and command settlement. They
cannot select actions, execute script/shell, read files, access server authority,
change a backend, approve an operation or manufacture trusted input.

Each received message must come from the installed controller and current
WKWebView, its main frame and the exact verified scheme/host/port. Bodies are
serialized JSON strings limited to 2,048 UTF-8 bytes before parsing. Version 1
accepts only exact keys and the current launch/view/document identities:

| kind | Additional fields | Meaning |
| --- | --- | --- |
| ready | none | One owner is connected to this document |
| retired | none | The owner disconnected; pending delivery is discarded |
| settled | request, accepted | A positive Int32 request ID and Boolean UI result |

Native requests carry only version, request and a named action. IDs increase
within the view and at most one request is pending. Duplicate, unknown, stale,
malformed or oversized messages cannot dispatch anything. Failure is consumed
without automatic replay. The React adapter also rejects malformed requests and
duplicate IDs, and retires captured callbacks on unmount/StrictMode replacement.

Navigation is restricted to this exact origin and main frame. New-window
creation returns nil. Engine loss, renderer failure, termination and view
replacement must retire commands before disposing the workspace. A retired
WebView is not reused for a successor launch.

Pure protocol fixtures and component checks characterize these contracts.
Acceptance additionally requires the checked-in actual `.app`/system WKWebView
journey, including physical keyboard/Edit provenance and visible paint on an
unlocked console. Scripted DOM, Chromium and pure state tests cannot establish
those claims. Instrumented acceptance builds remain separate from normal apps.
