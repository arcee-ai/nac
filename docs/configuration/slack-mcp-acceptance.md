# Slack MCP acceptance fixture

NAC uses an internal, non-production Slack app for acceptance against Slack's
official MCP endpoint:

```text
https://mcp.slack.com/mcp
```

This fixture is not a Marketplace app and must not be represented or
distributed as a shared production NAC client. Its workspace, app identifiers,
credential locator, and named operational owners are internal records and must
not be committed.

## Public configuration contract

- App class: internal, non-production.
- Slack MCP: enabled.
- PKCE: enabled.
- Local redirect URL:
  `http://localhost:1456/mcp_library/oauth/callback`.
- User scopes: `channels:history` and `chat:write`.
- Bot scopes: none.
- Organization deployment: disabled.
- Socket Mode: disabled.
- Slack token rotation setting: disabled for the initial fixture.

`channels:read` is intentionally absent because acceptance uses a known
channel ID. Add it only if the supported journey proves channel discovery is
required and the scope change is reviewed.

Never copy credential values, tokens, signing material, verification values,
Slack app identifiers, internal workspace or channel identifiers, or protected
credential-store locators into this repository, `config.toml`, issues, pull
requests, chat, logs, or test fixtures.

## Acceptance boundary

The internal app is installed and authorized in its designated acceptance
workspace and is ready to begin authorization against
`https://mcp.slack.com/mcp`. The internal ownership and protected-credential
record is maintained outside the repository under ALL-125.

ALL-124 owns the NAC OAuth client, localhost listener, callback handling,
authorization-code exchange, and live loopback acceptance. Do not treat this
fixture record as proof that the ALL-124 end-to-end flow passed.

No managed callback URL is registered yet. When managed OAuth is implemented,
derive it only from a real validated `public_hostname`:

```text
https://<validated-public_hostname>/mcp_library/oauth/callback
```

Never register a placeholder hostname.

## Repeat or rotate the fixture

1. Create an internal, non-production Slack app in the designated acceptance
   workspace.
2. Enable Slack MCP and PKCE.
3. Register only reviewed redirect URLs. For local acceptance, use the exact
   localhost redirect above without angle brackets.
4. Configure only the two user scopes above. Keep bot scopes and
   `channels:read` absent unless a reviewed acceptance journey requires them.
5. Keep organization deployment, Socket Mode, and Slack token rotation disabled
   for the initial fixture.
6. Install or authorize the app in the designated workspace.
7. Store new credential values directly in the approved protected credential
   path. Do not pass them through Slack, tickets, source files, prompts, logs,
   or command output.
8. Record only sanitized readiness and ownership evidence in the internal
   ALL-125 record.

The named internal owner is responsible for future credential rotation and app
removal. Rotation must update the existing protected item and report only that
rotation completed. Removal must revoke the app installation and remove or
retire the protected item without disclosing its contents.
