# Direct internal-subagent QA choreography

ALL-423 adapts the repository QA skill to the existing NAC direct child tools.
The orchestrator's setup → exactly n peers → aggregate path remains available.
The direct adapter uses one fresh `general` child for setup, one parallel wave
of exactly n fresh test children, then one fresh aggregate child. No independent
task, autonomous goal, orchestrator enablement, new allocator or runtime API is
introduced. The selected execution backend and ordinary permissions still apply.

## Bounded fixture

`crates/nac-server/src/tests/direct_qa.rs` exercises a real Local direct parent,
native model-visible `subagent` calls, the server's traditional-child controller,
native revision-checked file writes and durable child outcomes. It loads the
actual repository skill and adapter into an isolated disposable project. A
loopback Responses double scripts tool selection; no paid provider is contacted.
Each journey runs in its own test subprocess so isolated HOME/NAC_HOME settings
cannot affect unrelated tests in the parent binary.

The fixture explicitly requests **n=2**. A two-party provider barrier requires
both test children to arrive before either can finish, so sequential dispatch
cannot satisfy it. Setup completes before that wave and aggregate begins after
both outcomes. Assertions inspect actual child relationships, retained prompts,
reports, source identity and model-visible tools:

- One setup, two workers and one aggregate, all direct traditional children;
  no additional sessions or descendant children.
- Setup's literal assignment contracts survive in RUN.json and each worker's
  retained input, including the same committed project revision, root and paths.
- Child tool sets exclude subagent nesting, goal creation and orchestrator control.
- A seeded finding remains a worker outcome and is counted separately from a pass.
- Cancelling the exact owned second child retains its cancelled terminal state;
  aggregate receives actual structured outcomes and writes the missing report as
  `infra`, with no replacement worker.
- A scripted unavailable-rootless-Podman setup outcome produces no RUN.json,
  test wave or aggregate claiming completed slots.
- All artifact writes stay under the ignored fixture pass root; the committed
  disposable project stays clean. Optional retained evidence includes captured
  provider requests, durable child outcomes and the fixture reports/summary.

This is **choreography evidence**, not a live `$qa` pass or evidence of a
discretionary model following the skill. The fixture deliberately replaces
preparation, binary construction, Podman and live SUT cases with labelled inert
inputs. Its RUN.json is a fixture record, not a complete live-pass manifest;
the finding is seeded, not a discovered NAC defect. It does not qualify remote
execution, sandbox cleanup, frontend behavior or the full shared skill catalog.

## Reproduce

Run `make setup` in a fresh worktree, then:

```sh
cargo test --locked -p nac-server direct_qa -- --nocapture --test-threads=1
```

For retained fixture artifacts, set `NAC_QA_FIXTURE_EVIDENCE` to an absolute,
ignored or external directory before that command. It writes separate `finding`,
`cancelled` and `missing-podman` directories. Use a fresh destination per run.
Respect any host resource gate around the entire Cargo operation. These fixtures
invoke the internal child runtime with a scripted provider; they do not start
live QA SUTs or user-owned tasks.

The generic Codex skill-creator `quick_validate.py` rejects the pre-existing
`compatibility` frontmatter key because its schema omits that key. Preserve the
NAC-supported field; the direct fixture uses NAC's real loader and explicit
`$qa` expansion. This generic-validator mismatch is not a successful validator
result, nor evidence that NAC rejects the skill.

## Live environment boundary

On the initial October 30, 2026 host probe, `podman --version` succeeded
(6.1.0), but `podman info --format '{{.Host.Security.Rootless}}'` exited 125:
the configured macOS VM socket refused the connection. No VM was started and
no backend was substituted. Rootless Podman and a complete live QA pass remain
unqualified by this work. A live run needs an available verified rootless engine,
authorized target revision and explicit supportable n, then every prerequisite,
SUT report and ownership-checked cleanup required by the skill.
