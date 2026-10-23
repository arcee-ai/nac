# Retained isolated tasks

In a saved Local Git project, choose **New Session → Agent Session** to start a
separate direct task in its own retained checkout. Supply a title and initial
brief. On the first launch, save the project's exact default branch. Model
settings come from the destination project's existing defaults.

An explicit Git branch, tag or commit takes precedence. Without one, a launch
from a task in the same project uses that task's committed HEAD; a launch from
elsewhere uses the destination's saved default branch. The selected ref resolves
once to an immutable commit. Source edits, including staged and untracked files,
are excluded. Preparation does not copy a conversation or create a durable goal.

The preparation view shows the pinned commit, named preparation phase, exact
checkout path and **Open task** link. The task becomes available after workspace
and runtime preparation and the atomic publication of its session and initial
brief. Open either conversation to send or queue input independently.

**Use existing checkout** explicitly selects ordinary local creation. Non-Git
projects, remote projects and other session behaviors retain their established
creation path. Retained isolation itself currently supports unmanaged Local
hosts on Unix platforms; SSH and Podman are not supported launch backends.
If Git source inspection fails, the error view offers the same explicit
existing-checkout action. It never selects that action automatically.

## Retries and interrupted preparation

A launch has one request identity. **Retry same request** and **Resume same
request** reuse its original arguments and pin, even when the named branch moved
or was deleted. Reusing that identity with different arguments conflicts.
**Start another intentional task** creates a new identity and separate checkout.
After a host restart, interrupted preparation is shown as failed with a resume
action. Merely reading preparation status does not resume work or wake an agent.
An existing checkout without its durable materialization checkpoint remains
failed for inspection: Git may have registered HEAD before populating files.
Resume never treats that partial state as ready, fills it in, or resets it.

Session publication and the first durable inbox item commit together. A lost
response cannot create a second session or brief. Cancellation before publication
prevents both; cancellation after publication withdraws a pending initial brief
or cancels the active run through the established session lifecycle.
The inventory's **Cancel preparation or current run** action deliberately targets
the task's current run, including a later follow-up. Removed tasks can still have
their preparation receipt cancelled without reopening the session.

## Retention

Completion, cancellation and deleting a task retain the checkout. The project's
preparation inventory keeps its request, source, commit, session identity and
path even after session deletion. Removed sessions lose their Open task link;
the retained files remain inspectable at the displayed path. No automatic
cleanup, archive/restore or disk reclamation is provided.

Preparation runs no checkout hooks or smudge/process filters. Submodule/LFS
materialization and repository setup commands remain explicit agent work. A
missing source, changed repository identity, invalid effective subdirectory,
policy denial or ambiguous interrupted Git effect fails visibly without using
the source checkout as a fallback. Uncertain resources remain retained for
inspection; preparation never resets an existing owned checkout to hide edits.
The saved source/default-branch binding is immutable in this delivery. If that
branch is renamed or removed, select its replacement explicitly in the Git ref
field. Changing the saved binding requires a future project configuration flow.
