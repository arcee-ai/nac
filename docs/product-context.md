# Product context and supported navigation

“NAC capabilities” in the sidebar or phone menu reports the installed build,
deployment, current session behavior and selected execution backend. It reads
existing state; it does not attach, recover, connect or start a session.
Skill/tool counts are reported only when the current runtime can be observed.
A running agent can make its tool snapshot temporarily unknown. MCP readiness
is the host dashboard's connection count, not session tool permission.

Availability has four values: `available` is observed support, `disabled` is a
known inactive capability, `unavailable` is unsupported or not currently ready,
and `unknown` means there is no accessible current observation. Availability is
never an authorization grant. Context omits credentials, credential selectors,
provider endpoints, filesystem paths, transcript contents and other owners' data.

The application facade and `GET /product-context` use the selected serving
manager/store. The native `get_product_context` tool additionally binds its
session during construction. The outgoing MCP adapter accepts an optional
existing session in its already authenticated host context. These reads never
use the recovering session snapshot or skill-discovery endpoints.

`resolve_product_destination` and `POST /product-destinations/resolve` accept a
bounded enum and the inspected `build_id`. They return a logical destination,
availability and steps with `opened: false`. A native caller without a browser
can present those steps. The model tool cannot select another session.

| Destination | Existing presentation owner |
| --- | --- |
| `projects` | All projects route |
| `mcp-settings` | MCP servers dialog |
| `configurations`, `model-authentication` | Configurations dialog and its existing provider authentication controls |
| `ssh-configurations` | SSH configs dialog |
| `session-subagents` | Current direct primary's Subagents panel |
| `session-files` | Current session's Files panel |
| `session-terminal` | Current attached Local direct primary's Terminal panel |
| `session-history` | Current session's phone History panel; desktop receives revision-selector steps |

The browser bridge belongs to one immutable `NativeRuntime`. Only a user click
or explicit call to `runtime.productNavigation.open` invokes it; rendering an
answer never invokes it. It revalidates build, current view/session, visibility
and supported panels before opening. Closing/replacing a runtime, changing the
view or superseding a pending request invalidates the request. Connecting a
browser later never replays a headless request. Existing sidebar commands and
help navigation use the same presentation-scoped dialogs and overlay atoms.
Markdown links retain their existing file/external-link protections.

Opening a destination grants no form submission, authentication, key write,
approval-mode change, backend switch, prompt send, terminal launch or recovery
authority. Agent tools use ordinary prepared permission policy for
`product_context_read` and `product_destination_read`; configured/hard denials
and headless fail-closed behavior remain effective. The server port holds a weak
reference to the exact serving owner and cannot follow a replacement at the
same store path. No durable schema changes or Guide installation are required.
The response identifies its `installed-runtime` source and build; Guide document
and section references remain separate version-matched knowledge sources.

Standalone browser requests additionally carry the existing bootstrapped serving
incarnation on these two product endpoints. A replacement router rejects an old
document even at the same origin and build. This optional rejection-only header
is not authentication; headless clients omit it, and embedded consumers retain
their caller-owned gateway/runtime binding. Failed context reads hide cached facts.

Before opening a resolved destination, the attached browser reads current passive
context through the same bound transport and rechecks its view lifetime. This
rejects a successful old receipt delayed across a same-origin server restart.
Unbootstrapped Vite development proxies these endpoints without inventing a
serving fence. Production browser acceptance uses the embedded bootstrap; hosted
callers retain their existing gateway fences.
