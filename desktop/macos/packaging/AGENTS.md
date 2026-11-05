# Mac package owner

ALL-355 owns this outer packaging/manifest/signature boundary. Read root and
`desktop/macos/AGENTS.md`. Reuse the existing native builder and committed web
assets; do not compile another frontend or move runtime authority into Swift.

`prepare-engine` runs under the Rust lease and copies the exact binary before
releasing it. `fixture` and `normal` run under the native/browser lease using only that
private copy. Both require clean committed source, including no untracked files.
No build output may masquerade as a reviewed or qualified revision.

Preview output is a development fixture containing the disposable profile/provider.
The current private source composition starts at backend T3 cb1f76f293 and
consumes the ff289b0b native350 augmentation, ec69215d packaging source and
qualified native D9 d9e229e6 (including navigation and pinned Unicode reveal).
These are source suppliers, not additional Git ancestors. Generated outputs
remain the T3 baseline: this is not a build nomination. Root must review the
combined source, admit canonical regeneration and qualify the exact normal39
producer separately. Prior ff289/1c79/native75f and f2539dd/normal28 source and
4cbaf624/H584a6aa1, finalS 1f8bf49e and supplier 6c74dc2d retain their historical
source/control identities. The normal contract
has exactly 39 selected Swift sources, exact LOCAL_APP/UserNotifications flags,
false smoke/instance/lifecycle/attention instrumentation and three support hashes. native_receipt.py
admits that closed contract and reuses BundleIdentity.sh. Original nomination
9f215ec9, the old nine-source 1a0c7c35 policy and prior ddf4c643 artifacts retain
their historical identities; old binaries/receipts cannot qualify this source.
Packaging validates the actual unsigned receipt against its own clean build commit
and verifies all unsigned bundle/identity proof. The outer post-sign receipt
binds final signed facts without changing the sealed schema-1 PackageIdentity
marker/engine_identity contract consumed by356. Notify root before marker changes.
It is an admission policy, never another native compiler/receipt writer.
ALL-343 owns track-derived bundle identifiers/instance acceptance, ALL-354 actual-app CI and
ALL-356 updates. Consumer readiness remains false until all required suppliers
and actual evidence are qualified. Do not mutate their shared files or adopt
dirty state. In particular ALL-343 is first writer of App/Info/preview.sh.

Never select a signing identity, change credentials/keychains, submit notarization
or publish an archive from preparation commands. Developer ID/notary/installation
acceptance requires explicit authorized inputs plus actual corresponding evidence.
Ad-hoc signature/inventory checks establish only their named contracts. Preserve
failed receipts. No fixture runtime or minimum-OS qualification is implied.

The Rust embedded assets input tree must exactly match Git-tracked paths;
ignored files/symlinks/extra directories there cannot be reviewed-source input.
Do not apply that guard to unrelated ignored caches, dependencies or local config.
