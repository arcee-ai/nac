# Protected enrollment foundation

The protected-core enrollment slice belongs to ALL-117/ALL-107. Its starting
source is `fbbaa153947665b5ed0a2a15ca831766fd16389a`, descended from dev
`8c9486cbbd0468aedc39b5fafea90299c28c32b8`. Source tests establish local
behavior only; they do not establish an enrolled peer, current product
authority, accepted image, serving Ready state, or ALL-117 acceptance.

## Custody boundary

`model::ManagedHostKeyBinding` retains the eleven existing binding fields.
`ManagedHostKeyStore` uses the existing strict v3 delivery parser, owner-only
atomic credential persistence, consumed bootstrap history, generation watermark,
revocation tombstones and same-owner empty-slot repair. This source is reconciled
from verified NAC revision `33621ef6e74b3940863951f52caf56023162c6e0`.
It does not adopt that revision's runtime or schema ancestry.

`import_initial_custody(expected, input, check_current)` returns a noncloneable,
nonserializable `InitialHostKeyCustody`. Its private state fingerprint stays
inside the core. A failed current/private-state check permanently denies that
completion. Restoring a file cannot revive it. A receipt projection cannot
recreate missing private authority. These local APIs alone do not authenticate
the original product subject or grant inference/runtime execution.

Native owns configuration, TLS, listener/FD custody and current-serving
integration. The existing private carrier remains limited to initial Imported
and a distinct fresh Imported readback on the original channel and deadline.
It cannot supply Ready evidence.

## Durable journal

Schema 36 adds `managed_enrollment_attempts` and `managed_enrollment_events` to
the actual schema-34 terminal/human-shell union. Schema 35 belongs to a divergent,
unshipped historical branch and is explicitly refused for ancestry
reconciliation. Versions 0 through 34 retain their existing forward migrations.
Root, Native and the coordinator confirmed exclusive allocation of revision 36
to this slice. Every changed final source/build needs fresh qualification.

An attempt binds the full11 identity, immutable original controller Check hash,
original authority-channel lifetime, genuine eligible subject, primary revision and upstream
eligibility audit. The journal authenticates none of these inputs itself.
The live service must obtain them from authenticated current authority.

The check identities remain distinct inward types: `LifecycleAuditCheckSha256`
names the flat, domain-separated lifecycle SQL audit; `SourceBootstrapCheckSha256`
names the source verifier's nested stage/intent/binding check; and
`NativeImportedCheckSha256` names the private carrier's exact Go
action/current/desired check. The journal's `original_check_sha256` uses the last
type and retains its existing array encoding. None of these digests grants
authority or substitutes for the other checks.

`AuthorityChannelLifetimeId` identifies the earlier authority channel owner;
the later Imported/fact/Ready serving lifetime remains a different identity.
Historical draft records using `serving_lifetime_id` decode through a read alias
without rewriting their history or constructing a live capability.

`begin_enrollment_attempt` commits a pending uncertainty barrier before private
import. Only its first insert reports new work. Exact repeats are observational,
including after lost acknowledgment or restart. Bootstrap identity cannot be
reused under another attempt. Changed identity or lifetime conflicts.

`finish_enrollment_attempt` records an immutable local import audit event after
actual custody completion. Its audit identifier names that real SQL event;
it is distinct from the upstream eligibility audit. An imported receipt remains
historical evidence after cancellation. `terminate_enrollment_attempt` is
idempotent and permanently prevents finishing or rewinding the attempt. Neither
a journal row nor a copied receipt is a live authority capability.

## Remaining production join

ALL-121 owns authenticated current-primary/registry wire composition. The core
service must validate genuine original-subject eligibility and durable audit
lineage before and after import under the original deadline and sticky lifetime.
An expected-owner callback, copied binding, connection UUID or configured peer
cannot replace that producer. D retains its uncached resource checks, durable
intents and immediately-before-CAS fences. Fresh Ready requires a separate
current check and genuine serving-lifetime proof. Source completion leaves
runtime admission closed until these owners supply and qualify that join.
