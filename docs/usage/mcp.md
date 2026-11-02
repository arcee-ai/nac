# MCP in NAC

NAC can connect to MCP servers to give its agents tools, resources and prompts.
NAC also exposes a separate inbound session-management MCP endpoint for external
clients. Adding an outbound server and connecting an external client are different
operations.

## Add a server

Open **MCP** in the sidebar. Use the MCP Library or add a server with its supported
transport: streamable HTTP uses a URL and optional headers; stdio uses a command,
arguments and optional environment. Enter credentials privately in the product
UI or your own environment, never in a help conversation. Review the server's
trust and approval settings before enabling it. A help answer explains these
steps; it does not save configuration, start a server or grant tool authority.

The canonical file configuration uses `[mcp_servers.<name>]`; see the
[example configuration](../configuration/example.md). `enabled` defaults to
true and `required` to false. An enabled required server whose startup or catalog
fails prevents session admission. Server names namespace tools as
`mcp__<server>__<tool>`. An exact tool denylist wins over an allowlist.
Imported tool approval defaults to `ask`; configured Deny remains effective.
NAC displays skipped server diagnostics when optional discovery fails. A server
being configured does not prove its tools are available in an already-bound
session. Inspect the current session's actual tool list and diagnostics.

## Connect an external client

The default local inbound endpoint is `http://127.0.0.1:3210/mcp`, using
streamable HTTP. Configure it in the external client's own MCP settings. The
local listener has no built-in authentication: keep it local unless strong
access control is provided. Managed hosts have their own authenticated routing
and deployment contract; do not assume the local URL applies there.

The separately installable `nac-onboarding` skill helps an external harness
install NAC and connect that client. It remains a setup helper. Bundled
`nac-help` answers questions inside an installed NAC using release-local docs.

## Availability and backend limits

The guide can describe MCP configuration while offline. Contacting an actual
MCP server needs its transport, credentials and network to be available. Local,
SSH and Podman execution do not imply that every MCP server is enabled or
reachable. Remote host filesystem paths are not guide reference paths.
If current state is absent, report it as unknown and explain how to inspect it;
do not infer credentials or readiness from documentation.

See [disconnect, log out and revoke](mcp-disconnect-and-logout.md) for the
separate meanings of disabling a connection, ending local login and revoking
provider authorization.
