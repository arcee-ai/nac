# Mac package preparation (ALL-355)

This is the outer package writer. It reuses `desktop/macos/preview.sh`, the
ordinary locked `nac-web` build, root `version.txt`, existing compile-time build
identity and committed embedded web assets. It does not rebuild the frontend.
The current output is an **ad-hoc development-preview fixture**, containing the
disposable profile/provider. It is not a consumer app or a release candidate.
There is deliberately no command here that signs with a personal identity,
submits software to Apple, changes credentials or publishes a release.

After `make setup`, commit a clean candidate first. Both phases reject dirty
tracked or untracked source, mismatched engine receipts and existing output
paths. Run the following on Apple Silicon macOS, with Rust/Cargo and Apple Swift
SDK build prerequisites. Use fresh output paths on every attempt; failed outputs
are retained. On the shared host, use its supplied FIFO lease wrapper:

```sh
python3 /tmp/nac-35-01a18fbf/gate.py rust \
  python3 -B desktop/macos/packaging/package.py prepare-engine \
  --output /tmp/nac-package-engine

python3 /tmp/nac-35-01a18fbf/gate.py browser \
  python3 -B desktop/macos/packaging/package.py fixture \
  --engine-receipt /tmp/nac-package-engine/engine-build.json \
  --output /tmp/nac-package-fixture

python3 -B desktop/macos/packaging/package.py verify \
  /tmp/nac-package-fixture/manifest.json --signatures

python3 /tmp/nac-35-01a18fbf/gate.py browser \
  python3 -B desktop/macos/packaging/package.py relocate-check \
  --manifest /tmp/nac-package-fixture/manifest.json \
  --output /tmp/nac-package-relocation
```

On a dedicated host, invoke the Python commands directly. The Rust lease owns
compilation and the private binary copy/digest. After it exits, the native phase
uses only that private copy; it never reads a released shared Cargo cache.
`prepare-engine --track` accepts the engine's existing `dev`, `beta`, or `stable`
values; this is build identity, not release authorization or channel publication.
The fixture bundle identifier remains the existing isolated preview identifier.

Outputs are `.app`, ZIP download container and `manifest.json`. The embedded
`Contents/Resources/PackageIdentity.json` binds the source commit/tree, product
version, engine track/build, source schema, asset inventory, builder hash,
input engine digest, exact SDK/toolchain/OS and declared minimum OS. The outer
manifest inventories every final signed file, executable mode, shell/engine
binary and ZIP digest. The engine input and signed engine digests differ because
signing changes executable bytes; both are retained. Existing root LICENSE and
embedded frontend notices are copied before sealing. Manifest hashes establish
integrity, not publisher authentication or a human source-review attestation.

The signing order is engine leaf, then app bundle, with hardened runtime and no
entitlements. Every code object is individually verified, entitlements must be
empty, and the outer bundle is also recursively verified. `--deep` is used only
for verification. Do not add sandbox inheritance, `get-task-allow`, disabled
library validation, JIT or unsigned-executable-memory entitlements from a remote
Swift client; a demonstrated requirement needs separate review.

The archive round trip extracts into a newly owned path with spaces, compares
all bytes/modes and verifies signatures and the bundled engine's version. It
never opens the UI or a user store. It does not test app translocation, Finder
startup, Gatekeeper, installation or minimum-OS compatibility. The fixture
manifest explicitly marks each of those acceptance fields false. The compiler
target and plist currently declare macOS 14; that is a candidate minimum and
requires actual matching-OS evidence before qualification.

The ordinary `.app` includes compiled Swift, Rust and embedded React assets;
opening its UI needs no user-installed Swift/Rust/Node/Go compiler. `otool` checks
reject non-system linked dependencies. Build tools and this Python packaging
runner are not copied into the bundle. Genuine project tools remain external:
Git, SSH, optional Podman and user-configured MCP commands must be detected and
explained by the normal startup/tool owners, never silently installed here.

## Normal-app and distribution gate

ALL-342 must nominate the clean normal-app source/build entry point and an
explicit normal-vs-smoke source/flag receipt. ALL-343 owns track-derived bundle
identifiers and app-instance compatibility. Consumer integration must consume
those exact contracts; it must reject the preview profile/provider, fixture
keys, smoke hooks, input injection and synthetic redaction features. The normal
bundle should place Mach-O helpers in `Contents/MacOS` (or another Apple code
location), with the native engine owner resolving that bundle-relative path.
The current preview's Resources engine location is retained only for fixtures.
ALL-354 owns full-Xcode actual AppKit/WKWebView CI. The separate
`macos-package.yml` lane records uncredentialed fixture integrity and uploads
only evidence, never a consumer archive. A joined normal build should reuse the
existing stable macOS engine artifact, without another Rust/frontend build.
ALL-356 can consume the version/source/track/build/schema/assets and complete
bundle/container inventory fields; update policy and replacement are its scope.

Before any credentialed operation, present the exact normal source, artifact,
leaf signing order, entitlements and commands for an explicitly authorized NAC
Developer ID Application identity and established notary keychain profile.
Machine credential presence is not authority to choose one. No identity has
been selected and no notary submission has occurred in this preparation lane.
Required intervention is the maintainer's designated NAC identity/profile and
explicit authorization for those exact operations on the clean normal artifact.
No certificate/keychain/account setup is performed here.

The concrete future operation order is:

1. Sign each nested executable inside out with the authorized Developer ID
   Application certificate, `--options runtime --timestamp`, then the outer app.
   Verify each signature, expected Team ID/requirements and exact entitlements;
   recursively verify the sealed app.
2. Create the submission ZIP with `ditto -c -k --keepParent`, submit using
   `xcrun notarytool submit … --keychain-profile … --wait --output-format json`,
   retain the submission ID/status/log against the signed digest, and require
   `Accepted`. A credential/profile name is not proof of acceptance.
3. `xcrun stapler staple` the accepted `.app`, then `stapler validate` and
   `spctl --assess --type execute --verbose=4`. ZIP cannot itself be stapled:
   recreate the final ZIP from the stapled app and regenerate final digests.
4. Test the actual quarantined download through LaunchServices on a qualified
   Mac and in a fresh **owned disposable** Applications test location. Record
   quarantine, actual translocated path when applicable, spaces, bundle-relative
   resources, normal UI/engine identity, lifecycle and descendant cleanup. Never
   overwrite an installed/user app or disable Gatekeeper, SIP, TCC or quarantine.

Developer ID, notarization, stapling, Gatekeeper, quarantine/download,
Applications installation, translocation and actual normal-app startup remain
unavailable until their corresponding real artifacts and environment receipts
exist. Ad-hoc success substitutes for none of these. Missing authorized signing
inputs block distribution acceptance while allowing secret-free preparation.

Apple primary references:

- [Creating distribution-signed code](https://developer.apple.com/documentation/xcode/creating-distribution-signed-code-for-the-mac)
- [Code Signing In Depth](https://developer.apple.com/library/archive/technotes/tn2206/)
- [Notarizing macOS software](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [Packaging Mac software](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [Hardened Runtime](https://developer.apple.com/documentation/security/hardened-runtime)

Portable boundary tests:

```sh
python3 -B -m unittest discover -s desktop/macos/packaging -p 'test_*.py' -v
```
