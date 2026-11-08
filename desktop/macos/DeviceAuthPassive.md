# Passive device-auth observation

`DeviceAuthSmoke.swift` accepts exactly `device-external-xctest` as a passive
scenario, only in the existing `NATIVE_AUTH_FIXTURE && LOCAL_APP && PREVIEW_SMOKE`
auth build. The seven existing device scenarios keep their DOM-driven behavior.
An unknown scenario is refused before entering that driver. The ordinary app
builders continue to exclude this file and the marked engine.

The passive scenario uses the existing `PreviewApp` start and actual-stop hooks.
It never evaluates JavaScript, makes an HTTP request, invokes an opener, answers
an approval, changes auth state, or requests termination. A future separately
owned public XCTest actor must perform every visible UI action and native Quit.
No actor, collector, browser launch or hosted job is supplied by this unit.

Its finite JSON snapshot uses `nac348-passive-device-v1`. Readiness means only
that the marked dev engine has a verified current document. The observer pins
all four engine identity fields, PID, receipt version/schema, incarnation,
endpoint, store and document/view binding. It emits bounded identity and binding
facts, without the store path, auth URLs, codes, state, tokens or native failure
text. `passed` stays false: readiness is never sign-in or journey acceptance.
The `observer_*_issued`/`observer_*_invoked` facts describe this observer only;
they make no assertion about input or operations performed by the external actor.

The initial readiness deadline is 35 seconds on the monotonic clock. A first
valid binding arriving on an expired sample is refused before adoption. After
readiness, any missing or changed receipt/PID/document fails the observation;
the observer does not adopt a replacement or reload. An ordinary native stop
first moves it to stopping. The existing actual-stop callback cancels sampling
and reports whether the engine PID/receipt and command binding have retired.
That callback does not establish profile removal or browser cleanup. Failures
are sticky and are never cleared by a later ready or stop observation.

Only changed facts are written, with an atomic replacement of the same bounded
snapshot. There is no event log or command input. Missing output fails the
passive observer with a fixed diagnostic and never falls back to the active
driver or quits the app. Write/collection failure cannot establish acceptance;
the future collector must reject missing, stale, incomplete or mismatched data.

`DeviceAuthSmokeTests.swift` exercises actual native observation state as a CLI
control. It covers exact scenario selection, missing output, late readiness,
ordinary/wrong-track engines, stale source/build/version/schema/endpoint/store,
PID replacement, document reload/loss, native failure, normal stop and incomplete
retirement. It creates no AppKit app, window, WebView, child engine or browser.
The full auth module must also typecheck with its actual builder source list.

Source controls do not qualify an actual app/system-WK journey, default-browser
handoff, profile isolation, public input, auth outcomes or full ALL-348. A new
coherent candidate has a new source identity; it is not the earlier `88ae64f1`
recording binary. That recording's partial outcome and original counterexample
remain separate evidence. Auth actor/collector ownership, exact SDK collection,
fresh hosted browser/profile/permissions proof and a new native admission remain
required before any actual auth journey.
