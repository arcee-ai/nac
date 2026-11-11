# Terminal links in browser and desktop presentations

The presentation root selects `native-visible-anchor` only when its caller
explicitly supplies the existing desktop menu capability. Without that optional
capability, including ordinary browser and hosted presentations, the existing
trusted-cell HTTP(S) `window.open` behavior remains the default. Terminal owners
do not inspect the user agent, host, loopback port or ambient native globals.
The mode describes presentation; it grants no input, URL or native authority.

In desktop mode, hovering a link exposes an origin-only Open control without
moving focus. Activating the terminal cell focuses that real anchor; Enter or a
second click uses its normal browser navigation. There is no synthetic click,
URL bridge, private gesture API or fallback popup grant. The native navigation
owner still applies its current document/receipt/origin policy. A denied or
unavailable handoff remains a denial or acceptance gap.

The visible and accessible labels contain only the canonical destination origin
and an elision. Paths, query values and fragments remain solely in the bounded
ephemeral href/current target, not titles, datasets, logs, clipboard writes or
bridge arguments. Standard browser or assistive link inspection can expose that
href; this display policy does not make the URL secret from the browser. Native
targets are HTTP(S), without userinfo, at most 8192 UTF-8 bytes after canonical
serialization; displayed origins are at most 320 characters. Those new bounds
do not change the ordinary browser handler's existing normalization semantics.

New output, reset, scroll, resize, selection changes, window blur, hidden document
and renderer disposal clear the native target and remove stale hrefs. Hover
cannot retarget a focused link. The 250ms leave grace is presentation-only and
cannot survive disposal. Explicit Close cannot bubble into the frame's focus
handler; it restores the prior textarea only while connected and input-enabled.
The widget uses xterm's public embedder hover surface, with no global Escape,
outside-press, modal or focus-trap owner.

Mode changes retire and recreate the renderer through the existing observation
and input-recovery lifetime. Active-delivery uncertainty survives replacement;
queued bytes are discarded and never replayed. Link discovery, Open and Close
must send no terminal bytes or controller mutation. Existing trusted input,
paste/composition, selection/copy and OSC52 suppression retain their owners.

Adjacent unit controls exercise mode propagation, ordinary defaults, privacy,
focus, stale targets and cleanup. The production browser journey uses real
terminal output and actual click/Enter navigation to an owned HTTP destination;
it checks zero input/control requests and unchanged controller revision. Its
optional historical comparison serves exact retained production asset bytes
over the same owned API fixture and labels that limited baseline explicitly.

These browser controls and visuals do not establish system WKWebView, external
NSWorkspace handoff, physical input, vendor authentication or full ALL-348
acceptance. A separately coordinated public native actor must exercise the exact
source/native/engine candidate with supported isolated browser/profile ownership,
verify the real anchor classification and one handoff, and retain document/bridge
and negative-policy evidence. If the real anchor is `.other`, preserve denial
and its evidence for adjudication; do not broaden the navigation policy.
