# Model catalog generator guide

`nac-catalog-gen` is the offline/review-time single writer for nac-core's
checked-in model catalog baseline. Runtime core loads the artifacts with
`include_str!` and never fetches models.dev.

## Invariants and dependency restrictions

- Generation is deterministic for one input snapshot plus `overrides.toml`.
  Provider mapping, context/output fallbacks, reasoning levels, pricing tiers,
  modalities, and validation failures are reviewable compatibility policy.
- Runtime code must not depend on this crate or gain network access. The CLI is
  the only models.dev network touchpoint.
- Unknown/incomplete upstream records fail or use documented fallbacks; do not
  silently widen provider/model support.
- Keep live fetch, pure mapping, and checked-in output comparison separate.

## Starting points and size exception

- `src/lib.rs` — pure upstream decoding, normalization, overrides, validation,
  catalog/manifest construction and deterministic serialization.
- `src/main.rs` — fetch/input/check/output CLI adapter.
- `overrides.toml` — reviewed local policy.
- `fixtures/models-dev-api.json`, `tests/golden.rs`, `tests/mapping.rs` — stable
  generation evidence.

`src/lib.rs` deliberately exceeds 800 lines because one pure transformation
pipeline keeps upstream schema, override precedence, validation, and emitted
document construction reviewable together. Network and filesystem writing stay
in `main.rs`; unrelated runtime catalog behavior belongs in `nac-core`.

## Verification and generated artifacts

```sh
make crate-check CRATE=nac-catalog-gen
make crate-test CRATE=nac-catalog-gen
cargo run --locked -p nac-catalog-gen -- --input crates/nac-catalog-gen/fixtures/models-dev-api.json --check
```

The generator is the sole writer for:

- `crates/nac-core/src/model/catalog/data/catalog.json`
- `crates/nac-core/src/model/catalog/data/catalog.manifest.json`

Review source snapshot/override changes with both generated files. Do not hand-
edit outputs, add runtime fetches, or use a live unrecorded response as test
evidence.
