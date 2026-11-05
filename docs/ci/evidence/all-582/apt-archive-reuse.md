# Private authenticated OS-archive reuse prototype

This is an implemented package-byte mechanism experiment, separate from all
production workflows and PR quality. Qualification remains unassigned and the
campaign remains **14 measured / 0 of 10**. The production base is exact dev
`2b0c550f96d2255640ac03b3a84d6527a547aaa0`. The prior mirror experiment's
`91e907d5ce90e62aaa492d9faf5922b05476ab47` branch and contradictory results are
preserved. Neither static mirror selection nor another timeout/retry knob is
proposed. The recurring production APT payload tails were real; removing that
tail alone would still leave the separately measured 714-second managed path.

`apt-archive-experiment.py` reads tools plus Chromium requests from the current
installed, lock-matching Playwright data. It does not use a historical nine-font
package list as future defaults. It resolves the full current dependency closure
from fresh signed Ubuntu base/update/security/backports indexes, including all
normal components. APT's actual selected URI, version, variant and size identify
the matching SHA256 record from authenticated indexes. Every requested font and
library remains included. Unexpected removals, unsupported records, empty or
oversized closures, ambiguity, signature/index errors and arm-to-arm drift stop
the experiment and retain the failure.

`apt-archive-store.py` exports an exact content-addressed snapshot and restores
only against that fresh current plan. Repository, Ubuntu ABI/variant scope and
the complete package digest set bind its key. Source provenance is bounded
audit data, not an authorization or cached quality verdict. Every archive must
be a bounded regular file with one link; SHA256, size and actual Debian control
identity are checked on held descriptors. Copied bytes are reverified before a
completed offer directory becomes visible. No tar extraction or maintainer
script execution occurs. Partial/extra inventory, links, malformed manifests,
foreign/stale/platform mismatch and corruption fail before offering files to
APT. A genuinely absent snapshot returns an explicit miss; controlled-cold
returns no bytes and no offer, even if an unused snapshot is present.

One existing immutable official Ubuntu 26.04.1 amd64 image runs sequentially as
uid 65534, at 2 CPUs/768 MiB memory with equal memory-plus-swap/128 PIDs. The
probe never pulls/builds an image or installs host tools. Each arm uses fresh
private APT lists/archives, preserves signature/date/Valid-Until policy and
verifies all four InRelease signatures. Base Release may omit Valid-Until;
there is no recent-publication claim. Unprivileged simulation/download-only
uses `Debug::NoLocking`; this configuration must never be used for a real
installation. Existing package status is read, not changed. No package,
Chromium, browser journey or NAC binary is installed/executed by this prototype.

The cache hit is an explicit verification result plus APT's own zero-byte
download requirement; speed alone cannot label a hit. The private snapshot
export/restore and Docker copies are measured, including duplicate bytes. They
are not a GitHub cache service restore, network transfer or trusted seeded hit.
No shared cache action/write permission is present. A real trusted cache seed
remains pending legitimate dev/main landing. Production PR read-only, trusted
dev/main-only writes and controlled-cold nonce behavior remain unchanged. Any
later integration must retain those guards and normal APT locking/installation,
all native packages, pinned Chromium, actual journeys, one worker, zero retries,
real clocks, cleanup and mandatory proof. None is replaced by this result.

The first real arm (`d7d198eeb`) failed before downloads because it incorrectly
treated amd64v3 as the native ABI. The next (`8faada467`) stopped before downloads
when an encoded `+` in an APT URI did not match the literal signed filename; its
explicit source architecture filter also suppressed variants. Both are retained.
The correction keeps native amd64 and enables the supported variant preference,
without overriding source architecture expansion. See the
[Ubuntu Foundations description](https://discourse.ubuntu.com/t/introducing-architecture-variants-amd64v3-now-available-in-ubuntu-25-10/71312)
and [APT's source parser](https://salsa.debian.org/apt-team/apt/-/blob/main/apt-pkg/deb/debmetaindex.cc).
URI decoding binds the actual selected file to signed metadata, never guesses
which generic/v3 record to use.

The first complete positive arm (`bbf34dfb2`) resolved 120 packages / 93,650,338
bytes from 33 current Playwright requests. APT cold download took 40.703s;
container-to-host copy 6.315s; verified export 0.112s; verified restore 0.146s;
offer copy 0.652s; real APT hit 1.056s, with `Need to get 0 B/93.7 MB` and no
Get lines. It took 198.030s overall: separate metadata queries cost 67.550s cold
and 72.196s hit. Those costs are retained; the fast transfer is not a whole-path
saving. The final candidate batches identical metadata selection into one APT
query per arm. Its measured result is recorded in the companion JSON. The
final producer-provenance check was also replayed against all 120 real archives,
with controlled-cold yielding no offer; no extra APT run was hidden in that replay.

The final batched arm (`cce11568d`) completed in 68.456s with the identical
120-package key: cold transfer 38.774s, source copy 6.139s, verified export
0.114s, verified restore 0.116s, offer copy 0.547s and real APT hit 0.800s with
zero bytes needed. Fresh resolution time, setup and all other costs remain in
the companion JSON and total. Earlier failures and the slower positive arm were
not removed or relabeled. This is one local fixed-order mechanism comparison,
not a full production before/after timing or a qualifying CI observation.

Six real snapshot negatives reject wrong platform/repository, stale version,
corruption, partial inventory and links. Fourteen offline byte-boundary controls
also cover hardlinks, malformed/duplicate producer/manifest data, existing-output
preservation and control identity. Five source/solver controls cover current
locked requests, ABI/variant configuration, full solver inventory, URI escaping
and selected-variant identity. Eleven parsed diagnostic-workflow controls reject
broadened triggers/permissions, shared-cache writes, image/source drift, secrets,
missing attempt binding and lost failure evidence. The initial offline
existing-output test mistakenly expected its pre-existing directory to vanish;
that failed assertion is retained and corrected without changing store behavior.

Run with an already-available pinned image and existing valid locked web setup:

```sh
python3 .github/scripts/apt-archive-store.test.py
python3 .github/scripts/apt-archive-experiment.test.py
node --test .github/scripts/apt-archive-workflow.test.mjs
python3 .github/scripts/apt-archive-experiment.py \
  --source "$(git rev-parse HEAD)" --output /absolute/new/private/output
```

Package closure is bounded to 192 MiB, each archive to 64 MiB, output to 1 GiB,
container writable state to 768 MiB, host early stop to 13 GiB and elapsed time
to 1,800s. The complete positive arm reached 493,879,296 container writable
bytes and retained three distinct-inode host payload copies (280,951,014 bytes).
Only owned containers/private temporary copies are removed. Old evidence,
images, caches, other owners' work and global settings are untouched.

The unpublished diagnostic workflow is exact-private-branch push only,
contents-read, pinned existing checkout/Node/upload actions, no secrets, no PR
trigger and no shared cache saves. It prepares locked parser data, acquires only
the pinned official image, runs this same comparison and uploads source/run/
attempt-bound failure-inclusive evidence. One reviewed hosted execution would
test Linux/Docker/tool behavior and retain image acquisition, setup, transfer,
validation/export/copy and upload costs. It would still not prove actual Actions
cache transfer, normal installation/runtime parity or whole-CI improvement.
Those require a later authorized experiment on normal runner state and unchanged
production installation/journeys, with a legitimate trusted seed and controlled
miss/hit observations. No push/run/PR/production switch occurred in this unit.

The reused bytes are external OS archives, unlike S09's candidate executable,
S17's compiler dependencies or S18's incremental compiler state. Authority and
invalidation differ, but general caching overlaps: a different data domain alone
does not earn another mechanism count. Local Mac emulation, minimal container
state (120 packages rather than the hosted image's nine missing archives), warm
network effects and private local copy costs limit all performance conclusions.
Raw data are local-only at the companion JSON's locator; no hosted savings,
compression/capacity/dollar claim or synthetic acceptance cohort is asserted.
