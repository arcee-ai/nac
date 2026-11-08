# Mac package preparation (ALL-355)

Current private P12 is a NEVERMERGE test integration of exact Native
`8685729343c0ab806a9ab9cbdb5b6bf72e0c522c` and landed CAN658 dev
`04c22a7fa1e06a72219f59f37e811813cf64cd98`, join
`64df258aeb54093cdc5c410aede25f8c4d2e6aea`. The join differs from Native only
by CAN658's test delta; existing P11 eleven-file packaging carry is preserved.
All42 normal inputs and83 assets remain P11-exact. The three current maintained
lifecycle fixture postimages are inherited from Native8685 without edits.
Old P10/P11 artifacts and runtime evidence retain their original source/scope;
none may be retagged to this integration. This is source preparation only.

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

On the shared development host, prefix the first command with its supplied
`python3 /tmp/nac-35-01a18fbf/gate.py rust` lease; prefix native package and
relocation commands with `python3 /tmp/nac-35-01a18fbf/gate.py browser`.
Compilation, private engine copying and hashing finish inside the Rust lease.
Later phases consume only that private copy, never a released shared cache.
On a dedicated host the commands above run directly.

`prepare-engine --track` accepts the engine's existing `dev`, `beta`, or `stable`
values. It binds full `__desktop-identity` and version output to the exact clean
source. Track selection does not authorize release/channel publication. To test
the explicitly disposable preview instead, use `fixture` in place of `normal`
with a different output directory. Both can reuse the same private engine.

## Exact-source normal admission

`normal` invokes the sole native builder's `app-build` mode and consumes its
`Contents/Resources/build-receipt.json`. The original startup-Q carry used
Native snapshot `7013a96f2f2fdf3046c6976e018c9bf988eebfe0`. The post-OAuth
integration uses Native parent `84c25942f848eccdfa8e7c60c9bcaa37133e418a`
on landed dev `4b852f065e2200f46c194b4ad2c5ace3fbd766a8`. Its canonical normal
builder supplies the same closed39 receipt contract. The carry adds only the
existing packaging owner; it does not import an old product tree or change the
builder, track factory, lifecycle, generated web outputs or test actor.
The parent includes the reviewed startup error guidance and Q1 draft-classification
corrections. Earlier package `6c578a2` and failed hosted producer01 retain their
original identities and cannot qualify this candidate.
The resulting packaging child must be clean and committed before preparation.
Its actual full source SHA/tree binds engine, native output, package identity
and post-sign manifest; neither this parent nor an old package SHA may be used
as a source override. This is source preparation, not a build/runtime nomination.
Current generated inputs are inherited from that exact parent; actual drift and
tracked-input checks remain required before producer admission.
Prior ec69215d/ff289b0b closed39, f2539dd/normal28, 4cbaf624/H584a6aa1,
finalS 1f8bf49e and supplier 6c74dc2d evidence retains its original identity.
Admission selects exactly 39 normal Swift source paths and exact LOCAL_APP/UserNotifications
compiler flags. It accepts one exact current set, with no historical-roster
or discovered-source fallback. The original nine-source nomination at `9f215ec9`, the prior
`1a0c7c35` source policy and `ddf4c643` artifacts retain their historical identities.
Their source tests, compilation and artifacts are not new-candidate evidence.

Every selected source hash must match the current clean full source revision.
Normal startup must be true and smoke, instance-smoke, lifecycle-smoke and
attention-smoke instrumentation must each be literal false. The original engine, native executable
and plist digests must match the producer receipt; bundled and executable-reported
engine identities must match source/product/track/build. The producer's exact eleven
fixture-marker exclusion proof and the actual binary must both pass. The exact
three build-support files, including the combined-S `preview.sh`, must match their
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

`macos-package.yml` builds the engine once, packages preview and normal modes
through the same native owner, and uploads only preparation receipts/manifests.
It has contents-read permission and no signing secrets, notarization or release
publication. Ordinary stable publication/tag policy is unchanged. A joined stable
lane should consume its existing macOS engine artifact rather than add another
engine/frontend build.

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

## Separate canonical lifecycle fixture (private P12)

For a separately reviewed and admitted build, `package.py lifecycle-build
--engine-receipt ENGINE/engine-build.json --output NEW_FIXTURE_ROOT` invokes the
existing preview.sh lifecycle-build once. This compiles41 Swift inputs (normal39
plus LifecycleSmoke and RecoverySmoke), using exact normal flags plus
PREVIEW_SMOKE/LIFECYCLE_SMOKE. The canonical builder also compiles its existing
InstanceObservation helper with AppKit. No second Rust engine is built.

The maintained lifecycle runner checks the original unsigned build-receipt's
engine/native/plist hashes against actual bytes. Therefore this role deliberately
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

The hosted controller snapshots the sealed normal manifest/ZIP/all bundle files
BEFORE fixture production, then requires equality afterward and independent
regular-file inodes across both roles. Both roles bind the same original private
engine receipt. No hardlink/shared signing mutation may alter the sealed normal
package. Current-source validation and strict normal Q admission remain mandatory.

P12 source adds no actual runtime actor. Later Root briefs must explicitly name
all selected compiler roles: canonical Rust engine, normal Swift, lifecycle Swift,
canonical InstanceObservation; any separately selected H Foundation configuration
resolver (inherited45s compile), external observer/AX helper, generated XCTest
build-for-testing and independent R compilation must be separately declared and
admitted. This producer selects none of the latter roles and executes no
configuration resolver, lifecycle runner, app, OS Quit, AX or SDK case. R
`7325c48b3c9ec7036e255a6bd92f31c1a98c1607` is provenance only here; future full-source
R/P/manifest schema checks and actual independent R protocol evidence remain
required. No onboarding-only wrapper can establish full startup/all-four evidence.
