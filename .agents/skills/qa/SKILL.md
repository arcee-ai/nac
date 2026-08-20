---
name: qa
description: Run scalable, isolated live QA for nac development. The top-level local orchestrator must parse n (default 4), dispatch one setup worker with this skill, copy its n assignment contracts verbatim into exactly n parallel test workers with this skill, then dispatch one aggregate worker with this skill using all test episodes; setup selects or creates a clean worktree for the requested revision, every phase changes to that worktree, slots and paths stay immutable after setup, and preloaded workers never dispatch.
compatibility: Requires a local unsandboxed Git checkout, Rust and web build tools, curl, and rootless Podman.
---

# NAC quality assurance

Run adversarial, evidence-backed QA against one requested committed revision. Exercise the live branch-built server, not only unit tests. Preserve every worker's findings in independent ignored reports, then summarize the complete pass.

This workflow tests; it does not fix. Never edit source, dependency files, generated assets, repository configuration, issues, or pull requests during a QA pass.

## Input and roles

`n` is the number of QA test workers. Accept one positive integer and default to `4`. A caller-supplied value means exactly that many test workers, not a maximum or aspiration. Reject zero, negative, non-integer, or locally unsupportable values with concrete capacity evidence; never reduce `n` silently.

Caller requests about focus or duration are ordinary test context, not additional formal parameters.

The process's starting directory is only a place from which to resolve the requested revision. Its branch, staged files, unstaged files, and untracked files are never infrastructure failures by themselves. Setup must select an existing clean worktree at the target commit or create one, change its working directory to that root, and run the pass there. Workers and aggregate must likewise change to the setup-defined root before inspecting Git or running commands.

The top-level controller is not a QA test worker. In nac it sees this catalog description but cannot read or write files; it must use this exact choreography:

1. Dispatch `qa/setup` with `skills: ["qa"]` and `mode=setup`, `n`, the caller's requested revision or PR, and the caller's complete scope/focus context.
2. Read the retained setup episode. It must contain the absolute execution-worktree root, pass root, source SHA, binary, and `n` distinct assignment contracts.
3. Dispatch exactly those `n` test workers together in one parallel wave. Copy every setup contract verbatim—especially `repo_root`, `slot`, `scope`, `report`, and `evidence`—then add `skills: ["qa"]`, `qa/setup` as a source thread, the setup-proven `podman_mode`, `XDG_RUNTIME_DIR` only for local mode, and ephemeral connection fields only for remote mode. Never rename, repartition, or “improve” assignments after `RUN.json` exists.
4. After all `n` finish, dispatch `qa/aggregate` with `skills: ["qa"]`, `mode=aggregate`, the setup-defined `repo_root`, exact slots, `qa/setup`, every test worker that produced a retained episode, and explicit dispatch outcomes for workers without episodes. A failed or timed-out worker cannot be named as a source thread.
5. Return the aggregate conclusion. Never substitute one all-purpose QA worker for this topology.

Other harnesses must use the equivalent setup → exactly `n` peers → aggregate topology. A controller that has direct file/process tools may perform setup or aggregation itself, but those phases still do not count toward `n`.

Determine the preloaded worker role only from an explicit `mode`:

- **Setup (`mode=setup`):** perform the setup workflow and return the complete immutable assignment contract. Never dispatch.
- **Test (`mode=worker`):** perform only the assigned slot. Never dispatch or aggregate.
- **Aggregate (`mode=aggregate`):** validate all expected reports and write the pass summary. Never run new tests or dispatch.

Missing or unknown `mode` is `infra`; do not infer that a preloaded worker is the controller.

## Invariants

- Resolve one trusted committed target, then test it from one mechanically clean execution worktree from setup through aggregation. Git cleanliness applies only to that selected worktree, not to the process's starting directory. The caller must have authorized the target SHA to execute repository-controlled build scripts and binaries on the host.
- Keep the coordinator and branch-built `nac-web` on the host. Use a verified rootless Podman engine for nac sandbox sessions and controlled external service doubles. Never expose a Podman socket to a container or use nested Podman.
- Give every worker a distinct server process, absolute home/config/store paths, loopback port, Podman resource namespace, evidence directory, and report.
- Keep the repository read-only by discipline. Pass-owned ignored build output is allowed; no other source-tree writes are.
- Use only controlled local service doubles. Never copy, provision, print, or persist real provider credentials. Never make paid-provider calls.
- Bind nac-web and published service ports to loopback only. Never use `--allow-remote`, wildcard binds, privileged containers, host networking, or global Podman prune.
- A pass is not successful until all `n` slots have a final `pass`, `finding`, `skip`, or `infra` report and current-pass resources are cleaned.

## Setup workflow

### 1. Select and freeze the source worktree

The setup worker may start in any worktree or subdirectory. It owns source selection for the pass:

1. Read governing repository instructions and find the Git common repository without changing the starting checkout.
2. Resolve the requested target to one immutable commit. For an explicit SHA or ref, peel it to a commit. For a PR, use the repository host's CLI or API to obtain its current head SHA and fetch that commit or PR ref without checking it out in the starting worktree. With no explicit target, use the starting checkout's `HEAD`; staged, unstaged, and untracked content is intentionally not part of that committed target.
3. Require that the caller owns, reviewed, or explicitly authorized that target for host execution. A request to QA a named local branch, SHA, or PR is authorization for that target; stop on a different, unreviewed third-party revision.
4. Parse `git worktree list --porcelain`. Prefer an existing worktree only when its `HEAD` equals the target SHA and it has no staged, unstaged, or untracked source inputs. Otherwise create a collision-safe detached worktree at the target with `git worktree add --detach <absolute-new-path> <target-sha>`. A dirty candidate is skipped, not cleaned and not an infrastructure failure; create another worktree instead.
5. Immediately change the setup worker's process or tool working directory to the selected root and use that absolute root for every remaining command. Record it as `repo_root`. Never stash, commit, reset, clean, switch, or delete anything in the starting checkout or a rejected candidate.
6. In `repo_root`, confirm the top-level path, exact `HEAD`, and mechanical cleanliness. If a newly created worktree cannot satisfy these checks, stop with the concrete Git error. Ignored build output and prior `.nac/qa/` passes do not make the selected worktree dirty.
7. Require `podman --version` and `podman info --format '{{.Host.Security.Rootless}}'` to succeed and report `true`. The client user's UID does not prove a remote engine is rootless.
8. Classify the selected engine as local or remote/VM-backed and prove it remains rootless after replacing `HOME`. For a local engine, capture `XDG_RUNTIME_DIR` ephemerally, require it to be an absolute existing directory owned by the current user, and prove rootless `podman info` with isolated HOME/XDG config plus that runtime directory. For a remote engine, read `podman system connection list --format json`, select its default connection, and map only its URI and identity path to ephemeral `CONTAINER_HOST` and `CONTAINER_SSHKEY`; prove rootless `podman info` with an isolated home. Return the mode and its ephemeral runtime fields in the setup episode, outside `RUN.json`; never copy the containers configuration tree.

### 2. Create the pass

Create a collision-safe directory beneath:

```text
.nac/qa/<UTC>-<short-sha>-<unique>/
  RUN.json
  bin/nac-web
  coordinator.log
  resources.jsonl
  evidence/<slot>/
  reports/<slot>.md
  workers/<slot>/
  SUMMARY.md
```

Verify with `git check-ignore -v` that a prospective report resolves through the existing `.nac/` rule before dispatch. Never reuse or overwrite an earlier pass.
Build once into a fresh pass-owned target directory with `CARGO_TARGET_DIR=<pass_root>/build-target make build`. Run the build with provider, proxy, SSH-agent, cloud, CI, token, password, and secret variables removed; retain only the host toolchain/cache variables it needs. Require the produced nac-web to be a regular non-symlink file, copy it to `<pass_root>/bin/nac-web`, make the copy non-writable, record its version and SHA-256, remove `build-target`, and confirm `HEAD` still equals the captured SHA. Use only that absolute pass-owned copy for every worker's server and `--worker-executable`; never use the shared incremental `target/` artifact or an installed binary.

Write `RUN.json` atomically. Include the pass ID, execution-worktree `repo_root`, ref, full SHA, pass-owned binary path/version/SHA-256, requested `n`, coordinator identity, start time, Podman version/mode, and worker assignments. Never include credentials or environment values; remote connection URI and identity path remain ephemeral in the setup episode.

`resources.jsonl` is an append-only coordinator ledger for resources the coordinator itself creates. Workers keep their own ledgers below `workers/<slot>/resources.jsonl`.

### 3. Assign coverage

Honor the caller's explicit scope partition first. Then give every remaining slot a non-overlapping, change-relevant risk axis and dedicated paths. Write the finalized contracts to `RUN.json`; from that point their slot, scope, report, and evidence fields are immutable. Keep the taxonomy useful but open-ended:

- **API and services:** HTTP, SSE, MCP, OpenAPI, model/provider streaming, tool calls, controlled slow/error/malformed service doubles.
- **Persistence and concurrency:** SQLite capacity, distinct-session concurrency, deliberate same-session busy behavior, restart, crash recovery, transcript/event durability, compaction.
- **Lifecycle:** session/thread creation, completion, steering, cancellation, process-tree cleanup, restart/reuse, image/tool events.
- **Sandbox and security:** Podman availability, worktree revision, mounts, fallback warnings, cleanup, host/guest boundaries, bind/origin/Host validation, secret redaction.
- **Frontend:** real browser flows, live updates, accessibility, destructive actions, reconnect and failure states. Claim frontend coverage only after driving the actual page.
- **Malformed and fuzz:** schema boundaries, protocol sequences, generated request bodies, replayed seeds, cancellation races, timing and fault injection.
- **Resources and endurance:** file descriptors, memory/process growth, latency, bounded sustained load, cleanup after interruption.

Every worker must exercise its live branch-built SUT. Existing tests and static checks are supplementary. Ensure at least one slot owns a bounded reproducible malformed/property/fuzz campaign. As `n` grows, split providers, seeds, client counts, state transitions, repetitions, and failure modes instead of duplicating prompts.

Each worker dispatch must include:

```text
mode=worker
repo_root=<absolute setup-selected execution worktree>
pass_root=<absolute path>
slot=<stable unique slot>
source_sha=<full SHA>
binary=<absolute branch-built nac-web>
scope=<assigned risk axis and concrete boundaries>
report=<absolute pass_root/reports/slot.md>
evidence=<absolute pass_root/evidence/slot>
caller_context=<relevant focus or time guidance>
podman_mode=<local|remote>
```

Return the execution-worktree root, pass root, captured SHA, pass-owned binary path/version/SHA-256, requested `n`, Podman mode, the selected mode's ephemeral runtime fields (`XDG_RUNTIME_DIR` for local or connection URI/key path for remote), and all `n` complete worker contracts in the retained setup episode. Do not dispatch them yourself.

## Aggregate workflow

Run only with `mode=aggregate`, the absolute setup-defined `repo_root`, absolute pass root, captured source SHA, requested `n`, expected slot/report paths, the setup episode, every available completed test-worker episode, and explicit dispatch outcomes for missing episodes. Ignore the aggregate process's initial directory: resolve and change to `repo_root` first, then validate that root and the other values against `RUN.json` before writing anything. Then:

1. Require one final report at every assigned path. If a worker exited before atomically finalizing its report, write an aggregate-owned `infra` stub for that slot from its dispatch outcome and partial evidence; never call it a pass.
2. Recover cleanup after any crashed, cancelled, or timed-out worker. Validate each write-ahead worker ledger against its setup-defined slot, pass label, exact service names/cidfiles, pre-request Podman container-ID snapshot, pass-owned event log, ledgered observer PID/command, and setup-proven Podman engine. Stop and wait an exact leftover observer only after its command names the pass-owned event log, then ensure the log is closed. For a nac sandbox request without a completed response, consider only container IDs absent from the snapshot and created during the ledgered request window. Before removal, require `podman inspect` to prove the candidate's mount source lies under this slot's pass-owned isolated `NAC_HOME/worktrees/` and its mount destination equals the requested guest workspace. Remove only proven pending or created resources, then verify them absent. Stop and report exact leftovers when ownership cannot be proven.
3. Confirm reports are regular files under the pass root, have unique paths, name the captured SHA, and link only to evidence under the same pass root.
4. Confirm `git -C <repo_root> rev-parse HEAD` still equals the captured SHA, the selected worktree remains mechanically clean, and the pass-owned binary SHA-256 still matches `RUN.json`. Revision, worktree, or binary drift invalidates the pass as infrastructure evidence. Never inspect an unrelated startup checkout.
5. Read every report. Deduplicate findings only in `SUMMARY.md`; never rewrite worker reports.
6. Account for exactly `n` slots by primary status and separately count `clean`, `degraded`, and `failed` infrastructure outcomes. Preserve product findings even when their slot also has infrastructure failure; never count one slot under two primary statuses. Preserve contradictory results and repeated symptoms with source links.
7. Record cleanup results and any exact resource IDs that remain. Do not remove pre-existing resources or earlier pass directories.

`SUMMARY.md` must include revision and environment identity, assignments, primary status counts, separate infrastructure-outcome counts, coverage gaps, deduplicated findings ordered by severity/confidence, exact report links, fuzz seeds/replay commands, cleanup conclusion, and a statement that findings were not fixed during QA.

## Worker workflow

### 1. Validate the assignment

Require all worker dispatch fields, including `repo_root`. Ignore the worker process's initial directory: resolve `repo_root`, require that it exactly matches `RUN.json`, and change the process or tool working directory there before any Git check or test command. Resolve every other path and reject any report/evidence/worker path outside `pass_root`. Require the report not to exist. Create only the assigned evidence and worker directories.

Confirm `git -C <repo_root> rev-parse HEAD` equals `source_sha`, that selected worktree remains mechanically clean, and the supplied binary is an absolute regular non-symlink file whose version and SHA-256 match `RUN.json`. Re-hash it immediately before every host execution and SUT sandbox launch. State from any other checkout is irrelevant. If a selected-root or binary check fails, write an `infra` report and clean up without testing a different revision or binary.

Do not dispatch threads. Do not write `SUMMARY.md`, `RUN.json`, another slot's directory, or the repository outside ignored build output.

### 2. Create isolated state

Use absolute paths below `pass_root/workers/<slot>/` for:

```text
home/
xdg/
nac-home/
store.db
server.stdout.log
server.stderr.log
resources.jsonl
```

Construct the server environment from a minimal named allowlist. Set the isolated `HOME`, `XDG_CONFIG_HOME`, and `NAC_HOME`; retain only required `PATH`, locale, temporary-directory, logging, the setup-proven local `XDG_RUNTIME_DIR`, or the setup-proven remote Podman fields. Remove ambient provider/base-URL, proxy, SSH-agent, cloud, CI, token, password, and secret variables. Before the first nac-web launch, set `MODELS_DEV_URL` to a run-owned loopback metadata double; a deliberately closed loopback endpoint is acceptable only for an explicit offline case. Add only run-specific dummy credentials consumed by local service doubles.

Record allowed variable names, never values. Before server launch, verify the isolated homes contain no copied `config.toml`, auth files, credential files, model overrides, or user skills. Use secret canaries in local doubles and later confirm they do not appear in logs/reports.

Use the setup-proven Podman mode from the dispatch. For a local engine, pass the ephemeral setup-proven `XDG_RUNTIME_DIR` and require rootless `podman info` under the isolated home; do not omit the runtime directory that owns the rootless user socket. For a remote/VM engine, use the ephemeral setup-proven `CONTAINER_HOST` and `CONTAINER_SSHKEY` and require the same rootless check. Do not rediscover another connection, fall back to ambient `HOME`, persist runtime/connection fields in `RUN.json`, or copy the user's containers configuration tree.

### 3. Start the worker SUT

Immediately before launch, re-hash the binary against `RUN.json`. Then launch exactly the supplied binary with:

```text
--bind 127.0.0.1:0
--no-open
-y
-C <repo_root>
--store-path <absolute worker store.db>
--worker-executable <same supplied binary>
```

Capture stdout and stderr separately. Parse the actual listening address from nac-web's startup log; do not reserve a free port and race another process. Bypass ambient proxies for loopback probes.

Require readiness from `/health`, then probe `/openapi.json`, `/models`, and `/sandbox/availability`. A 200 health response is evidence for that probe, not proof that later database operations work. Exercise a real store/session operation before declaring readiness complete.

Watch stderr throughout. If nac reports `sandbox will mount the live checkout` or any equivalent worktree-isolation fallback, stop the affected case as `infra`; never continue against the live checkout.

Recheck `HEAD == source_sha` immediately before each SUT sandbox launch.

### 4. Run live QA

Choose concrete cases within the assigned scope. Prefer high-information transitions and failure boundaries over broad command counts. Cover expected success and expected failure; record both.

Controlled external services must run in the setup-proven rootless Podman engine with:

- a fully qualified image name and recorded image ID/digest;
- a unique collision-safe pass/slot label and exact name;
- no privileged mode or host networking;
- bounded CPU, memory, PIDs, and time;
- only required read-only inputs and a worker-owned output mount;
- service ports published to `127.0.0.1` for host consumers;
- a write-ahead worker-ledger record before creation. For containers, use a pass-owned `--cidfile`; for networks and volumes, record the exact planned name. After creation, append the resolved ID and state. This closes the cancellation window between create and ownership recording.

Prove connectivity from the actual consumer. `127.0.0.1` inside a sandbox is not the host. Use an explicit reachable service address or a sandbox-local service; do not weaken network isolation to make a test pass.

Before each owner nac sandbox request, record the selected engine's complete container-ID snapshot, request start time, isolated NAC_HOME worktree prefix, requested guest mount destination, and a pass-owned Podman event-log path in the worker ledger. Start `podman events` for container-create events before the request; ledger its exact PID and command, bound it with `--until` or an explicit stop, and write output directly to that durable path. On every path, stop and wait the observer after the request window, then flush/fsync and close the event log before report finalization. Do not send `sandbox.session_key`: that field attaches to an existing parent sandbox and does not predeclare a new owner's key. After a successful response, append the session ID, actual container ID/name, and request end time, then destroy through the nac session lifecycle first. The current launcher does not promise labels, custom networks, PID limits, or cidfiles, so do not claim them. If the request or worker is interrupted, aggregate recovery may consider only IDs new relative to the snapshot and events inside the request window, and may remove a candidate only after inspecting the exact ID proves its pass-owned worktree source and requested guest mount destination; otherwise leave it and report `infra`.

Use distinct session IDs for ordinary concurrent runs. Same-session concurrent submission should return the documented busy outcome unless that contract is what the case challenges. Treat SQLite lock, capacity, timeout, and descriptor exhaustion as observations requiring reproduction and classification, not automatic product findings.

### 5. Fuzz reproducibly

Prefer a repository harness if one exists. This repository currently has none, so do not add one during QA. Use an ephemeral container tool or a small untracked generator under the worker evidence directory.

Every fuzz/property case must be bounded and record:

- target and invariant;
- tool/generator and version;
- initial corpus or exact input domain;
- seed;
- iteration count or wall-time bound;
- CPU, memory, RSS, process, and per-input timeout limits where applicable;
- terminal statistics;
- crash/leak/timeout/minimized artifacts;
- one exact replay command.

A generator crash, invalid harness assumption, unreachable service, or exhausted test budget is `infra` until the same input reproduces against the SUT. Never report unreplayed random output as a product defect.

### 6. Write the report

Write to a temporary sibling and atomically rename it to the assigned final path after testing and cleanup. Produce exactly one immutable report.

Use this structure:

```markdown
# QA slot <slot>

Status: pass | finding | skip | infra
Infrastructure: clean | degraded | failed
Source: <full SHA>
Scope: <assignment>

## Environment and topology
## Cases and commands
## Findings
### <severity>: <observable title>
- Confidence:
- Expected:
- Actual:
- Reproduction:
- Evidence:
## Fuzz and replay
## Coverage and skips
## Cleanup
## Redaction
```
`Status` is one primary slot outcome. Use `finding` whenever the report contains at least one independently reproducible product finding, regardless of infrastructure outcome. Otherwise use `infra` when failed infrastructure invalidates a pass or skip; `skip` for explicitly unexecuted coverage or degraded non-invalidating infrastructure; and `pass` only when assigned coverage completed without a finding and `Infrastructure: clean`. Record infrastructure separately: `clean` means no harness/resource/cleanup limitation, `degraded` means a non-invalidating limitation and cannot accompany `pass`, and `failed` means invalidating unless `finding` remains primary.

Every finding needs observable impact, expected versus actual behavior, minimal exact reproduction, evidence path, severity, and confidence. Use `critical`, `high`, `medium`, or `low` for severity; do not inflate severity from noisy load alone.

Sanitize credentials, auth headers, cookies, private model responses, user paths, and unrelated environment data. Bound logs and store large raw output only under the assigned evidence directory. State which redaction checks ran.

## Cleanup

Cleanup runs cooperatively on success and failure. The aggregate workflow is the recovery owner after worker timeout, cancellation, crash, or interruption:

1. Stop runs and delete SUT sessions created by the worker.
2. Stop and wait the exact ledgered Podman event observer, flush/close its pass-owned log, and verify the observer PID is absent.
3. Terminate the exact worker nac-web process and wait for its process tree.
4. Remove worker-created containers, networks, and volumes from the current worker's write-ahead ledger in dependency order. Resolve a pending entry only through its exact cidfile or exact collision-safe name.
5. Verify nac-owned sandbox containers created by the worker are gone; remove only an exact inspect-proven leftover ID.
6. Confirm the worker port no longer accepts connections and no worker process remains.
7. Preserve the worker report, server logs, resource ledger, and sanitized evidence. Remove ephemeral credential canaries and mutable state only after evidence capture.

Never run `podman system prune`, an unfiltered bulk remove, `git clean`, or a name-prefix cleanup. Never touch resources absent from a validated current-worker write-ahead ledger.

If cooperative cleanup is incomplete, set `Infrastructure: failed` and list exact leftovers for aggregate recovery. Keep `Status: finding` when an independently reproducible product finding exists; otherwise set `Status: infra`.

## Stop conditions

Stop the affected worker or whole pass, preserving reachable evidence, when:

- the session is sandboxed/remote instead of a local host coordinator;
- the target is untrusted, the selected execution worktree becomes dirty or moves from the captured SHA, or the pass-owned binary digest changes; never stop solely because the process started in another dirty worktree;
- Podman is missing/unavailable or the selected local/remote engine is not verified rootless;
- an absolute isolated home/store/report path cannot be established;
- a server requires a non-loopback bind;
- ambient credentials/settings remain visible;
- worktree setup falls back to the live checkout;
- report paths collide or escape the pass root;
- exact cleanup ownership cannot be proven.

## Final response

Lead with the QA conclusion. Report the pass directory, tested ref/SHA, requested and completed worker count, status counts, deduplicated findings with report paths, important skips/infra limits, fuzz replay artifacts, and cleanup conclusion. Do not claim tests that no report proves and do not file issues or fix findings unless the user starts a separate task.
