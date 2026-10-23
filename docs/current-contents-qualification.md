# Current-contents qualification — ALL-417

**Verdict: FAIL / downstream launch acceptance remains blocked.** The current
run-history adapter cannot satisfy the selected [ALL-418](https://linear.app/arcee/issue/ALL-418)
contract. This completes a bounded investigation; it neither implements ALL-418
nor closes ALL-330. The new tests and isolated oracle are maintained evidence,
not a production capture candidate. No launch behavior changes in this PR.

Subject and starting base: `90be848ba3f0410b5e697bb60f4d71a935216361`, freshly
fetched `origin/dev` on October 23, 2026. No base update was made. ALL-417,
ALL-418, ALL-415, ALL-329 and ALL-330 were read with their complete comment
results (none). Current execution authorization supersedes their historical
“planning only” notes. ALL-415's independent clean-ref delivery is unaffected.

## Reproduce and interpret

See [runner instructions](../scripts/capture-qualification/README.md). The
[recorded JSON](qualification/all-417.json) gives fixture recipes, hardware,
cache conditions, source identity/digests, runner source fingerprints and physical/logical measurements.
Runner success means the observations match assertions, including known failures;
it does not turn the production qualification verdict green.

There are three evidence levels:

1. Rust integration tests invoke the actual exported `workspace::capture` and
   `GitTarget`, including a nested cwd. Unit tests invoke the actual private
   Local reader. These assertions characterize existing behavior without fixing it.
2. Python oracle fixtures establish an independently checked manifest/rejection
   vocabulary and deterministic scan boundaries. They deliberately expose ABA
   non-detection and buffering limitations; they are not runtime code.
3. Isolated Git processes exercise object pinning, interruption and a retained
   bundle. Fake admission receives only a checkpoint/completion proof; no NAC
   session, model, prepared resource or production input is admitted.

## Contract matrix

“FAIL” means the production candidate lacks the selected invariant, even where
an isolated oracle correctly refuses it. “Unproven” is also a failed acceptance
gate, never a successful capture. Test names below are searchable suffixes.

| Selected requirement | Actual helper / fixture evidence | Gate |
| --- | --- | --- |
| Whole bound repo from nested effective cwd | `history_preserves_source_and_ordinary_bytes_modes_links_from_nested_cwd`; resolves top-level and includes sibling paths | PASS for Git root resolution; saved-project/host binding is ALL-415/418 |
| Final disk text/binary, unstaged wins, ordinary untracked, executable modes | Same actual-helper test compares literal blobs, real index, HEAD, disk bytes and tree modes | PASS on ordinary unfiltered fixture |
| Deletes/renames as resulting paths | Oracle `supported_bytes_deletes_renames_mode_staging_nested_cwd`, dirty benchmark archive/manifest equality | PASS in actual raw-history test `raw_history_preserves_non_utf8_link_targets_and_resulting_rename_deletion_paths`, including whole deleted parent directory; no production launch claim |
| Tracked files remain included despite ignore matches | `fresh_history_index_silently_omits_tracked_files_matching_ignore` proves omission from fresh private index | **FAIL** |
| Ignored untracked/build trees excluded, no traversal | Actual-helper ignored fixture excludes secret. Oracle prunes an unreadable ignored nested repo and records visited directories; all benchmark inventories exclude ignored tree; Git trace2 directory counts match only selected directories | PASS on fixtures via oracle + Git trace2; no syscall-level arbitrary-race proof |
| Git state/staging not copied | Private index isolated; archive only tree paths. Actual source index bytes unchanged. No staging reproduction promised | PASS on fixtures |
| Safe relative/dangling/directory links preserved literally; no directory traversal | Actual-helper link with newline target, oracle dangling/directory link and parent-link rejection. Raw history preserves non-UTF-8 targets, but `local_non_utf8_link_target_is_lossy` proves Local reader changes `0xff` to replacement-character bytes | **FAIL** for Local reader byte fidelity; ordinary UTF-8/raw-history cases pass |
| Absolute/escaping links rejected with exact path | Actual helper accepts both and preserves unsafe target bytes; oracle rejects `bad` | **FAIL** |
| Unsupported link chains rejected | Oracle `link_chain`, `link_chain_with_directory_component`, `link_chain_before_parent_component_is_rejected`; history has no such validation | **FAIL** |
| No reads through linked parents/source type races | Actual `local_parent_link_escape_is_flagged_after_external_bytes_are_read` returns outside fixture bytes with `escapes=true`; `escapes=false` for symlink means parent containment only | **FAIL** |
| Nested repository/submodule/gitlink rejected | Oracle detects initialized nested repo and real index mode `160000`; current add can synthesize a gitlink, with no product preflight | **FAIL** |
| Unmerged/sparse checkout rejected | Real unmerged index and Git-canonicalized sparse boolean fixtures refused by oracle; fresh history index does not inspect real conflict/sparse state | **FAIL** |
| Sockets/FIFOs/devices/unreadable rejected | Actual capture silently drops FIFO. Git untracked enumeration omits FIFO/socket; oracle inventory catches both, unreadable fixture refuses. Device policy tested with injected stat type only | **FAIL**; real device fixture unavailable unprivileged |
| Invalid/escaping paths rejected before reads | Oracle `invalid_parent_path`, descriptor-relative parent test; existing reader is not a canonical path-validation API | **FAIL** for launch reuse |
| No normalization/LFS/filter execution before refusal | Actual CRLF fixture normalizes to LF. Oracle refuses text/eol/encoding/ident/LFS and poison clean/smudge attributes without executing sentinel command; autocrlf refused | **FAIL** for actual adapter |
| HEAD/path set/bytes/type/link/mode changes visibly conflict | Seven deterministic mutations between oracle scans conflict; actual capture performs no surrounding source validation | **FAIL** |
| Actual consistency guarantee stated without OS-atomic claim | Oracle ABA test restores bytes between scans and is accepted; changed values observed across scans conflict. Neither prevents mixed-time scans or edits after last validation | **FAIL** for unqualified reuse; sequential detection limit documented |
| One immutable capture/request, exact retry, incompatible args conflict | Actual same-session capture produces another commit/new bytes. Session revision slug is not a canonical launch key; no argument/request persistence here | **FAIL**; fake admission cannot supply this invariant |
| Complete checkpoint pinned before admission | Actual ref survives `gc --prune=now` and preserves prior parent; source-only objects/ref disappear with source loss. Independent retained bundle recovers old bytes | **FAIL** for source-independent launch checkpoint |
| Interruption before completion never admits/recaptures | Fixture kills writer at before-object, object-unpinned, pinned-unacknowledged barriers. Fake observer rejects all without completion proof | PASS for fake refusal, **unproven in production** |
| Complete checkpoint restart/lost response/source loss reuse | New process reads original pinned commit after source edits; retained bundle unbundles after source deletion. Initial source absence raises failure. No source recapture in observer | PASS for Git mechanism, **unproven durable request/session/input** |
| Incremental entry/file/aggregate/time enforcement and cancellation | Actual/scaled boundaries pass in oracle; timeout kills supervised process group. Actual helper has none; oracle buffers Git output/directory entries and resets per-pass clock | **FAIL** |
| Preserve source HEAD/index/files on success/refusal/timeout/cancel | Actual tests byte-compare source; oracle refusal helper compares file/type/mode hashes, index and HEAD; benchmark before/after manifest equality. Injected external changes intentionally remain | PASS on fixtures, no arbitrary-writer atomic guarantee |
| No unwanted coding admission/clean fallback/automatic recapture | Failed/incomplete fixture paths cannot call fake observer successfully; no runtime launch code added | PASS for isolation; production admission remains ALL-415/418 |
| Ordinary clean-ref behavior/modes/topologies/backends unchanged | Only test-module declaration in production source; no runtime capture/launch call sites changed | PASS by diff; no new remote parity claim |

## Why private history is insufficient

`workspace/revisions.rs` uses an initially empty per-session private index,
`git add --all`, `write-tree`, `commit-tree`, and a moving
`refs/nac/revisions/<slug>` ref. The real index is isolated, but its tracked
membership is not seeded into that private index. Ignore rules can therefore
remove tracked paths. Clean filters and line-ending attributes affect `add`.
The persistent index's stat cache is a performance optimization, not independent
byte validation. Unmerged real-index entries, sparse state and unsupported file
kinds are not selected-contract admission checks.

The ref pins the revision chain only while its source object database survives.
Publication precedes diff totals and caller persistence: an interruption may
leave objects/ref without a durable request result. `rewind_ref`/`forget` can
also move/remove history pins. Existing run-history lifecycle is not immutable
launch-checkpoint ownership. `GitTarget::output_with_env` uses blocking
`std::process::Command::output` for Local commands without capture cancellation,
command/output limits or a request deadline.

The oracle canonicalizes sparse configuration through Git's boolean parser.
A skip-worktree flag by itself is not reproduced in the destination and does not
replace existing disk bytes (`skip_worktree_flag_alone_keeps_current_disk_contents`).
Do not expand ALL-418's unsupported-source taxonomy to every index flag: staging
and index distinctions are excluded. Ambiguous leftover sparse/skip state with
missing files remains a production qualification gap, not a proved complete
sparse-state classifier in this oracle.

The Local reader first stats/canonicalizes, then reads by pathname. It can read
outside before a consumer sees the containment flag, and stat/open replacement
windows remain. The Local symlink reader uses `to_string_lossy()`, so non-UTF-8 literal targets
are changed even though raw Git history preserves them. Its `escapes` field
describes its parent directory. It is not target validation.
SSH behavior is outside this Local qualification and is not inferred from it.

## Recovery and race boundaries

The process fixtures deliberately separate object-written, ref-pinned,
completion-proven and acknowledgement-observed. A pin alone never authorizes
fake admission. A completed fixture observer reads a retained commit, not newer
working bytes. A standalone retained bundle survives deletion of the source
repository and is readable in a new process. This is mechanism evidence for a
source-independent checkpoint, not a proposed bundle-per-launch product design.
The fixture receipt is not crash-safe NAC database state or a concurrency claim.
Incompatible-key conflict, initial-input-once, cancellation/preparation ownership,
fsync/power-loss durability and real launch restart remain unimplemented gates.

Seven mutations are injected at a deterministic boundary between complete
manifest reads: HEAD, add, delete, content, file-to-link type, link target and
executable mode. Any differing observed manifest conflicts once; no recapture
occurs. An ABA byte rewrite between scans is deliberately missed. Content changes
during reads can be detected by inode/size/mtime/ctime checks, but uncooperative
writers and individually read entries do not provide a shared point-in-time
snapshot. The smallest future adapter must describe this validation guarantee
and test per-entry as well as enumeration/publication boundaries. It must fail
when complete capture cannot be proven, never choose newer contents or HEAD.

## Measured cost and finite defaults

Recorded on Apple M5 Max, 36 GiB RAM, macOS 27.0.1 arm64, Apple Git 2.50.1,
Python 3.14.8. Fixture creation warms OS caches; no cold-cache claim. Each row
has **10,000 ignored build files / 10,240,000 ignored bytes**. Selected binary
bytes are deterministic unique SHAKE-256 output, not repeated compressible blobs.
Capture/validation timings exclude fixture setup and the independent tar comparison.
They include two manifest scans and four history Git commands; this is the
unrepaired history recipe on safe fixtures, not a production capture measurement.

| Fixture | Candidates | Selected bytes | Git commands | First / warm seconds | New object allocation first / warm | Private index |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| Small clean: 24 × 1 KiB | 26 | 24,590 | 24 | 0.257 / 0.278 | 4 / 4 KiB | 4 KiB |
| Small dirty | 27 | 23,599 | 24 | 0.362 / 0.368 | 24 / 0 KiB | 4 KiB |
| Larger clean: 4,096 × 8 KiB | 4,098 | 33,554,446 | 86 | 2.093 / 1.830 | 4 / 4 KiB | 324 KiB |
| Larger dirty | 4,099 | 33,546,287 | 86 | 2.330 / 1.611 | 24 / 4 KiB | 324 KiB |

The larger source object database already occupied 50,491,392 physical bytes;
Git deduplicates existing blobs, but that says nothing about byte fidelity.
Two oracle scans read twice the selected bytes (67,108,892 for larger clean).
Git's own logical bytes read/written are **not syscall measured**; it may reuse
index/object data. JSON retains child OS block counters, object allocation,
archive bytes, index footprint, command counts and source-before/after equality.
Those OS counters are not substituted for byte accounting. `st_blocks * 512`
reports allocated blocks, not APFS exclusive/cloned/encoded storage. The separate
bundle recovery test proves source-independent retention, but its
power-loss durability is not qualified; no retained-checkpoint storage SLA is
claimed. JSON separately measures bundle logical/physical size and retention time. Ignored inventory pruning is asserted and logged in the oracle; Git trace2
directory counts independently corroborate candidate Git traversal on fixtures.

Recommend these **provisional finite defaults for the repair qualification**,
not production-approved parameters:

| Bound | Default | Count/enforcement and evidence |
| --- | ---: | --- |
| Candidate entries | 10,000 | Unique tracked path names (including deletions) plus selected nonignored untracked entries; include links. Exclude Git admin and pruned ignored trees. Stop while enumerating, before accumulating an unbounded path set. Default boundary fixtures use 9,999/10,000/10,001 tracked candidates. |
| Per-file data | 16 MiB = 16,777,216 bytes | Literal regular-file bytes or literal link-target bytes. Check declared size before allocation and count chunks while reading; never truncate. Actual default −1/at/+1 fixtures. |
| Aggregate capture data | 128 MiB = 134,217,728 bytes | Sum selected data once per capture attempt; deleted files zero. Validation and writes still consume the same overall deadline, and their I/O is separately measurable. Actual default −1/at/+1 fixtures spread data across per-file-safe entries. |
| Total elapsed time | 30 seconds | One monotonic deadline covering enumeration, reads, objects, validation, retention and subprocesses; check between chunks/entries and terminate supervised process trees on timeout/cancel. Deterministic 29/30/30.001-second clock fixtures plus real 0.1-second blocked-process kill. |

These are resource ceilings, not latency guarantees. The measured ordinary
larger case fits with roughly 2.4× candidate and 4× byte headroom, while 30 seconds
allows substantial observed-host variation without unbounded capture. Actual
maximum-byte/count fixtures establish refusal boundaries, not worst-case
performance. The 16 MiB file ceiling contains a memory allocation and requires
future representative large-binary validation before acceptance; it is not a
claim all repositories fit. A repository exceeding any bound gets a named
limit failure and zero coding admission, never partial capture/clean fallback.

The oracle uses pathname-based directory enumeration before descriptor-relative
entry reads: a concurrently replaced directory may expose external path names
before the later no-follow entry read refuses it. It is not a production-safe
no-follow inventory. The repair requires descriptor-relative enumeration too.

The oracle checks chunk bytes and cancels a supervised Git process, but buffers
Git output and each directory listing. Its per-pass clock also restarts.
The current production helper has no capture budgets at all. Consequently
incremental enumeration, memory/output caps, end-to-end deadline and production
cancel supervision remain **FAIL**, despite boundary fixtures passing. Approval
of these limits requires remeasurement of the repaired raw-byte adapter.

## Narrowest compatible repair and decision

Keep existing prepared-session/admission ownership (ALL-415) and inward workspace
ports. Do not reuse `capture` as a launch checkpoint without a separate,
contract-specific adapter:

1. Bind canonical Local source/project/repository/HEAD/effective cwd and request
   arguments first. Preserve whole-repository scope and source index membership;
   do not start a second task engine. Preflight real index conflicts, gitlinks,
   sparse state and content-transform attributes/configuration **before** any
   command capable of executing clean/smudge/filter code.
2. Enumerate with ignore pruning and no-follow type inspection, including special
   entries Git's file lists omit. Retain tracked ignored paths. Open components
   descriptor-relatively and verify identity/type/contents/mode around reads;
   validate literal link targets/chains without reading external bytes. Use
   bounded streaming lists/chunks and a single cancelable deadline.
3. Write verified raw bytes into Git blobs with a no-filter plumbing path
   (`hash-object --no-filters`/equivalent raw object writer), construct the explicit
   tree/private index from validated entries, and keep Git modes. Materialization
   must also avoid smudge/line-ending conversion. This recipe is a recommendation,
   not implemented/qualified here; batching/object performance remains to measure.
4. Compare source HEAD/path set/types/digests/link targets/modes before accepting
   the immutable checkpoint; document observed-change detection and remaining
   arbitrary-writer races. Conflict is terminal for that request. Never retry
   capture silently or fall back to a clean ref.
5. Retain the complete object graph independently of source loss under durable
   launch ownership. Publish completion proof/provenance and canonical request
   outcome before preparation/admission; reconcile unproven interruptions to
   failure. Exact retry recovers the original checkpoint/session/input and rejects
   incompatible arguments. Reuse existing preparation and durable admission
   precedents rather than promote fixture JSON/observer into production state.

No external code or new dependency was imported. No ALL-418 implementation,
watcher, mirror, automatic GC, other-mode behavior change, remote parity, archive,
cleanup, setup engine or project redesign is proposed. No human product rescope
is needed merely to record this FAIL: ALL-418 remains blocked until the identified
adapter/recovery invariants are repaired and qualified. If those repairs cannot
meet the selected contract, explicit human rescope is required; omission or
“best effort” is not an acceptable implicit alternative.
