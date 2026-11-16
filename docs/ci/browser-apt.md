# Same-run authenticated browser OS archive relay

The required `browser-apt` job exports a current native OS-package snapshot in
parallel with the independent `browser-binary` job after preparation. Eight
ordinary browser shards and the dedicated proof job await both and consume each
producer's specific artifact ID. This is same-run byte transport, with no Actions-cache
save/restore, trusted seed, cache quota/eviction claim or new token privilege.

The first private native pilot, source `036416ca23e4147bdd8c29903fe0bb73094adcc6`,
[run 42117004436](https://github.com/arcee-ai/nac/actions/runs/42117004436), passed
exact installed-package/font/Chromium/binary/API and three unchanged representative
journey comparisons. Normal Playwright installation took 86.35 seconds cold and
16.04 seconds with an authenticated offer, a roughly 70-second contrast in that
step. Pager/index variability and service/compile/setup costs remain separate;
this is not a 139-second whole-job saving, full browser qualification or causal
whole-CI gain. Earlier mirror results contradicted their local direction, and
archive-only prototypes did not establish installation/runtime parity.

## Producer and current authority

Compilation and S09 binary transport retain their existing source/profile/Rust
and read-only compiler cache contract. Independently, the native producer checks
out the same prepared source, selects package relay mode, installs the pinned Node/locked web dependency tree
and matches the consumer pager setup when the relay is enabled. These additional
steps are required when selected. Setup, signature, resolution, prefetch or
advertised-upload errors are failures, without blanket fallback or retries.
The native producer has no Rust toolchain or compiler-cache step. Its original
seven native steps are unchanged. Both producers must succeed, so a native
network tail still blocks consumers; this split does not make prefetch optional.
The extra Ubuntu allocation/checkout/queue cost and current-source full path need
hosted measurement. No observed saving follows from overlapping a prior
85-second build with a 552-second prefetch on a different source/run.

The cohesive stdlib owner is `.github/scripts/browser-apt.py`; immutable byte and
Debian-control validation belongs to `apt-archive-store.py`. Production imports
no private Docker probe or representative-journey controller. There are no new
dependencies, font omissions or native source/locking/hook changes.

The producer binds the prepared source, repository, run, attempt and actual
ImageOS/ImageVersion. On supported actual Ubuntu 26.04 GNU amd64 hosts it uses
fresh signed native APT indexes with date/valid-until/insecure-repository checks,
the current locked Playwright tools/chromium requests, and the complete current
missing solver closure. Selected URI, version, control architecture, native
variant, size and SHA must agree with authenticated records. No historical
nine-package or container-120-package set stands in for future defaults.

Only one verified content-addressed snapshot plus bounded transport manifest is
uploaded, with source/run/attempt-qualified name and zero compression. Producer
outputs bind the manifest digest to the artifact ID; consumers never search by
name. Raw downloads/restored offers are excluded from bounded evidence artifacts.
Signed index bytes, commands, modes, operation timing and failures remain evidence.

Explicit no-artifact modes are `disabled-cold`, `unsupported-platform` and
`nothing-missing`. The last means the native solver selected no missing packages;
it is not a cache hit. Unsupported release/ABI uses normal installation without
an offer, rather than treating a frozen point release as future authority.
Unknown modes, arbitrary errors and missing advertised evidence do not become
these modes.

## Consumer admission and normal installation

Each supported non-cold consumer independently refreshes signed authority and
resolves its own current full plan after normal pager/npm setup. Baseline dpkg
status, actual image/ABI, locked tool and plan identity are retained. Existing
S09 executable selection/source fallback is independent and unchanged.

A ready artifact requires a positive exact ID, nonempty anchored receipt and a
new download leaf. Complete producer identity, manifest inventory, package bytes,
size/digests and Debian control identity are validated before deciding whether
any compatibility fallback is allowed. Malformed/duplicate/unbounded fields,
foreign source/repository/run, future attempt, missing/corrupt/partial/extra/link
members and wrong control identity fail hard, including during image or
older-attempt mismatch. Current-source locked-tool drift also fails hard.

A fully valid older-attempt artifact, changed runner image, unsupported consumer
platform, changed dpkg baseline or changed fresh current plan selects normal APT.
The helper discards its private validated offers and records the specific reason;
it does not offer mismatched bytes to root. Older successful producer outputs on
a legitimate failed-job rerun therefore cannot supply current quality or stale
package-installation verdicts. Corruption is never hidden by that fallback.

Exact-compatible bytes become `verified-offer`, meaning verified archives are
available for normal APT. That mode alone does not prove that APT consumed them;
retain the actual normal-install log's requested/fetched-byte evidence. Root
creation is exclusive and no-follow and revalidates copied bytes. No existing
cache file is replaced. The existing `npx playwright install --with-deps chromium`
step remains unchanged: normal signed APT, dependencies, fonts, maintainer scripts,
locks, hooks, configuration and locked Chromium installation remain effective.
Configured selected package version/architecture/variant and installed font
hashes are recorded afterward on native-plan paths. Normal-install plan drift
fails that check and is not labeled successful reuse.

Always-run root cleanup uses exact recorded device/inode identities. It removes
only this invocation's offered entries, including a recorded partial copy, and
refuses foreign replacements or malformed/link ownership evidence. Normal APT
may already have removed the files through ordinary hooks. No global cache is
pruned; private evidence/downloads last until upload and disposable-runner cleanup.
Native helper commands retain exit/wall/cost logs, bounded output and a 13 GiB free
space guard. Ordinary commands use their own process group. Privileged metadata
commands use a root-side Linux subreaper with a private nonce/caller PID-start
lease, exact owned kernel ancestry and pidfd signalling. Timeout, interruption or
caller/launcher loss triggers bounded TERM then KILL and reaping, including
escaped-session descendants. Sudo-wrapper exit never proves cleanup: the caller
requires an actual root-owned receipt with no remaining descendants. No broad
PID/name scan, unrelated process signalling, NAC deadline or retry is introduced.
The private standard-GNU UID0 control includes the old wrapper-group survivor gap,
a TERM-ignoring descendant, parent loss and an independent root sentinel. Its
actual hosted result remains a separate gate; local mocked/nonroot controls do
not establish privileged teardown.

## Cold mode, coverage and quality ownership

The existing exact first-line PR cold marker and typed manual boolean are
unchanged. `cold_caches=true` additionally bypasses package prefetch, package
artifact reads and offers. Existing Rust/image cold isolation and S09 same-run
executable sharing remain; normal with-deps and every browser case still run.
There is no new input or cache-write authority.
The native job still runs its required checkout/preflight/evidence path in cold
mode and emits `disabled-cold`; Node/npm, native planning and prefetch stay bypassed.

`browser-apt` is a separate explicit `requiredJobs` entry; `qualityJobs` stays
unchanged. Both producers, all eight shards and proof must succeed; the browser join, test join and final
Required check retain their exact ownership. Package metadata never supplies a
quality or execution verdict and never enters managed quality receipt reuse.
Independent API/assets checks and the selected-binary ALL471 source/hash binding
remain mandatory.
The binary and native producers may receive different runner images during a
rollout. Each artifact retains its independent strict validation and valid
compatibility fallback; matching one never admits the other or reuses a verdict.

The complete current disjoint inventory, all ordinary selections and the
dedicated proof names remain. Ordinary test-level sharding stays eight shards, one worker,
zero retries. Dedicated proof stays serial with its real clocks, original
assertions/deadlines/cleanup and bounded two-receipt artifact. The private pilot's
three representative journeys are not the full acceptance set.

`browser-apt-parallel-wiring.mjs` verifies the exact split job, seven unchanged
steps, output references and required dependencies before recovering the
colocated graph at parent `0cfae9c3c999721a9e1e78c0801ccbc974c5d0da`.
`browser-apt-wiring.mjs` then matches every relay field before reversing
exactly those additions. The parsed guard recovers the full workflow at
parent `914782659a6183b89070a3516e2e44776b1eeb06`; the existing cold guard then
recovers all prior normalized hashes, provenance and four child-workflow hashes.
It does not delete arbitrary matching steps or replace an opaque failing digest.
Mutations cover cold reads, missing identity/receipt/fresh leaf, root offer/cleanup,
weakened normal install/proof/join, cache writes and ignored errors. Real CLI
archive, mismatch, root-filesystem and owned-child controls run through the
required release checks.
The required-job addition intentionally changes the `pr-checks.mjs` and linked
managed-applicability hash pins; the other six admission authority pins remain
byte-identical. Existing parent/cold fingerprints and the current elapsed-evidence
addition remain independently guarded. No private race-controller code enters production.

## Qualification boundaries

Collect producer added setup/resolution/prefetch/export/upload, all nine exact
images/modes/fallback reasons, actual download/validation/root copy/normal APT/CDN,
configured state, cleanup, full browser critical chain and total run/job times.
Nested command phases are not additive to their containing operation/job.
Do not infer CPU cost, dollars, net compute savings or a mirror cause from wall
time. A healthy same-run artifact may add overhead; a rollout may cause multiple
normal-source/normal-APT fallbacks. Both remain real measured outcomes.

Current-source full browser/proof/API/quality/native/image CI and established
controlled cold qualification follow publication and may be pending explicitly.
No full-source pipeline, broader runtime parity, Actions-cache service or trusted
writer is claimed by the representative pilot or the local controls. Campaign
strategy/cohort accounting remains the owner's separate evidence obligation.
