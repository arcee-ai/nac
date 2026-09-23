import { describe, expect, it } from "vitest";

import {
  actionItemMatches,
  buildActionTimeline,
  filterActionTimeline,
  flattenActionItems,
} from "@/app/lib/actionsTimeline";
import type { TranscriptBlock, TranscriptTurn } from "@/app/lib/transcript";

function modelTurn(key: string, blocks: TranscriptBlock[]): TranscriptTurn {
  return { kind: "model", key, blocks, durationMs: 1_000, messageIndex: 1 };
}

describe("actions timeline projection", () => {
  it("pairs user prompts with model actions and orders turns newest first", () => {
    const turns: TranscriptTurn[] = [
      {
        kind: "user",
        key: "user-1",
        text: "Inspect the parser",
        invokedSkills: null,
        messageIndex: 0,
        createdAt: "2026-09-23 12:00:00",
      },
      modelTurn("model-1", [
        { kind: "thoughts", key: "thought-1", text: "Checking", durationMs: 200, streaming: false },
        { kind: "tool", key: "tool-1", name: "read", pending: false },
      ]),
      {
        kind: "user",
        key: "user-2",
        text: "Run the checks",
        invokedSkills: null,
        messageIndex: 2,
        createdAt: "2026-09-23 12:05:00",
      },
      modelTurn("model-2", [
        { kind: "workset", key: "workset-1", worksetId: "validation", pending: false },
        {
          kind: "wave",
          key: "wave-1",
          rows: [
            [
              {
                key: "thread-1",
                name: "tests",
                action: "Run the web test suite",
                weight: null,
                summary: "Passed",
                log: [],
                state: "done",
              },
            ],
          ],
        },
      ]),
    ];

    const sections = buildActionTimeline(turns);
    expect(sections.map(({ key, number, prompt }) => ({ key, number, prompt }))).toEqual([
      { key: "model-2", number: 2, prompt: "Run the checks" },
      { key: "model-1", number: 1, prompt: "Inspect the parser" },
    ]);
    expect(sections[0].items.map((item) => item.kind)).toEqual(["thread", "workset"]);
    expect(sections[1].items).toMatchObject([
      { kind: "group", id: "model-1:tools-0", group: { label: "Thoughts & tools" } },
    ]);
  });

  it("filters without mutating sections and matches the correct selection channel", () => {
    const sections = buildActionTimeline([
      modelTurn("model-1", [
        { kind: "tool", key: "tool-1", name: "read", pending: false },
        { kind: "workset", key: "workset-1", worksetId: "alpha", pending: false },
        {
          kind: "wave",
          key: "wave-1",
          rows: [
            [
              {
                key: "thread-1",
                name: "review",
                action: "Review the diff",
                weight: null,
                summary: "Done",
                log: [],
                state: "done",
              },
            ],
          ],
        },
      ]),
    ]);

    expect(filterActionTimeline(sections, "tools")[0].items.map((item) => item.kind)).toEqual([
      "group",
    ]);
    expect(filterActionTimeline(sections, "worksets")[0].items[0]).toMatchObject({
      kind: "workset",
      title: "Worksets_alpha",
    });
    expect(flattenActionItems(sections)).toHaveLength(3);

    const group = flattenActionItems(sections).find((item) => item.kind === "group");
    const thread = flattenActionItems(sections).find((item) => item.kind === "thread");
    expect(group && actionItemMatches(group, group.id, null)).toBe(true);
    expect(thread && actionItemMatches(thread, null, thread.episodeKey)).toBe(true);
    expect(sections[0].items).toHaveLength(3);
  });

  it("does not invent timeline rows for prose-only output", () => {
    const sections = buildActionTimeline([
      modelTurn("model-1", [{ kind: "text", key: "text-1", text: "Done" }]),
    ]);
    expect(sections).toEqual([]);
  });
});
