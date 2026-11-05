# Capturing observed CI timing

`ci-timings.py` is a read-only evidence collector using the authenticated `gh`
CLI and Python's standard library. Run `make setup` in a fresh worktree first.

```sh
python3 .github/scripts/ci-timings.py capture 41936374012:1 41938950835:1 \
  --repository arcee-ai/nac --output /path/to/new-evidence
python3 .github/scripts/ci-timings.py summarize \
  /path/to/new-evidence/run-41938950835-attempt-1
python3 .github/scripts/ci-timings.test.py
```

Use the actual Stable release workflow run IDs. Other workflows are retained but
cannot supply that workflow's `Required PR checks` result. `RUN:ATTEMPT` pins the
requested attempt; plain `RUN` resolves the latest attempt once and then reads
its explicit attempt endpoints. Job pages retain step timestamps. Capture
requires a new or empty output directory; use another directory for each later
snapshot, including pending or failed observations.

Each snapshot retains raw run and paginated job responses, preparation and final
aggregate logs, commands with fetch timestamps and stdout digests, fetch failures,
repository metadata, run-scoped usage (all attempts), and a summary. Usage is
retained separately from exact-attempt job duration; unavailable billing data
remains a fetch error rather than a guessed cost. Failed, cancelled, missing and pending observations stay visible;
they never become successful timing samples. A retry may have diagnostic timing
but cannot become an ordinary first-attempt sample.

The workflow run's `head_sha` is the PR branch head. The checked merge candidate
can differ. The collector obtains the actual candidate from `SOURCE_SHA` and/or
`CANDIDATE_SHA` in the main preparation job's printed environment and requires
matching `EXPECTED_SHA` in the final aggregate log. Missing/conflicting identities,
foreign run/attempt jobs or incomplete duration evidence make the metric ineligible.

Processing latency is elapsed preparation start through final aggregate end.
Event-to-green additionally includes initial preparation wait. Both include later
scheduling gaps, setup, artifact movement and aggregate overhead. Executed job
seconds are summed separately by reported runner labels/group; they are neither
CPU time nor a billable dollar estimate. Pending jobs make compute totals partial.
Failed-result elapsed intervals remain diagnostic fields, separate from successful
processing and event-to-green metrics.

`metric_eligible` certifies the collector's timestamp/identity/status conditions,
not the workflow's coverage semantics. `ordinary_first_attempt_metric` additionally
requires a PR event and attempt 1. **Neither qualifies ALL-582's cohort.** Review the
complete consecutive run sequence, at least five meaningful candidates,
backend/managed/frontend/docs representation, controlled cold-cache case, full
coverage/failure matrix, resources/cache state and cost evidence separately.
No representative source changes, cold cache state, coverage parity or dollars
are guessed from a green aggregate. The tool never reruns workflows, writes
quality receipts, changes settings, or edits existing evidence snapshots.
