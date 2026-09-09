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

Automatic approval has durable session scope. It applies only to the current
session, survives server restarts and session resume, and remains active until
the user turns it off in that session's permissions control. New sessions,
traditional child sessions, and managed orchestrator sessions do not inherit
it. The composer shows **Auto-approve on** for as long as the mode is active so
the disable control remains easy to find.

Remembered grants remain separately scoped to the exact resource, backend
class, and session configuration revision that NAC derived. Forgetting a grant
does not change the answer mode, and changing the answer mode does not add or
remove grants.
