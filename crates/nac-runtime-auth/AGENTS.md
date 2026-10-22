# Runtime transport authentication

This inward infrastructure crate owns actual enrolled TLS acceptance and the
original connection/serving resources. It depends on neither Axum, `nac-server`,
the agent harness, nor Native runner wire. Delivery adapts its accepted I/O to
HTTP; Core consumes its opaque exchange alongside independent source, policy,
backend and execution owners.

## Invariants

- Preserve CA verification, exact client leaf pin, TLS 1.3, identity validation
  before bind, bounded handshakes, and explicit operator configuration.
- Ordinary enrollment is read-only. CREATE issuer-purpose enrollment is a
  separate explicit construction choice, absent by default.
- Only the actual acceptor creates authenticated stream/peer state. Never add
  `from_verified` metadata, callback, test-support positive constructor, or
  serialized owner/grant. Peer/issuer values alone authorize no operation.
- Capture the original expiry/cutoff before body I/O. One actual connection
  supplies at most one CREATE or cleanup ACK exchange; Core owns durable replay.
  Neither copied body data nor a later deadline renews the original exchange.
- EOF, I/O failure, shutdown, drop, serving retirement and observed expiry deny
  monotonically. Notification futures and weak observations must not keep an
  ended stream/serving owner current.
- CREATE currentness and serving/runtime currentness are distinct. Ending a
  successful HTTP exchange does not retire the serving owner. The serving view
  grants neither a fresh user lease nor permission for further runtime effects.
- ACK uses the same explicit CREATE enrollment but has a distinct opaque type,
  original pre-body budget and denial lifetime. It cannot enter a CREATE
  consumer, renew the original CREATE/runtime cutoff or itself retire anything.
  Core verifies matching original factory/source/terminal before preparation
  retirement; Native owns the qualified persisted/cache completion producer.
- Denial never establishes quiescence, terminal settlement, or release of an
  unresolved Core/AFM owner. PostgreSQL custody remains in AFM.

## Verification

Run `cargo test --locked -p nac-runtime-auth` with disposable local loopback
access, its compile-fail docs, and warnings-denied Clippy. Test actual TLS,
original cutoff/body ownership, concurrent one-use, EOF/drop and independent
serving lifetime. Re-run the server TLS/CREATE neighbors after adapter changes.
Fixtures are existing synthetic test certificates only; production never loads
them. Do not add certificate/credential discovery or an implicit listener.
