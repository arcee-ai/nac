# Controlled cold attempt and observation rollup

This folder preserves the constrained cache audit for [run 41963985617:1](https://github.com/arcee-ai/nac/actions/runs/41963985617/attempts/1), head `2a4a52e2044eb6db14c93f97ea83a36b79a1f61c`, prepared merge `081fcbdece55f2a9c897b4a22eccbea44953d804`. Their complete source trees are identical. The audit is byte-identical to the original local report, SHA256 `f8bfdfd123353877fce73483a52a2b9a0689c6bfc33aedbf5a78c302831c7f5c`.

All sixteen executed Rust cache actions used the unique `nac-ci-cold-41963985617-1` run/attempt prefix for both primary and fallback keys, logged misses and disabled saves. Docker ran with `--no-cache` and no import/export flags; both release S18 snapshots were absent and PR staging was skipped. Six browser consumers correctly rejected different runner-image executable reuse and compiled current source. The remaining three consumers validated same-attempt artifact bytes. Full source, quality, native, smoke, inventory and final joins ran successfully. Actual image scanning remained **blocked: 32 blocking records / 55 findings**, reported through the existing advisory wrapper; green is not image security clearance.

The audit establishes those cache mechanisms, not globally cold CDN/base/registry/toolcache state. Docker reported 4 CPUs, 15.61 GiB memory and an image size of 798,392,328 bytes. Peak CPU/RAM, total runner disk/cache bytes and billable cost were not recorded. GitHub's timing API billable zeros are not cost evidence. Existing ignored-test coverage gaps remain. No cohort qualification or isolated/additive whole-CI performance claim follows from this run.

## Local raw integrity locators

The original package is **local-only**:

`/Users/allison/.codex/visualizations/2026/11/05/01a1a901-93cd-7452-a13e-ff387749e4ba/image-workflow/cold-run-audit-41963985617`

Only `audit.json` is copied here. Paths inside it, including `joins.json`, `job-steps.json`, `negative-control-evidence.json`, `logs/`, `artifacts/`, `source-contracts/` and `source-comparison.json`, resolve against that original local package, **not this repository folder**. They have no public raw download URL. Public Actions links identify the hosted run; artifact availability and access are separate.

| Original file | SHA256 |
| --- | --- |
| `audit.json` | `f8bfdfd123353877fce73483a52a2b9a0689c6bfc33aedbf5a78c302831c7f5c` |
| `run-logs.zip` (2,038,395 bytes) | `2461ebe31d4ac6a495c5fe714d75fe88897734ef05701b4542cf6f264a9969e2` |
| `manifest.json` (680 payload files; 56,590,569 payload bytes) | `058bed80c23b010462a4ae11c5ab94323b3c6195ae01792927608226a694c8d3` |

The manifest covers the original raw and derived files except itself. No executable, image, advisory database or tool binary was downloaded for this audit. Source contracts were checked byte-for-byte against head and prepared commits. Negative-control tests and live qualification fixtures ran within the original workflow; no new CI mutation was injected by the audit. The exact marker was verified at creation by the parent collector; this audit independently retained the current body and actual `cold_caches=true` consumer evidence, not the original triggering webhook.

## Appended observations

The rollup is based on published PR609 head `004492fc300b296e6245a0f0768a892f98c8a42d`. All thirteen prior observations and three failure dispositions remain unchanged. All 3,140 prior CSV data rows remain an exact byte prefix (804,695 original bytes; SHA256 `38373f2715361f5b9053966d052da22dc42964c0a426a887b4638519e95966ad`). Nine unique first-attempt records and all 3,189 corresponding raw job/step rows are appended, including nonapplicable skips and the independent native failure's empty collector candidate. The CSV now has 6,329 data rows. Per-snapshot paths and SHA256 values are recorded in `../observed-candidates.json` under `append_provenance`.

| Run, attempt 1 | Outcome | Prepare → required result (s) | Event → result (s) | Runner-job seconds |
| --- | --- | ---: | ---: | ---: |
| 41958708860 | success | 991 | 994 | 6837 |
| 41958708487 | success | 947 | 1038 | 6903 |
| 41958735079 | success, later completed snapshot | 1039 | 1127 | 6814 |
| 41963983443 | success | 956 | 958 | 6243 |
| 41963984719 | independent native failure | unavailable | unavailable | 1344 |
| 41963984751 | success | 972 | 988 | 7642 |
| 41963985027 | success | 995 | 1007 | 7405 |
| 41963985617 | controlled cold success | 1189 | 1192 | 7665 |
| 41966958028 | docs-only success; managed work nonapplicable | 694 | 696 | 5164 |

The independent native workflow has no `prepare` or `Required PR checks` job; the collector candidate stays null even though a separate diagnosis identifies source. Its MCP authentication startup timeout and unexecuted later ignored cases remain recorded; a later same-source pass does not replace the failure. Controlled partial retry 41963983443:2 remains solely in `../browser-partial-retry.json`, with carried-forward execution accounted separately; it is not an ordinary sample. Generic collector `cohort_remaining` checklists are retained verbatim and are not a new assertion that this constrained audit does not exist.

Strategy dispositions reflect eight-shard completion (S02), the full local S07 comparison with guard/retry/emulation/security caveats, repaired first-pass and controlled retry behavior (S09), unresolved desktop failure despite later passes (S10), and successful hosted cold release targets with trusted seed/reuse still pending (S18). S17 is the twelfth measured mechanism: the actual local broad cache-sharing model is rejected for workspace4; the narrow server/browser adaptation still needs hosted seed/transfer/capacity/whole-path evidence. Local comparison and adaptation file hashes and measured reader numbers are retained in `s17_measurement`. Cache tuning and this documentation add no further strategy. All cohort flags remain false; no selected-window mean, infeasibility, compressed-storage saving or qualification is claimed.
