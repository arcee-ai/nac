//! Canned states for headless snapshots (`--scene NAME`): nothing here talks to a server or a
//! model. The transcript goes through the same `transcript::items` as a real snapshot's.

use serde_json::json;

use crate::api::{ActiveRun, ManagedSession, PermissionRequest, PermissionResource, Project, SessionSummary};
use crate::state::{App, OpenSession, Route, parse_utc};
use crate::stream::Link;
use crate::transcript::{self, Tool, ToolStatus};

type Scene = (&'static str, fn(&mut App));

pub const SCENES: &[Scene] = &[
    ("overview", overview),
    ("session", session),
    ("session-running", session_running),
    ("session-permission", session_permission),
    ("empty", empty),
    ("settings", settings),
];

const NOW: &str = "2026-11-12 10:00:00";
const OPEN: &str = "fixture-session-1";

fn project(id: &str, name: &str, cwd: &str) -> Project {
    Project { project_id: id.into(), name: name.into(), cwd: cwd.into() }
}

fn listed(id: &str, project: &str, title: &str, updated_at: &str, running_for_s: Option<i64>) -> ManagedSession {
    let now = parse_utc(NOW).unwrap_or_default();
    ManagedSession {
        summary: SessionSummary {
            session_id: id.into(),
            project_id: Some(project.into()),
            model: "anthropic/claude-sonnet-4-5".into(),
            behavior: "direct".into(),
            title: Some(title.into()),
            last_user_prompt: None,
            updated_at: updated_at.into(),
        },
        active_run: running_for_s.map(|s| ActiveRun { started_at_epoch_ms: now - s * 1_000, submitted_user_message: None }),
        lineage: None,
    }
}

fn lists(s: &mut App) {
    s.now_ms = parse_utc(NOW).unwrap_or_default();
    s.projects = vec![
        project("p-nac", "nac", "/Users/dev/src/nac"),
        project("p-site", "docs-site", "/Users/dev/src/docs-site"),
        project("p-catalog", "model-catalog", "/Users/dev/src/model-catalog"),
        project("p-notes", "release-notes", "/Users/dev/notes/releases"),
    ];
    s.sessions = vec![
        listed(OPEN, "p-nac", "Retry the event stream after a sequence gap", "2026-11-12 09:58:40", None),
        listed("fixture-session-2", "p-nac", "Split session settlement out of the run loop", "2026-11-12 09:59:30", Some(184)),
        listed("fixture-session-3", "p-nac", "Characterize permission ordering for remembered grants", "2026-11-12 07:12:00", None),
        listed("fixture-session-4", "p-site", "Rewrite the managed-host quickstart", "2026-11-12 09:59:50", Some(47)),
        listed("fixture-session-5", "p-site", "Fix broken anchors in the API reference", "2026-11-11 16:20:00", None),
        listed("fixture-session-6", "p-catalog", "Regenerate the catalog for the new provider", "2026-11-09 11:05:00", None),
        listed("fixture-session-7", "p-catalog", "Explain the manifest drift check", "2026-10-28 08:00:00", None),
    ];
    s.loaded = true;
}

fn overview(s: &mut App) {
    lists(s);
}

fn empty(s: &mut App) {
    s.now_ms = parse_utc(NOW).unwrap_or_default();
    s.loaded = true;
}

fn settings(s: &mut App) {
    lists(s);
    s.server = "http://127.0.0.1:31148".into();
    s.version = "0.9.2".into();
    s.route = Route::Settings;
}

const ANSWER: &str = r#"The stream now reconnects from the last delivered event instead of dropping the gap.

### What changed

- `eventStream.ts` keeps the cursor `(epoch_id, sequence_id)` of the last event it handed on.
- An envelope that skips a sequence number closes the connection and replays from that cursor.
- A `replay_boundary` in another epoch moves the cursor and reloads the snapshot.

```ts
function accept(cursor: Cursor, next: Envelope): Verdict {
  if (next.epoch_id !== cursor.epoch_id) return "resync";
  if (next.sequence_id <= cursor.sequence_id) return "duplicate";
  return next.sequence_id === cursor.sequence_id + 1 ? "deliver" : "replay";
}
```

| Case | Before | Now |
| --- | --- | --- |
| Duplicate after reconnect | Rendered twice | Dropped |
| Skipped sequence | Silently lost | Replayed from the cursor |

All 14 tests in `eventStream.test.ts` pass, including the new **gap** and **epoch change** cases."#;

fn transcript() -> Vec<serde_json::Value> {
    vec![
        json!({ "role": "system", "content": "You are NAC." }),
        json!({ "role": "user", "content": "The session page sometimes misses tool results after my laptop wakes up. Can you find out why and fix it?" }),
        json!({
            "role": "assistant",
            "content": "I'll look at how the client resumes the event stream after a dropped connection.",
            "reasoning_text": "The symptom after sleep suggests a reconnect that resumes from the wrong place.\nCheck how the cursor is kept and whether a gap in sequence ids is detected.",
            "tool_calls": [
                { "id": "call_1", "type": "function", "function": { "name": "grep", "arguments": "{\"pattern\":\"after_sequence_id\",\"path\":\"crates/nac-server/web/packages/nac-client/src\"}" } },
                { "id": "call_2", "type": "function", "function": { "name": "read_file", "arguments": "{\"path\":\"crates/nac-server/web/packages/nac-client/src/eventStream.ts\"}" } }
            ]
        }),
        json!({ "role": "tool", "tool_call_id": "call_1", "content": "eventStream.ts:41:  url.searchParams.set(\"after_sequence_id\", String(cursor.sequence_id));\neventStream.ts:88:    // TODO: detect skipped sequence ids\nclient.ts:212:  after_sequence_id?: number;" }),
        json!({ "role": "tool", "tool_call_id": "call_2", "content": "export function openEventStream(sessionId: string, cursor?: Cursor) {\n  const url = new URL(`/sessions/${sessionId}/events/stream`, base);\n  ..." }),
        json!({
            "role": "assistant",
            "content": null,
            "tool_calls": [
                { "id": "call_3", "type": "function", "function": { "name": "edit_file", "arguments": "{\"path\":\"crates/nac-server/web/packages/nac-client/src/eventStream.ts\",\"old\":\"// TODO: detect skipped sequence ids\",\"new\":\"if (verdict === \\\"replay\\\") return reconnect(cursor);\"}" } },
                { "id": "call_4", "type": "function", "function": { "name": "run_command", "arguments": "{\"command\":\"npm test -- eventStream\"}" } }
            ]
        }),
        json!({ "role": "tool", "tool_call_id": "call_3", "content": "Edited crates/nac-server/web/packages/nac-client/src/eventStream.ts (+9 -1)" }),
        json!({ "role": "tool", "tool_call_id": "call_4", "content": " ✓ src/eventStream.test.ts (14 tests) 212ms\n\n Test Files  1 passed (1)\n      Tests  14 passed (14)" }),
        json!({ "role": "assistant", "content": ANSWER }),
    ]
}

fn open(s: &mut App) -> &mut OpenSession {
    lists(s);
    let mut o = OpenSession::new(OPEN);
    o.loading = false;
    o.model = "anthropic/claude-sonnet-4-5".into();
    o.project_id = Some("p-nac".into());
    o.items = transcript::items(&transcript());
    o.link = Link::Live;
    s.route = Route::Session(OPEN.into());
    s.open.insert(o)
}

fn session(s: &mut App) {
    let o = open(s);
    // One row open, to show what a tool call expands to.
    o.expanded.insert("tool-call_4".into());
}

fn running(s: &mut App) -> &mut OpenSession {
    let now = parse_utc(NOW).unwrap_or_default();
    if let Some(m) = s.sessions.iter_mut().find(|m| m.summary.session_id == OPEN) {
        m.active_run = Some(ActiveRun { started_at_epoch_ms: now - 42_000, submitted_user_message: None });
    }
    let o = open(s);
    o.running = true;
    o.run_started_ms = Some(now - 42_000);
    o.pending_user = Some("Good. Now do the same for the Rust client in desktop/rune, and add a test for the epoch change.".into());
    o.stream_reasoning = "The Rust stream reader already tracks a cursor; it needs the same three verdicts.".into();
    let tool = |id: &str, name: &str, target: &str, status, output: Option<&str>| Tool {
        call_id: id.into(),
        name: name.into(),
        target: target.into(),
        args: String::new(),
        output: output.map(str::to_owned),
        status,
    };
    o.live_tools = vec![
        tool("call_5", "read_file", "desktop/rune/src/stream.rs", ToolStatus::Done, Some("//! The session event stream …")),
        tool("call_6", "run_command", "cargo test -j2 stream", ToolStatus::Running, None),
    ];
    o
}

fn session_running(s: &mut App) {
    let o = running(s);
    o.stream_text = "`stream.rs` has the same gap: a skipped sequence id is delivered as if nothing was lost. I'm adding the check and a test that feeds it a `replay_boundary` from".into();
    s.composer.focused = false;
}

fn session_permission(s: &mut App) {
    let o = running(s);
    o.live_tools.truncate(1);
    o.permissions = vec![PermissionRequest {
        id: "perm-1".into(),
        tool: "run_command".into(),
        resources: vec![PermissionResource { display: "git push origin fix/event-stream-gap".into() }],
    }];
}
