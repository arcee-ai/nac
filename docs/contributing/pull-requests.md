# Pull requests

A reviewer should understand what a PR changes from its description and
evidence alone. This page is the contract the
[PR template](../../.github/pull_request_template.md) links to. Engineering
rules for the code itself stay in [`AGENTS.md`](../../AGENTS.md) and the nested
guides; this page does not repeat or override them.

Nothing here adds a required check, bot, or approval rule. Designated
reviewers, required checks, and release policy are unchanged.

## Size and scope

- One independently useful behavior per PR.
- Aim for under about 2,000 changed lines, not counting machine-written
  outputs (`crates/nac-server/assets/dist/`, generated OpenAPI/TypeScript,
  lockfiles, the model catalog). This is a review heuristic, not a gate. If a
  change is cohesive and larger, say why in the description.
- Split genuinely dependent work into a short stack. Each layer must build,
  pass, and be usable on its own.
- Generated outputs still travel with the source that produced them.

## Describe the change

- Link the ticket and state the problem in a sentence or two.
- Say what behavior changed, not how every file changed.
- List the tests and commands you ran with their results.
- Name journeys you did not run and any acceptance gap, rather than leaving
  the reviewer to guess.

## Visual evidence

Any change a user can see needs comparable before/after evidence.

- Capture the baseline from the base revision and the current state from the
  PR head. Name both revisions (short SHAs).
- Use the same fixture data, viewport, theme, and zoom for both, and cover each
  affected state (for example empty, loading, error, selected) and each
  affected width. The production-embedded E2E harness with its scripted
  provider (`make test-e2e`, `crates/nac-server/web/e2e/`) or `make dev` with a
  disposable `DEV_STORE_PATH` gives repeatable states.
- A short recording is better than screenshots for timing, focus, or
  keyboard behavior.
- Add one sentence per pair saying what the reviewer should notice.

If nothing visible changes, write `No visual change:` and the reason, then
show the behavioral evidence instead: test output, a terminal transcript, or
an HTTP trace.

## Privacy

Evidence is public in the PR. Never include credentials, tokens, device codes,
cookies, private keys, private repository contents, personal paths, email
addresses, or other user data. Use disposable stores, fixture accounts, and
fixture workspaces; crop or redact anything else before uploading.

## Examples

**UI fix.** The folder picker submitted the previously browsed folder when a
user typed a path and clicked Select without pressing Enter (ALL-551). The
description states that in one sentence and says Select now validates and
applies the typed path. Evidence: a baseline/current pair at the same width
from the same fixture folder, showing the project form receiving the old
folder before and the typed folder after, plus the invalid-path error state.
Tests list the component regression and the Playwright journey with results.
Unrun journeys: real SSH host, if one was not available.

**Logic-only change.** `make dev` failed with an unhelpful message when its port
was taken (ALL-560). The description says `No visual change: terminal-only
startup diagnostics`, then shows the old and new terminal output for an
occupied API port and an occupied app port, and the source-workflow fixture
result.
