import { describe, expect, it } from "vitest";

import {
  compactTool,
  modelTurn,
  thoughts,
  thread,
  toolDetail,
  userTurn,
  wave,
  workset,
} from "@/app/features/insights/model/fixtures.test-support";
import {
  actionMeta,
  actionRunningLabel,
  actionTypeLabel,
  doneLabel,
  entryMeta,
  entryRow,
  groupLiveLabel,
  groupSummaryLabel,
  inProgressLabel,
  segmentRow,
  segmentTitle,
} from "@/app/features/insights/model/labels";
import { partitionModelTurn } from "@/app/features/insights/model/segments";
import { buildInsightTimeline } from "@/app/features/insights/model/timeline";
import type {
  ActionKind,
  InsightEntry,
  InsightGroup,
  InsightSegment,
} from "@/app/features/insights/model/types";
import type { ToolPresentation } from "@/app/lib/toolPresentation";
import type { TranscriptBlock } from "@/app/lib/transcript";

function entries(blocks: TranscriptBlock[]): InsightEntry[] {
  return buildInsightTimeline([userTurn(0), modelTurn(1, blocks)]).flatMap(
    (section) => section.entries,
  );
}

function group(blocks: TranscriptBlock[]): InsightGroup {
  const item = partitionModelTurn(modelTurn(1, blocks), userTurn(0))[0];
  if (item?.kind !== "group") throw new Error("expected a group");
  return item.group;
}

function tool(name: string, overrides: Partial<ToolPresentation> = {}): InsightSegment {
  return group([toolDetail(name, overrides)]).segments[0];
}

describe("insight labels", () => {
  it.each<[ActionKind, string, string, string | null]>([
    ["reasoning", "Thoughts", "Thinking…", null],
    ["thread", "Thread", "Running thread…", "Thread"],
    ["define-workset", "Define Workset", "Defining Workset…", "Workset"],
    ["delete-thread", "Delete thread", "Deleting…", null],
    ["read-file", "Read File", "Reading File…", "Read"],
    ["write-file", "Create File", "Creating File…", "Write"],
    ["edit-file", "Edit File", "Editing File…", "Edit"],
    ["glob", "Find files", "Find files…", "Glob"],
    ["grep", "Search files", "Search files…", "Grep"],
    ["run-command", "Run command", "Running command…", "Exec"],
    ["write-command", "Write command", "Write command…", "Write"],
    ["read-command-output", "Read Output Command", "Read Output Command…", "Read"],
    ["web-search", "Search", "Searching the web…", "Search"],
    ["web-fetch", "Fetch", "Fetching…", "Fetch"],
    ["create-goal", "Create goal", "Creating goal…", "Create"],
    ["get-goal", "Get goal", "Get goal…", "Read"],
    ["update-goal", "Update goal", "Updating goal…", "Edit"],
    ["spawn-agent", "Spawn Agent", "Spawn Agent…", "Spawn"],
    ["spawn-orchestrator", "Spawn Orchestrator", "Spawn Orchestrator…", "Spawn"],
    ["session-status", "Check session status", "Checking session status…", "Check"],
    ["session-steer", "Steer session", "Steer session…", "Steer"],
    ["session-read", "Read session", "Reading session…", "Read"],
    ["session-wait", "Wait for session", "Wait for session…", "Wait"],
    ["session-cancel", "Cancel session", "Cancelling session…", "Cancel"],
    ["other", "Tool", "Running tool…", "Tool"],
  ])("labels %s rows like the canonical table", (kind, type, running, meta) => {
    expect(actionTypeLabel(kind)).toBe(type);
    expect(actionRunningLabel(kind)).toBe(running);
    expect(actionMeta(kind)).toBe(meta);
  });

  it("shows the reasoning duration as its meta once it is known", () => {
    expect(actionMeta("reasoning", 13_750)).toBe("13.8 s");
    expect(actionMeta("reasoning", null)).toBeNull();
    expect(actionMeta("read-file", 13_750)).toBe("Read");
  });

  it("titles ready rows with the argument when it is known", () => {
    expect(segmentTitle(tool("read", { summary: "src/app/index.tsx" }))).toBe("index.tsx");
    expect(segmentTitle(tool("edit", { summary: "C:\\repo\\lib\\store.ts" }))).toBe("store.ts");
    expect(segmentTitle(tool("exec_command", { summary: "npm   run build" }))).toBe(
      "npm run build",
    );
    expect(segmentTitle(tool("exec_command", { summary: "(in /tmp/work)" }))).toBe("Run command");
    expect(segmentTitle(tool("grep", { summary: "useNow\\(" }))).toBe("useNow\\(");
    expect(segmentTitle(tool("web_fetch", { summary: "https://docs.example.com/a?b=1" }))).toBe(
      "docs.example.com",
    );
    expect(segmentTitle(tool("web_fetch", { summary: "not a url" }))).toBe("Fetch");
    expect(
      segmentTitle(tool("web_fetch", { summary: "https://user:SECRET@internal.example:8443/x" })),
    ).toBe("internal.example:8443");
    expect(segmentTitle(tool("orchestrator_wait", { summary: "session-7" }))).toBe("session-7");
    expect(segmentTitle(tool("create_goal", { summary: "Ship the revamp" }))).toBe("Create goal");
    expect(segmentTitle(tool("read"))).toBe("Read File");
    expect(segmentTitle(tool("mcp__linear__read", { label: "MCP · Read" }))).toBe("MCP · Read");
    expect(segmentTitle(group([thoughts("thoughts-0")]).segments[0])).toBe("Thoughts");
    expect(segmentTitle(group([workset("workset_define-1-0", "polylang")]).segments[0])).toBe(
      "Worksets_polylang",
    );
    expect(segmentTitle(group([workset("workset_define-1-0", "")]).segments[0])).toBe(
      "Define Workset",
    );
    expect(
      segmentTitle(group([compactTool("thread_delete-1-0", "thread_delete")]).segments[0]),
    ).toBe("Delete thread");
  });

  it("puts the argument in the live badge label", () => {
    expect(inProgressLabel(tool("read", { summary: "src/app/index.tsx" }))).toBe(
      "Reading index.tsx…",
    );
    expect(inProgressLabel(tool("write", { summary: "docs/notes.md" }))).toBe("Writing notes.md…");
    expect(inProgressLabel(tool("web_fetch", { summary: "https://docs.example.com/a" }))).toBe(
      "Fetching docs.example.com…",
    );
    expect(inProgressLabel(tool("exec_command", { summary: "npm test" }))).toBe(
      "Running npm test…",
    );
    expect(inProgressLabel(tool("exec_command", { summary: `make ${"x".repeat(60)}` }))).toBe(
      `Running make ${"x".repeat(35)}…`,
    );
    expect(inProgressLabel(tool("read", { summary: "src/app/components/VeryLongName…" }))).toBe(
      "Reading VeryLongName…",
    );
    expect(inProgressLabel(tool("read", { summary: "src/app/…" }))).toBe("Reading file…");
    expect(inProgressLabel(tool("exec_command", { summary: "(in /tmp/work)" }))).toBe(
      "Running command…",
    );
    expect(inProgressLabel(tool("read"))).toBe("Reading file…");
    expect(inProgressLabel(tool("web_search", { summary: "vitest" }))).toBe("Searching the web…");
    expect(
      inProgressLabel(group([compactTool("subagent-1-0", "subagent", true)]).segments[0]),
    ).toBe("Starting agent…");
    expect(inProgressLabel(tool("mcp__linear__read", { label: "MCP · Read" }))).toBe(
      "Running MCP · Read…",
    );
    expect(inProgressLabel(group([thoughts("thoughts-0")]).segments[0])).toBe("Thinking…");
  });

  it("summarizes groups by their first two distinct type labels", () => {
    expect(
      groupSummaryLabel(group([thoughts("thoughts-0"), toolDetail("read"), toolDetail("edit")])),
    ).toBe("Thoughts, Read File and more");
    expect(
      groupSummaryLabel(
        group([thoughts("thoughts-0"), thoughts("thoughts-1"), workset("workset_define-1-0", "w")]),
      ),
    ).toBe("Thoughts, Workset");
    expect(
      groupSummaryLabel(group([toolDetail("read"), toolDetail("read", { callId: "call-read-2" })])),
    ).toBe("Read File");
  });

  it("says how long a settled group worked when every duration is known", () => {
    expect(
      doneLabel(
        group([
          thoughts("thoughts-0", { durationMs: 12_000 }),
          toolDetail("exec_command", { status: "timed-out", durationMs: 324 }),
        ]),
      ),
    ).toBe("Worked for 12.3s");
    expect(
      doneLabel(group([thoughts("thoughts-0", { durationMs: 900 }), toolDetail("read")])),
    ).toBe("Thoughts, Read File");
  });

  it("follows the newest live segment in the badge", () => {
    expect(
      groupLiveLabel(
        group([
          thoughts("thoughts-0", { streaming: true }),
          toolDetail("read", { status: "running", summary: "src/a.ts" }),
          toolDetail("edit"),
        ]),
      ),
    ).toBe("Reading a.ts…");
    expect(
      groupLiveLabel(group([toolDetail("exec_command", { status: "awaiting-approval" })])),
    ).toBe("Awaiting approval…");
    expect(groupLiveLabel(group([thoughts("thoughts-0"), toolDetail("read")]))).toBeNull();
  });

  it("gives each entry its ready meta", () => {
    const [many, single, unknown] = [
      entries([thoughts("thoughts-0"), toolDetail("read"), toolDetail("edit")]),
      entries([thoughts("thoughts-0", { durationMs: 13_750 })]),
      entries([thoughts("thoughts-0")]),
    ].map((list) => list[0]);
    const threads = entries([
      wave("wave-1", [[thread("impl/calendar", "impl/calendar@1:a")]]),
      wave("wave-2", [[thread("impl/calendar", "impl/calendar@2:b")]]),
    ]);
    const [session] = entries([toolDetail("subagent", { summary: "Fix the flaky test" })]);

    expect(entryMeta(many)).toBe("3");
    expect(entryMeta(single)).toBe("13.8 s");
    expect(entryMeta(unknown)).toBeNull();
    expect(entryMeta(entries([toolDetail("read")])[0])).toBe("Read");
    expect(threads.map(entryMeta)).toEqual(["Thread, 2", "Thread, 2"]);
    expect(entryMeta(session)).toBe("Spawn");
  });

  it("drops the meta and shows the type while a row is running or failed", () => {
    const read = (status: ToolPresentation["status"]) =>
      segmentRow(tool("read", { status, summary: "src/app/index.tsx" }));

    expect(read("success")).toEqual({
      action: "read-file",
      label: "index.tsx",
      meta: "Read",
      status: "ready",
    });
    expect(read("running")).toEqual({
      action: "read-file",
      label: "Reading File…",
      meta: null,
      status: "running",
    });
    expect(read("error")).toEqual({
      action: "read-file",
      label: "Read File",
      meta: null,
      status: "failed",
    });
    expect(read("awaiting-approval")).toEqual({
      action: "read-file",
      label: "index.tsx",
      meta: "Read",
      status: "pending",
    });
    expect(
      segmentRow(tool("mcp__linear__read", { label: "MCP · Read", status: "running" })),
    ).toEqual({ action: "other", label: "MCP · Read…", meta: null, status: "running" });
  });

  it("rows a multi-segment group as a ToolsSegment", () => {
    const [ready] = entries([thoughts("thoughts-0"), toolDetail("read"), toolDetail("edit")]);
    const [running] = entries([thoughts("thoughts-0"), toolDetail("edit", { status: "running" })]);
    const [single] = entries([toolDetail("grep", { summary: "useNow" })]);

    expect(entryRow(ready)).toEqual({
      action: null,
      label: "Thoughts, Read File and more",
      meta: "3",
      status: "ready",
    });
    expect(entryRow(running)).toEqual({
      action: null,
      label: "Thoughts, Edit File…",
      meta: null,
      status: "running",
    });
    expect(entryRow(single)).toEqual({
      action: "grep",
      label: "useNow",
      meta: "Grep",
      status: "ready",
    });
  });

  it("keeps a thread's name and meta in every state and rows sessions by their title", () => {
    const rows = entries([
      wave("wave-1", [
        [
          thread("impl/a", "impl/a@1:a", { state: "running" }),
          thread("impl/b", "impl/b@1:b", { state: "pending" }),
          thread("impl/c", "impl/c@1:c", { state: "error" }),
          thread("impl/d", "impl/d@1:d", { state: "cancelled" }),
          thread("impl/e", "impl/e@1:e"),
        ],
      ]),
    ]).map(entryRow);
    const [launched, launching] = [
      entries([toolDetail("subagent", { summary: "Fix the flaky test" })]),
      entries([toolDetail("orchestrator_launch", { status: "running" })]),
    ].map((list) => entryRow(list[0]));

    expect(rows).toEqual([
      { action: "thread", label: "impl/a", meta: "Thread, 1", status: "running" },
      { action: "thread", label: "impl/b", meta: "Thread, 1", status: "pending" },
      { action: "thread", label: "impl/c", meta: "Thread, 1", status: "failed" },
      { action: "thread", label: "impl/d", meta: "Thread, 1", status: "failed" },
      { action: "thread", label: "impl/e", meta: "Thread, 1", status: "ready" },
    ]);
    expect(launched).toEqual({
      action: "spawn-agent",
      label: "Fix the flaky test",
      meta: "Spawn",
      status: "ready",
    });
    expect(launching).toEqual({
      action: "spawn-orchestrator",
      label: "Spawn Orchestrator…",
      meta: null,
      status: "running",
    });
  });
});
