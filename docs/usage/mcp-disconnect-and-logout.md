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
- The state is saved in the NAC home and survives a restart. Only Connect or
  Reload clears it.

## Log out

Log out applies to OAuth servers. It deletes the access and refresh tokens and
pending authorization state that NAC saved on this computer. After log out:

- Sessions stop sending requests to the server. A request fails with an
  authorization error instead of going out without credentials.
- An authorization that was already completing cannot save its tokens.
- The OAuth configuration stays, so Authenticate signs in again. Running
  sessions use the new tokens on their next request.

## Revoke

Log out does not revoke NAC's access at the provider. The grant stays valid
until the provider revokes it or it expires. Slack's MCP authorization metadata
advertises no token revocation endpoint. Slack's Web API `auth.revoke` method
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
