# Private terminal observer phase diagnostic (never land)

This private branch is a diagnostic preparation from exact landed
02354e7b9c13404de6bb7a31381760db1003c8bc, tree
1754fb5a3bbef10603b81755ff279c1818972e32. It is not a product repair,
performance comparison, ordinary cohort run, or optimization credit. The
registered nightly workflow is overridden **only on this private branch**;
its default/dev source must remain unchanged. No production publication is
requested. Root alone may publish/dispatch after one independent source review
and exact registered-workflow/ref/source verification. This carry authorizes
no hosted attempt; both previous first outcomes remain frozen.

The retained first #624 failure remains authoritative: 42132754881:1,
prepared41401d6e621fda87f5046a737c6e3597dd126a75, rendered1743.1ms against
unchanged1500ms. Its prepared tree equals historical5603, not this current base. The finite trace
showed19 ordered reads after the first final-retention response:903.481ms
HTTP total (812.399 wait,91.082 receive),240.173ms interrequest gaps.
The source immediately drains known backlog; no configured idle poll explains
those gaps. Those observations establish no causal product fix. HAR wait
contains unseparated server/network/provider work.

## Preservation and measurement

The original case file remains byte-identical SHA256
cf54889e48d03df25c0e4e9c4a592255cb06861185abae866d3657ccb6840b25.
Its native keyboard/type/Enter, focus, noise,45s test timeout,1500ms assertion,
real clocks, retries0,32KiB frames, ordered delivery, renderer-completion ACK,
ownership/configuration fences and cancellation are unchanged. No source
frame bypass, earlier ACK, caching, extra await, header, API field, or middleware
is introduced. Only one exact-title case runs, worker1, retry0. The file-scoped grep accepts
Playwright's filename/project prefix and anchors the original title at the end;
the pinned case source contains exactly one such test.

Tagged private statements time existing client fetch→headers, JSON decoding,
renderer parser completion and ACK readiness, and server completion admission,
fresh configuration before/after paging, execution status and page read.
Existing observer UUID and decimal cursor correlate records; the client also
retains its existing request UUID. Server does not invent a request header.
Concurrent requests/observers must be distinguished by UUID/cursor and local
sequence; clocks are independent process origins and must not be subtracted
across processes.

One explicitly authorized transport-only relocation maps the same frame once
and calls the exact same single Axum `Json(mapped).into_response()` inside the
handler, returning `Response`. Normal `Result<Json<T>,ApiError>` previously
called that conversion synchronously in Axum's response conversion. Returning
that resulting Response preserves its status/body/headers and error branch;
`ExecutionFrameResponse::from_frame(...)?` still precedes conversion. OpenAPI
annotations/request/response DTOs are unchanged. Local pinned axum0.8.9
`src/json.rs:205` implements that conversion including its serialization-error
response. No copied external code is included. The projection control reverses
only this mechanical relocation and the client decoded-value return, then
compares pinned baseline tokens (string contents retained). This supports
source preservation, **not a substitute for pending GNU compile/behavior**.
Mapping and JSON serialization timings exclude later compression, socket
write, HTTP scheduling and client receipt; those remain an explicit gap.

Numeric logging is opt-in, bounded2048 records plus one truncation record per
process/client module. It synchronously adds clock, JSON-format and stderr or
console overhead; it does not measure an undisturbed baseline. Console capture
uses the existing harness listener, with diagnostics retained on success too.
Only schema/side/phase/sequence/timing/UUID/cursor fields are exported. No
terminal bytes, response payloads, credentials, paths or source text enter
phase records. Unknown/malformed records or a missing side make the diagnostic
inconclusive/fail. Truncation is explicit and may limit attribution. Numeric
log rejection cannot authorize any behavior. Fresh flagged embedded assets
are built by the canonical writer and committed with client source; the hosted
writer must reproduce them before Rust compilation.

## Finite hosted contract (not executed locally)

One manual-only job on the ordinary `ubuntu-latest` runner, with admission
requiring x86_64 ubuntu26 and enforcing a two-CPU allowed-affinity subset
on the ordinary diagnostic controller (inherited by its child tree), contents:read,
attempt1, exact private branch/event/repository/repositoryID/source guard.
Host-visible CPU count is distinct from allowed affinity and cgroup quota. A
larger normal runner is accepted and pinned to two allowed CPUs; unsupported
affinity or fewer than two allowed CPUs refuses native work. Available unified
cgroup ancestor CPU quotas are recorded (missing/unreadable quota evidence
remains unknown); effective capacity can be below two. This changes only this
process tree, never runner/cgroup settings. The failed run did not capture
affinity/cgroup capacity, so this does **not** prove matched runtime capacity
or establish a product pass.

No token environment, cache publication, image/service, protected checks,
quality receipt, PR trigger or protected source alias is introduced. Existing
pinned compiler cache may restore dependencies with `save-if: false`; source
is always freshly compiled as dev with Rust/Cargo1.98, Node24.22.1, jobs2,
dev/testdebug0 and incremental0. Full private SHA is supplied to the build
identity; actual binary SHA/size/version and bundled offline Guide full identity
are retained. No old binary or source identity is relabeled.

Bounds are admission/refusal controls, not assurances about provider shutdown:

| Phase | Maximum controller time |
| --- | ---: |
| Signed normal `apt-get update` |900s |
| Ordinary `make setup` (locked Cargo/npm + Chromium download) |360s |
| Locked Playwright normal library installation |900s |
| Canonical flagged asset writer |180s |
| Source-drift command |10s |
| Fresh native locked nac-web build |720s |
| Actual binary version + Guide |10s each |
| One original affected E2E fixture |180s |
| Reserved descendant cleanup / evidence handling |120s |

The first job step records a wall-clock anchor before checkout/tool/cache setup.
The absolute envelope is anchor+2400s, with the provider40min job cap as outer
failure bound. Before **each** operation starts, the controller requires its
entire execution budget **plus120s cleanup and180s artifact margin** to fit.
Each started root/native APT operation retains the existing full900s deadline;
setup360 never wraps or shortens those operations. Build720 and case180 also
receive complete admission before starting. Insufficient remaining time stops
as budget-not-executed/no-result, with a refusal receipt and no operation start.
No guarantee is made that all worst-case phases can execute. Provider work
before the first step and transfer latency remain envelope limitations; the
provider cap can still interrupt and yield no result. No setup failure,
refusal or timeout is a passing case.

Initial b8babc5a50db566a5e71a539fa1c2e982b0ec878 incorrectly advertised180s
APT operation limits and a summed all-phase promise; that contract is frozen
and **superseded** by this full900s/admission envelope. CPU-only follow-up
a11b8e5bd is likewise an intermediate checkpoint, not the final run source.

Normal browser download runs under the ordinary runner UID/HOME/browser-cache
identity through `make setup`, which invokes `playwright install chromium`.
Only the same locked Playwright `install-deps chromium` command runs with the
selected absolute Node path through the existing reviewed root supervisor.
The existing `browser-apt.py run` wraps both privileged commands, anchors the
ordinary caller PID/start, uses root pidfd/subreaper ownership, checks its
root-owned completion receipt and reaps privileged descendants. The browser
itself is never installed as root. The ordinary controller uses the same
reviewed supervisor's direct-child/adoptee pidfd settlement for build/test;
a process-group signal alone is not cleanup evidence. Neither supervision
implementation is modified. SIGTERM/INT/HUP is recorded and bounds terminate
the owned command without replay. Root controller lifetime/lease remains a
boundary if the provider kills the entire runner.

Initial free space must be15GiB, with13GiB monitored reserve; compiler target
has its own12GiB logical-file ceiling, web setup dependencies2GiB, and owned
runtime/raw/evidence512MiB. These are separate budgets. New writes can overshoot
between5s scans; the13GiB floor is a sampled refusal boundary, not a filesystem
quota. Directory traversal has a200,000-entry/10s bound per root. Runtime
monitoring still adds overhead; compiler/dependency directories are remeasured
during their mutating phase and once otherwise, instead of repeatedly scanning
them during the case. Low free space or over-budget restore/build stops, with no shared cache
or other-owner cleanup. No local Cargo build, root/APT, browser run or network
probe was performed during preparation. Cached offline `make setup` and Node
checks are local; local Node26 differs from required hosted24 and is disclosed.

Dependency accounting is limited to the fixed web and `.github/scripts`
`node_modules` roots. Descriptor-relative traversal uses no-follow directory
opens and lstat metadata. Regular files contribute their logical size; a
symlink contributes only its link-entry size, without reading/statting its
target or traversing a linked directory. Outside target bytes are **not**
included. The2GiB logical bound and13GiB physical-free floor remain separate;
this is not a physical allocation or external-target inventory. Runtime/compiler counters still reject links; selected source/evidence
readers still require regular single-link files.

Only invocation-created0700 directories are used. Regular evidence files use
O_NOFOLLOW/O_EXCL and bounded reads; raw traversal rejects links/special files.
After owned descendants settle, selected numeric phases, immutable identity,
the existing case's strictly allowlisted numeric pressure/latency observations,
command timing/exit/cleanup ledgers, root supervisor receipts and raw file hashes
are retained. Runtime payload/SQLite/media/raw logs are removed only from this
invocation's newly created raw subtree; compiler outputs/shared caches are
untouched. No result, failed setup, failed case or missing numeric side remains
an explicit first outcome. Upload includes only the evidence subtree, not
workspaces, credentials, videos or retained terminal payloads.

## Compiler-output identity repair (local preparation only)

The first private run42143349403:1 compiled GNU successfully, then failed at
`digest(target/debug/nac-web)` before version/Guide/case. Actual failed mode and
nlink remain unknown. A separate owned temporary executable hardlink reproduces
the strict selected-reader rejection; it does not prove that historical cause.
The repository's canonical browser-binary producer accepts bounded nonempty
executable regular compiler files without imposing single-link metadata.

The diagnostic now hashes only the closed `ROOT/target/debug/nac-web` path,
opening each literal directory without following links and requiring ordinary
ownership. Its leaf is no-follow/nonblocking, regular, executable and bounded
by512MiB/10s hashing. Before/after descriptor metadata and path identity must
remain equal across the complete hash. Actual lstat/fstat/size/nlink/hash or
rejection metadata is published before return/rethrow. Selected source/evidence
`regular` and `digest` readers remain byte-identical and strict single-link.
Version and bundled Guide checks still follow hashing; the case still follows
full Guide identity validation. No binary is executed in the offline controls.
The missing independent post-raw-delete receipt remains an explicit gap; this
repair does not alter lifecycle code or authorize another profiling run.

## Expected identity preflight repair (local only; parked)

The second authorized private run42146531044:1 accepted compiler metadata/hash
and exited0 for version/Guide commands, then failed at the diagnostic's absent
Cargo workspace.package table. That is not semantic full identity validation,
and no case ran. The canonical product version is ROOT/version.txt, as read
by the build adapter. Expected product/source/dev-track/buildID construction
now runs in preflight before native tool/setup/build work, through the unchanged
strict selected-source reader. Missing, malformed, linked or oversized version
sources fail closed; no Cargo or environment fallback exists.

Post-build version output must match the expected product/short revision, and
bundled Guide must match all four full identity fields and provenance before
the case can run. A bounded comparison receipt retains only allowlisted
expected/observed identity fields and match booleans, never the Guide body.
Real current Cargo-table KeyError RED and actual-root version construction,
forbidden-source and finite identity-mismatch controls run offline only. Both
hosted first failures remain frozen; this correction authorizes no third run.

## Current-source carry (local preparation only)

The parked7ce33cf7fdd9d2c325b1406a8def343534e8832e source and two failed
profiler packets remain untouched. This new private branch
`codex/all-582-terminal-profile-current-20261106` starts from verified remote02354e7b9c,
including landed627. The timed implementation bodies are byte-identical between historical5603 and
current02354 before tagged instrumentation. The module roster additionally
retains current attention, attention_runtime and fresh_task_schedules entries; newer
product features, API, lockfiles, guides and test diagnostics are retained from
current source. The source baseline pins intentionally move to current02354,
including its changed Cargo.lock and exact canonical version.txt. No authority
or source guard is weakened. Assets are rebuilt from current source using the
canonical flagged writer, not copied from the parked branch. The parked
version.txt preflight and compiler-output NoFollow fixes are carried intact.
The unchanged cf548 case has still never executed under this profiler. Fresh
GNU compilation/full identity/runtime and cleanup remain unverified here; a
third hosted attempt requires Root authorization after affected carry review.
The independent post-raw-delete receipt gap remains explicit.

## Pre-execution gates

Run offline projection/numeric/NoFollow controls, focused SDK parser/ACK tests,
web typecheck/lint/format, flagged canonical asset writer, source-size and real
pinned workflow lint. Keep raw failed preparation attempts as such. Then one
independent source/protocol-preservation review is required. Actual GNU compile,
normal privileged setup, resource/cleanup behavior and the original case remain
**hosted pending**; this candidate does not establish a diagnosis or fix.

## Compiler sampler repair (local only; no fourth run authorized)

Separately authorized third run42162541663:1 on7c8160cad failed while the
resource sampler called lstat on an enumerated target object pathname that was
absent. It did not complete compilation or reach binary/full Guide identity or
the case. Its packet, both earlier private failures and all original terminal
failures remain frozen. Which process removed/renamed the object was not
observed; no compiler/product cause is claimed. The additional PR5631580.8ms
failure is separate context, not profiler evidence or attribution. Its owner
later supplied cached immutable prepared3416f6e66d91bea08dd0132bc83ae264173470d8,
distinct from head8fb63b20301e9e8ff074b1ef7ae4b1c3743f669f; no duplicate provider
fetch, local reproduction or causal equivalence is inferred.

Only compiler ROOT/target sampling now uses a closed descriptor-relative counter.
Ordinary ownership, device/inode binding, no-follow type checks,200,000 aggregate
entries and one10s scan budget remain mandatory. Descendant ENOENT marks the
current pass incomplete and records the omission; active-build rescans share
that SAME entry/time budget and stable root binding. Current logical_bytes is
null until a complete pass succeeds. Last-known completed bytes are separate
metadata and never admit a current cap. Initial absent active roots likewise
cannot yield a cap result; missing/replaced bound roots, changed identities,
links, special/foreign entries and permission/other errors fail closed. A scan
that cannot complete in budget raises typed accounting-unknown/no-result.
Complete scan means no observed omission, never an atomic snapshot or peak.
The12GiB logical ceiling and13GiB physical-free floor are both unchanged.

After build descendants settle, strict no-omission compiler inventory AND the
byte-identical original strict size() final cap must pass. Final inventory and
any secondary rejection are retained in the command receipt. Selected-source,
evidence/runtime readers and strict size() remain byte-identical. No parser,
ACK, fixture, await, schema, asset, timeout, job/resource envelope or clock is
changed. Offline controls use real owned temporary unlink/directory/link/sparse
fixtures plus explicitly mocked foreign metadata/budget/child APIs; they never
execute Cargo/native/browser/root or binaries. No fourth allocation/run/push is
authorized by this local correction. Helper remains private NEVER LAND.
