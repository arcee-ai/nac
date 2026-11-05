# Private native APT artifact/runtime comparison

This diagnostic extends the archive-only experiment at `1874a1dc` and its first
hosted run `42106495033`. That run proved authenticated download-only reuse;
it did not install packages or run Chromium/NAC. Its healthy-host cold/hit APT
commands took 5.552/0.668 seconds, before producer, copy and service overhead.
The original artifact unnecessarily contained three payload copies. The separate
static-mirror experiment contradicted its local result on the hosted runner.
Neither result justifies a production mirror or cache change.

Final dev source run `42090538362` subsequently passed with Chromium installation
steps of 582 and 659 seconds on two ordinary shards; other installations took
13–33 seconds. The retained shard-1 log attributes its delay to native APT archive
transfer, with Chromium download taking about eight seconds. The managed path
also lasted 714 seconds from prepare: removing this browser delay would not prove
a whole-pipeline target. These are observations, not a mirror-cause attribution.

## Scope and authority

The workflow `apt-runtime-parity.yml` runs only on pushes to the private branch
`codex/all-582-apt-runtime-parity`. It has read-only repository permissions, no
secrets, no shared-cache writes, no production-workflow changes and no PR/cohort
role. It has three actual jobs: one producer, followed by a cold/hit consumer
matrix on fresh `ubuntu-latest` runners. Ubuntu 26.04.1, native amd64 ABI, actual
`ImageOS`/`ImageVersion`, immutable source, repository, run, attempt, initial dpkg
status digest and the exact installed Playwright bundle/lock are admission
inputs. A runner rollout or baseline mismatch stops the comparison.

Every runner performs normal pager/npm setup, then a fresh native signed APT
update with date/valid-until checks and insecure/unauthenticated repositories
explicitly disallowed. Signed InRelease files and command output are retained.
The current locked Playwright `tools` and `chromium` requests determine the full
native solver closure. The helper binds selected URI, version, control
architecture, native archive variant, size and SHA256 to APT's authenticated
records. It does not substitute the historical nine missing font/X-font pins,
freeze a historical closure or alter native source configuration and hooks.

The producer downloads that closure with native APT, verifies Debian control
identity and every byte, and exercises the existing six real-snapshot negatives
before export. It uploads one content-addressed snapshot plus a bounded transport
manifest. Raw downloads and restored offers are excluded from all text uploads.
A job output binds artifact ID and manifest digest to the exact source/run/attempt;
consumers never search by artifact name. The cold consumer validates producer
identity/current-plan agreement without downloading package bytes. The hit
consumer downloads that specific ID into a new leaf, validates all members,
manifest/digests/control identities and current authority, then copies verified
files to the root APT archive cache using exclusive no-follow creation. Missing,
partial, corrupt, foreign, linked, stale or wrong-platform evidence fails closed.
An existing required archive is an uncontrolled baseline and stops either arm.

The package artifact is an actual Actions artifact-service measurement. It does
not establish Actions-cache save/restore/eviction behavior or a legitimate trusted
seed. The currently observed repository cache usage is not a free capacity budget.
Future adoption would need that separate trust/service/capacity evaluation.

## Exact-source runtime and coverage

The producer builds the current GNU `nac-web` once using Rust 1.98.0, locked/default
features, dev/test debug 0, incremental 0 and four compiler jobs. The existing
S09 helper packages it with source/repository/run/attempt/compiler/profile/target/
actual image and digest receipts. Consumers use its unchanged strict admission;
its source fallback remains available, with only a read-only compiler cache.
The package baseline guard will normally reject image drift before that fallback,
because cross-image package comparisons are not interpretable. Binary compile,
transport, fallback mode and actual runtime digest remain separate evidence.
No old local or GNU binary is relabeled as this candidate.

Both consumers run the locked Playwright CLI's normal
`install --with-deps chromium`. Normal APT locking, dependency selection,
maintainer scripts, configuration, native libraries, fonts and Chromium requests
remain effective. The hit must report zero requested archive bytes; the cold
must request positive bytes. The post-install check requires every selected
package's exact configured version/control architecture/variant and records the
complete supported system-font inventory with content hashes. It never deletes
or omits fonts. Unexpected font roots or inventory bounds fail the diagnostic.

Each arm launches the locked Chromium headless-shell revision, checks its actual
version and executable hash, runs `ldd`, and renders a small UTF-8 font probe.
It verifies the exact executable CLI/full offline Guide identity, then runs these
existing production-embedded cases without modifying their source:

- Outgoing MCP CRUD, test and runtime status on desktop.
- The same outgoing MCP journey on mobile.
- Joined installed Guide and scoped navigation on desktop.

The third case joins real native `/product-context` facts and native Guide/tool
results. Its retained evidence must match the offline binary's full build
identity. All three original assertions and deadlines remain; workers are 1 and
retries are 0. There are no force clicks, fixed sleeps, clock substitutions,
assertion changes or blanket retries. Scripted provider fixtures make no real
provider calls. This representative selection is not all 205 browser cases,
ALL471 proof, server/native suite or ordinary-CI acceptance.

The final `compare` command requires exact equality of configured packages,
font bytes, Chromium revision/version/bytes/font metric, native binary digest,
full API/Guide build identity and the exact three passing names. Source/baseline
agreement alone is not a runtime-parity verdict. Both consumer reports and their
cleanup receipts are required; one success cannot erase the other arm's failure.

## Resource, cancellation and cleanup contract

Jobs have 35-minute controller bounds; compilation uses four jobs and journeys
one worker. Command controllers retain elapsed time, exit, byte counts, real APT/
Chromium milestone timestamps and bounded stdout/stderr. They stop below 13 GiB
free disk or above 32 MiB command output. A command timeout or interruption kills
only its created process group and remains a failure, without retry. A descendant
holding output pipes after its parent exits also fails and is settled.

Only browser/fixture children receive an invocation-specific ownership marker.
The cleanup controller and runner shell do not. The existing descendant cleanup
helper settles only that marker, and finding a leak remains a parity failure.
Root archive cleanup records created device/inode identities, refuses foreign
replacements and removes only exact offered inodes; APT may already have removed
them through its ordinary hooks. Partial copy ownership is retained for cleanup.
Installed packages are left configured until the disposable runner terminates.
Private downloads/evidence remain in that runner's temporary directory until
artifact upload and normal runner disposal; no global cache is pruned.

Root-cache correctness controls use an owned temporary directory with mocked
root identity locally; no host APT cache or root package installation is used.
Real subprocess interruption controls exercise SIGINT and SIGTERM against owned
SIGTERM-ignoring children. Fixture-byte tests are controls of admission, not
claims of native install/runtime coverage. The native workflow remains unrun at
authoring time; no local Cargo, Docker, browser or package installation is needed
to prepare it. Existing setup is valid because both lockfiles are unchanged.

## Commands and evidence interpretation

Local focused controls:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 .github/scripts/apt-runtime-parity.test.py -v
node --test .github/scripts/apt-runtime-workflow.test.mjs
node --check .github/scripts/apt-runtime-browser.mjs
make lint-workflows
make test-source-size
git diff --check
```

After one independently reviewed private publication, retain the first run's
complete producer/cold/hit step metadata and all success/failure text artifacts.
Do not rerun a failed arm into the first comparison. Actual artifact upload AND
download durations/bytes must be included, together with signed resolution,
prefetch, export, verification/restore, root copy, normal APT/CDN phases, exact
source compilation/transport and representative journey time. Command milestone
times are nested in command elapsed times: do not add them twice. Setup/tool/
cache service and finalization gaps need actual step timestamps, not inference.

Run the post-run comparison on the two retained `runtime-result.json` files:

```sh
mkdir -m 700 /tmp/apt-parity-compare-unique
python3 .github/scripts/apt-runtime-parity.py compare \
  --state /tmp/apt-parity-compare-unique \
  --cold /absolute/cold/runtime-result.json --hit /absolute/hit/runtime-result.json
```

This is an artifact-transport refinement of the authenticated archive-reuse
prototype, distinct from S09 executable sharing and S17 compiler dependency
sharing; it shares their identity/trust principles. It is not image compiler
reuse (S08/S18), a new mirror knob or another strategy credit. Mechanism credit
remains unassigned and campaign status remains 14 measured / 0 of 10. No hosted
savings, production journeys, Actions-cache hit, trusted writer or cohort result
is claimed before the corresponding actual evidence exists.
