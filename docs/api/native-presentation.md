# Native presentation integration

The native web client can run under a caller-owned router with an injected NAC
client. `crates/nac-server/web/src/app/runtime/index.ts` exports
`createNativeRuntime`, `NativePresentationRoot` and the runtime context. It
reuses native features, queries, mutations, live projections and providers.
The standalone entry mounts this same root with its existing HashRouter,
document theme, stylesheet and persisted browser preferences.

This is a source/module seam. The experimental ALL-121 tarball exposes the full
typed HTTP/SSE facade but contains no React presentation. ALL-122 must decide
the eventual UI distribution, name, style delivery and compatibility policy.
Consuming native source currently requires the web's React dependencies and
`@/` alias to its `src/`, plus explicit stylesheet/assets handling. No registry
publication or backend route change is part of this seam.

## Constructing a view

Supply an existing authenticated client's structural `transport`, and copy the
consumer's opaque owner/profile/organization/host/incarnation/endpoint/release
bindings into `scope`. These strings fence frontend state; they do not grant
native admission authority or encode identity. Injected transport errors preserve
native status, message and request identity across separate installed/source
client constructors. `scope.endpoint` must exactly
match the client's normalized endpoint.

```tsx
const runtime = createNativeRuntime({
  scope: selectedBinding,
  client: authenticatedClient,
  eventSource: authenticatedEventSourceFactory,
});

<NativePresentationRoot
  runtime={runtime}
  router={(children) => <MemoryRouter>{children}</MemoryRouter>}
  styles={selectedScopedStyles}
/>
```

The root imports no global stylesheet and never calls `createRoot`. The caller
owns DOM mounting, routing and CSS delivery. Its default theme stays local and
does not mutate the host document or localStorage. Overlays and modal inertness
stay inside its presentation boundary. Fixed headers and overlays use that
root as their containing block; embedded shortcuts require focus inside
that boundary. The standalone entry explicitly owns document shortcuts and
uses the existing document theme provider.

Create a new runtime for every change to any binding, even when session IDs and
the endpoint are unchanged. Close the old instance before exposing the next;
close on logout, revoked eligibility and host deletion. Unmounting/replacing
the root also releases the instance, with React StrictMode remount handling.
`close()` is idempotent: it aborts pending reads, fences late adapter results,
closes event sources/timers, clears the private cache and resets presentation
stores. It cannot roll back an accepted server mutation. A lost response after
dispatch remains uncertain and requires authoritative readback, without replay.

Each instance has its own query hashes/cache, live output, composer, selections,
tabs, filters, navigation and preferences. Hosted preferences are ephemeral by
default. Only standalone opts into existing localStorage keys. A consumer that
supplies storage owns its namespace and must avoid sharing it across bindings.
Provider API-key values are excluded from query keys.

## Streams and operation coverage

The existing SSE adapter receives fresh transport context on every connection.
Native EventSource cannot carry bearer/custom headers; authenticated deployments
must supply the existing auth-capable factory. Connections rotate at 299 seconds
and reconnect with their cursor and fresh context. Retired-source callbacks,
late authorization completions, duplicates and runtime closure cannot revive
the old projection. The frontend lease is a browser lifecycle ceiling; backend
eligibility and per-tool authorization remain owned by their existing services.

The checked-in contract currently documents 123 operations. The historical
112-operation inventory omitted nine MCP/OAuth library operations,
session commands and UI configuration. `scripts/client-api-surface.mjs` is the
explicit method/path classification used by the existing generator. The
generated `NAC_API_SURFACE` maps 118 operations to the resource facade, two to
client readiness/UI configuration, one to SSE, and two intentionally private
operations: infrastructure liveness and the server-owned OAuth callback.
Managed control, inbound MCP and other undocumented routes are not added to
that public surface. Rust/OpenAPI remains the wire-schema source of truth.

## Local verification

Unit tests exercise real native query owners and presentation with equal IDs in
separate instances, scope replacement, late reads/events, fresh stream context,
bounded reconnect and single command dispatch. The packed-artifact test checks
all classified methods and strict generated request/result types.

`e2e/hosted.e2e.ts` builds the actual native presentation with its production Vite
configuration into an isolated output directory, mounts it under MemoryRouter,
and exercises desktop/mobile send, streaming, replacement and closure through
a local mediated proxy. The proxy uses fixture-only headers/cookies and the
existing isolated scripted NAC harness. It proves frontend injection/lifecycle,
not production identity/admission, per-tool authorization, or an ArceeFM release.
The normal production-embedded E2E lane continues to verify standalone behavior.
