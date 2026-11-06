# Controlled cold-cache measurement

Stable release can request required Rust/BuildKit cache misses through either
an ordinary PR marker or a manual `cold_caches` boolean (default `false`). Both
select cache reads only. Every existing build, test, fixture, receipt, identity,
archive, native and security check stays in effect. This measurement capability
has no optimization credit and adds no publication or cache-writing path.

For an ordinary cold PR run, the body must start with this exact first line:

```text
<!-- nac-ci-cold-caches -->
```

The marker must be followed immediately by LF, CRLF or end of body. Leading
whitespace/blank lines, quotes, fences, later examples, trailing text on the same
line and near matches do not activate it. Body text is parsed as data and never
interpolated into shell. Include the marker at creation on a genuine PR intended
to land; only its first ordinary run can qualify under the ticket's cohort rules.
Adding it later, manufacturing a scratch candidate or rerunning does not create
a qualifying original run. The selector applies on every PR run while the marker
is present; it does not certify cohort eligibility.

The prepare selector reads bounded event JSON and emits canonical `true/false`.
PRs without the marker and all push/tag events retain normal caches. Manual runs
use JSON-encoded typed `inputs.cold_caches`, not string-valued event inputs.
Malformed metadata or a nonboolean manual value fails before output. Manual
cold runs are separate diagnostics, outside the ordinary PR cohort.

Normal keys keep prefix `nac-ci-v1`, original role/target/shared keys and Docker
import scope. Selected cold runs use `nac-ci-cold-<run-id>-<attempt>` for every
reachable required Rust cache, including release S18 staging, browser source
fallbacks and native's shared cache. Four reusable required units receive the
prepare output as a typed boolean: native, early image, early fault and late
quality fallback. They accept true only for the original PR/manual event;
standalone wrappers omit it and retain their previous default behavior.

Cache actions still run for their environment setup; cold restore prefixes
cannot fall back to normal namespaces. The image build imports no cache and
sets `no-cache: true` on its existing fresh builder. Pinned base images,
Dockerfile/platform/candidate arguments and all smoke/scanner work stay in effect.
Original trusted-main/dev-push-only saves and S18 staging conditions are unchanged:
PR/manual cold runs can neither stage/save incremental state nor export image
cache. No deletion, quota/runner/permission change or extra writer is involved.

S18 must report absent-cache/cold on a fresh hosted runner, build the prepared
candidate and execute packaged full Guide identity checks. Same-run browser
artifacts and quality/fault receipts retain their validation/fallback semantics.
Record ref, prepared full SHA, event/run/attempt, actual cache prefixes/misses,
S18 output and BuildKit invocation (`--no-cache`, no `--cache-from`), plus every
applicable final gate and whole-run wall/compute/queue/storage evidence. Partial
failed runs do not qualify. Compare identical source and coverage, and disclose
that manual dispatch uses selected-ref `github.sha` while PRs prepare a merge.

This covers the main required graph. Independent MCP conformance, nightly
portability and terminal-browser workflows keep their cache regimes and require
separate accounting. Registry/CDN/toolchain/base-image transport caches are not
globally purged. Hosted cold and seeded warm results still require execution;
no timing benefit follows from this wiring.

`pr-cold-cache.test.mjs` exercises the real selector CLI, actual parsed cache
expressions and negative mutations. Its bounded expression subset covers the
operators/canonical contexts here; actionlint validates Actions grammar. It also
removes only these additive selector/cache fields and compares canonical parsed
workflow hashes to `85f12eadfbf43cb585fe5a0f0231d479069ec26d`, guarding every other
field. Intentional future workflow changes must review/update those fingerprints.
