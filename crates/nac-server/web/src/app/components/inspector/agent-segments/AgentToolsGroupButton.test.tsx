/** @vitest-environment jsdom */

import type { PropsWithChildren } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentToolsGroupButton } from "@/app/components/inspector/agent-segments/AgentToolsGroupButton";
import { SegmentDetailList } from "@/app/components/inspector/agent-segments/SegmentDetailList";
import { buildStepperSteps } from "@/app/components/inspector/agent-segments/stepper";
import { focusActionSegment, resetActionExpansion } from "@/app/lib/actionExpand";
import type { AgentToolsGroup } from "@/app/lib/agentSegments";
import { resetSessionSelection, sessionLayoutStore } from "@/app/store/sessionLayoutStore";

function DetailRouter({ children }: PropsWithChildren) {
  return <MemoryRouter initialEntries={["/session/session-1/actions"]}>{children}</MemoryRouter>;
}

function renderDetails(group: AgentToolsGroup, hostRoots?: string[]) {
  return render(<SegmentDetailList group={group} hostRoots={hostRoots} />, {
    wrapper: DetailRouter,
  });
}

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
  resetSessionSelection();
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
  resetSessionSelection();
  vi.useRealTimers();
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
    renderDetails(group());
    expect(screen.getByText("Thoughts")).toBeTruthy();
    expect(screen.getByText("Run command")).toBeTruthy();
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("Awaiting approval")).toBeTruthy();
    expect(screen.getByText("npm test")).toBeTruthy();
    expect(screen.getByText("all tests passed")).toBeTruthy();
  });

  it("scrolls to and highlights a child selected from the Actions list", async () => {
    const scroll = vi.fn();
    const { container } = renderDetails(group());
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

  it("follows live detail growth until the reader scrolls away and resumes at the bottom", () => {
    let scrollHeight = 600;
    const initial = group();
    const initialTail = initial.segments[2];
    if (initialTail.kind !== "tool") throw new Error("expected a tool tail");
    initialTail.presentation.name = "exec_command";
    initialTail.presentation.label = "Run command";
    initialTail.presentation.summary = "npm test";
    const { container, rerender } = renderDetails(initial);
    const root = container.firstElementChild as HTMLDivElement;
    Object.defineProperty(root, "scrollHeight", { configurable: true, get: () => scrollHeight });
    Object.defineProperty(root, "clientHeight", { configurable: true, get: () => 200 });

    const firstLive = structuredClone(initial);
    firstLive.inProgress = true;
    const firstTail = firstLive.segments[2];
    if (firstTail.kind !== "tool") throw new Error("expected a tool tail");
    firstTail.presentation.status = "running";
    firstTail.presentation.statusLabel = "Running";
    firstTail.presentation.resultPreview = "partial output";
    rerender(<SegmentDetailList group={firstLive} />);
    expect(root.scrollTop).toBe(400);
    expect(container.querySelectorAll(".agent-segment-row-connector")).toHaveLength(1);

    root.scrollTop = 100;
    fireEvent.scroll(root);
    const paused = structuredClone(firstLive);
    const pausedTail = paused.segments[2];
    if (pausedTail.kind !== "tool") throw new Error("expected a tool tail");
    pausedTail.presentation.resultPreview = "partial output growing while reading";
    rerender(<SegmentDetailList group={paused} />);
    expect(root.scrollTop).toBe(100);

    root.scrollTop = 390;
    fireEvent.scroll(root);
    scrollHeight = 700;
    const resumed = structuredClone(paused);
    const resumedTail = resumed.segments[2];
    if (resumedTail.kind !== "tool") throw new Error("expected a tool tail");
    resumedTail.presentation.resultPreview = "partial output growing after returning to bottom";
    rerender(<SegmentDetailList group={resumed} />);
    expect(root.scrollTop).toBe(500);
  });

  it("turns read paths into Files-panel buttons without hiding the result preview", () => {
    const fileGroup = group();
    fileGroup.segments = [
      {
        kind: "tool",
        key: "read-file",
        presentation: {
          callId: "call-read",
          name: "read",
          label: "Read file",
          summary: "/workspace/src/app.tsx",
          resultPreview: "export function App() {}",
          status: "success",
          statusLabel: "Succeeded",
        },
      },
    ];

    renderDetails(fileGroup, ["/workspace"]);
    const file = screen.getByRole("button", { name: "src/app.tsx" });
    expect(screen.getByText("export function App() {}")).toBeTruthy();
    fireEvent.click(file);
    expect(sessionLayoutStore.getState().selectedFile).toBe("src/app.tsx");
    expect(file.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows the first three glob matches, a remainder count, and an empty state", () => {
    const globGroup = group();
    globGroup.segments = [
      {
        kind: "tool",
        key: "glob-files",
        presentation: {
          callId: "call-glob",
          name: "glob",
          label: "Find files",
          summary: "src/**/*",
          resultPreview: JSON.stringify({
            entries: [
              { path: "src/app.tsx", kind: "file" },
              { path: "src/lib", kind: "directory" },
              { path: "src/lib/routes.ts", kind: "file" },
              { path: "src/lib/store.ts", kind: "file" },
            ],
          }),
          status: "success",
          statusLabel: "Succeeded",
        },
      },
    ];

    const { rerender } = renderDetails(globGroup);
    expect(screen.getByRole("button", { name: "src/app.tsx" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "src/lib" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "src/lib/routes.ts" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "src/lib/store.ts" })).toBeNull();
    expect(screen.getByText("+1 more")).toBeTruthy();

    const empty = structuredClone(globGroup);
    const emptyTool = empty.segments[0];
    if (emptyTool.kind !== "tool") throw new Error("expected a glob tool");
    emptyTool.presentation.resultPreview = JSON.stringify({ entries: [] });
    rerender(<SegmentDetailList group={empty} />);
    expect(screen.getByText("No files found")).toBeTruthy();
  });

  it("animates only the newest live pill and fades the live stepper after settlement", () => {
    vi.useFakeTimers();
    const live = group();
    live.inProgress = true;
    const liveTail = live.segments[2];
    if (liveTail.kind !== "tool") throw new Error("expected a tool tail");
    liveTail.presentation.status = "running";
    liveTail.presentation.statusLabel = "Running";

    const { container, rerender } = render(
      <AgentToolsGroupButton group={live} active={false} onSelect={() => {}} />,
    );
    const activePills = container.querySelectorAll('[data-state="active"]');
    expect(activePills).toHaveLength(1);
    expect(activePills[0].getAttribute("data-segment-id")).toBe("tool-2");
    expect(screen.getByText("Reading file…")).toBeTruthy();

    const settled = structuredClone(live);
    settled.inProgress = false;
    const settledTail = settled.segments[2];
    if (settledTail.kind !== "tool") throw new Error("expected a tool tail");
    settledTail.presentation.status = "success";
    settledTail.presentation.statusLabel = "Succeeded";
    rerender(<AgentToolsGroupButton group={settled} active={false} onSelect={() => {}} />);
    expect(container.querySelector('[data-stepper] [aria-hidden="true"]')).not.toBeNull();

    act(() => vi.advanceTimersByTime(300));
    expect(container.querySelector("[data-stepper]")).toBeNull();
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
    const track = container.querySelector<HTMLElement>("[data-segment-id]")?.parentElement;
    expect(track?.style.transform).toBe("translateX(-72px)");
    expect(
      Array.from(container.querySelectorAll("[data-segment-id]")).map((node) =>
        node.getAttribute("data-segment-id"),
      ),
    ).toEqual(["tool-0", "tool-1", "tool-2", "tool-3", "tool-4", "tool-5"]);
  });
});
