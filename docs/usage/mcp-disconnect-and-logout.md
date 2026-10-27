# MCP disconnect, log out, and revoke

Disconnect, log out, and revoke are separate actions. Each one changes what
running sessions may do next.

## Disconnect

Disconnect in MCP settings stops NAC from using a server:

- Sessions that already mounted the server refuse every new tool, resource,
  and prompt request to it, including sessions in other NAC processes that
  share the same NAC home.
- Those sessions also stop refreshing the server's catalogs and stop listening
  for its notifications. After Connect, they can call the server again, but
  they may no longer receive its catalog changes; a new session does.
- New sessions skip the server. A `required` server blocks new sessions until
  it is connected again.
- The state is saved in the NAC home and survives a restart. Connect or Reload
  clears it as soon as you ask, even if the settings page's own connection
  then fails.
- Running sessions follow a server through renames in MCP settings: disconnecting
  it under its new name stops sessions that mounted the old name, and Connect
  lets them use it again. A new server added under a deleted or old name is a
  different server; it starts connected and does not affect those sessions.
  If a rename is interrupted, both names retain the same disconnect state until
  the settings operation finishes. A failed rename never re-enables the server.
- If the saved state cannot be read, every server counts as disconnected and
  MCP settings say so. Connecting a server rewrites the record, admitting only
  that server for new sessions. Sessions that were already running stay
  blocked from every server; start a new session to use them again.

## Log out

Log out applies to OAuth servers. It deletes the access and refresh tokens and
pending authorization state that NAC saved on this computer. After log out:

- Sessions stop sending requests to the server. A request fails with an
  authorization error instead of going out without credentials.
- An authorization that was already starting or completing cannot save its
  sign-in state or tokens, even if the server is deleted and added again under
  the same name. A token refresh
  already in progress finishes first, and log out then clears its result.
- A token that has expired and cannot be refreshed is treated the same way.
- The OAuth configuration stays, so Authenticate signs in again. Running
  sessions use the new tokens on their next request.

## Revoke

Log out does not revoke NAC's access at the provider. The grant stays valid
until the provider revokes it or it expires. Once the provider revokes it, the
server rejects the token and the call fails; NAC does not retry it without
credentials. Slack's MCP authorization metadata
(`https://mcp.slack.com/.well-known/oauth-authorization-server`, checked
2026-10-23) advertises no token revocation endpoint. Slack's Web API `auth.revoke` method
is separate from that metadata and has not been qualified for tokens issued
through MCP OAuth, so NAC does not call it. Revoke the authorization in Slack
instead ([removing app authorizations](https://slack.com/help/articles/360003125231)).
For other providers, remove NAC's access in the provider's connected-app
settings.

## Calls that are pending or running

- A tool call still awaiting approval when the server is disconnected or
  logged out fails when it is approved. It is not retried.
- A call already running when the server is disconnected or logged out
  finishes normally and is reported once. Disconnect does not interrupt it.
- A call that is cancelled while running is not sent again.
