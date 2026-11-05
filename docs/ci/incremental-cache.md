# Compiler-only release incremental cache

The S18 candidate preserves NAC's public const build-identity API and all current
source, feature, runtime and release checks. `scripts/ci-incremental.py` can
restore compiler incremental data for the two existing release-build targets:
`x86_64-unknown-linux-musl` and `aarch64-apple-darwin`. It does not cache test
results, quality receipts, runtime stores, credentials, advisory databases or
workspaces, and supports no Docker, native-test or ordinary-test cache mode.

Actual local NAC release compilation changed from 97.96 seconds to 17.81 seconds
for a synthetic A-to-B identity change. After modeled rust-cache cleanup,
restoring only A's compiler incremental data took 17.71 seconds; full B identity
was verified using the standalone binary with an empty environment. These are
compiler mechanism measurements on macOS, not ordinary PR qualification or
Linux/musl/Wolfi timing. No synthetic identity belongs to the acceptance cohort.

## Helper contract

```sh
python3 scripts/ci-incremental.py restore \
  --workspace "$(pwd -P)" --target "$RELEASE_TARGET"
python3 scripts/ci-incremental.py stage \
  --workspace "$(pwd -P)" --target "$RELEASE_TARGET"
```

`GITHUB_REPOSITORY` supplies the repository; `--repository` can make that binding
explicit. Both commands require pinned Rust/Cargo 1.98.0, `CARGO_INCREMENTAL=1`
and `CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16`. Release optimization remains 3,
with its existing disabled debug assertions and overflow checks. The original
Cargo command, locked graph, feature selection, current-candidate identity
variables and archive/binary execution checks remain mandatory.

The only source is
`target/<target>/release/incremental`. The only staging location is
`.nac-ci-incremental-cache/<target>` outside the cleaned target directory. The
helper expects physical paths without symlink ancestors and refuses to replace
an existing incremental output directory during restore. Both root `.gitignore`
and `.dockerignore` exclude `/.nac-ci-incremental-cache/` so these compiler-only
files stay out of source commits and image contexts.

The manifest binds repository, release role, host OS/architecture, target,
workspace path, complete rustc/Cargo version identity, all workspace manifests
and lock bytes, ancestor/CARGO_HOME configuration hashes and compiler-related
environment hashes. Config and flag contents are never recorded in plaintext.
Source revision/build ID are deliberately not compatibility keys: rustc must
recompile the current const identity and all affected code. Provenance records
the trusted seed's source SHA, ref, run and attempt; it supplies no source or
quality verdict for the consuming candidate.

Only known Rust 1.98 incremental unit/session names and object, bitcode,
metadata, dependency/query/work-product and empty lock files are accepted.
Traversal uses bounded no-follow descriptors and regular files, rejects
symlinks/special files, and validates file size/hash before atomic publication
of a restored directory. Staged cache files must have no hard links. Hard-linked
compiler work products may be read while staging, then become separate regular
staged copies. In-flight size/identity/mtime changes fail. Unknown paths, extra
files, duplicate manifest fields/records, missing manifests and corruption fail.

An absent staging directory is an explicit cold result. A complete, intact cache
from a different supported configuration is also cold and never reused. A
foreign repository/role/profile, malformed provenance or corrupt payload fails
even when configuration differs. No partial copy becomes the active target.

Stage additionally requires a real `push` payload for the current repository's
`dev` or `main`, matching `GITHUB_SHA`, checked-out HEAD, ref, run and attempt.
PRs, forks, tags and manual events cannot stage. GitHub's existing repository
cache scope and trusted-push-only save condition remain the cache's write
authority; the manifest hashes/provenance are integrity/context controls, not
an independent signature or an extra permission grant.

## Release workflow integration

The workflow applies this only to the existing `build` matrix. Its runners,
target matrix, permissions, source preparation and required aggregation remain
unchanged. The job-level environment makes the configuration visible to the key:

```yaml
env:
  CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "16"
```

The release build's cache step has an output ID and these inputs:

```yaml
- name: Cache Rust build
  id: release-cache
  uses: Swatinem/rust-cache@c19371144df3bb44fab255c43d04cbc2ab54d1c4 # v2.9.1
  with:
    prefix-key: nac-ci-v1
    key: ${{ github.job }}-${{ matrix.target }}-incremental16-v1
    cache-directories: ${{ github.workspace }}/.nac-ci-incremental-cache/${{ matrix.target }}
    save-if: ${{ github.event_name == 'push' && (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') }}
- name: Restore verified compiler incremental data
  env:
    CARGO_INCREMENTAL: "1"
    RELEASE_TARGET: ${{ matrix.target }}
  run: python3 scripts/ci-incremental.py restore --workspace "$(pwd -P)" --target "$RELEASE_TARGET"
```

The pinned action unconditionally exports `CARGO_INCREMENTAL=0`. The existing
**Build nac-web binary** step explicitly sets `CARGO_INCREMENTAL: "1"` afterward.
Its `NAC_BUILD_TRACK`, `NAC_BUILD_ID`, `NAC_SOURCE_REVISION`, `--release`, `--locked`,
package/bin and target arguments remain unchanged. Shipping features, release
assertions, the mandatory build on cache hits and archive execution checks stay
in effect.

After successful packaging and archive identity verification, stage only an
eligible new snapshot before the action's existing post-save cleanup:

```yaml
- name: Stage trusted compiler incremental snapshot
  if: >-
    github.event_name == 'push' &&
    (github.ref == 'refs/heads/dev' || github.ref == 'refs/heads/main') &&
    steps.release-cache.outputs.cache-hit != 'true'
  env:
    CARGO_INCREMENTAL: "1"
    RELEASE_TARGET: ${{ matrix.target }}
  run: python3 scripts/ci-incremental.py stage --workspace "$(pwd -P)" --target "$RELEASE_TARGET"
```

The original save condition and success-only post action remain unchanged.
PR/tag/manual jobs may restore but never stage or save this additional path.
Default workspace-output pruning remains enabled; `cache-workspace-crates`
must remain unset/false. The helper's compiler-only staging location survives
that cleanup. Workspace binaries, Cargo fingerprints/build directories and
workspace library outputs remain pruned; compiler-private metadata inside the
incremental directory is retained with its other compiler work products.

## Frozen snapshots and costs

The pinned action does not update an exact immutable cache-key hit. Its manual
key is part of the restore prefix, so adding a candidate SHA there would prevent
ordinary cross-SHA reuse through that prefix. This design deliberately retains
one trusted snapshot for each exact role/target/toolchain/configuration/dependency
key, not a continuously refreshed latest-source cache. The stage condition avoids
copying a fresh snapshot the action cannot save. A dependency/configuration key
miss may save a new snapshot on the next successful trusted push. No cross-key
or cross-workflow lookup is added.

The new versioned key starts cold and may also miss an older dependency cache.
A prelanding PR cannot seed the trusted snapshot; human landing and the normal
trusted push are separate gates. Keep that cold result and post-seed repeated
ordinary PR timings explicit. Do not change cache privileges to obtain warm
qualification or treat a seed commit as a cohort candidate.

The helper caps each payload at 4 GiB, each file at 512 MiB, 20,000 files and
30,000 total directory entries, depth three, with an 8 MiB metadata manifest.
It requires payload size plus 1 GiB of free space before copying. A cache hit
hashes while copying once into the target; old-configuration cold validation
hashes without copying. Staging validates any old owned snapshot and copies the
current compiler data through hashing into a temporary directory. Atomic
replacement can temporarily retain both old and new staging snapshots, in
addition to current target outputs; at the payload cap this can approach 12 GiB
for those three copies. The helper never removes a shared target or cache.

The observed NAC A snapshot was 1.485 GB raw; retained B incremental data was
2.518 GB. Local cleanup/restore and other bookkeeping together took at most
2.069 seconds in that trial. At a hypothetical sustained 100 MB/s, 1.485 GB raw
would require about 15 seconds of transfer, or 59 seconds at 25 MB/s. Those are
arithmetic estimates, not observed hosted transfer speeds; compression, hashing,
archiving, runner setup and cache quota/eviction can change the result. Include
all overhead and executed compute/storage in actual PR processing measurements.

The repository capacity snapshot at 02:00:43 UTC recorded 74 caches totaling
11,466,115,493 bytes; the REST cache storage-limit endpoint (API version
2026-03-10) reported `max_cache_size_gb: 10`. No limit or settings changed.
An additional 1.5–2.5 GB raw incremental snapshot per target may evict other
useful caches; raw compiler bytes do not establish compressed cache occupancy.
Measure whole-pipeline hit rates, transfer time, storage and eviction before
claiming an operating-cost improvement. Zero public-runner compute charges do
not make cache storage free. Retain the portable `cache-resource-snapshot.json`
receipt with the campaign evidence.

## Verification and remaining gates

`python3 scripts/test_ci_incremental.py` and the automatic
`pr-incremental-cache.test.mjs` entrypoint exercise CLI and realistic small owned
fixture trees, profile/toolchain isolation, trusted writer denial, configuration
hashing, target-pruning equivalence, link/FIFO/path/hash rejection, byte/count
limits, cold paths, protected existing outputs and atomic failure handling.
The tool responses are fixture stubs; these tests run no real Cargo/compiler
and copy only small data. They do not contend with image timing trials.

Parsed `pr-release-incremental.test.mjs` controls require the exact workflow and
ignore wiring, trusted writer/key boundaries, unchanged profile and binary
checks, cold restore-before-build ordering and frozen-hit staging condition.
Negative mutations exercise each boundary. Actual helper stage/restore on
retained real compiler data, cross-target macOS/musl compiler acceptance,
corrupt/unusable cache behavior, complete current-head CI, the existing
source/stable/Guide/native/image controls and the ALL-582 timing cohort remain
required. Linux/Wolfi/image integration and Docker cache behavior remain separate;
this candidate adds no Docker path or API change. No cached quality is reused.

Pinned behavior is readable in
[restore](https://github.com/Swatinem/rust-cache/blob/c19371144df3bb44fab255c43d04cbc2ab54d1c4/src/restore.ts#L30),
[cleanup](https://github.com/Swatinem/rust-cache/blob/c19371144df3bb44fab255c43d04cbc2ab54d1c4/src/cleanup.ts#L60)
and [save](https://github.com/Swatinem/rust-cache/blob/c19371144df3bb44fab255c43d04cbc2ab54d1c4/src/save.ts).
