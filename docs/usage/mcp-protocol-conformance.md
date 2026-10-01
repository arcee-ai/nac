# Outbound MCP protocol revisions

Each MCP server selects its lifecycle independently with `protocol`:

- `legacy` uses the stateful initialize handshake and pins `2025-11-25`.
- `auto` first attempts `2026-07-28` stateless discovery. It falls back to
  legacy only when the peer identifies itself as legacy or does not answer the
  discovery probe within the SDK's bounded window.
- `current` requires `2026-07-28` stateless discovery and never initializes a
  legacy session.

Omitting the setting remains equivalent to `legacy`, preserving existing
configuration behavior. Current connections use the SDK's per-request
metadata, `MCP-Protocol-Version`, standard and custom request headers, private
response-cache hints, subscription behavior, SSE reconnection, cancellation,
and multi-round tool resolution. NAC does not put its own session identifiers
in outbound request `_meta`.

## Official conformance

Run both advertised client revisions with:

```sh
make test-mcp-conformance
```

The target pins `@modelcontextprotocol/conformance@0.2.0-alpha.11` and runs the
official frozen `--requirements` sets for `2025-11-25` and `2026-07-28` through
the same lifecycle, transport, catalog, and tool-call code used by configured
servers. The expected-failures file is strict: an unexpected regression fails,
and a stale expected failure also fails.

The only scored exclusions are:

- OAuth client scenarios, owned by ALL-124 and ALL-126 rather than this
  protocol-transport change.
- `elicitation-sep1034-client-defaults`, because NAC does not yet provide an
  interactive outbound elicitation surface and does not advertise one.

Sampling and elicitation are not implemented solely to improve a nominal
conformance percentage. The current MRTR scenario still exercises NAC's
high-level tool-call path and its default local input handling.
