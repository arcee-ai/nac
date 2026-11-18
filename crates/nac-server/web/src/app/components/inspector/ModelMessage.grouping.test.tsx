/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { ModelTurnItem } from "@/app/features/insights/model/types";
import type { ModelTurn } from "@/app/lib/transcript";
import { ModelMessage } from "./ModelMessage";

const fixture = vi.hoisted(() => ({ items: [] as ModelTurnItem[] }));
vi.mock("@/app/features/insights/model/segments", () => ({
  partitionModelTurn: () => fixture.items,
}));
vi.mock("@/app/features/insights/transcript/TranscriptSessionCard", () => ({
  TranscriptSessionCard: ({ entry }: { entry: { id: string } }) => (
    <div>
      <button>{entry.id}</button>
    </div>
  ),
  TranscriptSessionGroup: ({ entries }: { entries: Array<{ id: string }> }) => (
    <div>
      {entries.map((entry) => (
        <button key={entry.id}>{entry.id}</button>
      ))}
    </div>
  ),
}));

afterEach(cleanup);

it("keeps the focused child control when a later invocation joins its group", () => {
  const entry = (id: string): ModelTurnItem => ({
    kind: "session",
    id,
    action: "spawn-agent",
    rowKey: "child:one",
    title: "Audit",
    status: "ready",
    presentation: {
      callId: id,
      name: "subagent",
      label: "Subagent",
      summary: null,
      resultPreview: null,
      status: "success",
      statusLabel: "Succeeded",
    },
  });
  const turn: ModelTurn = {
    kind: "model",
    key: "turn",
    durationMs: null,
    messageIndex: 1,
    blocks: [],
  };
  const props = {
    model: "model",
    active: true,
    selectedThreadEpisode: null,
    onSelectThread: vi.fn(),
  };
  fixture.items = [entry("first")];
  const view = render(<ModelMessage {...props} turn={turn} />);
  const control = screen.getByRole("button", { name: "first" });
  control.focus();
  fixture.items = [entry("first"), entry("second")];
  view.rerender(<ModelMessage {...props} turn={{ ...turn }} />);
  expect(screen.getByRole("button", { name: "first" })).toBe(control);
  expect(document.activeElement).toBe(control);
  expect(screen.getByRole("button", { name: "second" })).toBeTruthy();
});
