/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { TranscriptTurnsContext } from "@/app/features/insights/transcript/transcriptTurns";
import { standaloneTranscriptDensityStore } from "@/app/store/transcriptDensityStore";
import { FoldChoicesContext } from "./foldChoices";
import { WorkFoldView } from "./WorkFold";

vi.mock("@/app/features/insights/useInsightsNavigation", () => ({
  INSIGHTS_DETAIL_ID: "detail",
  useInsightsNavigation: () => ({ openGroup: vi.fn() }),
}));

it("retains explicit child fold choices across switches without sharing them with a sibling", () => {
  const choices = new Map<string, boolean>();
  const fold = { kind: "fold" as const, key: "fold:1", groupIds: [], steps: [] };
  const view = (sessionId: string) => (
    <MemoryRouter>
      <FoldChoicesContext value={choices}>
        <TranscriptTurnsContext value={{ sessionId, turns: [] }}>
          <WorkFoldView
            key={sessionId}
            turnKey="turn:1"
            fold={fold}
            active={false}
            turnDurationMs={null}
            selectedGroupId={null}
            interactive={false}
          />
        </TranscriptTurnsContext>
      </FoldChoicesContext>
    </MemoryRouter>
  );
  const rendered = render(view("child-a"));
  const button = () => screen.getByRole("button");
  expect(button().getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button());
  expect(button().getAttribute("aria-expanded")).toBe("true");
  rendered.rerender(view("child-b"));
  expect(button().getAttribute("aria-expanded")).toBe("false");
  rendered.rerender(view("child-a"));
  expect(button().getAttribute("aria-expanded")).toBe("true");
  // Density changes the default for the sibling, while the explicit choice
  // remains authoritative for this child.
  fireEvent.click(button());
  act(() => standaloneTranscriptDensityStore.setTranscriptDensity("detailed"));
  expect(button().getAttribute("aria-expanded")).toBe("false");
  rendered.rerender(view("child-b"));
  expect(button().getAttribute("aria-expanded")).toBe("true");
  rendered.rerender(view("child-a"));
  expect(button().getAttribute("aria-expanded")).toBe("false");
  act(() => standaloneTranscriptDensityStore.setTranscriptDensity("compact"));
});

it("retains a child's explicit choice while live activity changes and after a sibling visit", () => {
  const choices = new Map<string, boolean>();
  const view = (sessionId: string, text: string, active: boolean) => (
    <MemoryRouter>
      <FoldChoicesContext value={choices}>
        <TranscriptTurnsContext value={{ sessionId, turns: [] }}>
          <WorkFoldView
            key={sessionId}
            turnKey="turn:1"
            fold={{
              kind: "fold",
              key: "fold:1",
              groupIds: ["group:1"],
              steps: [
                {
                  kind: "segment",
                  key: "thoughts-0",
                  groupId: "group:1",
                  segment: {
                    kind: "reasoning",
                    key: "thoughts-0",
                    text,
                    durationMs: null,
                    streaming: active,
                  },
                },
              ],
            }}
            active={active}
            liveLabel={active ? "Thinking…" : null}
            turnDurationMs={null}
            selectedGroupId={null}
            interactive={false}
          />
        </TranscriptTurnsContext>
      </FoldChoicesContext>
    </MemoryRouter>
  );
  const rendered = render(view("child-a", "first", true));
  fireEvent.click(screen.getByRole("button", { name: "Thinking…" }));
  rendered.rerender(view("child-a", "first extended", true));
  expect(screen.getByRole("button", { name: "Thinking…", expanded: true })).toBeTruthy();
  rendered.rerender(view("child-b", "sibling", true));
  expect(screen.getByRole("button", { name: "Thinking…", expanded: false })).toBeTruthy();
  rendered.rerender(view("child-a", "first extended", false));
  expect(screen.getByRole("button", { name: "Thought", expanded: true })).toBeTruthy();
});
