# MCP OAuth

HTTP MCP servers can use an OAuth client that NAC owns. Configure it from the MCP server panel; do not put client secrets, tokens, or Slack app identifiers in `config.toml` or this repository.

## Dashboard

Open MCP servers, select an HTTP server, and use the OAuth panel. Registration is one of:

- `pre_registered` — a protected client-ID credential name is required; a client-secret credential name is optional.
- `client_metadata` — a client metadata document URL.
- `dynamic` — optional client name (the panel defaults the name to `NAC MCP Client`).

Optional authorization-metadata JSON overrides discovery. Scopes are a list; the Slack fixture uses `channels:history` and `chat:write`.

Status values are `needs_configuration`, `needs_authorization`, `connecting`, `connected`, and `failed`. Connect starts authorization and shows the authorization URL while waiting. Logout clears the stored credentials for that server.

## Callback URLs

Loopback servers keep a local listener at:

```text
http://localhost:1456/mcp_library/oauth/callback
```

Ordinary non-loopback binds require an explicit HTTPS origin (`--mcp-oauth-callback-origin` or `NAC_MCP_OAUTH_CALLBACK_ORIGIN`). NAC never builds redirects from `Host` or forwarding headers. The remote callback is per server:

```text
https://<origin-host>/mcp_library/servers/<server_name>/oauth/callback
```

The origin must be scheme plus authority only (no path, query, fragment, or userinfo). HTTP is accepted only for localhost / loopback; every other host needs HTTPS. Managed NAC derives the same origin from its validated `public_hostname`. Server names are URL-encoded (`team/slack` → `team%2Fslack`).

Register that exact URL with the identity provider. A loopback-registered app will not complete against a remote or managed callback, and the reverse is also true.

## HTTP

```http
POST /mcp_library/servers/{server_name}/oauth/configure
GET  /mcp_library/servers/{server_name}/oauth/status
POST /mcp_library/servers/{server_name}/oauth/authenticate
GET  /mcp_library/servers/{server_name}/oauth/callback
POST /mcp_library/servers/{server_name}/oauth/logout
```

Official `make test-mcp-conformance` still excludes OAuth client scenarios from the scored set (`scripts/mcp-conformance/expected-failures.yml`). That is a scored-exclusion list, not proof the operator flow is missing. ALL-456 records those OAuth extensions as unscored observations; NAC rejecting them is not evidence that dashboard OAuth is unimplemented.
