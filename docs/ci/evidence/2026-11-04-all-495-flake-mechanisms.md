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
this failure locally: runs with the prompt fix removed also passed.

**Real slow rendering.** [Run 40577481249](https://github.com/arcee-ai/nac/actions/runs/40577481249)
(artifact `12768897663`) recorded 1,582.8 ms with the marker present, 203 animation
frames in about 8 seconds and a longest frame gap of 166.7 ms. Nine misses from 1,541 to
3,132 ms were recorded on October 26 and 27. Under 6x CPU throttling and 14 busy loops,
local runs reached 1,300 ms. The 1,500 ms limit is unchanged. Waiting for the resize to
settle was tried and rejected: noise kept accumulating and latency rose to between 1,173
and 1,491 ms.

`pressure-observations.json` now separates the two cases, including on timeout: marker
arrival at the observer, rows at the deadline, presence at paint, input receipts,
resize requests, page offsets and geometry.

## Session-list polling test

With a 5 ms poll, a second base response could replace the initial `old` title before
the test observed it ([run 41483846984](https://github.com/arcee-ai/nac/actions/runs/41483846984)).
The test now holds that response until `old` is observed. Delaying the assertion by 40 ms
fails the previous test and passes the new one.

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

`signal_with` now retries a denial up to three times, one millisecond apart, re-checking
the exact identity each time. A persistent denial still returns `EPERM`, and
`terminate_members` still retains the identity. With the fix and the original `unwrap`,
[run 41892520232](https://github.com/arcee-ai/nac/actions/runs/41892520232) completed
3,369 package runs with no failures. About three denials would be expected in that
volume, so this is strong evidence rather than proof.

## Rates

All completed `stable-release.yml` runs from October 25 to November 4 (2,395 runs), before
this branch's fixes. Jobs that were cancelled or skipped are not counted. #380 merged on
October 31 at 00:36 UTC.

| Failure | October 25 to 30 | October 31 to November 4 |
| --- | --- | --- |
| Noisy terminal: latency over 1,500 ms | 9 of 332 browser jobs | 0 of 696 |
| Noisy terminal: marker erased | 1 of 332 | 0 of 696 |
| macOS `EPERM` | 7 of 406 macOS jobs | 9 of 843 |
| Manager-drop `WouldBlock` | 4 of 406 | 0 of 843 |

The same noisy test also failed 8 times on November 4, all on PRs #565, #567, #568 and
#580, at its history-panel steps rather than its latency or marker checks. Those are a
different failure, outside this record.

After the fixes:

- **macOS `EPERM`:** 0 failures in 3,369 package runs at the fix (run above), where about
  3 denials would be expected.
- **Noisy terminal:** no CI rate yet, and 12 of 12 local runs passed, as they also did
  before the change.
- **Polling test:** one failure in those 11 days, and the order is now fixed by the test.

## Residual unknowns

- Why macOS denies the signal during exec.
- Whether the short prompt reduces erased markers. One occurrence was recorded in 11 days,
  and it has never been reproduced locally.
- Whether #380 caused latency misses to stop. The timing fits, but nothing isolates it, and
  misses could recur under CI load.
