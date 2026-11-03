# Mac package owner

ALL-355 owns this outer packaging/manifest/signature boundary. Read root and
`desktop/macos/AGENTS.md`. Reuse the existing native builder and committed web
assets; do not compile another frontend or move runtime authority into Swift.

`prepare-engine` runs under the Rust lease and copies the exact binary before
releasing it. `fixture` and `normal` run under the native/browser lease using only that
private copy. Both require clean committed source, including no untracked files.
No build output may masquerade as a reviewed or qualified revision.

Preview output is a development fixture containing the disposable profile/provider.
Normal preparation consumes the exact ALL-343 builder nomination at9f215ec9
and its actual unsigned receipt. native_receipt.py admits the nominated selected
nine sources/flags and three build-support hashes, reuses BundleIdentity.sh,
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
