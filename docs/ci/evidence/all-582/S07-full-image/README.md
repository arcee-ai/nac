# S07 full-image local evidence

This is the portable record of one completed local comparison of the managed
Rust dependency layer. It documents historical execution at the four immutable
revisions below. This docs-only delivery adds no optimization and supplies zero
ordinary cohort samples. It does not qualify the delivery head or a newer recipe.

| Build | Source revision | Build wall seconds | Builder CPU seconds |
| --- | --- | ---: | ---: |
| Before cold A | `928379d67b56d706489acdc1c884c6af0284ffb1` | 1591.244 | 3622.531 |
| Before warm B, successful retry | `51444e1d3ee856b47be1acabea66c0bc883ef153` | 818.919 | 1535.182 |
| After cold A | `7a80821ffcbfacba72a707312e50ad6414e65999` | 1682.295 | 3653.843 |
| After warm B | `7446e4337200cdd8d90944f6dcc594309ba56eb6` | 322.215 | 581.750 |

The warm image build decreased **60.65% wall time** and **62.11% builder CPU**.
Its source phase compiled zero external dependencies instead of 305 and rebuilt
all six local crates selected by the server image build. The manifest-keyed
dependency RUN was actually cached; the real-source COPY and workspace clean
ran again. Six selected image dependencies does not replace the independent
seven-crate quality coverage.

The cold image build increased **5.72%**. Its Rust phases totaled 847.4 seconds
versus 828.5 seconds before; the unchanged final-runtime step took 254.0 seconds
versus 128.2 seconds. There is no isolated cold speed/cost conclusion. Network,
scheduling and resource effects remain in these observations. These are single
local samples, not hosted, statistical, ordinary-cohort or additive whole-CI
savings. Build timers include export/load; smoke, inventory and scans have
separate timers, and this is not a complete workflow measurement.

Both pairs used identical production Rust, workspace manifests and locks, with
the Dockerfile unchanged inside each pair. The real successor commits changed
context/identity without synthetic commits. The checked-in
[summary](summary.json) retains full root/crate trees, Dockerfile/input hashes,
original exact argv/cwd, source/build/image identities, phase counts and timings.
Historical absolute paths in argv describe the original execution; they are not
required path dependencies. A reproduction must use its own checkout of each
exact revision, its required `make setup`, isolated builder/cache/tags and
relocated output, policy and tool-cache paths. The reviewed policy's immutable
revision/path/hash and the tool pins are recorded in the summary.
This documentation's consistency check performs no image build.

The host was ARM64 macOS with 18 CPUs and 36 GiB RAM; its exact macOS minor
version was not retained. Actual target execution was Linux/x86_64 Wolfi under
emulation. Docker Desktop 29.7.2 exposed an ARM64 Linux VM with 18 CPUs and
8,317,267,968 bytes of memory. Both isolated builders used the same pinned
BuildKit v0.33.1 image, four-CPU quota, 6 GiB memory and memory-swap limits
(no additional swap), maximum parallelism two and automatic GC disabled.
Cargo used two jobs in all four builds, differing from hosted CI's five.
The summary preserves the base/frontend/tool distribution pins and actual hashes.

Two unsuccessful attempts remain visible. The first before-cold attempt stopped
after 567.994 seconds at the initial 11 GiB early estimate guard; only its owned
builder/cache was discarded before recreating a truly empty cold builder. The
first before-warm attempt stopped after 447.722 seconds at the old 15 GiB guard.
Both clients exited 130. The successful warm retry already had its source COPY
cached, but downloaded/recompiled all 305 external and six local compile events;
the failed Cargo RUN supplied no compiled output. This retry/COPY caveat limits
the comparison. Final CPU counters did not survive those owned-container stops;
no exact CPU total is invented for the failures.

Authorized Docker added-data caps rose from 12 to 16 to 20 GiB, with early stops
at 11, 15 and 19 GiB. The estimate included owned builder data plus a 3.3 GiB
loaded-image reservation; active snapshot `du` could overcount physical growth.
Independent Docker sparse-file growth and host-free guards remained active.
The host reserve stayed at 12 GiB, with early stop at 13 GiB. Polling was one
second, owned-data sampling ten seconds, and telemetry unavailable for 45 seconds
failed closed. The controller stopped only its own client/container. No observer
injection/pause or substituted exit status was used. CPU/memory/platform/tool
pins and product flags/features were unchanged when the guard budget changed.

Each loaded immutable image passed full source/build identity, unchanged
credential-independent smoke and live inventory. All four had identical actual
hashes for Rust, Cargo, rustfmt, clippy, Node and Go, while NAC executable hashes
and embedded source identities changed correctly. All 121 actual APK rows match
the [portable package table](runtime-packages.tsv). Cold install/upgrade traces
also matched: 59 build, 114 native SDK, 20 package-recipe and 107 runtime actions.
The summary retains six tool hashes, four NAC hashes, actual image IDs and trace
digests; these equalities do not establish whole-CI coverage parity.

Every image received a fresh database directory and real strict scan using its
exact inventory, pinned tools and the recorded reviewed baseline policy. Every
scan exited **1**, with **32 blocking findings out of 55**, zero exceptions and
no security clearance. Actual DB schema/hash/build time and scan times are
retained. No advisory wrapper masked the strict result. The scanner qualification
job, full quality and whole-run CI were not executed by this local image-only
experiment; their existing mandatory contracts remain unchanged.
Native Darwin ARM64 Syft/Grype version, archive and binary pins are retained
separately from the image's Linux AMD64 toolchain hashes.

The explicit Linux AMD64 normal/build graph matched 836 dependency/feature rows
between source and exact recipe skeleton. Removing a workspace manifest failed
with exit 101; changing an existing Tokio feature changed the graph hash. The
earlier actual Cargo 1.98 old-timestamp control returned `stub` without workspace
clean and `actual 17` after cleaning all local outputs while retaining external
`itoa`. These are safety controls, not additional timing strategies.

PRs still cannot export the shared image cache. A hosted warm-layer comparison
requires population by a **human-approved dev/main push**, then actual hosted
miss/hit and current-candidate coverage evidence. Nothing here authorizes cache
publication or asserts a current-head/whole-Required-PR/security qualification.

The [original raw-report manifest](raw-report-manifest.json) is copied byte for
byte. Its SHA-256 and supplemental per-log/metadata/SBOM hashes are in
`summary.json`. Full raw reports remain at the original host's
[`image-workflow/S07/full-comparison` archive](/Users/allison/.codex/visualizations/2026/11/05/01a1a901-93cd-7452-a13e-ff387749e4ba/image-workflow/S07/full-comparison).
That link is local-only and does not resolve on another checkout; no public raw
download URL has been published. This folder preserves compact measurements and
integrity locators, not a claim of publicly downloadable raw execution proof.
Large logs, databases, binaries and external source code are not copied here.
Only owned images/builders/cache/DBs were removed after evidence retention; shared
caches were not pruned. Cleanup and resource receipts remain identifiable in the
copied manifest. Both source worktrees stayed clean.

From the repository root, this portable check verifies arithmetic and internal
data consistency, not the underlying execution (which requires the raw archive):

```sh
python3 - <<'PY'
import hashlib, json, math
from pathlib import Path
p = Path("docs/ci/evidence/all-582/S07-full-image")
r = json.loads((p / "summary.json").read_text())
rows = {x["label"]: x for x in r["measurements"]}
assert len(rows) == 4
assert not r["delivery"]["managed_applicable_expected"]
assert r["delivery"]["additional_optimization_count"] == 0
assert r["delivery"]["ordinary_cohort_samples"] == 0
assert hashlib.sha256((p / "raw-report-manifest.json").read_bytes()).hexdigest() == r["raw_report_archive"]["copied_manifest_sha256"]
apk = r["comparability"]["actual_runtime_apk_rows"]
assert len((p / apk["file"]).read_text().splitlines()) == apk["count"] == 121
assert hashlib.sha256((p / apk["file"]).read_bytes()).hexdigest() == apk["file_sha256"]
for row in rows.values():
    assert row["build_client_exit"] == 0
    assert row["inventory_status"] == "inventoried"
    assert row["strict_scan_exit"] == 1
    assert (row["security"]["blocking"], row["security"]["findings"]) == (32, 55)
    assert row["full_build_identity"]["source_revision"] == row["source_revision"]
    assert row["full_build_identity"]["build_id"] == "dev-" + row["source_revision"]
before, after = rows["before-B"], rows["after-B"]
for metric, key in [("build_wall_seconds", "warm_build_wall_decrease_percent"), ("builder_cgroup_cpu_seconds", "warm_builder_cpu_decrease_percent")]:
    assert math.isclose(100 * (before[metric] - after[metric]) / before[metric], r["deltas"][key], abs_tol=1e-10)
assert before["source_phase"]["external_compile_event_count"] == 305
assert after["source_phase"]["external_compile_event_count"] == 0
assert len(after["source_phase"]["local_compile_events"]) == 6
assert after["dependency_phase"]["cache_hit"]
assert len(r["failed_attempts"]) == 2
assert all(x["actual_client_exit"] == 130 for x in r["failed_attempts"])
print("S07 portable data consistency: ok")
PY
make test-source-size
git diff --check
```
