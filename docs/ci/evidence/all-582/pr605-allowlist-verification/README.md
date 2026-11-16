# PR605 incremental-path finding verification

Decision: preserve the existing allowlists. The reported trusted-stage failure is
not supported by the pinned implementations or retained actual Rust 1.98 NAC
data. This is read-only mechanism verification, not Linux/hosted qualification.

The retained macOS A tree has 433 files, nine units and nine finalized sessions;
B has 866 files, the same nine units and 18 finalized sessions. The actual helper
inventory accepts both. Every finalized session has three tokens after `s`,
and only NAC/build-script units occur. Exact names, full tool identities,
input-source digests and pinned source links are in `summary.json`. Earlier
full-data stage/restore also passed on all 433 A files.

Rustc finalization keeps timestamp and random tokens, asserts three dashes and
appends the SVH. Its lock-path code also requires three dashes. The introductory
comment's two-token sketch conflicts with the implementation; it is not the
emitted format. The pinned Cargo profile logic applies the global incremental
override, then disables incremental for nonlocal sources. The caller defines
local as a path source, excluding registry/git dependencies. These particular
branches have no target-platform condition. Current NAC metadata has only NAC
packages as path sources; enabling `CARGO_INCREMENTAL=1` does not make registry
packages generate incremental units through this Cargo configuration.

No production parser, source, workflow or cache privilege changed. Unknown paths
remain rejected. A custom dependency patched to a path is a local source and
would require its own deliberate allowlist decision; it does not establish the
reported registry-dependency behavior. Actual Linux/musl and explicit-target
macOS acceptance remain unverified. No tiny compile ran during the image timing
trial: pinned source and retained real data suffice to decide this finding.

The original owned artifact directory retains the exact downloaded primary
source snapshots and this receipt under `incremental/PR605-allowlist-review/`.
Those files were inspected only, never imported as implementation/build input.
