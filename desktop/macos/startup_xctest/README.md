# Ordinary startup XCTest proposal (ALL-342)

Preparation only. `StartupJourneys.swift` is not included in an Xcode target in
this slice. A Swift parser check and pure Python contract tests do not establish
SDK compilation, accessible controls, public input, ordinary app paint, profile
read access, cleanup, or acceptance. The original ALL-342 goal remains blocked.

The acceptance baseline is the unchanged four-state ordinary-app contract
`qualification-contract-ec4.json`, SHA256
`202b13e6491c7bfdfa21667c3f0e14d1977af353b3f4fc070456adc7259ec16d`,
staged with ALL-354. Its source is
`ec4f3a9a8ab2e80d98ff76ca8c536e1e41b413c8`. Use that candidate or a successor
explicitly nominated by root; do not consume a moving branch. Existing
real-vendor evidence remains consumed. These four cases use only a disposable
dummy provider, with no live inference or credential copying.

Root's product nomination is now P
`d443a2aca506def2817b9afc0c9a20a75f5c4b5d`, with an available normal ad-hoc
package. The earlier helper Q was `57b16ef4`, followed by published Q
`1412af562c56edebc63dbf61af849f08e2255b54`. This first path repair requires a
new exact Q nomination before inclusion. H
`a4ec6b17a92dabd28501fa427992528cd3729100` remains an interface reference.
Keep P, Q and eventual H identities distinct; only the four files in this
directory may be supplied from Q, and only the Swift file is a test input.
No Q provider, vendor qualification or app/runtime source is consumed.

## Four states

| Case | Public UI and image | Independent owner assertions |
| --- | --- | --- |
| `onboarding` | Empty shared `No projects yet` workspace | Selected fresh disposable store, no seeded project |
| `configuredLocal` | Get Started, shared project/folder controls, Create Project, Message and Send, visible `Finder configured local response.` | Correct configured dummy preset through Rust owner; project created by UI; exact selected store; Local backend; settled run and persisted reload |
| `invalidConfig` | Native `config.toml`, repair and relaunch guidance; no hittable shared workspace | Invalid owned config; no DB opened or substitute store |
| `futureStore` | Exact root-nominated356 unique native recovery message and ordinary window image; old generic footer fails | Owned SQLite user_version999 main DB and config hashes unchanged, no WAL/SHM, no activation or alternate store; typed serving-startup failure, producer inclusion and cleanup |

Root nominated ALL-356's exact source contract (present in P; actual ordinary
UI remains unqualified): private v1 `kind: failed`, `code: store_schema_incompatible`,
`stage: startup`, with this exact shell-owned visible guidance:

> The selected store uses a newer database schema. Quit NAC and reopen this store with a compatible newer NAC app. Keep your configuration and data; do not delete or downgrade the store. No alternative store was selected.

The public UI actor requires this complete literal in one visible native text
element. It records `exact_unique_message_observed_producer_binding_required`
only after that assertion. Old ec4 source, whose shell appends generic
compatible-version advice to initialization failures, **must fail** this
assertion. Generic guidance is not a substitute, and no unconditional case
success or four-case completion is claimed by this source preparation.

`contract.require_future_recovery` checks a caller-supplied authentic typed v1
record and the extracted unique message. It rejects an old generic failure,
wrong stage, or changed guidance. This pure assertion does not classify logs or
observe the app's private pipe. The public UI actor does not read that pipe,
and its `expected_private_failure` attachment is an expectation, **not** an
observed receipt.354 must bind authentic producer evidence and exact included
producer source/hash to the ordinary app candidate and its observed message.
No duplicate classifier or production change belongs in342.

Normal `__desktop-configuration` must still select the valid configuration and
path without opening SQLite. The typed rejection occurs during identified
serving startup, after store-owned priority. Do not move it into preflight or
invent a preflight schema code. Preserve checks for the main DB/config hashes,
WAL/SHM absence, no workspace activation, no alternate store and exact cleanup
independently of the unique message and image. SDK/source inclusion, generated
runner execution and actual ordinary images remain gates even when this
assertion is syntactically present.

The helper has fixed public XCTest actions, exact URL/hash/receipt and app
incarnation checks, unique foreground/on-screen window checks, and fresh
console checks at input and screenshot boundaries. Console admission ports
H's settled policy: positive root IOConsoleLocked=false, a unique matching
logged-in console UID, Quartz session/on-console/login, at least one display
and a known foreground bundle other than loginwindow. Optional session lock
flags may be absent/null or strictly Boolean false; true, strings, numbers and
other malformed values fail. Absence is retained as null in observations,
never changed to false. Swift uses CFBoolean identity, so NSNumber(0) cannot
masquerade as false. The app PID/incarnation/window/foreground guards remain.
Public `typeText`, `typeKey`, clicks and a window
screenshot establish only the actions actually executed. They do not establish
physical keyboard/IME behavior. Selectors still require actual SDK/AX validation;
absence/ambiguity must fail, with no DOM, private WebKit, coordinate or guessed
element fallback. Blank images require rejection by the actual image reviewer.

## Separate unsigned and post-sign admission

`validate(config, receipt)` retains the original unsigned-declaration behavior
and its eight original regression controls. It must not admit a signed app.
For a normal packaged candidate use:

```python
validate_normal_package(config, manifest_path, clean_product_root,
                        product_sha=P, test_sha=Q, harness_sha=H)
```

This read-only adapter invokes P's existing `package.verify_files`, inventory
and post-sign record validation in an isolated Python process, using `-B` and
the explicitly nominated clean same-repository P checkout. It never launches
the app, engine, native observer, signing command or profile. It requires the
explicit `manifest.post_sign_receipt.phase == ad-hoc-preparation`, full actual
relocated inventory equal to the owner manifest, exact P source/asset identity,
the unchanged embedded unsigned build receipt equal to sealed
`PackageIdentity.native_build_receipt`, the nominated owner compiler/source
rosters and flags, fixture exclusion, all four engine identity fields, and dev
bundle identity. Original owner code/receipt/marker are not rewritten. This
establishes integrity and provenance admission, not signature authenticity or
runtime acceptance.

Config `native_sha256`, `engine_sha256`, and `info_plist_sha256` bind final
post-sign fields. Add separate `manifest_sha256`, `package_identity_sha256`,
`engine_identity_sha256`, `build_receipt_sha256`, full four-field
`engine_identity`, `test_source_sha` (Q) and `harness_sha` (H). `source_sha`
continues to mean P. These digests identify different records/phases and must
not be substituted for one another. H freezes and validates the external
manifest before SDK execution. The public Swift actor checks actual bundle
bytes/config hashes, sealed marker/receipt equality and engine identities;
the external manifest hash is an H-validated binding, not a claim that the UI
actor read an external manifest. Pure inspection without fixture creation is
available as `inspect_normal_package(manifest_path, relocated_app, P_root,
product_sha=P)`.

## Exact integration requirements for ALL-354 after its current freeze

Read-only interface reference: H
`a4ec6b17a92dabd28501fa427992528cd3729100` owns
`NativeUITests/NativeJourneys.swift`, the maintained pbxproj/scheme,
`ci_xctest.py`, `ci_xctest_project.py`, and `ci_xctest_attachments.py`.
None is edited here. No H/T job is requested by these files.

1. Root/354 must allocate actual source inclusion in a real Xcode target. H's
   base project includes only `NativeJourneys.swift`; dropping a Swift file in
   a directory does not compile it. The optional project materializer currently
   supports performance source selection only. Extend maintained ownership
   deliberately after the freeze; do not fabricate a project receipt or
   `.xctestrun`. Record exact H, helper source commit/hash and candidate source.
2. Consume P's owner-built ordinary relocated `NAC.app`, with only
   `LOCAL_APP`, no PREVIEW_SMOKE/INSTANCE_SMOKE or fixture definitions. Record
   full build receipt and actual native/engine/plist/receipt hashes. This helper
   uses the existing `compiler_flags` receipt field and verifies Info.plist's
   actual bundle identifier. Keep unsigned and post-sign admission separate as
   above; the normal P package does have a bundle identifier in its receipt.
3. A host-side fixture owner prepares one unique canonical
   `nac342-xctest-*` root per case, containing `Moved app folder with spaces/NAC.app`,
   `home with spaces/selected nac`, and `workspace with spaces`. Prepare the
   configured dummy model through existing hardened Rust settings owners and
   stop the preparation engine before app launch. Seed no project. Queue the
   H-owned wrapper around H's existing shared ScriptedProvider with step
   `startup-home`; expected prompt is `FINDER_CONFIGURED_LOCAL_startup-home`
   and response `Finder configured local response.`. Consume no Q runtime
   payload outside these four files. Keep catalog/provider listening only
   on owned ephemeral loopback ports. Never infer API authority from a port.
4. Use `contract.validate_normal_package` for packaged admission. Supply fields shown
   in `test_contract.fixture()`, with real paths/hashes. These examples are
   synthetic unit data, not a runnable config, plus the distinct package/source
   fields documented above. `startup_source_sha256` binds
   this helper's source and must match actual source inclusion in the generated
   runner receipt. Bind configuration bytes/hash to that runner and test ID
   `StartupJourneys/testOrdinaryStartup`; never mutate the config after build.
5. Make the config available through the existing `NAC_UI_FIXTURE` build
   setting/scheme route only after verifying that exact runner actor/path can
   read it and the bundle. Prior harness-actor JSON access is not arbitrary
   normal-profile access. The Swift actor reads configuration and bundle
   provenance only, never the normal profile/store or an app-written result.
   No runner-to-app file writes, app output handshake, AppleScript, permission
   requests, private WebKit APIs, or host defaults/TCC changes are used.
6. Public `XCUIApplication.launchEnvironment` augments launcher inheritance.
   ALL-354 must sanitize the test launch environment, demonstrate resulting
   child HOME/NAC_HOME/command environment, and preserve required Xcode runtime
   variables. The test refuses inherited `*_API_KEY`, `*_TOKEN` or
   NAC_MANAGED_CONFIG. Its exact child overrides are the allowlist enforced by
   `contract.py`; no real provider secrets are needed. Config strings alone
   are not proof of effective child isolation.
7. Capture before/after persistent authorization policy using354's existing
   observations; never provision permission. Observe usable unlocked Aqua
   before/after and at each guarded action using the established positive
   policy above. Preserve optional absent lock observations as null; missing
   positive root/session/display/foreground observations remain gates. Do not
   attempt a local GUI run on this locked host.
8. Use `xcodebuild build-for-testing` and its single real generated runner,
   then `test-without-building`, serialized on an admitted Mac runner. Verify
   source inclusion, real result bundle and test success/failure. Swift parse
   does not typecheck XCTest/SDK interfaces. Do not report an unexecuted test
   or uncollected image as accepted.
9. Extend354's public attachment collector for this helper's distinct schemas.
   Current352 dispatch extraction is not a startup collector. Export actual
   PNG/JSON attachments from the real xcresult; bind selected test identifier,
   generated runner/config/helper/candidate hashes and result tree hash.
   Check each before/after operation pair, app PID/launch epoch/window number,
   image SHA256 and exact ordinary compile mode. Inspect actual images; only
   then record visual review. Preserve bounded redacted failure exports too.
10. Cleanup uses public XCTest terminate only after exact incarnation recheck.
    A `nac342-cleanup-v1` attachment reports app termination, never engine or
    profile success.354 must independently verify exact bundled engine/worker
    ancestry and settlement, no fallback DB and profile cleanup. Preserve
    bundle/profile on unknown ownership or cleanup failure; no fallback signal
    learned only from a JSON PID. Enforce existing13s preflight/25s normal
    engine bounds and retain failure evidence. No fixed port/process adoption.

Public attachment names are `nac342-dispatch-v1-NN-before/after`,
`nac342-ordinary-<case>` (PNG), `nac342-ordinary-v1-<case>` (JSON), and
`nac342-cleanup-v1-<case>`. The final observation says
`visible_paint: requires_actual_image_review`; it is not a pass receipt.

## Physical declarations and observed URLs

H owns frozen absolute, lexical, POSIX-physical fixture declarations. The
root must be an existing directory named `nac342-xctest-*`; its exact app layout
is `Moved app folder with spaces/NAC.app`. `StartupPaths` requires declared
root/app/native paths to equal `realpath`, rejects symlink declarations and
wrong types, and pins device/inode/type for subsequent resource witnesses.
The six bundle members retain their byte hashes and now also require existing
physical regular files. Receipt, PackageIdentity, source and engine checks stay
in the ordinary admission path.

Foundation may display `/private/var/...` as `/var/...`. Observed file URLs
must resolve to the pinned physical resource; display spelling alone supplies
no identity. The actor uses this comparison for pre-launch admission, running
app selection, incarnation, window guards and cleanup. Attachments emit the
admitted physical declaration. Profile fields use bounded absolute lexical
component containment only, without profile/store filesystem access. H retains
profile no-follow, integrity, environment and process-ownership obligations.
A failed root/app admission retains bounded declared/physical path diagnostics
and the configuration digest, with no environment or profile content.

The first hosted attempt at Q1412 (run41223240327/job124602097842) failed before
`ui.launch()` at the compound URL guard. Its operands were not retained. An
owned local Foundation probe reproduces the spelling defect, but does not
prove the hosted cause. Preserve Q1412, interface erratum SHA256
`d30aa21b7b648912db9ca4df4356e132fd2740ceaf73a29f6659fdaec2bb0d0e`
and the original failed 53-file episode as historical evidence. No UI state gained
qualification; launch/input/PNG remain uncaptured and input completion unknown.
This repair is local source preparation pending the same bounded affected
review, root nomination and H's matching observer/source-hash update.

## Local preparation checks

```sh
NAC342_PRODUCT_SOURCE_ROOT=<clean-exact-P-checkout> NAC342_SWIFT_POLICY_PROOF=1 NAC342_SWIFT_PATH_PROOF=1 \
  python3 -B -m unittest discover -s desktop/macos/startup_xctest -p 'test_*.py' -v
swiftc -frontend -parse desktop/macos/startup_xctest/StartupJourneys.swift
```

On the shared host run the unit command under the existing browser/build lease
because the opt-in Swift proof compiles a tiny Foundation-only CLI. It extracts
the exact production `StartupConsolePolicy` source block from this helper and
runs the same31 supplied fixture observations as Python and immutable H's
existing policy, including omitted/false/true/malformed flags and missing
positive observations. The path proof extracts the actual `StartupPaths`
block and exercises physical declarations, verified `/var` URL observations,
spaces, emitted paths, missing/wrong-type resources, lexical/containment/layout
failures, declared symlinks and same-path resource replacement. Its temporary
files are inert fixtures; missing profile/store leaves are never inspected.
These proofs perform no live console observation or GUI action.
The normal package tests use tiny synthetic non-executable artifacts and P's
real owner validator; they require the separate nominated P checkout. Missing
P or either Swift opt-in is an explicit skipped proof, not a passing substitute.

No new dependency, workflow, SDK install, app/engine change, project generation,
PR publication, actual UI execution, or live-provider request is performed by
these commands. Current-head readiness and ordinary four-state qualification
remain outstanding until root/354 completes the actual integration and evidence.
