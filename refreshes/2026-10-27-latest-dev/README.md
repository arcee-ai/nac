# NAC Insights stack: current screenshot comparisons

Each pair uses the exact current PR frontend head and its immediate base. Desktop1440×960; phone390×844; scale1. Native #426 and #429 use exact immediate-base/head backend binaries with identical fixture inputs replayed independently. Other pairs hold their recorded native backend/session constant. Backend SHAs, session IDs, URLs, asset-tree IDs and image hashes are retained in manifest.json.

The captured data is deterministic fixture content executed through real native tools; there are no live model requests or production data. Still images do not establish smooth streaming or scrolling.

## PR #421: Button variants and session identity

Frontend b3682c66 → 99d224e3. Backend 012dd3d1 → 012dd3d1.

Immediate-base/current-head frontend bundles held against the recorded common backend; not an exact per-layer backend build.

| Before | After |
| --- | --- |
| ![Before #421](screenshots/pr421-before-buttons.jpg) | ![After #421](screenshots/pr421-after-buttons.jpg) |

### session-row

Frontend b3682c66 → 99d224e3; backend 012dd3d1 → 012dd3d1; viewport 1440×960.

Same real session/backend with exact immediate-base/head frontend bundles.

| Before | After |
| --- | --- |
| ![Before](screenshots/pr421-before-session-row.jpg) | ![After](screenshots/pr421-after-session-row.jpg) |

## PR #422: New design-preview atoms

Frontend 99d224e3 → 1f98ac5b. Backend 012dd3d1 → 012dd3d1.

Immediate-base/current-head frontend bundles held against the recorded common backend; not an exact per-layer backend build.

| Before | After |
| --- | --- |
| ![Before #422](screenshots/pr422-before-gallery.jpg) | ![After #422](screenshots/pr422-after-gallery.jpg) |

### session-card-atoms

Frontend 99d224e3 → 1f98ac5b; backend 012dd3d1 → 012dd3d1; viewport 1440×960.

New preview-only session-card atom; before section is the existing Model loader because the card section does not exist yet. Accessibility snapshots record spoken behavior/lineage.

| Before | After |
| --- | --- |
| ![Before](screenshots/pr422-before-session-card-atoms.jpg) | ![After](screenshots/pr422-after-session-card-atoms.jpg) |

## PR #423: Model extraction — matching visible session

Frontend 1f98ac5b → 3e76b727. Backend 012dd3d1 → 012dd3d1.

Immediate-base/current-head frontend bundles held against the recorded common backend; not an exact per-layer backend build.

| Before | After |
| --- | --- |
| ![Before #423](screenshots/pr423-before-desktop.jpg) | ![After #423](screenshots/pr423-after-desktop.jpg) |

## PR #424: Files/default panel → Insights

Frontend 3e76b727 → 0bcfe323. Backend 012dd3d1 → 012dd3d1.

Immediate-base/current-head frontend bundles held against the recorded common backend; not an exact per-layer backend build.

| Before | After |
| --- | --- |
| ![Before #424](screenshots/pr424-before-insights.jpg) | ![After #424](screenshots/pr424-after-insights.jpg) |

## PR #425: Transcript layout, failed launch and durable report

Frontend 0bcfe323 → 2e6223c3. Backend 012dd3d1 → 012dd3d1.

Immediate-base/current-head frontend bundles held against the recorded common backend; not an exact per-layer backend build.

| Before | After |
| --- | --- |
| ![Before #425](screenshots/pr425-before-insights.jpg) | ![After #425](screenshots/pr425-after-insights.jpg) |

### failed-launch

Frontend 0bcfe323 → 2e6223c3; backend 012dd3d1 → 012dd3d1; viewport 1440×960.

Same real failed subagent launch before child creation. Diagnostic must remain visible after the card redesign.

| Before | After |
| --- | --- |
| ![Before](screenshots/pr425-before-failed-launch.jpg) | ![After](screenshots/pr425-after-failed-launch.jpg) |

### expanded-completion-report

Frontend 0bcfe323 → 2e6223c3; backend 012dd3d1 → 012dd3d1; viewport 1440×960.

Same genuine background child generation1 completion and parent acknowledgement on exact current stack-tip backend. After disclosure expanded through real summary and wheel controls. Exact frontend base/head refs, common backend held constant.

| Before | After |
| --- | --- |
| ![Before](screenshots/pr425-before-expanded-completion-report.jpg) | ![After](screenshots/pr425-after-expanded-completion-report.jpg) |

## PR #426: Exact native tool metadata comparison

Frontend 2e6223c3 → 5192cbef. Backend 2e6223c3 → 5192cbef.

Exact immediate-base/head native binaries and frontend refs. Same initial files and native glob/read/edit/read inputs replayed independently; IDs/timestamps/durations naturally differ. No performance claim.

| Before | After |
| --- | --- |
| ![Before #426](screenshots/pr426-before-native-metadata.jpg) | ![After #426](screenshots/pr426-after-native-metadata.jpg) |

## PR #427: Native full content, paths and edit diff

Frontend 5192cbef → 68e1fc20. Backend 012dd3d1 → 012dd3d1.

Immediate-base/current-head frontend bundles held against the recorded common backend; not an exact per-layer backend build.

| Before | After |
| --- | --- |
| ![Before #427](screenshots/pr427-before-insights.jpg) | ![After #427](screenshots/pr427-after-insights.jpg) |

### expanded-native-output

Frontend 5192cbef → 68e1fc20; backend 012dd3d1 → 012dd3d1; viewport 1440×960.

Exact immediate-base/head frontend refs, same native stack-tip backend/session. After uses real retained full native tool output; no API interception.

| Before | After |
| --- | --- |
| ![Before](screenshots/pr427-before-expanded-native-output.jpg) | ![After](screenshots/pr427-after-expanded-native-output.jpg) |

## PR #428: Real active run waiting for response

Frontend 68e1fc20 → abdf3d21. Backend 012dd3d1 → 012dd3d1.

One genuine active native session held waiting at its deterministic local provider; same backend/session and exact immediate-base/head frontend refs. Still images do not establish absence of flicker, resets, or scroll jumps.

| Before | After |
| --- | --- |
| ![Before #428](screenshots/pr428-before-stream.jpg) | ![After #428](screenshots/pr428-after-stream.jpg) |

## PR #429: Exact native Git conflict and typechange projection

Frontend abdf3d21 → 7e36de32. Backend abdf3d21 → 7e36de32.

Exact immediate-base/head native binaries and frontend refs. Identical genuine Git typechange README.md and merge conflict review-checklist.md, plus modified TSX; before projection labels M/M and after T/U.

| Before | After |
| --- | --- |
| ![Before #429](screenshots/pr429-before-native-git-status.jpg) | ![After #429](screenshots/pr429-after-native-git-status.jpg) |

## PR #430: Desktop and phone composer

Frontend 7e36de32 → 71087efc. Backend 012dd3d1 → 012dd3d1.

Immediate-base/current-head frontend bundles held against the recorded common backend; not an exact per-layer backend build.

| Before | After |
| --- | --- |
| ![Before #430](screenshots/pr430-before-desktop.jpg) | ![After #430](screenshots/pr430-after-desktop.jpg) |

### phone

Frontend 7e36de32 → 71087efc; backend 012dd3d1 → 012dd3d1; viewport 390×844.



| Before | After |
| --- | --- |
| ![Before](screenshots/pr430-before-phone.jpg) | ![After](screenshots/pr430-after-phone.jpg) |

## PR #431: Phone session header and panel navigation

Frontend 71087efc → 012dd3d1. Backend 012dd3d1 → 012dd3d1.

Immediate-base/current-head frontend bundles held against the recorded common backend; not an exact per-layer backend build.

| Before | After |
| --- | --- |
| ![Before #431](screenshots/pr431-before-phone.jpg) | ![After #431](screenshots/pr431-after-phone.jpg) |

### phone-insights

Frontend 71087efc → 012dd3d1; backend 012dd3d1 → 012dd3d1; viewport 390×844.

Phone navigation must use the actual native header/panel controls; inspect and adjust the exact accessible name if needed.

| Before | After |
| --- | --- |
| ![Before](screenshots/pr431-before-phone-insights.jpg) | ![After](screenshots/pr431-after-phone-insights.jpg) |


## Latest-dev provenance and limits

This package was captured after rebasing the whole stack onto dev `b3682c66f22bb338938e1b320998fc31f675fe82`. All 11 frontend pairs were captured again at their exact new immediate-base/head refs. No historical images were relabeled. Every frontend-only comparison, including the expanded #425 completion report, holds the actual current-tip native backend `012dd3d1c928d5d73e4ddbde8e89241f17157f6b` constant. Native #426 and #429 use exact per-side native binaries identified in the manifest and runtime build banners.

The #428 images show a real active run held waiting at the deterministic provider. They do not demonstrate rejected-submit attribution, token animation, or scroll stability. The #426 normal-tool comparison does not demonstrate the separate approval-wait exclusion and timeout/cancellation regressions; focused behavioral tests are required for those claims. The #423 extraction pair intentionally has matching visible behavior.

`historical-caption-audit.json` identifies older screenshot pairs as historical. Raw JPEG files were copied without image edits. All 36 selected images were visually inspected and passed hash/dimension/nonflat validation, and all capture pages reported zero JavaScript errors. The report-only capture allowed the real layout to settle before opening the disclosure. `reproduction/` records scripts, fixture options, frontend configs and genuine native runtime metadata. Scripts use scratch paths and fresh output folders and are not intended to overwrite preserved evidence.
