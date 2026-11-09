# Mac package preparation (ALL-355)

This source owner is carried onto exact Native source
`0949c09d43974343913c2ae165a6e25f4b47d34d` (immediate base
`85252cebd4496e5197afb8a1966e5d59fc13b7bd`, landed dev
`f27b5b4a92b38567580a1a43576137bf5b436f95`). Only the fourteen packaging
files come from reviewed P12 donor `4b7a1f3e0bf6175a77c5ebf627fe965860e99976`;
the donor's integration tree, builder, assets, controllers, binaries and receipts
are not carried. The normal39/3-support roster and LOCAL_APP flags remain exact,
but current source/support/asset hashes must be freshly bound. Normal admission
now requires the canonical writer's exact seventeen fixture exclusions.

This is source integration only. P12's one consumed actual attempt/zero retries
and all earlier evidence remain historical at their original source/scope. No
current producer, CI, native runtime, signing or distribution acceptance is
established by this carry; the actual clean packaging child, never this parent
or an old donor SHA, must bind any separately admitted future artifact.

The outer package writer reuses `desktop/macos/preview.sh`, the locked `nac-web`
build, root `version.txt`, existing engine identity and committed embedded web
assets. It builds no second frontend or native client. `fixture` packages the
disposable preview. `normal` consumes the corrected ALL-342 normal-app builder
and its actual compiler-output receipt. Both produce **ad-hoc preparation**,
with consumer readiness and distribution qualification explicitly withheld.

After `make setup`, commit a clean candidate. Commands reject dirty tracked or
untracked source, mismatched private engine receipts and existing output paths.
Build prerequisites are Apple Silicon macOS, Rust/Cargo, an Apple Swift SDK and
Python 3.10+. Use fresh output paths; failures are retained:

```sh
python3 -B desktop/macos/packaging/package.py prepare-engine \
  --output /tmp/nac-package-engine

python3 -B desktop/macos/packaging/package.py normal \
  --engine-receipt /tmp/nac-package-engine/engine-build.json \
  --output /tmp/nac-package-normal

python3 -B desktop/macos/packaging/package.py verify \
  /tmp/nac-package-normal/manifest.json --signatures

python3 -B desktop/macos/packaging/package.py relocate-check \
  --manifest /tmp/nac-package-normal/manifest.json \
  --output /tmp/nac-package-relocation
```

On a shared host, build/package execution requires the coordinator's current
exact-source allocation and resource gates. This source milestone authorizes
only setup and portable controls; the command interfaces above do not grant a
producer or native-runtime run. Compilation, private engine copying and hashing
must finish inside the admitted Rust lease; later phases consume only that
private copy, never a released shared cache. No historical temporary gate path
or old allocation is a current admission.

`prepare-engine --track` accepts the engine's existing `dev`, `beta`, or `stable`
values. It binds full `__desktop-identity` and version output to the exact clean
source. Track selection does not authorize release/channel publication. To test
the explicitly disposable preview instead, use `fixture` in place of `normal`
with a different output directory. Both can reuse the same private engine.

## Exact-source normal admission

`normal` invokes the sole native builder's `app-build` mode and consumes its
`Contents/Resources/build-receipt.json`. Current Native parent0949c09d supplies
the same closed39 source roster and exact LOCAL_APP/UserNotifications flags as
the reviewed P12 donor. The carry adds only this packaging owner and its precise
current fixture-exclusion admission; it changes no builder, track factory,
lifecycle, generated outputs or test actor. BundleIdentity.sh is byte-identical
to the donor, while preview.sh/build_receipt.py and selected source hashes have
advanced. All actual hashes must come from the resulting clean full child.

The current writer excludes the five offline fixture Swift sources from
LOCAL_APP and emits exactly seventeen marker exclusions: the original eleven
plus offline-dummy-local-only, OfflineProviderPolicy, OfflineNetworkFence,
OfflineWebProbe, OfflineProviderSmoke and OfflineHTTPControlTarget. The package
adapter requires that exact ordered proof and checks all seventeen against the
actual binary. Old eleven-item, missing, extra, duplicate or reordered proofs
are rejected. It has no historical-roster, discovered-source or marker fallback.
Existing portable controls also reject each offline fixture source from the
closed normal39 roster.

Historical nine-,22- and28-source nominations, P11 and P12 producers, and old
parent/asset/hash evidence retain their original identity. They cannot establish
current artifact acceptance. A separately admitted producer must begin with a
clean committed packaging child and bind its actual full revision/tree, root
version, source schema, assets and private engine identity. No future/self SHA is
predicted here.

Every selected source hash must match the current clean full source revision.
Normal startup must be true and smoke, instance-smoke, lifecycle-smoke and
attention-smoke instrumentation must each be literal false. The original engine, native executable
and plist digests must match the producer receipt; bundled and executable-reported
engine identities must match source/product/track/build. The producer's exact seventeen
fixture-marker exclusion proof and the actual binary must both pass. The exact
three build-support files, including current `preview.sh`, must match their
recorded current hashes. Packaging reuses `BundleIdentity.sh`'s read-only track
factory and verifies both actual plist and producer metadata; it does not maintain
another stable/beta/dev mapping. The unsigned native bundle retains its closed
five-file layout. Arbitrary additions, historical nine-, 22- or 28-source receipts, missing
normal inputs and fixture/smoke sources are rejected.

This validates the existing schema-1 producer JSON rather than writing another
native receipt or selecting compiler inputs. The sealed PackageIdentity schema
and four-field engine identity remain unchanged. Later qualified native suppliers
must explicitly extend admission and refresh the actual final source/support
inventory before package qualification. The current foundation may gain separately
owned fixes; this preparation does not freeze their future source hashes.
ALL-343 supplies track-derived bundle IDs and app-instance code, with its actual
eight-case AppKit acceptance separately held. Package metadata checks do not certify
that behavior: `track_bundle_identity` and `consumer_ready` remain false pending
integrated evidence. ALL-354 owns full-Xcode actual AppKit/WKWebView evidence.
Lifecycle, storage and joined normal-app runtime acceptance remain prerequisites
for distribution claims. No historical binary or receipt can be relabeled for a
new full source revision.

## Artifacts and checks

Outputs are `.app`, ZIP download container and `manifest.json`. Embedded
`PackageIdentity.json` binds commit/tree, root product version, engine identity,
source schema, complete asset inventory, native builder hash, private engine
input, exact SDK/toolchain/OS and declared minimum OS. Normal output also retains
the actual producer receipt. The outer manifest inventories every final signed
file, executable mode, shell/engine and ZIP digest. Original unsigned/input
hashes and final signed hashes are both retained because signing changes bytes.
Root LICENSE and existing embedded frontend notices are copied before sealing.
Hashes establish integrity, not publisher authentication or human source review.
The entire Rust `include_dir!` input tree (`crates/nac-server/assets/`) must
exactly match tracked Git paths before compilation. Ignored files, symlinks
anywhere in the embedded root, and empty extra directories are rejected; legitimate ignored dependencies,
build caches and unrelated local configuration outside it are unaffected.

The outer manifest also contains a post-signing preparation receipt. It binds
the actual post-sign engine identity, root versions, producer track/name metadata
and final engine/native/plist digests to the signature evidence. It remains
outside the sealed app; the existing `PackageIdentity.json` schema-1 marker and
its `engine_identity` interface are unchanged for ALL-356. Its `engine_input`
digest describes the pre-sign engine, while the outer receipt records signed
bytes. File inventories retain all Unix permission mode bits.

The nested engine is signed before the outer app, with hardened runtime and no
entitlements. Each object is individually verified; recursive verification is
also required. `--deep` is never used to sign. Do not copy App Store sandbox
inheritance, debugging, JIT or disabled-library-validation entitlements from a
remote Swift client. Changing this policy requires a demonstrated normal-app
requirement and review.

The native owner currently resolves its engine at
`Contents/Resources/nac-web`. Packaging preserves that nominated layout and
verifies both the executable signature and its outer resource seal. It never
replaces that nested executable in a sealed app. Whole-app replacement is
ALL-356's scope; it can consume the version/source/track/build/schema/assets and
complete bundle/container inventory interface.

`relocate-check` extracts into a newly owned path with spaces, compares all bytes
and modes, verifies signatures and runs the relocated engine's version and full
identity commands. It opens no UI or store. It proves archive/resource integrity,
not Finder startup, Gatekeeper, quarantine, Applications installation,
translocation or minimum-OS compatibility. Those qualification fields remain
false. macOS 14 is the declared compiler/plist candidate minimum; actual matching
OS evidence is still required.

The `.app` contains compiled Swift/Rust and embedded React assets. Opening its
UI requires no user-installed Swift/Rust/Node/Go compiler. `otool` checks reject
non-system linked dependencies. The Python runner and build tools are not copied
into the app. Git, SSH, optional Podman and configured MCP commands remain genuine
project prerequisites, detected/explained by the startup owners and never
silently installed by packaging.

## Continuous ad-hoc preparation

The fourteen-file source carry at `c60c808f7cb0629f3900e038592dcfd7b951f1c4`
installed no workflow. The following CI contribution adapts the originally
reviewed `.github/workflows/macos-package.yml` from package PR #501 source
`1b23d9062d29c08700efd4f899484ebedf808c01`. It uses current approved pinned
actions and read-only Contents permissions. It is a separate preparation lane;
`stable-release.yml`, its checks, tags and publication policy remain unchanged.

The workflow selects the exact `github.sha` checkout on relevant PR changes or
an explicit manual invocation. PR source is the full GitHub merge candidate,
not a head-only substitute. Engine/core/asset/native/version/lock and lane-control
changes are included in its path selection. A fresh checkout runs `make setup`
with locked dependencies before controls or compilation; setup installs build
dependencies without rebuilding committed frontend/server/client outputs.
The runner uses the existing macos-26 / Xcode 26.6 selection. Source-only local
verification of this contribution does not authorize publishing it, dispatching
it or running a producer. Root must admit exact-source actual qualification
separately before a source publication can trigger the lane.

Compiler and verification roles are explicit:

| Phase | Selected owner and role |
| --- | --- |
| Engine | One `package.py prepare-engine --track dev` call: one locked release arm64 engine build, private copy and full-source/assets/schema/build receipt. |
| Shell | One `package.py normal` call: the sole `preview.sh app-build` writer, closed39 LOCAL_APP sources, three support inputs and exact17 proof/binary exclusions. No preview, provider, lifecycle or helper compiler role is selected. |
| Integrity | `verify --signatures`, then `relocate-check`: strict ad-hoc engine/app signatures, complete ZIP inventory and extracted bytes/modes in a new path with spaces. |

The current stable macOS job uploads `nac-aarch64-apple-darwin.tar.gz` containing
only `nac-web` and LICENSE. It exposes no `engine-build.json` with the package
owner's full clean-source/tree/assets/schema/toolchain and deployment-target
contract, and this independent workflow has no same-run receipt transfer port.
Consequently this dedicated preparation job needs its one engine build. It
does not fetch a latest/cross-run binary, synthesize missing provenance or build
a second frontend. A future joined lane can reuse an engine when that exact-source
receipt interface exists; it must not infer qualification from a cache hit.
The existing Rust cache is read-only in this PR/manual lane.

The approved upload-artifact action retains
`mac-package-adhoc-preparation-<full source SHA>` for seven days: the normal ZIP,
schema-1 manifest with embedded source and post-sign facts, private engine build
receipt, relocation receipt and bounded command logs. The inner ZIP preserves
the app's executable modes; the outer GHA evidence container is not an install
claim. Failure logs and any completed receipts are retained through `always()`;
explicit Bash pipefail keeps pipeline errors fatal. The private unsigned engine and extracted
duplicate app are not additional download artifacts.

No normal app/WKWebView is launched. Only the engine's bounded version/identity
commands execute; no server, profile, provider, E2E or GUI/AX interaction is
selected. Signing is ad-hoc only, with no keychain/certificate/account/notary
inputs. All consumer/distribution/runtime qualification fields remain false.
CI source and inert boundary controls are reviewable without credentials;
current hosted producer success and all distribution gates remain unqualified.
Historical producer/controller runs retain only their original source scope.

## Credentialed distribution gate

`distribution-plan` writes reviewable command arrays for a normal preparation;
it executes none. Supply only the maintainer's explicitly designated NAC
Developer ID Application certificate SHA-1, Team ID and existing notary profile:

```sh
python3 -B desktop/macos/packaging/package.py distribution-plan \
  --manifest /tmp/nac-package-normal/manifest.json \
  --certificate "$NAC_AUTHORIZED_CERT_SHA1" --team "$NAC_AUTHORIZED_TEAM_ID" \
  --notary-profile "$NAC_AUTHORIZED_NOTARY_PROFILE" --output /tmp/nac-signing-plan
```

Do all secret-free preparation before requesting authorization for the exact
source, artifact, identity/profile and commands. Machine credential presence is
not selection authority. No identity/profile is discovered or installed here;
no certificate, keychain or signing-account setup occurs. Current preparation
has no actual Developer ID/notary acceptance. The signing planner requires an
explicit certificate fingerprint and team, verifies Apple's Developer ID
Application certificate requirement, exact team and selected leaf certificate
SHA-1, and checks hardened runtime, secure timestamp and empty entitlements.
It retains no personal certificate CN. Same-team certificate renewal requires
explicit selection of its new fingerprint; it cannot satisfy an older pin.

Plans carry `execution_authorized: false`. They stage a separate Developer ID
candidate so the ad-hoc preparation and its evidence remain intact. Before any
credentialed execution, require qualified track identifiers, required normal-app
native evidence and explicit authorization for the designated NAC identity and
profile. The plan lists the exact detail/entitlement inspection argv and inserts
`verify-developer-id` as the first notary stage. This read-only CLI runs the
cryptographic/team checks and feeds both objects' actual detail/entitlement
outputs into `signature_evidence`; hardened runtime, a secure timestamp and
empty entitlements must all pass before it writes `signature-evidence.json`.
The plan requires that successful gate before creating or submitting a notary
archive. Verification neither signs nor accesses signing/notary credentials;
synthetic positive parser tests are not real Developer ID qualification.
Planned operation order:

1. Sign leaves inside out with the authorized certificate and
   `--options runtime --timestamp`, then the outer app. Verify each object,
   expected Team ID/certificate requirement and entitlements, then the whole app.
2. Submit a ZIP through `notarytool --keychain-profile … --wait`, retaining its
   exact submitted digest, successful tool result, submission ID and log. Require
   `Accepted`; synthetic parser tests are not Apple receipts.
3. Staple the accepted `.app`, validate its ticket and assess it with Gatekeeper.
   A ZIP cannot be stapled. Create a **new** final ZIP from the stapled app and
   regenerate final bundle/container digests.
4. Test the actual quarantined download through LaunchServices and a new owned
   disposable Applications test location, including spaces, observed
   translocation when applicable, bundle resources, UI/engine identity, lifecycle
   and descendant cleanup. Never overwrite a user app or change Gatekeeper,
   quarantine, SIP, TCC, privacy or global system settings.

Developer ID, notarization, stapling, Gatekeeper, download/quarantine,
Applications, translocation and actual packaged normal-app acceptance require
their own real artifact/environment receipts. Ad-hoc success substitutes for
none of them. Missing authorized signing inputs block distribution acceptance
while allowing secret-free preparation.

Apple primary references:

- [Creating distribution-signed code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac)
- [Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/)
- [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Packaging Mac software](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Inside Code Signing: Requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)
- [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)

Portable boundary tests:

```sh
python3 -B -m unittest discover -s desktop/macos/packaging -p 'test_*.py' -v
```

## Separate canonical lifecycle fixture

For a separately reviewed and admitted build, `package.py lifecycle-build
--engine-receipt ENGINE/engine-build.json --output NEW_FIXTURE_ROOT` invokes the
existing preview.sh lifecycle-build once. This compiles41 Swift inputs (normal39
plus LifecycleSmoke and RecoverySmoke), using exact normal flags plus
PREVIEW_SMOKE/LIFECYCLE_SMOKE. The canonical builder also compiles its existing
InstanceObservation helper with AppKit. No second Rust engine is built.

The maintained lifecycle runner checks the original unsigned build-receipt's
engine/native hashes against actual bytes; the typed fixture validator also
checks the original plist hash. Therefore this role deliberately
retains canonical compiler output: no outer packaging signature, plist rewrite,
PackageIdentity insertion or original receipt rewrite. Compiler/linker signatures
are not represented as verified packaging signatures. The normal app still uses
the unchanged ad-hoc nested/outer signature path and13-file inventory. A distinct
`canonical-lifecycle-fixture-v1` manifest seals full source/tree/assets/schema,
engine input/build identity, original native receipt,41+3 input hashes, exact
three maintained journey postimages, observer source/flags/digest/mode and declared
signature role. All runtime, signature, minimumOS and distribution qualification
fields stay false/null. This is an instrumented fixture, not a consumer package.

`NAC-lifecycle-fixture-arm64.zip` has exactly six regular entries: the original
five-file `NAC Lifecycle Smoke.app` and `InstanceObservation`. No runner/source,
expanded normal app, profile, compiler/cache or provider state is included.
`package.py verify-lifecycle FIXTURE/manifest.json` checks every original file,
mode, unsigned receipt, archive CRC/hash/layout and bounded sizes without launching
anything. ZIP bounds are128MiB compressed/256MiB expanded, observer16MiB and
manifest256KiB; duplicate/case/escape/symlink/special/encrypted entries fail.
Extract only after digest/strict layout admission, into an absent private path,
preserving0755/0644 modes. The original manifest and ZIP must remain unedited.

The carried normal_snapshot/verify_role_pair helpers require a BEFORE snapshot
of sealed normal manifest/ZIP/all bundle files and private inode identities,
then equality afterward and independent regular files across both roles. A
future separately admitted controller must use those existing ports. Historical
P12 did so at its own exact source; its controller is not included in this carry.
Both roles bind the same original private engine receipt. No hardlink/shared
signing mutation may alter the sealed normal package. Current-source validation
and separate strict normal admission remain mandatory.

No runtime actor is selected by this source integration. Later Root briefs must
name every selected compiler role: canonical Rust engine, normal Swift,
lifecycle Swift and canonical InstanceObservation. Any Foundation configuration
resolver, external observer/AX helper, generated XCTest build-for-testing,
independent R build/protocol and native/runtime actor require their own explicit
current source/schema/identity nomination and admission. Historical R or
onboarding-only evidence is not a current full-source or full-startup gate.
No current SDK, G3/minimized, provider, renderer recovery, OS Quit, signing,
minimum-OS, quarantine/install/translocation or distribution acceptance follows
from portable source controls.
