import { describe, expect, it } from "vitest";

import {
  completionTurn,
  modelTurn,
  text,
  thoughts,
  toolDetail,
  userTurn,
} from "@/app/features/insights/model/fixtures.test-support";
import {
  buildInsightTimeline,
  filterInsightTimeline,
  findInsightEntry,
  flattenInsightEntries,
  insightFilterEmptyCopy,
  insightFilterOptions,
  newestInsightEntry,
} from "@/app/features/insights/model/timeline";
import type { InsightsFilter, InsightTurnSection } from "@/app/features/insights/model/types";
import { STREAMING_TURN_KEY, withStreamedOutput, type TranscriptTurn } from "@/app/lib/transcript";

const DIRECT_TURNS: TranscriptTurn[] = [
  userTurn(0, "Plan the calendar\n  feature", "2026-10-24T09:00:00Z"),
  modelTurn(1, [thoughts("thoughts-0"), toolDetail("read"), text("text-0")]),
  userTurn(2, "Ship it", "2026-10-24T10:00:00Z"),
  modelTurn(3, [thoughts("thoughts-0"), toolDetail("edit")]),
];

function ids(sections: readonly InsightTurnSection[]): string[][] {
  return sections.map((section) => section.entries.map((entry) => entry.id));
}

function headers(sections: readonly InsightTurnSection[]) {
  return sections.map(({ key, ordinal, promptPreview, createdAt }) => ({
    key,
    ordinal,
    promptPreview,
    createdAt,
  }));
}

describe("buildInsightTimeline", () => {
  it("pairs each prompt with its actions, newest section first and entries in order", () => {
    const sections = buildInsightTimeline(DIRECT_TURNS);

    expect(headers(sections)).toEqual([
      { key: "user-2", ordinal: 2, promptPreview: "Ship it", createdAt: "2026-10-24T10:00:00Z" },
      {
        key: "user-0",
        ordinal: 1,
        promptPreview: "Plan the calendar feature",
        createdAt: "2026-10-24T09:00:00Z",
      },
    ]);
    expect(ids(sections)).toEqual([["user-2:thoughts-0"], ["user-0:thoughts-0"]]);
  });

  it("keeps output after a delegated completion with the prompt before it", () => {
    const sections = buildInsightTimeline([
      userTurn(0),
      modelTurn(1, [toolDetail("subagent", { summary: "Fix the flaky test" })]),
      completionTurn(2),
      modelTurn(3, [thoughts("thoughts-0"), toolDetail("read")]),
    ]);

    expect(headers(sections).map((section) => section.key)).toEqual(["user-0"]);
    expect(ids(sections)).toEqual([
      ["user-0:tool-call-subagent", "delegated-completion-2:thoughts-0"],
    ]);
  });

  it("collects output before the first loaded prompt into a leading section", () => {
    const sections = buildInsightTimeline([
      modelTurn(4, [thoughts("thoughts-0")]),
      userTurn(5, "Continue"),
      modelTurn(6, [thoughts("thoughts-0")]),
    ]);

    expect(headers(sections)).toEqual([
      { key: "user-5", ordinal: 1, promptPreview: "Continue", createdAt: null },
      { key: "insights-leading", ordinal: null, promptPreview: "", createdAt: null },
    ]);
    expect(ids(sections)).toEqual([["user-5:thoughts-0"], ["insights-leading:thoughts-0"]]);
  });

  it("gives a stream whose prompt the snapshot does not show yet a section of its own", () => {
    const turns = withStreamedOutput(
      [userTurn(0), modelTurn(1, [thoughts("thoughts-0")])],
      { reasoning: "Plan the next step.", text: "" },
      true,
    );
    const sections = buildInsightTimeline(turns);

    expect(sections.map((section) => [section.key, section.ordinal])).toEqual([
      [STREAMING_TURN_KEY, null],
      ["user-0", 1],
    ]);
    expect(ids(sections)).toEqual([["model-streaming:thoughts-0"], ["user-0:thoughts-0"]]);
  });

  it("does not invent entries for prose-only output and still counts its prompt", () => {
    expect(buildInsightTimeline([])).toEqual([]);
    expect(buildInsightTimeline([userTurn(0), modelTurn(1, [text("text-0")])])).toEqual([]);

    const sections = buildInsightTimeline([
      userTurn(0),
      modelTurn(1, [text("text-0")]),
      userTurn(2),
      modelTurn(3, [thoughts("thoughts-0")]),
    ]);
    expect(sections.map((section) => [section.key, section.ordinal])).toEqual([["user-2", 2]]);
  });
});

describe("insight timeline helpers", () => {
  it("filters without mutating sections and keeps narrowed groups resolvable", () => {
    const sections = buildInsightTimeline(DIRECT_TURNS);
    const before = JSON.stringify(sections);

    const tools = filterInsightTimeline(sections, "tools");

    expect(ids(tools)).toEqual([["user-2:thoughts-0"], ["user-0:thoughts-0"]]);
    expect(
      tools[1].entries.flatMap((entry) =>
        entry.kind === "group" ? entry.group.segments.map((segment) => segment.kind) : [],
      ),
    ).toEqual(["reasoning", "tool"]);
    expect(filterInsightTimeline(sections, "sessions")).toEqual([]);
    expect(filterInsightTimeline(sections, "all")).toEqual(sections);
    expect(filterInsightTimeline(sections, "all")).not.toBe(sections);
    expect(JSON.stringify(sections)).toBe(before);

    const selected = tools[1].entries[0];
    const full = findInsightEntry(sections, selected.id);
    expect(full).toBe(sections[1].entries[0]);
    expect(full?.kind === "group" ? full.group.segments.length : 0).toBe(2);
    expect(tools[0].entries[0]).toBe(sections[0].entries[0]);
  });

  it("filters launched sessions apart from tools", () => {
    const sections = buildInsightTimeline([
      userTurn(0),
      modelTurn(1, [
        thoughts("thoughts-0"),
        toolDetail("subagent", { summary: "Fix the flaky test" }),
        toolDetail("read"),
      ]),
    ]);

    expect(ids(filterInsightTimeline(sections, "sessions"))).toEqual([
      ["user-0:tool-call-subagent"],
    ]);
    expect(ids(filterInsightTimeline(sections, "tools"))).toEqual([
      ["user-0:thoughts-0", "user-0:tool-call-read"],
    ]);
  });

  it("flattens entries in display order and finds them by id", () => {
    const sections = buildInsightTimeline(DIRECT_TURNS);

    expect(flattenInsightEntries(sections).map((entry) => entry.id)).toEqual([
      "user-2:thoughts-0",
      "user-0:thoughts-0",
    ]);
    expect(newestInsightEntry(sections)?.id).toBe("user-2:thoughts-0");
    expect(newestInsightEntry([])).toBeNull();
    expect(findInsightEntry(sections, "user-0:thoughts-0")).toMatchObject({ kind: "group" });
    expect(findInsightEntry(sections, "missing")).toBeNull();
  });

  it("offers the direct session filters", () => {
    expect(insightFilterOptions()).toEqual([
      { value: "all", label: "All actions" },
      { value: "tools", label: "Tools & reasoning" },
      { value: "sessions", label: "Sessions" },
    ]);
    expect(insightFilterOptions()).toBe(insightFilterOptions());
  });

  it.each<[InsightsFilter, string, string]>([
    ["all", "No actions yet.", "They appear here as the agent works."],
    ["tools", "No thoughts or tools yet.", "They appear here as the agent works."],
    ["sessions", "No sessions yet.", "They appear here as the agent delegates work."],
  ])("explains an empty %s filter", (filter, title, body) => {
    expect(insightFilterEmptyCopy(filter)).toEqual({ title, body });
  });
});
