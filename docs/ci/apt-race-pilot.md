# Private dynamic-plan native APT acquisition race

This is a payload-only experiment based on exact production parent
`5603ad0bda5d8e62cf9587659f4548131c1bbf45`. It changes no production workflow,
installer, test, cache, font, dependency, clock, retry or quality contract. The
private push trigger matches only `codex/all-582-apt-race-pilot-20261106`.
Publication and a single diagnostic execution require the owner's review and
dispatch decision. No hosted result, runtime parity, pipeline improvement,
controlled-cold qualification, cohort or strategy credit is claimed here.

The observed #623 first source `42130569629:1` passed in 1,032 seconds. Its
producer's exact native package download took 552.222 seconds, versus 2.633
seconds for fresh planning and 0.060 seconds for immutable export. Its nine
selected packages totaled 21,857,278 bytes. An untimestamped `Ign` and repeated
`Get` for `xfonts-encodings` cannot assign that entire delay to one package or
prove a mirror, network or runner cause. Earlier healthy hosted ABBA evidence
favored Azure, contradicting the local static-mirror direction. This pilot
therefore tests redundant authenticated acquisition, not a permanent mirror swap.

## Authority and result rule

The stdlib controller reads the current locked Playwright request authority. It
copies the actual native source configuration into a fresh private APT tree,
preserving native architecture/variant configuration and signing keys while
keeping lists, caches, logs and hooks separate from the host. Canonical, Azure
and official-route trees each independently perform fresh signed APT update
with date/valid-until and insecure-repository checks, full native simulation,
URI selection and authenticated package-record joining. The two route trees
rewrite recognized Ubuntu base URIs only. Other native repositories remain
unchanged. Unknown source/architecture forms stop the pilot.

Every route must equal the canonical full current missing closure in package,
version, control architecture, native Filename variant, size and SHA-256 before
any baseline or race acquisition starts. No historical nine-package list,
ancestral Git object or old benchmark file is a runtime input. Empty or more
than 32 missing packages is an explicit unsupported finite-pilot failure; the
full closure is never truncated. The native baseline is hashed before/after
planning. Signed InRelease bytes and exact commands remain evidence. A mutated
current Ubuntu InRelease must produce an actual native gpgv BAD-signature failure.

The unchanged single native-route acquisition runs once, then its verified bytes
are removed before the candidate. Two ordinary-UID native `apt-get download`
workers race in independent roots, with identical exact pins and native retry
behavior. A winner requires the complete closure plus size/SHA and Debian control
verification. Every observed completed arm is checked for errors before election;
completions during verification are checked again. A simultaneous tie is labeled
and uses lexical selection, not invented subsecond network ordering.

The redundant live arm receives an explicit nonce-bound `winner-cancelled`
request. Only a worker's actual cancellation receipt, signal termination and
empty remaining-descendant inventory can establish that disposition. It is
never reported as a successful network transfer. A real positive error exit
during cancellation remains failed. A simultaneously completed arm must also
pass full byte verification. Unexpected network, signature, hash, control,
identity, resource, worker or cleanup failures fail the comparison even when
another arm could supply bytes. Native `Ign`/internal retry output is retained;
it is not rewritten as a separate passing operation or attributed without timing.

Cancellation additionally requires the original owned child PID/start, a recorded
teardown signal for that exact identity and a matching reap/TERM-or-KILL exit.
Independent crashes or signals without that evidence fail, including a child
that dies between stop observation and teardown. During budget draining all
archive/index/total/text/free-space fences stay active; a separate resource
violation stops the failed experiment rather than granting a clock exception.

## Process and resource ownership

Each GNU acquisition worker is an ordinary-UID Linux child subreaper. It reuses
the production direct-child/adoptee PID-start/PPID/pidfd ownership primitives;
it never recursively trusts transient numeric nested-child lists. Parent loss,
signals, unexpected child failure and cancellation trigger owned TERM then KILL
and reaping. Escaped descendants become direct adoptees before signaling.
There is no sudo, root command, broad PID/name kill, global cache cleanup or
service. Abrupt worker/VM destruction is not claimed as a locally proved cleanup
case. GNU escape/sentinel, signal and parent-loss controls run before the pilot;
they are explicitly skipped on local macOS rather than relabeled as proved.

One standard Ubuntu VM has at most two acquisition workers. Controller and
workers share a two-CPU affinity. Each native worker has a 768 MiB address-space
limit; index files have a 128 MiB file limit and each acquisition's file limit is
the largest authenticated selected archive. Each private authority's index tree
has a separately sampled 384 MiB fence. All three authority trees, logs and
archives together have a sampled 1,536 MiB owned-data fence; text evidence has
a 128 MiB fence. Initial free space must reserve that amount above 13 GiB; the
13 GiB early-stop fence remains active in both controller and workers.

The existing 64 MiB archive-file and 192 MiB archive-copy bounds are not raised.
Preflight reserves three full candidate payload copies plus 1 MiB metadata under
192 MiB; the baseline is removed first. Both race directories, including partial
files, and the winner export are counted. Sampled aggregate fences are not exact
physical high-water measurements; native per-file kernel bounds and APT digest
checks are additional controls. A resource refusal is a failed experiment, never
a smaller package selection. No unrelated data is removed. Cleanup checks the
original private root device/inode and refuses a foreign replacement.

## Absolute admission budget

The first workflow step records `PILOT_JOB_STARTED` before checkout/npm/setup.
The job has an absolute 40-minute infrastructure budget. The controller deadline
is the earlier of 35 minutes after controller start and the remaining job budget
minus 30 seconds for cleanup. Before every native command, the controller must
admit the full original **900 seconds plus cleanup**; the worker independently
checks the same monotonic deadline before spawning its command. No started native
operation receives a shortened timeout. Failure to admit is typed
`budget-not-executed-no-result`, exits nonzero and grants no performance credit.
Already admitted operations drain through their full original bound if a later
operation cannot start. There is no resume, automatic retry or repeat-to-green.

The budget does not promise that all operations can execute under simultaneous
worst cases. Healthy execution is expected to be roughly 1–2 minutes, subject to
fresh-index/setup/network variation; the actual observed slow prefetch alone
was about nine minutes. If prior operations consume the budget, later signature,
baseline or race coverage is explicitly absent. Job bootstrap before the first
step is not measured by that timestamp. Actual job metadata remains the source
for allocation duration; sampled wall/RSS and runner-seconds are not dollars.

## Commands, records and limitations

Local offline commands after required setup:

```sh
CARGO_NET_OFFLINE=true npm_config_offline=true make setup
python3 .github/scripts/apt-race-pilot.test.py -v
node --test .github/scripts/apt-race-workflow.test.mjs
make lint-workflows
make test-source-size
```

The private workflow installs only locked request/control tooling, executes the
GNU controls, then runs:

```sh
python3 .github/scripts/apt-race-pilot.py --source "$GITHUB_SHA" \
  --output "$RUNNER_TEMP/apt-race-evidence"
```

The control step explicitly selects Bash and enables `set -euo pipefail`.
[GitHub's shell contract](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#jobsjob_idstepsshell)
distinguishes unspecified Linux shell behavior from explicit Bash. A real local
execution of the parsed step with failing Python/Node stubs proves pipeline
failure stops later work; this is shell behavior, not GNU/native APT coverage.

Raw native stdout/stderr, UTC command intervals, worker exits/cleanup and child
usage, signed authority, source/tool/runner/run/attempt identities, full plans,
per-package verification times, retained complete/partial byte counts and sampled
resource fences are retained even on failure. Native package transfers are only
timed as complete commands when per-package timing is not observable. Native
retry and protocol/index overhead mean wire bytes are not inferred as exactly
twice the selected payload. Artifact upload is real but contains bounded text
and a winner manifest, not duplicate .deb or Packages-index copies. Actual
service timing must be read from the hosted job; no service gain is assumed.

The isolated native APT configuration approach is adapted from this repository's
own benchmark at `91e907d5` (no copied external code/license/dependency). That
revision is provenance only. The existing immutable store validates current
bytes; production authority/cleanup modules are imported read-only. This is a
refinement of the same-run archive relay with transport overlap disclosed, not
S09 executable sharing, S17 compiler caching, S18 image caching, cross-run cache
service proof, trusted seeding or accepted production/runtime coverage. Any later
adoption must separately preserve the unchanged normal with-deps installation,
fonts/Chromium, full ordinary inventory plus dedicated proof and all quality joins.
