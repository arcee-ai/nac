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

Processing latency begins at admission identity when that unit precedes prepare,
or at prepare for legacy workflows, through final aggregate end. Event-to-green
additionally includes the initial wait before that first execution. Both include later
scheduling gaps, setup, artifact movement and aggregate overhead. Executed job
seconds are summed separately by reported runner labels/group; they are neither
CPU time nor a billable dollar estimate. Pending jobs make compute totals partial.
Failed-result elapsed intervals remain diagnostic fields, separate from successful
processing and event-to-green metrics.

For partial retries, GitHub can assign new job IDs and the new `run_attempt` to
carried-forward results while preserving their original execution timestamps.
The collector separates completed jobs before the retry's `run_started_at` from
new execution. `completed_job_seconds` counts only new execution;
`carried_forward_job_seconds` and `job_view_completed_seconds` retain the prior
durations and complete returned view separately. Missing boundaries or jobs
straddling a boundary leave compute explicitly incomplete, with known but
unclassified durations retained. Carried-forward results make elapsed pipeline
metrics ineligible. The controlled [partial-retry evidence](evidence/all-582/browser-partial-retry.json)
records 249 new job-seconds versus 6,391 seconds in GitHub's returned job view;
neither is CPU or billable time. Its successful source fallback and separate
proof artifacts provide diagnostic acceptance evidence, never an ordinary sample.

`metric_eligible` certifies the collector's timestamp/identity/status conditions,
not the workflow's coverage semantics. `ordinary_first_attempt_metric` additionally
requires attempt 1 and proven original PR event provenance. The preparation step
prints only `CI_EVENT_NAME`, `CI_EVENT_ACTION` and `CI_EVENT_BASE_CHANGED`, using
the original GitHub event name/action and a canonical `true`/`false` expression
for `github.event.changes.base != null`. It adds no commands or execution decisions.
The collector requires exactly one canonical printed value per field and exact
event-name agreement with the run API. `event_provenance` classifies `opened`,
`synchronize`, `reopened`, or `edited` with a proven base change as `source`;
an `edited` event without that change is `metadata-only`. `ready_for_review` is
`non-source`; push/manual events are `non-pr`. Missing, duplicated, conflicting,
malformed or noncanonical values remain `unknown`, never inferred from actors,
head repetition, edit timestamps or a later success. Unknown provenance leaves
otherwise valid diagnostic timestamp metrics available, but cannot set the
ordinary flag. Retries never set that flag, even with proven source provenance.

Historical snapshots used a weaker ordinary flag: successful PR event plus
attempt 1, without the original action. Those flags were potential indicators,
not cohort acceptance, and every `cohort_qualified` value remained false.
Keep their raw evidence and historical summaries intact; a new summary from
old logs will conservatively report unknown provenance. The bounded
[provenance audit](evidence/all-582/provenance-audit.json) records why the retained
observations do not prove a qualifying consecutive window. The workflow-run API
does not retain this action; public activity/timeline history only partially
corroborates it. Capturing the actual preparation environment closes this gap
for future runs that reach preparation. Runs cancelled before preparation still
have unknown provenance and must remain in the sequence ledger.

**Neither metric flag qualifies ALL-582's cohort.** Review the
complete consecutive run sequence, at least five meaningful candidates,
backend/managed/frontend/docs representation, controlled cold-cache case, full
coverage/failure matrix, resources/cache state and cost evidence separately.
No representative source changes, cold cache state, coverage parity or dollars
are guessed from a green aggregate. The tool never reruns workflows, writes
quality receipts, changes settings, or edits existing evidence snapshots.

## Admission processing boundary

For workflows with the source-admission unit before prepare, processing begins
at `ci-admission / NAC admission identity`, not the later prepare job. The
collector includes admission execution, subsequent waits and all remaining work
in processing_seconds; prepare-to-result remains a separate diagnostic field.
Initial wait ends at that earliest admission execution. Missing, duplicate,
skipped or improperly ordered admission evidence cannot yield eligible timing.
Legacy runs without the unit retain their original prepare boundary and numbers;
no historical snapshot is rewritten. PURE observations lack Required PR checks
and cannot become ordinary timing/cohort samples. All their resource jobs remain
recorded. This change neither qualifies a cohort nor selects successful windows.
