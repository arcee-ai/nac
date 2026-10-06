# 0006 — Restricted managed host-key provenance and durability

Status: accepted bounded implementation contract

The October 6 coordinator accepted ALL-148's invariant and fixture output at
controller commit `d29d019b03029d7c76df65f9364617a333881874`. This decision
supports native implementation; it does not establish live Clerk capability,
fleet upgrade acceptance or safe clearance of retained customer secrets.

The new provider-owned `ManagedHostKeyBinding` compares trusted controller
configuration with a strict delivered bootstrap version 3. Local bootstrap,
host, organization and key IDs are canonical lowercase UUID strings. CR/PVC and
provider IDs are opaque exact strings, at most 256 bytes, without whitespace or
control characters. Owner epoch and key generation lie in `1..=i64::MAX` for
compatibility with the product's signed BigInt contract. The inference origin
is an exact approved Arcee HTTPS origin. Credential class is `clerk_api_key`;
scope is exactly the singleton `managed:inference`.

The delivered JSON fields are `version`, `bootstrap_id`, `managed_host_id`,
`host_incarnation_id`, `pvc_uid`, `organization_id`, `owner_epoch`,
`key_generation`, `local_key_id`, `key_id`, `clerk_instance_id`,
`inference_origin`, `credential_kind`, `scopes` and private `api_key`.
Unknown, duplicate, missing and invalid fields fail before durable writes.
The controller resolves CR/PVC identities and delivers a regular no-follow
mounted file. Product intent cannot manufacture these identities.

`managed_host_key.json` is the owner-only authoritative version 1 record: exact
binding, optional private key, consumed bootstrap IDs and generation watermark.
An existing cross-process credential lock serializes atomic private-file write,
file fsync, rename and directory fsync. `managed_host_key_receipt.json` is a
recoverable nonsecret projection: version 3, flat binding, credential class,
scope and `disposition=imported`. A missing or corrupt projection recovers from
authority without reading any bootstrap mount. An orphan projection or corrupt
authority fails closed. Legacy Arcee auth, repair and receipt files retain
their existing ownership and format.

Initial import never overwrites active credentials or crosses owner epochs.
An authenticated exact-generation revocation records an empty key slot while
retaining consumed history. Mount replay cannot restore the slot. A dedicated
same-owner empty-slot repair compares the entire predecessor, requires a fresh
bootstrap ID and larger key generation, commits the successor and retains all
consumed IDs. Duplicate repair recovers its receipt without reopening a mount.
The finite consumed-ID capacity is 4096; exhaustion fails closed and requires an
explicit recovery decision rather than silently discarding replay history.
Active-slot rotation and stopped-owner transfer require separate fenced
operations; the initial importer cannot perform either.

Offline readiness proves exact local provenance and a nonempty credential.
ALL-155 owns independent upstream verification of provider class, instance,
organization subject, claims and current local host/key/member policy. The
workload receives no Clerk backend secret, platform M2M, cloud or Kubernetes
credential. No local stored-user login fallback may satisfy this profile.
Restricted-key usage retains local organization/key attribution. Provider
failure or revoked eligibility never authorizes billable request replay.
Unresolved former-owner/customer-secret exposure remains a hard successor
access/restart gate; storage preservation alone is insufficient.

Native tests exercise strict identity/class/schema negatives, file permissions,
no-follow paths, authority-before-projection crash recovery, projection-write
failure, missing/corrupt authority, revoked replay, repair CAS and thread/process
concurrency. Runtime/configuration integration and live provider proof remain
separate acceptance steps.
