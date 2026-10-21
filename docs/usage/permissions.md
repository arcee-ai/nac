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
- **Approve for me** sends eligible requests that reach the approval broker to an
  automatic review service through ArceeFM: ordinary
  commands, reads outside the workspace that are not credential files, and
  broad execution on the Podman backend. Git, Cargo, Make, shells and
  interpreters run repository-controlled code, so on Local and SSH they keep
  the manual prompt even for read-only commands such as `git status`. Review can
  allow one exact invocation once. On a Podman sandbox whose only writable
  host mount is a workspace without Git metadata anywhere in it (checked
  again at every review, including nested and bare repositories; a
  workspace of more than 20,000 entries counts as having it), review needs
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
the selected mode for as long as it is enabled so the disable control remains
easy to find. For Approve for me, enabled describes the saved answer policy;
it does not guarantee that the review service is available.

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

Enabling this mode checks local credentials and the approved endpoint origin.
It does not contact the review service or check model access, credits or
connectivity. The permissions dialog shows **Service availability not checked**
until a review runs, **Review in progress** while it runs, then the last
retained result. A completed review describes that request only; it does not
guarantee availability for the next one.

There are three distinct paths:

| Request | What happens |
| --- | --- |
| Not eligible for automatic review | A manual permission prompt appears; without an interactive approver, the action is denied. |
| Eligible, with an approving verdict | That exact invocation is allowed once. No remembered grant is created. |
| Eligible, but rejected, uncertain, unavailable or timed out | The action is not executed. An error returns to the agent; no manual prompt opens automatically. Switch to Manual and ask the agent to try again if you want to decide the request yourself. |

Unavailable reviews include a fixed failure category, without provider response
text or credentials. The dialog explains whether to sign in again, check
workspace access or credits, ask an administrator to check the review model or
endpoint, or retry after a rate limit, timeout or service failure. Rejected and
uncertain verdicts are decisions about the action; an unavailable review
produced no decision.

The reviewer sees a bounded, redacted description of the prepared operation:
the tool, canonical resources, backend and, as intent, the messages a person
typed to the session tree through the app or the HTTP API (prompts, queued
messages and steering), oldest first. Messages accumulate across runs, so a
later prompt such as "continue" does not lift an earlier restriction such as
"do not push". Entering or leaving Approve for me clears them; reviews use
messages typed after it is enabled. Selecting the current mode again preserves
its accumulated scope. Each message becomes
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
could hide a restriction. Reverting or editing and resending a user message
invalidates review scope for its session tree, including traditional children;
requests keep the manual prompt until Approve for me is turned off and on and
the person provides fresh intent. The stored text cannot safely identify only
the surviving human messages. An operation that needed redaction is not reviewed
either. Tool output, files and the transcript are never sent. ArceeFM
records requests as it does other inference requests unless the
organization has zero data retention.

Reviews never create remembered permissions. A verdict is discarded if the
answer mode changes while the review runs. Within one run, three consecutive
blocked reviews, ten blocked of the last fifty, or two consecutive unavailable
reviews stop the run; switch to Manual to continue during an outage.

Blocked actions are listed in the permissions dialog. **Authorize retry** asks
the agent to retry exactly that action once; the retry passes policy and a
fresh review with your authorization as context. It does not repair unavailable
service configuration or bypass a review.

Recent reviews, blocked actions and retry authorizations are held in server
memory. They disappear on restart and when an idle session is unloaded after
its clients disconnect. An empty Automatic reviews panel therefore does not
prove no reviews occurred. The selected mode and recorded human intent remain
saved; turning the mode off still clears intent as described above. Keep any
required audit evidence separately, and do not rely on this panel as a durable
review log.

### Environment readiness

The session's coding model and the permission reviewer have separate access and
billing requirements. A working ChatGPT connection does not establish Arcee
review readiness; insufficient credits for an Arcee coding model are also
separate from a missing review model.

The current reviewer adapter requests `typesafe/jev-1.13` at the credential's
Arcee origin on `/api/alpha/decisions`. Each environment needs an active,
API-enabled registry row of type `decisions` for that name, included in the
selected workspace's access profile. An authenticated request can return
HTTP 404 when that row or access is missing, before billing or inference runs.

ArceeFM administrators import the model from provider discovery or create it
through the model registry. Discovery alone writes no model rows, and provider
field synchronization updates existing rows only. Importing an active model
does not by itself establish API access for every workspace. Check the API flag,
model type and access-profile membership in the target environment. Deploying
NAC does not provision these records or workspace credits.

Use credentials issued by the environment being tested. A normal
`nac-web arcee-auth login` targets production. For API-key testing against dev2,
use a dev2-issued `ARCEE_API_KEY` with
`NAC_REVIEW_ARCEE_BASE_URL=https://api2.apps.dev.arcee.ai/api/v1` in an isolated
`NAC_HOME` without a stored production login. The URL override applies only to
API-key reviews; stored logins use their own environment and take precedence.

### Testing the reviewer

- `make test-e2e-review` runs the browser journey against a build with the
  `review-fixture` feature, whose scripted reviewer replaces Jev only when
  `NAC_REVIEW_FIXTURE` is set. Ordinary builds cannot load it.
- `cargo test --locked -p nac-core live_jev_smoke -- --ignored --nocapture` sends one
  synthetic request to the configured Arcee environment. To test with an Arcee API key
  from that environment, set `ARCEE_API_KEY` and
  `NAC_REVIEW_ARCEE_BASE_URL=https://api.apps.dev.arcee.ai/api/v1` (or the
  dev2 host). The override applies only to API-key review and must be an
  approved Arcee origin.
- `cargo test --locked -p nac-core live_jev_corpus -- --ignored --nocapture` runs the
  labeled corpus through NAC's real projection and Jev, and fails on any
  approved high-risk fixture. Set `NAC_JEV_CORPUS_REPORT` to write a JSON
  report with verdicts, latency and cost.

The scripted browser journey checks NAC's approval flow, not deployment
readiness or the live reviewer's judgment. Before enabling an environment for
users, require a successful live smoke test, rerun the labeled corpus after
changes to intent, confinement, the rubric or thresholds, and run a real
session through both a routine approval and a blocked action. Record the code
revision, environment and result; an older corpus pass does not establish that
the current deployment is ready.

### Operator reviewer experiments

New permission brokers use the existing Jev reviewer by default. For an
explicit operator experiment, `NAC_PERMISSION_REVIEW_PROFILE` accepts only
`clef-scope-v6`. Unset the variable to keep legacy Jev; an
empty, unknown or non-Unicode value disables automatic review with a fixed
configuration error. Selection is snapshotted when each broker is constructed.
Changing the environment does not mutate an existing broker's profile.

The fixed training-selected profile remains an experiment. Training results
and passing finite fixtures alone do not qualify deployment; evaluate the
frozen model, rubric and numeric gates on fresh cases before enabling an
environment. Prior rejected profiles are not enabled by this setting.

The Clef profile binds the model, exact additional scope question, numeric
gates and history identity. Legacy Jev remains unchanged. Clef requires safe
probability at least 0.80 on every backend, routine category probability at
least 0.60, explicit confidence at least 0.40, and scope probability at least
0.70. Every gate must pass;
scope never compensates for failed safety/risk gates. Scope answers must have
type `noul` and a finite probability in [0, 1]; missing or malformed answers
are unavailable. All existing category/distribution validation and rejection
semantics remain effective. Legacy Jev's rubric and response contract do not
require the new scope answer.

Selection uses normal approved-origin Arcee authentication and model access.
It does not expose a project/session/UI setting, add models to the catalog,
change deterministic policy or eligibility, create remembered grants, change
canonical resource binding, or select a different execution backend.

The committed synthetic cases and captured Clef responses under
`crates/nac-core/src/model/testdata/` run through production scoring in ordinary
Rust tests. Their README records the frozen profile, comparison results and
limits. This offline replay detects scoring drift; it does not make a new
network request or establish current deployment readiness.
