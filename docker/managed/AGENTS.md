# Managed image guide

This directory owns the optional managed NAC container image and entrypoint
contract. It packages the existing `nac-web` product for managed deployment; it
does not define managed domain behavior or server API semantics.

## Invariants and dependencies

- Preserve the documented runtime user, filesystem ownership, bind address,
  repository/config/secret locations, readiness behavior, signal forwarding,
  graceful shutdown, and restart persistence.
- Image changes must not bake credentials into layers or print secret values.
  Runtime credentials remain mounted/provisioned through the managed product
  contract.
- Keep platform/runtime differences explicit. Docker/Podman invocation belongs
  in scripts/Make targets, not the Rust domain.
- Managed deployment remains opt-in and must not alter ordinary local `nac-web`
  startup.
- Do not weaken health/readiness checks merely to make image startup pass.

## Starting points

- `Dockerfile` — build stages, runtime contents, user and filesystem contract.
- `entrypoint.sh` — initialization, permissions, argument/environment wiring,
  and signal lifecycle.
- `../../scripts/test-managed-image-contract.sh` — deterministic static image
  contract.
- `../../scripts/smoke-managed-image.sh` — live readiness/restart/SIGTERM smoke.
- `../../docs/managed/README.md` — user-facing deployment behavior.

## Verification

```sh
make test-managed-image-contract
make managed-image
make test-managed-image
```

The last two require Docker or Podman. Report unavailable infrastructure as a
coverage gap. The static contract is still required everywhere.

## Generated artifacts and placement mistakes

The image is built from repository sources and is not committed. Do not commit
container layers or generated runtime data.

Do not implement GitHub flows, secrets administration, clone state, readiness
domain facts, or HTTP handlers here. Those belong to `nac-managed` or
`nac-server`; the image only supplies deployment wiring.
