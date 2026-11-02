# NAC direct controller adapter

Use this adapter only in a top-level NAC `direct` session. Read the complete
QA skill before dispatch. Traditional children inherit the selected backend,
workspace and policy ceiling; skill instructions cannot grant permissions.
This live QA workflow requires a Local unsandboxed host controller. If the
current backend cannot provide that, retain a named infrastructure gap and stop;
do not reconstruct a Local runtime to escape the selected backend.
Do not enable an orchestrator, call public MCP to loop back into NAC, launch a
visible independent task, or create a goal for any QA phase. A child loading
this reference remains its explicit `mode`, never a controller.

## Capacity and context

NAC currently admits at most four active traditional children per parent.
Require capacity for all `n` workers together, including any already active
children and host process/browser/build admission. Reject an unsupported `n`
with that evidence before setup; never serialize batches or silently reduce it.
Setup and aggregate each use one child at different times and do not count
toward `n`. Keep unrelated children intact. Default `n=4` needs all four slots.

The `general` profile supplies native coding tools and disables recursion,
goals and orchestrator control. It does not accept `skills`, `mode`, or source
thread fields as tool arguments, and a fresh child does not inherit the parent
conversation or activated skills. Put the role and all required context in
`prompt`: the complete QA skill body and this adapter as literal text, absolute
skill/resource paths, caller scope/revision, host admission requirements, then
the explicit phase inputs. Do not rely on `$qa` expansion inside a tool prompt.
Do not place ephemeral Podman connection fields in committed files or RUN.json.

## Dispatch and retain

1. Dispatch one fresh setup child with `subagent`:

   ```json
   {
     "profile": "general",
     "description": "QA setup",
     "prompt": "<complete skill, adapter and caller context>\nmode=setup\nn=<n>\n<requested revision>",
     "child_session_id": null,
     "background": false
   }
   ```

   Require a completed structured outcome and retained setup report containing
   `repo_root`, `pass_root`, SHA, binary identity, proven Podman mode and all `n`
   complete assignment contracts. Read RUN.json from that absolute root and
   compare the contracts before dispatch. If setup fails or prerequisites are
   missing, retain its outcome and report the named gap. No test wave or aggregate
   claiming `n` completed slots exists in that case.

2. Submit exactly `n` fresh `subagent` calls in **one parallel tool-call wave**.
   Use `profile: "general"`, `child_session_id: null`, `background: false` and a
   distinct short QA slot description for each. Copy each setup contract verbatim
   into its prompt, including `mode=worker`, fixed paths, scope and SHA. Add the
   complete skill/adapter, caller context, setup report and child identity, plus
   setup-proven ephemeral Podman fields. Foreground calls are parallel-admitted;
   separate sequential foreground calls would serialize the QA pass.

   Record each returned child ID, generation and terminal outcome against its
   original slot in `coordinator.log`. A tool error, failed child, cancellation
   or absent report is an explicit dispatch outcome, never permission to spawn
   a replacement or count a slot as passed. If admission partially fails, let
   admitted children settle, then aggregate all expected slots and the failures.
   Do not claim that a partially admitted wave achieved the requested concurrency.
   If a launch acknowledgement is uncertain, reconcile owned child state before
   retrying; never blindly repeat a fresh-child call.

   Background calls may instead launch the same single wave when the controller
   needs to remain responsive. Retain their child IDs/generations and consume
   automatic durable inbox completions; do not poll or duplicate their work.
   Use `subagent_status` only for a genuine missing/uncertain outcome, and
   `subagent_cancel` only for the exact owned active child. A pass cancellation
   stops testing, settles admitted children, then still needs cleanup/evidence
   recovery; if the parent itself cannot continue, report recovery pending.

3. Once every admitted worker is terminal, dispatch one fresh foreground
   `general` aggregate child with `mode=aggregate`. Supply the complete skill,
   adapter, setup-defined root/pass/SHA/`n`/expected slots, setup report, every
   available worker report and structured child outcome, and explicit outcomes
   for missing reports. Child outcomes replace orchestrator source-thread
   episodes here; never invent a source-thread argument or omit failed slots.
   Supply setup-proven ephemeral Podman fields for exact cleanup recovery.
   Aggregate follows the skill's validation, `infra` stubs, status precedence
   and ownership-checked cleanup; it cannot test or dispatch replacements.

4. Return the aggregate report and its limitations. Retain RUN.json, reports,
   SUMMARY.md and evidence under the one ignored pass root. The setup, each
   worker and aggregate also retain their own durable child reports; name their
   IDs/generations in `coordinator.log` for attribution. Do not rewrite a worker
   report to match an aggregate conclusion. Missing aggregate output is `infra`,
   not a successful pass inferred from workers.

## Qualification boundary

A bounded scripted direct fixture can prove native dispatch, child capability
ceilings, exact assignment transfer, retained outcomes and failure/cancellation
accounting. Label it a choreography fixture. It does not prove a discretionary
model followed this skill or that live sandbox/browser QA ran. A full QA pass
requires the setup prerequisites and every worker's live SUT evidence described
in SKILL.md. Report missing rootless Podman by its actual failing probe; Local
fixture success does not qualify SSH or Podman execution backends.
