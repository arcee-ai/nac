# Fresh-host local network diagnostic (not qualification)

The registered `stable-release.yml` workflow selects this diagnostic only on
`codex/all616-local-network-diagnostic` with the existing `native-qualification`
input set to `all-347-paths-macos26` and `native-paths-custody` set to the exact
non-allocation sentinel `local-network-diagnostic-v1`. The ordinary paths
admission is skipped only for that branch and sentinel. This manually
dispatch now selects only the paired `engine` and `panel` cells on independent
macOS 26 hosts. Earlier runs selected the control and combined cells described
below; this paired dispatch does not repeat them. Its
fixed immutable H/P/Q/R sources match the failing investigation snapshot. Each
cell uses a Python controller. The first three cells use a separately
source-bound Q-prime XCTest and a disposable AppKit fixture with no network
behavior. Q-prime uses the existing public app-window screenshot API and
emits only inferred `ocr_title_match` or `unknown` before and after the fixed
operation; it sends no UI input and does not explicitly request permissions.
`idle` runs two baseline snapshots; `provider` starts H's actual dummy Node
provider; `loopback` adds H's numeric-loopback Python request to that same
provider. The `engine` cell additionally builds the exact pinned product using
its committed package owner, verifies its signatures, and uses unchanged H/Q
profile, configuration, direct-owned setup-engine and dummy model seeding
owners. Its preparation builds before its baseline screenshot, and retains all
private profiles until disposable-host teardown. The `panel` cell compiles the
exact pinned P `NativeFolderPanel` and `NativeFolderSelection` into the Q-prime
fixture and opens a directory sheet programmatically; it never clicks or
selects within the sheet. Q-prime records `panel_sheet_observed` only after its
own sheet query and screenshot/OCR complete. It is a fixture composition, not
a normal P app launch or qualification. A 404 is sufficient to show an HTTP
request was made, not a successful model call. The provider's own bounded
stop/settlement owner remains in charge.

`combined_journey` runs the existing full ordinary startup journey with all
its qualification custody, witness, input and cleanup controls intact. It can
reach the real app folder panel, but includes Node, Python, engine and earlier
journeys; it is not a panel-only experiment and may fail before reaching the
panel. This workflow is not a qualification or required acceptance check even
if the underlying journey succeeds. Its result does not establish which
operation caused a prompt or whether a prompt was absent. The system
notification center can contain unrelated notifications; a sampled frontmost
category is only a rough timing clue. The separate positive modal category
requires a single AX value to equal the observed Python local-network dialog
title after whitespace and curly-quote normalization. Each traversal has a
0.6-second monotonic cutoff, a 48-element cap and 50 ms per-AX-call timeout.
AX refusal, slow calls, incomplete trees and missed samples remain unknown;
no text is retained. Missing samples,
unknown custody, or an incomplete workflow are unknown. Counts, process IDs,
window contents, URLs, paths, screenshots and raw logs are not uploaded.

Do not click, dismiss or accept any system alert, change or query TCC, or run
against a personal profile. Private temporary outputs stay on disposable hosts;
only closed categories are uploaded. New launch ancestry and timing can change
responsibility attribution, so a negative observation never disproves the
original failure. Correlate cells cautiously; the combined cell has substantially
longer setup and cannot isolate the panel. A dedicated panel-only actual-app
probe would require a separately reviewed actor or product hook and is not
provided by these sources.

The combined cell additionally reads only the exact H-exported private
configuredLocal case and named failed-test attachment, requiring the fixed
P/Q/R/H case identity, Q test identity, unique inventory and bounded
no-follow file/hash matches. Apple Vision reads the selected PNG via a pipe;
only `ocr_title_match` is emitted for an exact normalized title match. This
is inferred image text, not proof of system-dialog identity or provenance;
the independent AX modal field is unchanged. OCR failure, mismatch or timeout
stays unknown. The same bound dispatch records can report that the
folder operation's before or after receipt was observed, never that input was
delivered. Only the existing positive owner process-settlement proof yields
`positive_owner_proof`; false, absent or mismatched evidence remains unknown.
All of these fields remain diagnostic and do not grant acceptance or cleanup
authority.

Q-prime never establishes a system-dialog identity, the absence of a prompt,
or qualification. Its app and launch ancestry differ from ordinary NAC, and
the fixture itself may affect focus or system behavior. If an XCTest run or
screenshot cannot complete using existing host permissions, the checkpoint
remains unknown; no permission prompt is acted on. Its small fixture terminates
itself after a fixed timeout and its private tree remains on the disposable
host until teardown, because a failed test does not prove fixture settlement.

Before either control snapshot or operation, Q-prime renders a synthetic title
prefixed `CONTROL` inside its disposable fixture and requires its own OCR to
match that distinct string. The prefix reduces contamination from an unrelated
real alert, but adjacent recognized lines can still combine across surfaces.
The positive verifies fixture-window OCR, not system-alert visibility. If the self-test cannot match, the cell stops
before its operation. Closed build/test/export/attachment/OCR coverage fields
show where a checkpoint stopped; `ocr_complete` plus an unknown image still
never proves a prompt absent. The synthetic positive is never a system-dialog
observation and never changes the modal field.
