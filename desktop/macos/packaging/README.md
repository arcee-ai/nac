# Mac package preparation (ALL-355)

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
`Contents/Resources/build-receipt.json`. Admission is pinned to ALL-342's normal
contract nominated at `9f215ec9ac4de198715843564ab0fa923efb217d`: nine selected
Swift sources and actual compiler flags, clean full source revision, LOCAL_APP
and no smoke instrumentation. Every selected source hash must match the current
clean checkout. The original engine, native executable and plist digests must
match the producer receipt; the bundled and executable-reported engine identity
must both match source/product/track/build. Preview definitions must be excluded,
producer marker proof must exist and the actual binary must pass that check.
The exact three build-support files, including `BundleIdentity.sh`, must also
match their recorded hashes. Packaging reuses that producer's read-only track
factory and verifies both the actual plist and producer metadata; it does not
maintain another stable/beta/dev mapping. Unexpected files in the unsigned
native bundle are rejected.

This validates the existing producer JSON format rather than generating another
native build receipt or reconstructing the producer's source selection. Future
qualified native suppliers explicitly extend the admission policy with their
normal sources and flags. ALL-343 supplies the track-derived bundle IDs and app-instance code in the
nominated source. Its actual eight-case AppKit acceptance is separately held.
Package metadata checks do not certify that behavior: `track_bundle_identity`
and `consumer_ready` qualification remain false pending the required integrated
evidence. A label cannot promote preparation into a consumer artifact.
ALL-354 owns full-Xcode actual AppKit/WKWebView evidence. Later lifecycle and
joined normal-app acceptance remain prerequisites for distribution claims.

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
exactly match tracked Git paths before compilation. Ignored files and empty
extra directories in that tree are rejected; legitimate ignored dependencies,
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
Application certificate requirement and exact team, and checks hardened runtime,
secure timestamp and empty entitlements. It retains no personal certificate CN.

Plans carry `execution_authorized: false`. They stage a separate Developer ID
candidate so the ad-hoc preparation and its evidence remain intact. Before any
credentialed execution, require qualified track identifiers, required normal-app
native evidence and explicit authorization for the designated NAC identity and
profile. Planned operation order:

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
