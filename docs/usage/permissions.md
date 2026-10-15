# Direct-session permissions

Direct sessions evaluate every prepared agent tool operation against deterministic
permission rules before it can run. Hard safety denials and configured deny
rules are final. Approval authorizes only the prepared operation on the
session's already selected Local, SSH, or Podman backend; it does not change
that backend, escape its sandbox, or expose credentials.

The permissions control beside the direct-session composer supports three
answer modes:

- **Manual** is the default. A request that reaches the approval broker pauses
  for **Allow once**, **Always allow** when NAC derived a safe reusable resource,
  or **Reject**. Without an interactive approver it fails closed.
- **Approve all** answers ordinary broker requests as **Allow
  once**. Enabling it also safely drains requests already waiting at that
  broker. It never creates remembered grants and cannot override a hard or
  configured denial.
- **Approve for me** sends requests that reach the approval broker to Jev, an
  automatic reviewer reached through ArceeFM, when they are eligible: ordinary
  commands, reads outside the workspace that are not credential files, and
  broad execution on the Podman backend. Git, Cargo, Make, shells and
  interpreters run repository-controlled code, so on Local and SSH they keep
  the manual prompt even for read-only commands such as `git status`. Jev can
  allow one exact invocation once. On a Podman sandbox whose only writable
  host mount is a workspace without Git metadata anywhere in it (checked
  again at every review, including nested and bare repositories; a
  workspace of more than 20,000 entries counts as having it), Jev needs
  less confidence to allow a command than on Local or SSH. A sandbox that can write Git
  metadata is reviewed like Local, because that metadata is shared beyond
  the session: a live checkout's `.git` holds every branch and its hooks,
  and a forked worktree writes the repository's objects and refs. So is a
  sandbox started with extra writable mounts (`--mount`). In both, broad
  execution keeps the manual prompt and the stricter thresholds apply, which
  covers most Podman sessions on a Git repository. Rejected, uncertain,
  failed and timed-out reviews return an unexecuted
  error to the agent with a stable code (`review_rejected`, `review_uncertain`,
  `review_unavailable`, `review_stopped`). Everything else, including
  unsandboxed broad execution, unsupported shell syntax, terminal input,
  credential files and operations whose description had to be redacted, keeps
  the manual prompt; without an interactive approver it fails closed.

Automatic approval has durable ownership-tree scope. On a direct or
direct-with-orchestrator primary session, it applies to that session and all of
its traditional child sessions, including children that already exist or are
created later. The policy is resolved through the durable root owner, so it
also covers deeper descendants if the traditional-child nesting limit changes
in the future. It survives server restarts and session resume and remains
active until the user turns it off in the primary session's permissions
control. Disabling restores manual handling immediately across the tree.

Traditional children keep their own requester identity, transcript, remembered
grants, configured rules, and execution backend. A manual prompt identifies the
child that requested access. Managed orchestrator sessions are a distinct
durable topology and do not inherit this setting. The primary composer shows
**Auto-approve on** for as long as the mode is active so the disable control
remains easy to find.

Remembered grants remain separately scoped to the exact resource, backend
class, and session configuration revision that NAC derived. Forgetting a grant
does not change the answer mode, and changing the answer mode does not add or
remove grants.

Authenticated human-initiated product operations never enter the agent
approval-request lifecycle. An exact human `!` command and **New shell** run
without an agent approval card, including in Manual mode with no connected
approver. They retain hard/configured Deny, authentication and session ownership,
canonical working-directory binding, configuration/readiness checks, and the
selected supported backend. Human intent is issued privately by the service;
a client/model cannot declare itself human. It changes no approval mode and
creates no remembered grant. Agent opaque commands and nonempty `write_stdin`
keep their ordinary policy.

A live human shell accepts fresh focused typing, resize and close directly.
Normal reattach or **Reconnect** sends no automatic input and needs no extra
Enable-input step. If input was accepted but delivery could not be confirmed,
NAC freezes typing and shows **Acknowledge failure and enable fresh input**.
Check the shell, then acknowledge before typing again. Old input is never
retried; this acknowledgement is delivery recovery, not agent permission.

## Approve for me

Selecting Approve for me reuses NAC's existing Arcee authentication: a stored
Arcee login (`nac-web arcee-auth login`) or a configured `ARCEE_API_KEY`,
independent of the session's model. When both exist, reviews use the login
and fall back to the API key if the login has expired or is rejected. Without either, the selection fails with
"Sign in to Arcee or configure an Arcee API key in NAC before enabling Approve
for me." and the previous mode stays selected.

The reviewer sees a bounded, redacted description of the prepared operation:
the tool, canonical resources, backend and, as intent, the messages a person
typed to the session tree through the app or the HTTP API (prompts, queued
messages and steering), oldest first. Messages accumulate across runs, so a
later prompt such as "continue" does not lift an earlier restriction such as
"do not push". Turning Approve for me off clears them; after turning it on
again, reviews use the messages typed from then on. Each message becomes
intent in the same store write that hands it to the model, so a queued
message counts only once its run starts, and one cancelled before then never
counts. Text that NAC, the agent, a child, an orchestrator or an MCP client
wrote is never sent as intent, though a run an MCP client starts is still
reviewed against what a person typed earlier. Requests keep the manual prompt
instead of being reviewed without scope when no person has typed anything
yet (for example in a session driven only over MCP), when the messages
exceed 20 or 8,000 characters (turn Approve for me off and on to start
over), or when any of them carries a credential-shaped value or a stored or
managed secret. Messages are never shortened or partly dropped, since that
could hide a restriction. An operation that needed redaction is not reviewed
either. Tool output, files and the transcript are never sent. ArceeFM
records requests as it does other inference requests unless the
organization has zero data retention.

Reviews never create remembered permissions. A verdict is discarded if the
answer mode changes while the review runs. Within one run, three consecutive
blocked reviews, ten blocked of the last fifty, or two consecutive unavailable
reviews stop the run; switch to Manual to continue during an outage.

Blocked actions are listed in the permissions dialog. **Authorize retry** asks
the agent to retry exactly that action once; the retry passes policy and a
fresh review with your authorization as context. Blocked actions and
authorizations are not kept across restarts.

### Testing the reviewer

- `make test-e2e-review` runs the browser journey against a build with the
  `review-fixture` feature, whose scripted reviewer replaces Jev only when
  `NAC_REVIEW_FIXTURE` is set. Ordinary builds cannot load it.
- `cargo test -p nac-core live_jev_smoke -- --ignored --nocapture` sends one
  synthetic request to the configured Arcee environment. Jev is currently
  deployed to the dev environments only; to test there with an Arcee API key
  from that environment, set `ARCEE_API_KEY` and
  `NAC_REVIEW_ARCEE_BASE_URL=https://api.apps.dev.arcee.ai/api/v1` (or the
  dev2 host). The override applies only to API-key review and must be an
  approved Arcee origin.
- `cargo test -p nac-core live_jev_corpus -- --ignored --nocapture` runs the
  labeled corpus through NAC's real projection and Jev, and fails on any
  approved high-risk fixture. Set `NAC_JEV_CORPUS_REPORT` to write a JSON
  report with verdicts, latency and cost.
