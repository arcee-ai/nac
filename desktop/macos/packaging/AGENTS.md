# Mac package owner

ALL-355 owns this outer packaging/manifest/signature boundary. Read root and
`desktop/macos/AGENTS.md`. Reuse the existing native builder and committed web
assets; do not compile another frontend or move runtime authority into Swift.

`prepare-engine` runs under the Rust lease and copies the exact binary before
releasing it. `fixture` runs under the native/browser lease using only that
private copy. Both require clean committed source, including no untracked files.
No build output may masquerade as a reviewed or qualified revision.

The initial format is explicitly a development-preview fixture. It contains the
preview profile/provider and cannot be a consumer app. A normal builder must be
explicitly nominated by ALL-342 before consumer packaging integration; ALL-343
owns track-derived bundle identifiers, ALL-354 actual-app CI and ALL-356 updates.
Do not mutate those owners' shared files or adopt their dirty state.

Never select a signing identity, change credentials/keychains, submit notarization
or publish an archive from this fixture path. Developer ID/notary/installation
acceptance requires explicit authorized inputs plus actual corresponding evidence.
Ad-hoc signature/inventory checks establish only their named contracts. Preserve
failed receipts. No fixture runtime or minimum-OS qualification is implied.
