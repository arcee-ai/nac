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

The server's callable `ManagedHostKeyRepairService` composes that storage seam
with a private mounted-delivery adapter selected by validated v3 operator
configuration. Its default lifecycle authority refuses revocation and repair
before private I/O. A separately constructed sender port must authenticate the
accepted exact lifecycle/readback, upstream cutoff/issuance and current resource
eligibility, holding the same dispatch barrier as departure through publication.
Its fresh current-authority check runs inside the credential lock after any
writer wait and immediately before private publication. Time expiry is checked
even when departure is held behind the shared lifecycle barrier.
The borrowed Rust mutation inputs are not an accepted wire or proof. No sender
factory, HTTP route, callback URI, CLI flag or automatic startup repair is
installed. No legacy upgrade assertion grants Clerk authority. The workload
receives no extra backend/M2M/Kubernetes credential.

Composition tests use a synthetic gated sender to exercise revocation, empty
slot, successor repair/receipt, mount-free ordinary startup, lost response and
duplicate delivery, native CAS negatives, and both departure orderings. A
duplicate after successor cutoff cannot refill the consumed slot or report local
availability. Errors after a durable commit do not roll it back or authorize
automatic replay. These tests prove the callable boundary, not authenticated
sender activation or an actual controller-authorized image repair journey.

Offline readiness proves exact local provenance and a nonempty credential.
ALL-155 owns independent upstream verification of provider class, instance,
organization subject, claims and current local host/key/member policy. The
workload receives no Clerk backend secret, platform M2M, cloud or Kubernetes
credential. No local stored-user login fallback may satisfy this profile.
Restricted-key usage retains local organization/key attribution. Provider
failure or revoked eligibility never authorizes billable request replay.
Unresolved former-owner/customer-secret exposure remains a hard successor
access/restart gate; storage preservation alone is insufficient.

The opt-in controller configuration is version 3 with `model_backend=arcee-api`,
`model_credential_source=managed-host-key`, the fixed bootstrap file, and a
nonsecret `[managed_host_key]` block containing the eleven binding fields.
NAC_HOME must equal state_root. Versions 1 and 2 keep their existing modes.
Retained `arcee_auth.json` blocks import and static-key use without reading or
clearing that credential. Broader retained-secret clearance remains an external
successor gate, not something native local provenance can establish.

Construction passes an ephemeral capability to new, resumed and route-matched
light clients; neither private keys nor credential capability fields enter
persisted session settings or public HTTP/model arguments. Hidden native
workers carry only the nonsecret binding and independently revalidate version 3
operator configuration from the existing NAC_MANAGED_CONFIG location or
/etc/nac/managed.toml, NAC_HOME/state_root, exact route and current authority.
The nonsecret configuration reader accepts public-readable ConfigMap modes,
including controller mode 0644, while rejecting group/other writes, symlinks,
nonregular files and oversized input. Mounted/private secret readers retain
their stricter access policy; this does not establish a privilege split.
The flag alone grants nothing. SSH and competing credential selectors are
rejected; custom config locations without that established discovery mechanism
fail closed. Static inference reloads authority before every request, prohibits
HTTP/SSE automatic retries and bounds the complete request to five minutes.
Readiness only checks local availability; it does not repair files or prove
upstream eligibility. These changes leave ordinary/local and v1/v2 flows intact.

Native tests exercise strict identity/class/schema negatives, file permissions,
no-follow paths, authority-before-projection crash recovery, projection-write
failure, missing/corrupt authority, revoked replay, repair CAS and thread/process
concurrency, configuration boundaries, worker transport, new/resumed/light
capabilities and request failures. Live provider, integrated controller/runtime
qualification and independent final review remain separate acceptance steps.

Host execution carries a separate ephemeral authority even when the session or
light worker selects another model. New/resumed sessions, prepared/native/MCP
tool dispatch, post-approval checks, workspace admission, command spawn/input,
atomic file publication and prompt admission consult the same exact private
binding. Prompt admission checks on the owned store executor after queue wait;
it wraps the existing identified transaction without changing persisted schema,
run identity, inbox settlement or terminal recovery. Each serving lifetime
latches denial across clients and children. File restoration cannot reopen that
lifetime; the construction path must supply current trusted authority again.

A one-second local observer wakes cancellation for managed workers and serving
sessions, including idle retained terminals. Denial uses existing process-tree,
child/managed-session and durable cancellation settlement. Local observation
latency is measured separately from provider revocation propagation. These
checks grant no permission, change no backend, and confer no upstream eligibility.
Same-UID command access to private credential files remains a production gate:
mode bits, nondumpable workers and private sockets do not establish a privilege
split. The selected privileged mediated sender and authenticated upstream
eligibility callback require independent integration before production release
or any version 3 fleet capability advertisement.

A separately authenticated sender can provide the inward read-only
`ManagedHostExecutionObserver` port. It returns an opaque nonsecret observation
revision for the exact binding; the unconfigured implementation denies. The
existing shared execution authority latches unavailable or changed observations
and never reopens old clones after restoration. No sender enrollment factory is
installed. The optional [two-UID experiment](../managed/sender-prototype.md)
compiles forwarding/grant adapters only in tests and demonstrates native client
and private-worker transport without loading the provider key in NAC. Its
synthetic verifier and local protocol are not production enrollment or an
accepted lifecycle wire. B's published lifecycle9e8b22e settles canonical phase
comparison; authenticated native producers and private delivery remain required.
