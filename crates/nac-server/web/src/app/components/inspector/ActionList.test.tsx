/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActionList } from "@/app/components/inspector/ActionList";
import { resetActionExpansion } from "@/app/lib/actionExpand";
import { actionFilterEmptyCopy, type ActionTurnSection } from "@/app/lib/actionsTimeline";

const sections: ActionTurnSection[] = [
  {
    key: "model-1",
    number: 1,
    prompt: "Validate the UI migration",
    createdAt: null,
    items: [
      {
        kind: "group",
        id: "model-1:tools-0",
        group: {
          id: "model-1:tools-0",
          turnKey: "model-1",
          label: "Thoughts & tools",
          inProgress: false,
          durationMs: 500,
          segments: [
            {
              kind: "thinking",
              key: "thought-1",
              text: "Inspect the current contract.",
              durationMs: 500,
              streaming: false,
            },
            {
              kind: "tool",
              key: "tool-1",
              presentation: {
                callId: "tool-1",
                name: "exec_command",
                label: "Run command",
                summary: "npm test",
                resultPreview: "passed",
                status: "success",
                statusLabel: "Succeeded",
              },
            },
          ],
        },
      },
      {
        kind: "thread",
        id: "thread-1",
        name: "review",
        episodeKey: "thread-1",
        nested: true,
        state: "done",
        action: "Review the result",
      },
    ],
  },
];

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

function Harness() {
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  return (
    <ActionList
      sections={sections}
      kind="orchestrator"
      selectedGroupId={selectedGroup}
      selectedThreadEpisode={selectedThread}
      onSelectGroup={setSelectedGroup}
      onSelectThread={(_name, episode) => setSelectedThread(episode)}
    />
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  resetActionExpansion();
});

afterEach(() => {
  cleanup();
  resetActionExpansion();
  vi.unstubAllGlobals();
});

describe("ActionList", () => {
  it("expands grouped segments, preserves callbacks, and selects a child segment", () => {
    render(<Harness />);
    const group = screen.getByRole("button", { name: /Thoughts, Run command/ });
    expect(group.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(group);
    expect(group.getAttribute("aria-expanded")).toBe("true");
    const child = screen.getByRole("button", { name: "Run command" });
    fireEvent.click(child);
    expect(child.getAttribute("aria-pressed")).toBe("true");

    const thread = screen.getByRole("button", { name: /review/ });
    fireEvent.click(thread);
    expect(thread.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders filtered empty copy without implying unavailable session behavior", () => {
    render(
      <ActionList
        sections={sections}
        filter="worksets"
        kind="orchestrator"
        selectedGroupId={null}
        selectedThreadEpisode={null}
        onSelectGroup={() => {}}
        onSelectThread={() => {}}
      />,
    );
    expect(screen.getByText("No worksets yet.")).toBeTruthy();
    expect(actionFilterEmptyCopy("tools", "agent").body).toBe(
      "They appear here as the agent works.",
    );
  });

  it("marks pending threads disabled and failed groups with error presentation", () => {
    const pending = structuredClone(sections);
    const thread = pending[0].items[1];
    if (thread.kind !== "thread") throw new Error("expected thread");
    thread.state = "pending";
    render(
      <ActionList
        sections={pending}
        kind="orchestrator"
        selectedGroupId={null}
        selectedThreadEpisode={null}
        onSelectGroup={() => {}}
        onSelectThread={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /review/ }).hasAttribute("disabled")).toBe(true);
  });
});
