# Early managed fault execution and same-run receipts

`managed-fault.yml` runs the complete `make test-managed-fault-fixture` target
against the caller's prepared SHA. It installs the pinned Rust 1.98.0 toolchain
with clippy and Node 24.22.1, uses matching dev/test symbol profiles, and retains
the trusted-main/dev-push-only compiler cache write boundary. It never replaces
the ordinary quality graph or runs a second full `make ci` as early work.

The unchanged Make target executes both core fault filters, the server monitor
fault filter, and feature-enabled server clippy with warnings denied. A failure
in any command fails the job. Receipt production follows the fixture under the
default successful-steps condition, requires its explicit successful outcome,
and separately binds the actual checkout SHA to preparation.

## Reusable interface

The workflow accepts only required string input `source_sha` and returns string
output `fault_receipt` from job `fault`. It exposes no dispatch, skip, or supplied
receipt input. The receipt has exactly these fields:

```json
{
  "schema_version": 1,
  "sha": "0123456789abcdef0123456789abcdef01234567",
  "repository": "arcee-ai/nac",
  "run_id": "123",
  "run_attempt": "1",
  "fixture_result": "success"
}
```

The CLI is `node .github/scripts/managed-fault.mjs <command>`. All commands use
`EXPECTED_SHA`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, and `GITHUB_RUN_ATTEMPT`.

| Command | Additional input | Successful output |
| --- | --- | --- |
| `receipt` | `CHECKOUT_SHA`, `FIXTURE_RESULT` | `fault_receipt=<compact JSON>` |
| `verify` | `FAULT_RECEIPT` | Verification message for the exact current attempt |
| `mode` | `FAULT_RECEIPT` | `mode=reuse` or `mode=full` |

Only a complete successful receipt from the exact candidate, repository, run,
and current attempt permits reuse. Missing, extra, malformed, unsuccessful,
foreign, or future evidence fails. An empty or absent receipt selects full
fixture execution. Nonempty JSON `null`, whitespace, scalars, or partial objects
are errors, rather than fallback requests.

A failed-job rerun may retain successful upstream outputs from an earlier
attempt. The controller validates the old receipt's complete schema, successful
fixture and same source/repository/run before selecting full fixture execution
in the current attempt. Corrupt earlier receipts fail; old successful evidence
never supplies current-attempt reuse. Decimal attempt IDs use exact integer
comparison rather than floating-point coercion.

## Caller and late-controller obligations

The caller starts early fault work after preparation, independently of ordinary
quality. It passes this fault receipt and the existing complete quality receipt
to the late controller. The controller validates both before choosing work:

| Ordinary quality mode | Fault mode | Required late execution |
| --- | --- | --- |
| reuse | reuse | Neither previously completed command set is repeated |
| reuse | full | Complete fault fixture |
| full | reuse | Full `make ci` and complete fault fixture |
| full | full | Full `make ci` and complete fault fixture |

Standalone managed execution supplies neither receipt and must retain both full
command sets. Final managed and Required PR checks must explicitly require the
early job and late controller as well as the image branch. Missing, failed,
cancelled, or unexpectedly skipped work cannot pass either join. No external
status lookup, cross-run evidence, cached verdict, extra retry, publication
permission or PR cache-write privilege supplies a substitute.

`node --test .github/scripts/pr-managed-fault.test.mjs` checks the real CLI's
schema, identity and retry negatives; mandatory early workflow wiring; and the
unchanged Make recipe using a fake Cargo executable. Each of the four commands
has a failure control proving that no receipt is emitted afterward. These local
controls do not claim the Rust fixture executed or hosted timing improved.
Observed candidate preparation, setup, scheduling and late-join overhead remain
part of ALL-582's processing measurement. This is a refinement of S03, not a
separately counted optimization mechanism.
