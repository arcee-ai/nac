# ALL-495 CI flake mechanisms

Recorded November 4, 2026 against `dev` at `481ee248`.

## Noisy terminal test

Two distinct failures share this test. The prompt change targets only the first.

**Marker erased before it renders.** In [run 40435191751](https://github.com/arcee-ai/nac/actions/runs/40435191751)
(artifact `12704192239`), the trace shows ten PTY resize requests within about 430 ms.
`NOISE-INTERRUPTED` reaches the observer in one 12,267-byte frame, followed by the
prompt and `\r\x1b[K\r\x1b[A\x1b[K\r\x1b[A\x1b[K\r\x1b[A\x1b[K`. Readline moves up three
lines to redraw its wrapped prompt. Input keeps succeeding for the remaining 10 seconds,
and no marker ever renders. The CI working directory makes that prompt long, and the
terminal is narrow while resizing. The test now sets a short prompt before starting its
noise, so nothing wraps, and the measurement clock is unchanged. We did not reproduce
this failure locally: runs with the prompt fix removed also passed, and resizing around
the marker in a scratch test either lost focus or closed the page before giving a result.

**Real slow rendering.** [Run 40577481249](https://github.com/arcee-ai/nac/actions/runs/40577481249)
(artifact `12768897663`) recorded 1,582.8 ms with the marker present, 203 animation
frames in about 8 seconds and a longest frame gap of 166.7 ms. Twelve misses from 1,541 to
3,132 ms were recorded from October 26 to 28. Under 6x CPU throttling and 14 busy loops,
local runs reached 1,300 ms. The 1,500 ms limit is unchanged. Waiting for the resize to
settle was tried and rejected: noise kept accumulating and latency rose to between 1,173
and 1,491 ms.

Repeating this test on `ubuntu-latest` still misses the limit. In
[run 41925939853](https://github.com/arcee-ai/nac/actions/runs/41925939853), 60 repeats per
job:

| Test version | Jobs | Runs | Over 1,500 ms | Typical (p50) by job | Slowest |
| --- | --- | --- | --- | --- | --- |
| Before this branch | 4 | 240 | 5 | 403 to 667 ms | 2,851 ms |
| With this branch | 4 | 240 | 4 | 281 to 711 ms | 2,620 ms |

So this branch neither causes nor fixes these misses. An earlier run with this branch
([41923980106](https://github.com/arcee-ai/nac/actions/runs/41923980106), six jobs) missed 7
of 360. In the side-by-side run:

- All 9 misses were in the first 10 repeats of a job, when the runner had just started.
  Regular CI reaches this test partway through its browser suite.
- With the marker timing added, the observer received the marker at about the same time it
  rendered in the slowest runs, so most of the delay comes before the browser renders.
- The slowest run carried 1,694 KiB of output against about 1,100 KiB for the fastest
  runs, which fits a backlog draining in 32 KiB pages. That cause is inferred.

`pressure-observations.json` now separates the two cases, including on timeout: marker
arrival at the observer, rows at the deadline, presence at paint, input receipts,
resize requests, page offsets and geometry.

## Session-list polling test

With a 5 ms poll, a second base response could replace the initial `old` title before
the test observed it. ALL-495 records this failure in test-server job
[121975313411](https://github.com/arcee-ai/nac/actions/runs/40439042325/job/121975313411).
That was an earlier attempt of its run, and it's the only occurrence found from October 25
to November 4, across all attempts. The test now holds that response until
`old` is observed. Delaying the assertion by 40 ms fails the previous test and passes the
new one.

## Manager-drop `WouldBlock`

The fixture unwrapped a retryable "identity changed during inspection" result inside its
5 second polling loop. #473 made the fixture keep those observations pending and still
require proof that every job died. It merged about 16 minutes after #380, so the rate
split below can't separate the two. This branch doesn't change that fixture.

## macOS signal denial

`proc_signal_with_audittoken` can return `EPERM` for a live process with the correct
identity while it execs. Probes on `macos-26` (26.6.2) replaced the test's `unwrap` with
bounded retry and logging:

| Run | Package runs | Signals sent without denial | Denied | Stuck |
| --- | --- | --- | --- | --- |
| [41883560005](https://github.com/arcee-ai/nac/actions/runs/41883560005) | 1,704 | 81,791 | 1 | 0 |
| [41888073821](https://github.com/arcee-ai/nac/actions/runs/41888073821) | 3,399 | 163,148 | 4 | 0 |

All four denials with retained detail show `comm_before=bash` and `comm_at_err=sleep`,
and each succeeded on the first retry within 35 to 130 µs. The kernel's reason is
inferred from this timing, not documented by Apple. It never reproduced on macOS 27.2 in
2,282 local runs.

`signal_with` now makes up to three signal attempts in total, one millisecond apart after a denial,
re-checking the exact identity each time. A persistent denial still returns `EPERM`, and
`terminate_members` still retains the identity.

Real CI fails mostly in the first pass: of the 22 failures below, 16 were first and 6 warm.
Each job runs a first and then a warm pass, and a first-pass failure skips warm. That's about
1.3% of jobs for the first pass and 0.5% for warm, against 0.10% per package run in the probes
above. To cover that
condition, [run 41931815125](https://github.com/arcee-ai/nac/actions/runs/41931815125)
cleared the file cache with `sudo purge` before each package run, with the original
`unwrap` in both versions:

| Signal path | Jobs | Package runs | Failed with this `EPERM` | Other failures |
| --- | --- | --- | --- | --- |
| Before this branch | 4 | 1,053 | 6 | 1 (`checked_finish_reaches_observed_escape_after_reaped_leader`) |
| With this branch | 4 | 979 | 0 | 0 |

An earlier warm run with the fix
([41892520232](https://github.com/arcee-ai/nac/actions/runs/41892520232)) completed 3,369
package runs with no failures.

## Rates

Every attempt of every completed `stable-release.yml` run created from October 25 until
November 4 at 20:00 UTC: 2,398 runs and 2,433 attempts. This is before this branch's fixes.
Only passed and failed jobs are counted, using the `browser` job and the
`ARM macOS process and credentials` job. #380 merged on October 31 at 00:36 UTC and #473 at
00:52 UTC. Windows split by run creation time at the end of October 30 UTC. Each failed job is
classified from its own attempt's log. One failed browser job from November 1 (`125012412385`)
has no retrievable log, so it's counted in the total but not classified.

| Failure | Through October 30 | From October 31 |
| --- | --- | --- |
| Noisy terminal: latency over 1,500 ms | 12 of 352 browser jobs | 0 of 724 |
| Noisy terminal: marker erased | 1 of 352 | 0 of 724 |
| macOS `EPERM` | 10 of 428 macOS jobs | 12 of 811 |
| Manager-drop `WouldBlock` | 10 of 428 | 0 of 811 |

The same noisy test also failed 8 times on November 4, all on PRs #565, #567, #568 and
#580, at its history-panel steps rather than its latency or marker checks. Those are a
different failure, outside this record.

After the fixes:

- **macOS `EPERM`:** 0 of 979 cold package runs and 0 of 3,369 warm ones, against 6 of 1,053
  cold runs before.
- **Noisy terminal latency:** not fixed. 11 of 600 repeats missed the limit with this
  branch, and 5 of 240 without it.
- **Noisy terminal marker erase:** none in those 840 repeats, with or without this branch.
- **Polling test:** no CI rate. It had one failure in 11 days, and the delay above shows the
  new order holds.

## Residual unknowns

- Why macOS denies the signal during exec, and why real CI fails more often than the probes.
- Whether `checked_finish_reaches_observed_escape_after_reaped_leader` is related. It failed once
  in the cold run without this branch, and this branch doesn't touch it.
- How closely clearing the file cache matches a real first pass in CI.
- Whether the short prompt reduces erased markers. One occurrence was recorded in 11 days,
  and it has never been reproduced locally.
- Why regular CI shows no latency misses since October 31 while repeats do. #380, the
  test's position in the suite and runner speed could each contribute, and nothing isolates
  them. Misses could return.
- Whether the output backlog is the cause, and whether draining it faster is worth a product
  change. This branch doesn't change terminal output handling, and the limit stays at 1,500 ms.
