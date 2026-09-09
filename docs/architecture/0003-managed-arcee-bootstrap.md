# 0003 — Managed Arcee bootstrap ownership and durability

Status: accepted

## Decision

NAC owns a strict versioned bootstrap wire contract for importing an
ArceeFM-minted `managed-nac` grant. The managed controller transports that
opaque payload as the regular file `/run/secrets/nac/bootstrap.json`; it never
constructs NAC's private `arcee_auth.json`, calls an import HTTP endpoint, or
receives credentials back from NAC.

The provider implementation in `nac-core` parses and validates secrets, stores
the registered client identity with the credential, refreshes with that stored
identity, and retains the optional nonsecret bootstrap provenance across token
rotation. Legacy records with no client field deserialize as `nac-cli`, so the
interactive device flow and existing durable files remain compatible.

Import and refresh share the existing Arcee cross-process lock. Import first
checks a separate owner-only receipt. With a receipt, it does not open the
bootstrap mount. Without one, it reads the input with the hardened mounted-file
reader, compares under the lock, and never overwrites any existing canonical
credential content. A fresh v2 import transaction writes the opaque repair
capability to its own owner-only file, then the credential, then the receipt;
each file replacement is atomic and the whole sequence is serialized by the
credential lock. Embedded nonsecret provenance repairs the
credential-to-receipt crash window without a credential rewrite. Existing
valid or invalid state is preserved and the generation is tombstoned, but a
preservation receipt never authorizes managed use. The receipt and repair
capability survive logout and revocation; either condition leaves the managed
profile unavailable rather than allowing an unrelated interactive credential
to satisfy managed readiness.

`nac-managed` owns only the provider-neutral credential-source enum. The server
composition layer binds `mounted-api-key` to API-key providers and
`managed-bootstrap` to `arcee-auth`, performs startup import, attaches no secret
file or environment selector to sessions, and derives catalog/readiness from
the receipt and credential as one lock-protected bound state. Only an
`imported` v1 `managed-nac` receipt whose host and bootstrap IDs exactly match
the credential's retained provenance is ready. Readiness is local and never
spends model tokens. The managed image fixes `NAC_HOME` and `state_root` to the
same PVC; composition rejects a mismatch so refresh rotation cannot land on
ephemeral state.

## Consequences

- Kubernetes must use a single-key `subPath` so the input is a regular file;
  projected-volume symlinks remain rejected.
- Reconciliation and restart cannot restore an already-consumed refresh token,
  and steady state does not depend on the mount.
- Preserved legacy or corrupt credentials remain byte-for-byte untouched and
  tombstoned, but are unavailable to managed catalog, create, and resume paths.
- Interactive Arcee login remains compatible for ordinary `arcee-auth` use; it
  is not provenance-equivalent to an ArceeFM-minted `managed-nac` generation.
  Managed repair additionally requires the v2 bootstrap's opaque capability
  and ArceeFM's authoritative completion binding.
- `managed_host_id` remains the stable ArceeFM-allocated UUID. NAC does not
  invent or persist an incarnation assertion; repair requires ArceeFM to return
  a nonblank authoritative incarnation together with the exact durable host and
  bootstrap binding before credentials are written.
- Grants authorize organization-entitled Arcee models generally. Default model
  selection stays an independent managed configuration field.
- ArceeFM retains grant mint/revoke ownership. NAC gains no provisioning or
  Kubernetes identity and exposes no new credential delivery API.
- A fully compromised NAC process can use the model credential in v0. Moving
  that trust boundary requires a separate credential broker.
