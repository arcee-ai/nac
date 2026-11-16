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
- Lifecycle gates nest parent before child or managed orchestrator, as deletion
  cascades. Never wait for a parent's gate while holding a descendant's: settle
  under the descendant's gate, release it, then wake the parent.
- Authenticated human-initiated product operations never request agent approval.
  Delivery authenticates and scopes requests; core services issue narrow human
  capabilities. Preserve Origin/Fetch Metadata checks, session/host ownership,
  readiness/configuration, hard/configured Deny, and backend admission. Client
  fields cannot declare trusted origin or human authority.
- Execution/history/control-status reads resolve existing cached services without
  attachment, wake or recovery. Pending output frames are immutable receipts, not
  current input authority. History reopening remains explicitly read-only even
  for a live handle; controller mutation revalidates the expected revision.
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

## Cohesive size exceptions

- `delivery/server.rs` remains the single auditable list of routes, OpenAPI
  schemas, middleware/layers, and state binding. Do not add use-case
  implementations there.
- `lib.rs` is the server composition/lifecycle root: supported re-exports,
  `SessionManager` shared gates/caches, service-facade construction, attachment,
  delegation monitor settlement, and complete shutdown. Product CRUD and HTTP
  handlers already live in focused modules and must not return to this root.
- `main.rs` owns CLI parsing, auth/upgrade/server/worker action dispatch, and
  outermost runtime composition. Library use cases and provider algorithms do
  not belong in the binary.
- `mcp_api.rs` keeps MCP configuration delivery and OAuth callback/task/listener
  ownership together above 800 lines. Per-owner start serialization and joined
  callback replacement share this transport lifecycle; durable profile/state
  fencing remains in core, and route tests live in sibling test modules.
- `managed_github.rs` is the HTTP/device-login/clone transport adapter plus the
  Git credential-helper wiring required by that flow. Provider, credential
  persistence, and clone process behavior stay in `nac-managed`.

- `application/attention.rs` keeps its bounded current projection, replay ring,
  source compare-and-replace, physical receiver ownership and publication lock
  together above 800 lines. These checks share one atomic frontier; lifecycle
  and canonical reads belong to `attention_runtime.rs`, and HTTP mapping stays
  in delivery. Do not move callbacks or store work under the hub lock.
- `application/attention_runtime.rs` keeps physical observation lifetime,
  bounded bootstrap/read tails, weak service ownership and retirement, and
  generation-checked reconciliation together above 800 lines. These paths
  share source binding and teardown ordering; normalization/publication stays
  in its `projection.rs`, broker authority stays in core, and HTTP stays in
  delivery.

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
