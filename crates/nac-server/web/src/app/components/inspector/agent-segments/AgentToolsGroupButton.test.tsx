/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentToolsGroupButton } from "@/app/components/inspector/agent-segments/AgentToolsGroupButton";
import { SegmentDetailList } from "@/app/components/inspector/agent-segments/SegmentDetailList";
import { buildStepperSteps } from "@/app/components/inspector/agent-segments/stepper";
import { focusActionSegment, resetActionExpansion } from "@/app/lib/actionExpand";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";

function group(): AgentToolsGroup {
  return {
    id: "turn-1:tools-0",
    turnKey: "turn-1",
    label: "Thoughts & tools",
    inProgress: false,
    durationMs: 1_200,
    segments: [
      {
        kind: "thinking",
        key: "thought-1",
        text: "I checked **the source**. Now the result is stable.",
        durationMs: 1_200,
        streaming: false,
      },
      {
        kind: "tool",
        key: "tool-1",
        presentation: {
          callId: "call-1",
          name: "exec_command",
          label: "Run command",
          summary: "npm test",
          resultPreview: "all tests passed",
          status: "success",
          statusLabel: "Succeeded",
        },
      },
      {
        kind: "tool",
        key: "tool-2",
        presentation: {
          callId: "call-2",
          name: "read",
          label: "Read file",
          summary: "src/app.tsx",
          resultPreview: "permission needed",
          status: "awaiting-approval",
          statusLabel: "Awaiting approval",
        },
      },
    ],
  };
}

beforeEach(() => {
  resetActionExpansion();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  cleanup();
  resetActionExpansion();
  vi.unstubAllGlobals();
});

describe("agent segment presentation", () => {
  it("keeps the controlled selection callback and exact status text accessible", () => {
    const onSelect = vi.fn();
    render(<AgentToolsGroupButton group={group()} active={false} onSelect={onSelect} />);
    const button = screen.getByRole("button", { name: /Thoughts & tools/ });
    expect(button.getAttribute("aria-label")).toContain("Awaiting approval");
    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("turn-1:tools-0");
  });

  it("renders bounded input/output previews and every settled status", () => {
    render(<SegmentDetailList group={group()} />);
    expect(screen.getByText("Thoughts")).toBeTruthy();
    expect(screen.getByText("Run command")).toBeTruthy();
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("Awaiting approval")).toBeTruthy();
    expect(screen.getByText("npm test")).toBeTruthy();
    expect(screen.getByText("all tests passed")).toBeTruthy();
  });

  it("scrolls to and highlights a child selected from the Actions list", async () => {
    const scroll = vi.fn();
    const { container } = render(<SegmentDetailList group={group()} />);
    const root = container.firstElementChild as HTMLDivElement;
    const target = root.querySelector<HTMLElement>('[data-segment-key="tool-2"]');
    expect(target).not.toBeNull();
    root.scrollTop = 40;
    Object.defineProperty(root, "scrollTo", { value: scroll });
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      top: 100,
      bottom: 500,
      left: 0,
      right: 400,
      width: 400,
      height: 400,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });
    vi.spyOn(target!, "getBoundingClientRect").mockReturnValue({
      top: 250,
      bottom: 300,
      left: 0,
      right: 400,
      width: 400,
      height: 50,
      x: 0,
      y: 250,
      toJSON: () => ({}),
    });

    act(() => focusActionSegment("tool-2"));

    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ top: 190, behavior: "smooth" }));
    expect(target!.className).toContain("bg-btn-ghost-highlighted");
  });

  it("derives live step text without changing the underlying segment order", () => {
    const live = group();
    live.segments[0] = {
      kind: "thinking",
      key: "thought-1",
      text: "First sentence. Working on the unfinished tail",
      durationMs: null,
      streaming: true,
    };
    const steps = buildStepperSteps(live);
    expect(steps.map((step) => step.key)).toEqual(["thought-1", "tool-1", "tool-2"]);
    expect(steps[0]).toMatchObject({ label: "First sentence.", statusLabel: "Thinking" });
    expect(steps[2]).toMatchObject({ statusLabel: "Awaiting approval", failed: false });
  });

  it("clips the leading pills at the mobile limit without reordering the visible tail", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const mobile = group();
    mobile.segments = Array.from({ length: 6 }, (_, index) => ({
      kind: "tool" as const,
      key: `tool-${index}`,
      presentation: {
        callId: `call-${index}`,
        name: "read",
        label: `Read file ${index}`,
        summary: null,
        resultPreview: null,
        status: "success" as const,
        statusLabel: "Succeeded",
      },
    }));

    const { container } = render(
      <AgentToolsGroupButton group={mobile} active={false} onSelect={() => {}} />,
    );
    expect(screen.getByText("+2")).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll("[data-segment-id]")).map((node) =>
        node.getAttribute("data-segment-id"),
      ),
    ).toEqual(["tool-2", "tool-3", "tool-4", "tool-5"]);
  });
});
