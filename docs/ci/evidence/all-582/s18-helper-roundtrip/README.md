# S18 actual helper data roundtrip

Mechanism-only check, 2026-11-05 02:20:37.906–02:20:41.737 UTC on macOS.
Owned helper source `8921b78ff882a58227554ce108527a78b4085565` processed the
retained synthetic-A release compiler snapshot: 433 files, 1,484,480,503 logical
bytes. This is modeled local push provenance, not a real trusted GitHub seed,
acceptance-cohort run, current-candidate build or compiler-reuse measurement.

The actual CLI commands and pinned Cargo/rustc/Python identities are recorded in
`summary.json`. The helper performs offline Cargo metadata/version queries and
rustc version queries; there were no compiler builds. Stage took 1.483 seconds,
restore 1.016 seconds, independent source/restored hash audit 1.057 seconds.
Raw macOS time reports preserve CPU and maximum RSS. Local filesystem/page cache
was not flushed; transfer, archiving and hosted cache costs remain unmeasured.

A temporary hardlink mirror exposed retained A at the helper's required owned
workspace `target/aarch64-apple-darwin/release/incremental` path without a payload
copy. This namespace does not prove explicit-target compiler compatibility: the
original benchmark used host release compilation. Stage produced private regular
files; the mirror was removed before restore produced a second private copy.
Both copies passed complete path/size/hash validation. Source, staged and
restored record-set digests match; the digest definition is in the JSON receipt.
Staged bytes were fully hashed by restore, and the independent audit rehashed
all source and restored bytes. Each copy was 1,484,480,503 bytes; total payload
copied was 2,968,961,006 bytes, plus small manifest/directory metadata.

Free space was 24,673,189,888 bytes initially, at least 21,701,500,928 bytes during
the check, and 24,672,841,728 bytes after cleanup. The start threshold accounted
for the 12 GiB floor, two payload copies and 128 MiB overhead. Cleanup deleted
only new owned staged/restored/mirror payloads. All original source file inodes,
sizes and link counts were preserved; hardlink creation/removal necessarily
changed source ctime, which cannot be restored. The original snapshot and all
benchmark targets remain. The exclusive resource slot was released immediately.

The parent verifier at `efd55a1eb8070c6fcccb9a547b9a742fa8c5ed1d` also consumed
actual offline Guide output from the retained synthetic-B executable with an
empty PATH and absent owned HOME/NAC_HOME. Full B identity passed. A wrong
40-character source sharing B's first 12 characters failed. No runtime home was
created. Binary/verifier/Guide SHA256 values and both CLI results are in the
JSON receipt; this proves the verifier mechanism, not current-head compilation.

Original raw evidence remains under the owned campaign artifact directory's
`incremental/real-helper-roundtrip/`: supervisor, exact commands/environment,
full manifest, source link inventories, CLI stdout/time logs, actual Guide output
and negative stderr. No source/workflow/cache permissions changed for this test.
Actual compiler reuse through the helper, hosted trusted seeding/cold/warm runs,
cross-target acceptance and whole-pipeline storage/transfer/eviction remain open.
