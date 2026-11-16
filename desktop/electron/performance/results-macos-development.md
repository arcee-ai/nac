# Historical Mac development performance evidence — 13 November 2026

This is **historical evidence from 13 November 2026** (America/Los_Angeles;
some record timestamps are 14 November UTC). It predates the later merge of
`dev` at `87e8eb6b3` for PR publication. These measurements describe the product
and tool revisions recorded below; they do **not** measure the current PR head.
Current-head build and functional checks are reported separately in the PR.

Public records use `<repo>` for the disposable checkout root and
`<redacted-battery-registry-id>` for the host's battery registry identifier.
Power state, percentages, hardware conditions and all numerical measurements are
unchanged. Session/process/window identifiers are from disposable test fixtures.
Product/tool hashes retain their original binary/source meaning. Packet/artifact
hashes refer to original local captures, not the published sanitized subsets;
no hash identifying an altered tracked evidence file is retained as its new hash.

The final early comparison uses product revision
`4cada76fc45235b229f02034243b09145100c1ed`. Both optimized Swift/WKWebView and
Electron packages contain the byte-identical signed Rust engine, SHA-256
`3e6400da275a45c2803a3bddea8f9f984dac75d0fcf4abbff173615aee9384c7`, and its
same embedded production React assets. Electron is the pinned official 45.3.2
runtime; Swift uses the canonical `-O` builder. Normal packages have no diagnostic
bridge or debug port. This is an early development comparison, **not frozen
budget acceptance, physical-paint measurement or full Swift parity certification**.

The final normal run completed five interleaved pairs, ten accepted trials with
no failures or excluded resource intervals. The Apple M5 Max host has 36 GiB RAM
and macOS 27.0.1. It remained on AC power, battery 80% unchanged. Every actual
native window targeted built-in display 1,1512×982 points, Retina scale 2, mode
120 Hz; all idle sample native states were active. Both content geometries are
1280×800, independently observed in the paired workflow. No OS display, power,
privacy or security settings were changed. Automatic brightness and unrelated
shared-host load were not fully controlled.

| Normal package measure | Swift/WKWebView | Electron |
| --- | ---: | ---: |
| Native first-visible-window proxy, median / p95 | 351 / 355 ms | 593 / 660 ms |
| Same-process hide/LaunchServices reopen proxy, median / p95 | 148 / 155 ms | 152 / 158 ms |
| Median of five trial median CPU samples, one logical core | 0.665% | 0.637% |
| Median of five trial median physical footprints | 167.79 MiB | 259.82 MiB |

Electron's sampled footprint is **92.03 MiB higher**. The short idle cells show
no material CPU increase. Those values fit the ticket's proposed idle/footprint
calibration envelopes, but do not freeze or certify them. Each trial has exactly
10 s settle and10 measured one-second intervals, shorter than the owning ticket's
three five-minute qualification cells. Trial 0 is a fresh empty store/browser
profile; four returning trials relaunch the process into the same private
profile. OS caches were retained, not purged. The same-process warm case hides
and reopens the existing app and engine; window-close lifecycle is separately
covered by the actual-app regression suite.

The startup endpoints have different product ordering: Swift's initial window
can precede engine readiness; Electron's window follows its verified ready
receipt. The  +242 ms median/ +305 ms p95 native-window difference is therefore not
a matching-stage composer-ready or paint regression verdict. Polling/observer
cost is included in these coarse native proxies. CG bounds can show the macOS
opening transition, such as width 1278 before 1280; these first-visible samples
remain intact. Resource geometry is admitted after 10 s settle, then fenced through
idle samples and returning trials. Reopen still times first visibility, followed
by separate observation of the original settled geometry. Missing/ambiguous
actual displays or steady geometry drift fail admission.

Whole-app accounting includes LaunchServices coalition membership plus exact
app descendants: detached WK WebContent/GPU/Networking helpers, Electron renderer/
GPU/network/crash helpers, the native engine supervisor and `nac-web`. All accepted
intervals had complete counters and unchanged cohort membership. Mac physical
footprint is not RSS or Linux PSS; global WindowServer costs are unassigned.
Process-counter collection cost is retained; the preceding native-window metadata
poll is additional observer work outside the app. Birth bookends reject PID reuse.
Every accepted cohort completed ordinary protected Stop and Quit after timing,
with independent retirement of every captured exact app/helper/engine birth.
Unavailable counters never imply disappearance; complete PID census or changed
valid birth is required. No app/helper/engine was force-killed for a timing result.

The [structured summary](results-macos-development.json) and
[final raw normal records](evidence/2026-11-13-review-normal.jsonl) retain all trial
samples, distributions, engine/shell identities, actual display/window states,
and exact source/compiled-tool SHA-256. Product revision 4cada identifies the app;
observer checkout 43c109175 and separately captured source hashes identify the
later test tooling. The phase-aware collector changes were dirty at collection
and are committed with these exact hashes. Tooling revision is not represented
as the product revision.

The final optimized workflow pair executed the same shared probe SHA-256
`0cfd5f9110ed0cdfd3ba5ea88b953d470333b1061c9f99250598eb81b118a4f2`:
a roughly 300 KiB retained answer, five history openings, 120 full-height scroll
jumps, 200 synthetic textarea events, a target 30 Hz/two-second provider stream,
and three terminal pressure/control repetitions. Both used the same engine,
assets, provider responses and private fixtures. Actual native focus stayed true
with zero sticky losses; the current textarea was focused, actual display 1 and
1280×800/DPR 2 matched, and native AX observers attached before both measurement
gates. Electron accessibility stayed enabled. No CSS override, graphics flag,
sandbox change or throttling change was present in the canonical pair.

| Canonical workflow proxy | Swift/WK | Electron |
| --- | ---: | ---: |
| Synthetic textarea event→rAF p95 / p99 | 18 / 18 ms | 8.6 / 9.2 ms |
| Long-history open→DOM/rAF p95, five opens | 491 ms | 530.9 ms |
| Full-height scroll-jump frame gap p50 / p95 / max | 17 / 18 / 127 ms | 8.3 / 33.5 / 279.7 ms |
| Streaming root mutation gap p95 | 105 ms | 105.3 ms |
| ≥266240-byte terminal pressure→visual DOM/rAF | 115–151 ms | 106.8–116.8 ms |
| PTY resize HTTP→status | 7 ms | 4.9–7.6 ms |
| Interrupt HTTP→visual DOM/rAF | 49–51 ms | 41.3–42.3 ms |

The untrimmed Electron scroll p95 remains higher because of initial-entry spikes:
seven jumps above 33 ms occur at indices 3–21; WK has three at indices 1–3. All 120
jumps remain in the distributions. Electron's entire 120-jump sequence took
1547.6 ms versus WK 2265 ms; its faster steady cadence does not erase its higher
initial tail. Residual entry spikes are a review limitation, not a paint-parity
pass or an established exact root cause. The separate full functional suite
also observed scroll p95 9 ms; that best-case run does not replace this paired
33.5 ms cell. The roughly 300 KiB history is not the ticket's ordinary-tail dataset.
Input/relative budgets are calibration targets; no budget was relaxed for these
results. HTTP terminal control and synthetic events do not establish physical
keyboard→paint latency. The normal Swift app contains no diagnostic JS bridge.

The [canonical workflow raw records](evidence/2026-11-13-review-workflow.jsonl)
retain every sample and native admission fact. The actual-Electron executor also
checks settled answer text is opacity 1 with no finished-held animation; its
one-time first-input style read is observer overhead, not a production change.
All complete workflow fixtures settled their owned engine and terminal work.

A demonstrated sustained regression was repaired before this candidate. Initial
native-focused Electron typing/scroll cadence was about 60 ms versus WK 17–18 ms.
A renderer trace attributed 19.514 s to native `Layerize`; during 200 typing events,
199 such calls consumed 11.856 s (median 59.263 ms,p95 62.358 ms). A separate exact-birth
native sample succeeded after omitting `sample -mayDie`, which reads symbols
upfront. Vendor symbols are stripped; nearest exported names plus large offsets
do not identify the true hot C++ function. LayerTree showed only 16 layers, but
one 1264×166930-pixel opacity-animation layer retained 3478 per-line touch regions.

A parent-transform override did not help and was rejected. A narrower control
changed completed-fade ownership: base opacity 1 plus no forwards fill preserved
the exact 150 ms ease-out fade 0→1, removed the giant retained opacity-animation
layer, and repaired typing p95 to 8.6 ms/scroll 9.1 ms. Only that supported two-line
change entered shared CSS. Canonical source/asset/engine/package rebuilding and
the no-override pair above confirmed the repair; accessibility, full history,
touch handlers, sandboxing and background throttling stayed intact. Details and
capture hashes are retained in the
[layerization trace summary](evidence/2026-11-13-layerization-attribution.json),
[native layer/sample summary](evidence/2026-11-13-native-layer-sample.json) and
[resumed control records](evidence/2026-11-13-workflow-resumed.jsonl).

Earlier attempts remain separate. The original normal 4a battery run is retained
in [historical raw records](evidence/2026-11-13-normal.jsonl), with a per-trial
display limitation; it is not merged into the final AC distributions. Two early
native-observer failures remain in
[original exclusions](evidence/2026-11-13-excluded.jsonl). The first review-normal
attempt compared an opening-animation 1278 px frame against settled 1280 px and was
excluded; its current protected Quit was answered and all bundle paths observed
absent before retry. Its [raw exclusions](evidence/2026-11-13-review-normal-excluded.jsonl)
retain the partial cells and interrupted collector exit 130. The repaired phase
admission has characterization coverage and fails closed on subsequent settled
drift. A fresh run supplied all ten accepted final cells.

Original workflow timings lacked true native-focus admission and are retained in
[original workflow records](evidence/2026-11-13-workflow-original.jsonl). Playwright
DOM focus emulation had masked an inactive native window. Earlier frame controls
and an exploratory display-scale attempt are retained separately, without
substituting them for admitted comparisons. A no-CUA control did not isolate AX
false (it ended true); a WK CUA-attached control remained fast, so observer
attachment alone did not prove causation. The first trace exceeded its cap and
had a literal-newline payload discrepancy; the follow-up exact-payload trace
retained an incomplete10 s native sample, followed by the successful bounded
capture. An opacity-`!important` control was caught before its gate and never
measured. These failures remain failures, not renamed passes.

ALL-636/637 retain frozen sample counts and budgets, controlled/minimum hardware,
actual paint and trusted input, matching-stage composer startup, the full seeded
resource/history matrix, navigation growth, long soak, hidden/minimized cells,
Linux and final parity certification. Reproduction and observer limits are in
[README.md](README.md). The finite early development comparison is complete.
