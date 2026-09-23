import { describe, expect, it } from "vitest";

import {
  collectAgentToolsGroups,
  groupAriaLabel,
  partitionAgentTranscript,
  toolSegmentFailed,
  toolsItemsFromGroup,
  visibleToolsItems,
  type AgentSegment,
} from "@/app/lib/agentSegments";
import type { ModelTurn, TranscriptBlock, TranscriptTurn } from "@/app/lib/transcript";
import type { ToolPresentation } from "@/app/lib/toolPresentation";

function presentation(overrides: Partial<ToolPresentation> = {}): ToolPresentation {
  return {
    callId: "call-1",
    name: "read",
    label: "Read file",
    summary: "src/app.tsx",
    resultPreview: "bounded result",
    status: "success",
    statusLabel: "Succeeded",
    ...overrides,
  };
}

function turn(blocks: TranscriptBlock[]): ModelTurn {
  return {
    kind: "model",
    key: "model-9",
    blocks,
    durationMs: 1_200,
    messageIndex: 9,
  };
}

describe("agent segment view adapter", () => {
  it("groups only consecutive thought and tool blocks without changing order", () => {
    const detail = presentation({ status: "awaiting-approval", statusLabel: "Awaiting approval" });
    const items = partitionAgentTranscript(
      turn([
        {
          kind: "thoughts",
          key: "thought-empty",
          text: "   ",
          durationMs: null,
          streaming: false,
        },
        {
          kind: "thoughts",
          key: "thought-1",
          text: "Inspecting the current view.",
          durationMs: 800,
          streaming: false,
        },
        { kind: "tool-detail", key: "tool-1", presentation: detail },
        { kind: "text", key: "text-1", text: "Done." },
        { kind: "tool", key: "tool-2", name: "exec_command", pending: true },
        { kind: "workset", key: "workset-1", worksetId: "release", pending: false },
      ]),
    );

    expect(items.map((item) => item.kind)).toEqual(["group", "block", "group", "block"]);
    const first = items[0];
    expect(first.kind).toBe("group");
    if (first.kind !== "group") throw new Error("expected a group");
    expect(first.group).toMatchObject({
      id: "model-9:tools-0",
      label: "Thoughts & tools",
      durationMs: 800,
      inProgress: false,
    });
    expect(first.group.segments.map((segment) => segment.key)).toEqual(["thought-1", "tool-1"]);
    expect(first.group.segments[1]).toMatchObject({ kind: "tool", presentation: detail });

    const second = items[2];
    expect(second.kind).toBe("group");
    if (second.kind !== "group") throw new Error("expected a group");
    expect(second.group).toMatchObject({
      id: "model-9:tools-1",
      label: "Run command",
      inProgress: true,
    });
    expect(second.group.segments[0]).toMatchObject({
      kind: "tool",
      presentation: { status: "running", statusLabel: "Running" },
    });
  });

  it("preserves every current tool status and safe presentation field", () => {
    const statuses: ToolPresentation["status"][] = [
      "pending",
      "running",
      "awaiting-approval",
      "success",
      "error",
      "timed-out",
      "cancelled",
      "interrupted",
    ];
    const blocks: TranscriptBlock[] = statuses.map((status, index) => ({
      kind: "tool-detail",
      key: `tool-${index}`,
      presentation: presentation({
        callId: `call-${index}`,
        status,
        statusLabel: status === "awaiting-approval" ? "Awaiting approval" : status,
        resultPreview: `safe-${index}`,
      }),
    }));
    const item = partitionAgentTranscript(turn(blocks))[0];
    expect(item.kind).toBe("group");
    if (item.kind !== "group") throw new Error("expected a group");

    const rendered = toolsItemsFromGroup(item.group);
    expect(rendered.map((entry) => entry.statusLabel)).toEqual(
      statuses.map((status) => (status === "awaiting-approval" ? "Awaiting approval" : status)),
    );
    expect(rendered.map((entry) => entry.live)).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(rendered.map((entry) => entry.failed)).toEqual([
      false,
      false,
      false,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(groupAriaLabel(item.group)).toContain("Awaiting approval");
  });

  it("marks terminal failures without treating approval as an error", () => {
    const segment = (status: ToolPresentation["status"]): AgentSegment => ({
      kind: "tool",
      key: status,
      presentation: presentation({ status }),
    });
    expect(toolSegmentFailed(segment("awaiting-approval"))).toBe(false);
    expect(toolSegmentFailed(segment("error"))).toBe(true);
    expect(toolSegmentFailed(segment("timed-out"))).toBe(true);
    expect(toolSegmentFailed(segment("cancelled"))).toBe(true);
    expect(toolSegmentFailed(segment("interrupted"))).toBe(true);
  });

  it("collects groups across model turns and clips overflow from the leading edge", () => {
    const turns: TranscriptTurn[] = [
      {
        kind: "user",
        key: "user-0",
        text: "go",
        invokedSkills: null,
        messageIndex: 0,
        createdAt: null,
      },
      turn([{ kind: "tool-detail", key: "tool-1", presentation: presentation() }]),
    ];
    expect(collectAgentToolsGroups(turns)).toHaveLength(1);

    const items = Array.from({ length: 6 }, (_, index) => ({
      id: String(index),
      icon: toolsItemsFromGroup(collectAgentToolsGroups(turns)[0])[0].icon,
      label: `tool ${index}`,
      statusLabel: "Succeeded",
      live: false,
      failed: false,
    }));
    expect(visibleToolsItems(items, 4)).toMatchObject({
      overflowCount: 2,
      items: [{ id: "2" }, { id: "3" }, { id: "4" }, { id: "5" }],
    });
  });
});
