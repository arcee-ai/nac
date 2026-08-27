# nac-server guide

`nac-server` is the composition and delivery crate. It wires core and managed
application capabilities, serves HTTP/OpenAPI and outgoing MCP, embeds the React
bundle, and builds the `nac-web` binary. Product use cases live in focused
`application` services; transport mapping lives in `delivery`.

## Invariants and dependency restrictions

- Handlers decode/validate transport, invoke one application operation, and
  encode its result. Business ordering, filesystem policy, and durable lifecycle
  do not belong in handler bodies.
- `application` modules may depend on core/managed contracts but not Axum
  request/response types. `delivery` adapts application errors and DTOs.
- Composition may implement outward ports such as managed project registration;
  do not reverse the dependency by making core or managed depend on the server.
- Preserve route paths, status codes, response bodies, OpenAPI schemas, MCP
  names/arguments, defaults, and shutdown semantics unless an explicit
  compatibility decision authorizes change.
- `SessionManager` remains composition/lifecycle state, not a destination for
  unrelated use cases. Add a focused facade and preserve shared gates and exact
  transaction ordering.
- Managed routes are adapters over `nac-managed`; ordinary unmanaged startup
  remains valid.
- The production bundle is embedded from committed assets and must match web
  source.

## Starting points

- `src/application/` — projects, sessions, delegation, configuration,
  credentials, workspace and managed use-case facades.
- `src/delivery/` — contracts, errors, thin handlers, router/OpenAPI assembly,
  and server startup.
- `src/delivery/server.rs` — assembled router and `openapi_document()` seam.
- `src/lib.rs` — composition state, remaining cross-use-case lifecycle wiring,
  and public re-exports; new cohesive operations should prefer an owner above.
- `src/mcp.rs` / `mcp_api.rs` — outgoing session-control MCP and HTTP MCP config.
- `src/managed_*.rs` — managed auth/GitHub/status transport adapters.
- `examples/export-openapi.rs` — deterministic offline contract export.
- `web/AGENTS.md` — frontend ownership and generation.

The router composition in `delivery/server.rs` is allowed to exceed 800 lines
while it remains the single auditable list of routes, OpenAPI schemas, layers,
and state binding. Do not add use-case implementations there.

## Verification

```sh
make crate-check CRATE=nac-server
make crate-test CRATE=nac-server
make test-api-contract
make test-assets
make test-e2e
```

Run focused application and route/OpenAPI tests with each seam, then the full
server suite. Managed delivery changes also need managed crate tests and the
static image contract.

## Generated artifacts and placement mistakes

Rust routes/schemas are the API source. Use `make generate-api-contract`; never
hand-edit generated TypeScript. Web build output under `assets/dist` is
committed and must change with its source.

Do not put provider transports, durable domain records, native tool execution,
or React workflow state in this crate. Do not create HTTP-shaped application
DTOs merely to avoid mapping at delivery. Do not add another catch-all manager.
