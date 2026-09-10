# Direct-session permissions

Direct sessions evaluate every prepared tool operation against deterministic
permission rules before it can run. Hard safety denials and configured deny
rules are final. Approval authorizes only the prepared operation on the
session's already selected Local, SSH, or Podman backend; it does not change
that backend, escape its sandbox, or expose credentials.

The permissions control beside the direct-session composer supports two answer
modes:

- **Manual** is the default. A request that reaches the approval broker pauses
  for **Allow once**, **Always allow** when NAC derived a safe reusable resource,
  or **Reject**. Without an interactive approver it fails closed.
- **Approve all automatically** answers ordinary broker requests as **Allow
  once**. Enabling it also safely drains requests already waiting at that
  broker. It never creates remembered grants and cannot override a hard or
  configured denial.

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
