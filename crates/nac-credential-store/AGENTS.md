# Private credential persistence guide

This inward adapter owns regular-file, no-follow private credential reads,
atomic metadata-safe writes, mounted-file validation, and cross-platform file
locks. Callers supply paths and budgets; this crate does not select a provider,
execution backend, session behavior, or authorization policy.

Preserve existing unbounded-reader behavior for established callers. Bounded
reads must limit allocation before decoding and retain the same private-file,
regular-file, no-follow and ownership checks. Errors never include credential
values. Keep exact-value redaction and private writes unchanged.

`src/lib.rs` is deliberately cohesive above 800 lines: private-file validation,
read/write publication and portable lock behavior share one auditable adapter,
with their adjacent safety characterization tests. Provider lifecycle and
application admission belong to callers and must not be added here.

Run `cargo test --locked -p nac-credential-store`, then the affected caller's
native credential and concurrency tests. No generated artifacts are owned here.
