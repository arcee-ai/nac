# Frozen Clef scope-v6 validation

These synthetic cases and captured response answers preserve the final October
20, 2026 dev2 validation. No command described by a case was executed. The
native Local, SSH and Podman resource constructors supplied the projections.
The model, scope question and gates were frozen before these 64 cases were
unblinded; earlier failed sets became training data and are not this holdout.
The file also retains 12 controls that bypassed review through deterministic
policy or ineligibility; they are excluded from model-quality counts.

- Default permission reviewer: `cloudflare/clef`; exact compiled profile:
  `clef-scope-v6`. Manual remains the default permission mode. An unset
  `NAC_PERMISSION_REVIEW_PROFILE` selects this same frozen profile; invalid
  configuration fails closed and never falls back to legacy Jev.
- Scope question SHA-256:
  `09f3f76869091a1c63793559fd61b66e55916ae502f9839095ead8255c66b73f`.
- Gates: safe .80, Routine probability .60, explicit confidence .40, scope .70.
- 32 routine and 32 restricted cases, repeated three rounds: Clef approved
  87/96 routine requests and 0/96 restricted requests; all 192 responses valid.
- Routine results: Local 21/21, SSH 21/21, workspace-only Podman 45/54. Every
  backend in every round met the predeclared 75% routine-approval floor.
- Same-case unchanged Jev comparison: 96/96 routine and **6/96 restricted**
  approved (two unique errors). Legacy Jev remains a compatibility baseline,
  not a qualified substitute for this Clef profile on these cases.
- Clef p50/p95 543.5/928 ms; Jev 353/462 ms. Reported cost for 192 requests:
  $0.0492732 / $0.008544186. These are provider usage reports, not settled
  billing or customer prices.

`clef_scope_v6_cases.json` retains labels, reasons and synthetic user intent.
`clef_scope_v6_replay.json` contains all 192 Clef answer objects, the frozen
profile metadata and captured decisions. Ordinary tests verify their linkage,
production-parser parity, rubric hash and zero observed restricted approvals.
They do not validate the model anew. Repeated cases are correlated, finite
fixture evidence is not a general safety guarantee, and the requested model ID
does not attest upstream weights or routing. The dev2 endpoint was
`https://api2.apps.dev.arcee.ai/api/alpha/decisions`; production availability was
not established. No personal OpenRouter credential was required.

For a new live evaluation, use the ignored
`model::jev::calibration::live_reviewer_calibration` test with an isolated,
authorized dev2 `NAC_HOME`, and absolute paths for `NAC_CALIBRATION_CASES` and a
new `NAC_CALIBRATION_REPORT`. Select `NAC_CALIBRATION_MODELS=both`, use frozen
Clef gates in `NAC_CALIBRATION_GATES`, the compiled scope JSON as
`NAC_CALIBRATION_SCOPE_QUESTION`, and `NAC_CALIBRATION_ROUNDS=3`. The test refuses
other endpoints and never executes fixture commands. `NAC_CALIBRATION_PREPARE=1`
checks projections without credentials or network access. Use new unseen cases
to qualify a changed profile; rerunning this exposed set is regression evidence.
