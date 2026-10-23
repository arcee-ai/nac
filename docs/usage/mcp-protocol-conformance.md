# Outbound MCP protocol revisions

Each MCP server selects its lifecycle independently with `protocol`:

- `legacy` uses the stateful initialize handshake and pins `2025-11-25`.
- `auto` first attempts `2026-07-28` stateless discovery. It falls back to
  legacy only when the peer identifies itself as legacy or does not answer the
  discovery probe within the SDK's bounded window.
- `current` requires `2026-07-28` stateless discovery and never initializes a
  legacy session.

Omitting the setting remains equivalent to `legacy`, preserving existing
configuration behavior. Current connections use the SDK's per-request
metadata, `MCP-Protocol-Version`, standard and custom request headers, private
response-cache hints, subscription behavior, SSE reconnection, cancellation,
and multi-round tool resolution. NAC does not put its own session identifiers
in outbound request `_meta`.

## Official conformance

Run both advertised client revisions with:

```sh
make test-mcp-conformance
```

The target pins `@modelcontextprotocol/conformance@0.2.0-alpha.11` and runs the
official frozen `--requirements` sets for `2025-11-25` and `2026-07-28` through
the same lifecycle, transport, catalog, and tool-call code used by configured
servers. The expected-failures file is strict: an unexpected regression fails,
and a stale expected failure also fails.

The only scored exclusions are:

- OAuth client scenarios, owned by ALL-124 and ALL-126 rather than this
  protocol-transport change.
- `elicitation-sep1034-client-defaults`, because NAC does not yet provide an
  interactive outbound elicitation surface and does not advertise one.

Sampling and elicitation are not implemented solely to improve a nominal
conformance percentage. The current MRTR scenario still exercises NAC's
high-level tool-call path and its default local input handling.

## Reproducible automation (ALL-456)

Run `make setup` in a clean checkout, then `make test-mcp-conformance`.
The official runner remains version `0.2.0-alpha.11` (MIT), now installed from
`.github/scripts/package-lock.json` with its complete dependency graph. Both
revisions use that single installation and the same once-built executable.
Cargo builds the feature-gated example with `--locked`; it is selected from
Cargo's artifact receipt, including when `CARGO_TARGET_DIR` is customized.
No `npx` or install-on-demand resolution occurs during testing. Node 22+ and
Cargo are prerequisites; CI uses Node 24.22.1 and the existing managed-build Rust 1.98.0 pin.

The existing tooling npm root remains covered by enforcing source-security CI
and its Dependabot entry. No additional scanning input or package root is added.
The lock addition preserves all 162 existing package identities and adds 111
runner dependencies; the resulting graph has 273 packages. Added packages use
MIT, ISC, BSD-2-Clause, BSD-3-Clause or Apache-2.0 licenses and declare no install
scripts. These are development-only Node modules; there is no NAC production or
native dependency change. Freezing the already selected official referee avoids
maintaining a local conformance implementation. Future runner updates must review
the complete lock diff, frozen requirement inventories, individual failures and
conditional skips, then pass both revisions, failure controls and source scanning.

`mcp-conformance.yml` runs nightly at 09:23 UTC, manually, and on PR events.
Schedules use the default branch's immutable event SHA; PRs use GitHub's immutable
test merge SHA. Preparation compares that candidate to the exact PR base with a
complete NUL-delimited no-renames diff, preserving deleted paths and both sides
of renames. It tests the workflow contracts on every PR and always emits
**MCP conformance complete**. Only explicitly non-applicable PRs may skip the
expensive Rust/conformance job. Failed, cancelled, missing, stale or unexpectedly
skipped applicable work fails that result. This separate signal is initially
outside the universal **Required PR checks** aggregate; existing mandatory
security, workspace, native, browser and image lanes remain effective.

| Changed paths | Full conformance | Rationale |
| --- | --- | --- |
| `crates/nac-core/**` | yes | Outbound lifecycle, transport, handlers, tools, configuration and test driver |
| `crates/nac-contracts/**`, `crates/nac-process/**`, `crates/nac-credential-store/**` | yes | Shared schemas, process adapters and credential contracts consumed by MCP |
| `crates/nac-server/{src,tests,examples}/**` | yes | MCP delivery, registry/tool schema and application composition |
| Any crate `Cargo.toml` or `build.rs`; root `Cargo.toml`, `Cargo.lock`, `Makefile`, `build.rs`, Rust toolchain files, `.cargo/**` | yes | Resolved SDK/features and client construction/build inputs |
| `scripts/**`, `start.sh`, `start_dev.sh` | yes | Build/launch contracts, conformance driver, baselines and receipts |
| `.github/scripts/package{,-lock}.json`, `.github/workflows/mcp-conformance.yml` | yes | Exact runner graph and this lane's execution contract |
| Web/assets-only, documentation-only, image-only and unrelated workflow-only | no | Preparation/contracts and explicit terminal result still run |
| Nightly/manual, regardless of changed paths | yes | Complete scheduled/explicit observation |

The runner scores 18 scenarios for 2025-11-25 and 32 for 2026-07-28, and also
runs seven unscored scenarios under each frozen requirement set. The latter are
six OAuth extensions and the later-added JSON-schema preservation scenario.
Their failures remain visible; they do not claim supported product behavior.
NAC deliberately rejects those OAuth invocations, and its current test driver
has no later schema-echo scenario. Infrastructure failures in these observations
still fail the lane. OAuth `resource-mismatch` passes by rejecting authorization;
this is not evidence that NAC implements OAuth flows.

`expected-failures.yml` names exact revision-specific `scenario:check-id` pairs:
40 checks in 2025-11-25 and 46 in 2026-07-28. They characterize the existing
explicit OAuth/elicitation rejection, rather than exempting entire scenarios.
An unexpected failure/warning, newly passing entry or missing expected check
fails. `expected-skips.json` separately records the exact conditional check
instances omitted by this fixed driver: unadvertised optional capabilities,
methods it does not exercise in the header scenario, and the unscored schema
echo's dependent checks. Every scenario must run and produce nonempty results;
any missing, added, duplicate or changed skip fails. The current header scenario
still proves `tools/list` and `tools/call` method/name headers. The fixed current
protocol does not initialize a stateful session. These bounded gaps do not count
as passes and are not a blanket skip exemption.

Upstream suite mode drops client exit status when applying its baseline verdict.
The launcher therefore retains each exact scenario/revision, client status,
signal and stderr independently. Deferred failures require the exact known NAC
rejection and exit 1. Missing executables, timeouts, panics, malformed reports,
runner errors and wire-schema harness errors cannot match that allowance.

Each run retains raw checks/client output, Cargo logs, candidate SHA, platform,
runner version, lock/baseline/requirement/executable hashes and timings in
`target/mcp-conformance/<timestamp>/summary.json` (override the destination with
`MCP_CONFORMANCE_OUTPUT`). CI uploads the same candidate-bound evidence for
14 days, including failed runs. No automatic retries are configured.
`make test-mcp-conformance-contract` exercises inventory, applicability, result
propagation and infrastructure-negative controls without compiling Rust.

The Make target also runs a deterministic negative control after both positive
revisions: the launcher tells the real client to connect and list tools but omit
`add_numbers`. The official single-scenario run must exit 1 with a failed
`tool-add-numbers` check while the client itself exits 0. This exercises the
actual protocol path without editing production source or weakening assertions.

Initial local ARM64 macOS evidence after clean setup: the cold locked example
build took 50.69 seconds. A subsequent measured run validated 25 scenarios in
1.51 seconds and 39 in 0.52 seconds, then detected the seeded omission. Those
are local warm-run timings, not Linux hosted scheduling evidence. The workflow
has a 25-minute job bound (15-minute build and 3-minute runner subprocess bounds).
Hosted PR evidence is recorded in the ALL-456 PR/ticket; nightly delivery begins
after normal human landing and must be observed separately.
