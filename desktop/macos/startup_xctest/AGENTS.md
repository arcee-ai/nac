# Ordinary startup test supplier

Read the root and desktop/macos guides before changes. This directory is a
test-only immutable supplier, excluded from the ordinary app compiler roster.

StartupJourneys.swift owns the complete ordered four-state XCUI journey, its
guard/dispatch fences and diagnostic attachments. Keeping those sites together
explains its current size above 800 lines. Do not split an input from its
before/after guards merely to reduce line count. Pure retained-identity/AX policy
and the private bound witness client have separate canonical owners in
StartupAXGuard.swift and StartupAXReceipt.swift. H compiles those exact files;
never fork their predicate or alter Runner sandboxing to make a test pass.

Source and inert controls do not establish SDK or actual native acceptance.
Keep existing console, geometry, diagnostic and all public XCUI assertions.

The accepted interaction contract permits only the closed private point request
and readonly proof on the existing witness port. Preserve the exact selected
public coordinate, retained CFEqual ancestry, original ticket/freshness and
sticky refusal. Coordinate dynamics retain an accepted last-instant race; never
claim atomic or independently observed delivered-event equality.
