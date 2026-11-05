# Private S08/S18 image compiler comparison

This is an unpublished, unexecuted diagnostic candidate. It adds no production
optimization or strategy credit:14 measured mechanisms,0of10 accepted cohort.
The ordinary image workflow, Dockerfile, release profiles, cache writers and
quality/publication/standalone contracts are unchanged. Root remains the sole
publication/landing owner. Independent changed-concern review precedes any push.

Final dev source `2b0c550f96d2255640ac03b3a84d6527a547aaa0`, tree
`486654235b2ca505c628376e8ecfc254f500b72a`, completed run42090538362:1
in1112s processing/1115s event,6435 executed assigned-job seconds. It is a dev
push, not an ordinary qualifying PR. The browser worker owns its separate659s
APT bottleneck. The latest nonbrowser managed join finished714s after prepare.

Image job127467638485 took630s. Its build step took451s:

| Observed phase | Seconds |
| --- | ---: |
| Cached dependency-layer materialization; no external compile |32.7|
| Real source COPY |3.1|
| Workspace clean plus six real local crates; zero external crates |337.9|
| Cached runtime toolchain materialization |26.7|
| NAC binary COPY / offline Guide |2.7 /0.2|
| Runtime tool/provenance checks |12.3|
| In-daemon image export/load |5.5|
| Trusted-push-only GHA max export |26.1|

The selected phases total447.2s; small frontend/context/gap overhead remains.
Repeated per-vertex DONE values are cumulative, not extra operations. Inventory
and live scan/report took33s and110s after smoke9s. The log does not separate
Grype download/update, scans, OSV requests or policy work. Do not call110s a DB
download. The strict scan remained40 blocked/65 findings under advisory reporting,
not clearance. Exact DB/policy hashes are not proven by this log-only audit.

Cache-export partition is not the next experiment:26.1s is small and PRs already
have no export. Current source uses native Docker/default, Engine29.4.2,
Buildx0.38.1, BuildKit0.29.0, frontend1.7 at digest a57df69d…, four advertised
CPUs/15.61GiB, Ubuntu26.04 image20261025.179.1/eastus. These are capacity and
elapsed observations, not measured CPU/peak RAM/dollars.

## One falsifiable comparison

The earlier S18-image design deferred until a trusted S07 hit. That condition is
now observed while the local337.9s compile remains material. Test whether retained
Rust incremental work products help that exact Wolfi build before designing
cross-run compiler transport. This is a combined S08/S18 profile/cache refinement,
not an isolated cache-causality claim or a fifteenth mechanism.

One standard Ubuntu job executes exactly four serialized builds:

1. Original release A, `ae8c7955f23e27d9f0b42d4afbea07c68f6af0e1`.
2. Original release B, `2b0c550f96d2255640ac03b3a84d6527a547aaa0`.
3. Candidate A with an empty job-owned incremental cache mount.
4. Candidate B with the same job's candidate-A compiler state.

These genuine adjacent dev commits have identical crates, manifests/lock,
Dockerfile, package recipes and security sources/policies. Their CI/docs/source
identity differs; this pair is an identity-change mechanism diagnostic, not a
representative Rust edit, ordinary PR, synthetic commit or cohort sample.

The generated candidate aligns `CARGO_INCREMENTAL=1` and release codegen-units16
in **both** dependency and real-source builds. The first candidate dependency
layer therefore need not hit the existing S07 seed. Retain its cold compilation,
downloads and cost; inspect actual external/local compiles in every arm. Source
profile changes must never silently turn repeated external recompilation into
a claimed cache hit. Original opt3/assertions/overflow/default features stay;
no host binary or compiler ABI is substituted. Profile parity is unproven until
these complete actual-image checks run; production adoption is not authorized.

After real source COPY, the original workspace clean completes in its own RUN.
Only the next RUN mounts `/src/nac/target/release/incremental`, with a run/attempt
owned ID and locked sharing. It never restores rlibs, binaries, Cargo fingerprints,
build-script outputs or a whole target tree. Candidate A must see zero prior
workspace units; B must see prior units and execute all six real local compiles.
Verbose rustc flags must use the mounted path and codegen16. The generator fails
on any base Dockerfile drift and exactly reverses its intentional changes.
Verbose instrumentation changes only the real-source RUN, forcing actual source
execution while preserving the original baseline S07 dependency-layer key.

All four actual IIDs are inspected and receive the unchanged full image smoke,
network-disabled offline Guide, source-bound inventory and live scan with fresh
per-arm tool/DB directories. Separate live scanner qualification stays mandatory.
Same-B actual runtime/package/supplier metadata and offline Guide output must
match. Scanner faults, stale DBs, source mismatches and parity failures stop the
comparison. Advisory findings are retained as blocked, never converted to a
security pass. Remaining arms are explicitly unexecuted after a failure; a warm
failure cannot disappear from the report. There is no retry wrapper.

## Trust, resources and limits

The private workflow triggers only its named branch push. It has contents:read,
exact checkout, no persisted credentials/cache-to/registry push, and an always-run
SHA/run/attempt-bound evidence artifact. A dependency-free local Node action
receives the runner's existing cache runtime environment and launches Python.
Only the exact cache-reading Docker child receives those runtime keys. Other
children have a sanitized environment; token values are never outputs/arguments
and exact values are redacted from retained command logs. The public runtime
identity, generated files, phases and every attempted/unexecuted arm are retained.
No compiler data, images, tools, advisory DBs or fixture roots are uploaded.
Maximum build metadata is checked against actual IID, source arguments and
platform, then credential-redacted before evidence retention. Private raw
metadata is excluded from upload. Same-source runtime and Guide parity remain
independent checks.

The job requires the existing supported native Docker/default Engine; fallback
is a diagnostic capability failure, without installing another builder. Capacity
must be four CPUs/14–18GiB; initial host free space at least33GiB. An80-minute job
contains a70-minute controller and at most four25-minute solves. Commands have
32MiB output bounds and newly owned process groups. Deadline/resource failure
kills/reaps only that group; interrupted smoke cleanup uses its exact recorded
PID-derived container/volume names. No shared prune or other owner cleanup occurs.
Cleanup has its own120-second deadline; the wrapper allows150seconds to finish
the report before its final owned-controller stop. These are failure bounds,
not assertions that interrupted backend execution was observed to complete.

Before any solve, bind fixed initial Docker usage, host free space and exact
pre-existing image IDs. Initial cache, containers and volumes must be empty;
image count/IDs must agree. Sampling every five seconds preserves global raw
categories and verifies every initial image ID remains present. Charge positive
rounded logical growth above that fixed stock, plus owned worktree/evidence
bytes and3.3GiB output reservation, against the unchanged19GiB early stop/20GiB
cap. Independently stop at13GiB host free (12GiB floor), or when the high-water
decrease in filesystem free space plus the same reservation reaches19GiB. No
baseline reset between arms, cap increase, image deletion or cache prune occurs.
Malformed/unavailable telemetry, lost initial IDs and resource crossings fail
closed. Logical categories may overlap; filesystem changes include all runner
activity/deletions. Neither is an exact owned physical peak/cost. State over4GiB
or evidence over1GiB fails. All failures/costs stay visible; no local heavy build.

First hosted controller736a3d8642ca968aad4fdc0dcb14b5c9dd883445,
run42108983591:1, failed its original global-stock guard during baseline A.
Source release compilation completed377.4s (six local/zero external compiles);
the CLI was killed at447.595s during runtime provenance, before any image IID or
smoke/inventory/scan. The other three arms did not execute. Live qualification
passed188.473s; both owned worktrees/private root were removed. Daemon-side solve
termination was not independently observed. Initial rounded Docker stock was
3,599,000,003 bytes (six preinstalled images); the final global logical total was
17,065,000,002. Adding owned298,481,243 and reserved3,543,348,019 crossed19GiB at
20,906,829,264 bytes. Minimum sampled host free remained85,218,467,840 bytes.
Subtracting fixed initial stock yields17,307,829,261 charged bytes; replay of all
126 samples reproduces the original abort and no revised historical crossing.
This accounting correction does not prove remaining export/candidate-profile
growth or four-arm feasibility. ZIP13455095793 (2,795,740 bytes) SHA256:
`8568541872ebc15a1b41d7d2dfb47d3a08d144a870772506bc6019ebe0ff77f2`.
The original failed run and unexecuted identity/parity obligations remain intact.

This is cold **compiler state**, not globally cold image/CDN/OS caches. Fixed
baseline-first order, warmer host caches before candidate A, and profile-layer
change prevent an isolated cold whole-image conclusion. Compare warm B builds,
source/dependency events, full image checks and all setup/guard/upload allocation;
record cold overhead separately. Raw phases, not only successful timings, decide.
Telemetry queries run inside supervised build intervals: their durations must
not be added again to build wall time. After the authorized run, retain actual
REST job/step allocation through setup and artifact upload; controller time alone
is not a complete allocation or dollar-cost receipt.

A positive same-builder result does not prove fresh-worker reuse. Docker's GHA
export does not preserve cache mounts by default. An eventual compiler-only
transport still needs a separate image role/path/compiler/profile compatibility
contract, private bounded parser, trusted dev/main writer/PR reader, typed-cold
disablement and standalone behavior; existing helper target/role guards are not
broadened here. No public identity-composition rewrite is included. A failed
reuse result remains counterevidence rather than a reason to rewrite that API.

Light controls: `python3 .github/scripts/image-incremental-proof.test.py` and
`node --test .github/scripts/image-incremental-workflow.test.mjs`; then normal
workflow lint/source-size. They exercise generated seams, source-vs-stub compile
inventory, resource/schema guards, credential isolation and real child/grandchild
timeout cleanup with an unrelated sentinel. They do not execute NAC or Docker.

Primary references: [cache mounts](https://docs.docker.com/build/cache/optimize/#use-cache-mounts),
[GHA mount limitation](https://docs.docker.com/build/ci/github-actions/cache/#cache-mounts),
[runner runtime environment](https://github.com/actions/runner/blob/v2.338.2/src/Runner.Worker/Handlers/NodeScriptActionHandler.cs#L49),
and [Docker disk usage](https://docs.docker.com/reference/cli/docker/system/df/).
