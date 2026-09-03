# 0002 — Generated API contract

Status: accepted

## Context

The React client previously duplicated the server's HTTP DTOs by hand. That
allowed required/optional fields, nullable values, and enums to drift from the
assembled router and its Rust serialization contract.

## Decision

The exact `utoipa` document assembled by `nac-server::openapi_document()` is the
wire-contract source of truth. The live `/openapi.json` route and the offline
exporter call the same state-free assembly seam.

`make generate-api-contract` writes, in order:

1. `crates/nac-server/web/openapi.json` from the assembled Rust router; and
2. `crates/nac-server/web/src/app/types/openapi.generated.ts` from that checked-
   in OpenAPI 3.1 document.

The local generator deliberately supports only the JSON Schema constructs NAC
currently emits and fails on unfamiliar constructs instead of widening them to
`any`. It has no runtime dependency and formats through the repository-pinned
formatter. `make test-api-contract` runs both generators in check mode, and
`make test-assets` depends on that drift gate.

`app/types/api.ts` remains the stable frontend import surface. It aliases
generated schemas and may define intentional client-only refinements, but it
must not reintroduce handwritten wire DTOs that exist in OpenAPI.

## Consequences

- Rust serialization/OpenAPI annotations and the checked-in frontend contract
  change together.
- Required-nullable fields must be represented accurately in Rust schemas;
  correcting the schema is not permission to change serialization.
- Adding a new OpenAPI schema construct requires an explicit generator update
  and regression coverage.
- The generated files and production bundle are committed so release and local
  builds can detect drift without network access.

## Maintenance

After changing routes or DTO schemas, run:

```sh
make generate-api-contract
make test-api-contract
make test-assets
```

Do not edit `openapi.generated.ts` manually. Review generated diffs alongside
their Rust owner and frontend consumers.
