# Private credential persistence

This inward infrastructure crate owns regular private-file reads, atomic writes,
removal, permission checks and cross-process credential locks. It does not own
provider eligibility, product admission, current-primary state or execution.

`src/lib.rs` is a cohesive existing owner above 800 lines: it contains the
cross-platform private-file/lock contract and neighboring characterization tests.
New reservation logic belongs in `src/slot_gate.rs`, with descriptor-relative IO
and controls beside it.

Every private-file mutator and credential lock participates in the directory's
nonblocking shared reservation gate. Provider-local atomic writers/removers in
Core must participate too. The exclusive original slot owner retains the actual
selected directory descriptor and a durable quarantine marker while remote work
is possible; it never retains the short credential lock across network or SQL.
Only explicit reserved IO borrows may write under its short credential lock.
Original-root/name replacement, expiry, cancellation and uncertainty refuse;
dropping a reservation never clears quarantine or reconstructs authority.
A known local negative before provider work or the actual known original import
completion may retire that original gate. An otherwise-empty ephemeral private
record directory may remove only its unused empty gate under exclusive lock
through `remove_empty_private_directory`; active/quarantined gates refuse. There is no automatic recovery/reset
from marker bytes, a path, a Boolean or a receipt.

Changes require focused credential tests plus neighboring Core provider/import
controls. Include cross-process contention and abrupt-exit quarantine controls.
Keep the established credential formats, redaction, no-follow final components,
atomic rename, directory fsync and lock ordering. No new dependencies are needed.
