import { describe, expect, it } from "vitest";

import {
  actionKindForTool,
  isSpawnAction,
  segmentAction,
} from "@/app/features/insights/model/actionKinds";
import { presentation } from "@/app/features/insights/model/fixtures.test-support";
import type { ActionKind } from "@/app/features/insights/model/types";

describe("action kinds", () => {
  it.each<[string, ActionKind]>([
    ["thread", "thread"],
    ["workset_define", "define-workset"],
    ["thread_delete", "delete-thread"],
    ["read", "read-file"],
    ["write", "write-file"],
    ["edit", "edit-file"],
    ["glob", "glob"],
    ["grep", "grep"],
    ["exec_command", "run-command"],
    ["write_stdin", "write-command"],
    ["read_command_output", "read-command-output"],
    ["web_search", "web-search"],
    ["web_fetch", "web-fetch"],
    ["create_goal", "create-goal"],
    ["get_goal", "get-goal"],
    ["update_goal", "update-goal"],
    ["subagent", "spawn-agent"],
    ["orchestrator_launch", "spawn-orchestrator"],
    ["subagent_status", "session-status"],
    ["orchestrator_status", "session-status"],
    ["orchestrator_steer", "session-steer"],
    ["orchestrator_read", "session-read"],
    ["orchestrator_wait", "session-wait"],
    ["subagent_cancel", "session-cancel"],
    ["orchestrator_cancel", "session-cancel"],
    ["list_executions", "other"],
    ["mcp__linear__linear_read_issue", "other"],
    ["constructor", "other"],
    ["", "other"],
  ])("maps %s to %s", (name, kind) => {
    expect(actionKindForTool(name)).toBe(kind);
  });

  it("recognizes only the two launch tools as spawns", () => {
    expect(isSpawnAction("spawn-agent")).toBe(true);
    expect(isSpawnAction("spawn-orchestrator")).toBe(true);
    expect(isSpawnAction("session-status")).toBe(false);
    expect(isSpawnAction("other")).toBe(false);
  });

  it("names the action of each segment kind", () => {
    expect(
      segmentAction({
        kind: "reasoning",
        key: "thoughts-0",
        text: "Thinking",
        durationMs: null,
        streaming: false,
      }),
    ).toBe("reasoning");
    expect(
      segmentAction({ kind: "workset", key: "workset_define-1-0", worksetId: "w", pending: false }),
    ).toBe("define-workset");
    expect(
      segmentAction({
        kind: "tool",
        key: "tool-call-grep",
        name: "grep",
        action: "grep",
        presentation: presentation("grep"),
        pending: false,
      }),
    ).toBe("grep");
  });
});
