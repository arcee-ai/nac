# Recent terminal activity

The selected direct primary chat's terminal panel shows existing human shells,
agent PTYs and pipes, and exact human `!` commands. Recent activity is bounded.
A human shell is one entry for its lifetime; prompts, Enter presses and redraws
do not create inferred command records.

Reopening output observes the existing execution. It never launches a shell,
reruns a command, retains a process, restores a session or asks the model to
respond. Historical output is read-only. A dead shell cannot be reconnected;
starting new work uses the existing deliberate launch or command action and a
new identity.

Process settlement and output collection are separate facts:

- **Running** means the process owner still reports execution.
- **Cleanup pending** means process/resource ownership is unresolved. Output
  collection can already be complete while cleanup is pending.
- **Settled** means process ownership ended. It does not prove collector EOF.
- **Output collection pending** means a final append is not yet confirmed.
- **Output collection error** means collection ended without confirming the
  entire stream. A known process result remains valid independently.

Pipe results distinguish completed, cancelled, timed out and spawn error.
PTY exit codes describe only what the process owner proved; the panel does not
invent why a shell exited. An exact `!` command's durable state, exit code,
diagnostic and sanitized previews remain authoritative if fuller output becomes
unavailable. An unconfirmed accepted/started command has no reconstructed live
handle. Viewing it cannot reconcile its journal or repeat its effects.

Output availability has its own lifetime:

- **Retained output** can be reopened through its current session-owned handle.
- **Earlier output discarded** shows exact retained byte bounds. The observer
  resets its display before reading the retained tail, so missing bytes cannot
  silently be joined to an older screen.
- **Output expired** means known local metadata survives but its artifact is
  gone. An expired artifact id grants no read or control authority.
- **Process-local output unavailable** means the current owner has no matching
  observation reference. Metadata eviction and server restart can both cause
  this; an old durable snapshot alone cannot distinguish those causes.
- **No output reference recorded** means the durable command has no fuller
  output reference. It is not evidence that an uncertain command had no effects.

The recent projection returns at most 32 entries, ordered by admission time.
It reads at most 33 newest committed command journal rows to report omission.
The existing completed PTY metadata deque retains at most 16 entries; settled
pipe metadata likewise retains 16. Pending cleanup and collectors remain owned
outside those settled-history limits. View eviction never frees their leases.
The shared output registry keeps the configured byte and artifact budgets:
defaults are 8 MiB per command, 64 MiB per session and 16K artifact records.
Metadata and bytes can expire independently. Canonical transcript history and
durable `!` records retain their established storage contracts.

An unexpired observer bound to the current owner may repeat only an immutable
page it already admitted before source expiry. Acknowledging that page releases
it; obtaining another page still requires the existing source. Observer expiry
and service/configuration/host replacement deny even that bounded replay. This
receipt does not retain or restore an artifact or process.

Full output and process ownership are process-local. Server restart invalidates
old execution handles and observers. Durable `!` results/previews still appear;
human shells and fuller logs are not restored. Forked transcript evidence does
not grant access to the source chat's output. Recent activity reads remain
scoped to the current session, service incarnation, configuration and host.

The supported history contract uses the currently qualified Local direct
primary backend. It does not enable unqualified human SSH or Podman terminals,
or establish hosted acceptance from local tests.
