/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import type { ModelTurn } from "@/app/lib/transcript";
import { standaloneTranscriptDensityStore } from "@/app/store/transcriptDensityStore";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));

afterEach(() => {
  cleanup();
  standaloneTranscriptDensityStore.setTranscriptDensity("compact");
});

describe("transcript topology badge navigation", () => {
  it("shows requested and reported speeds without inferring missing tiers", () => {
    const turn: ModelTurn = {
      kind: "model",
      key: "receipts",
      durationMs: null,
      messageIndex: 1,
      blocks: [],
      serviceTierReceipts: [
        { requested: "fast", served: "priority" },
        { requested: "ultrafast", served: "default" },
        { requested: null, served: "fast" },
        { requested: "standard", served: null },
        { requested: "fast", served: "future-tier" },
        { requested: "ultrafast", served: "ultrafast" },
      ],
    };
    render(
      <ModelMessage
        turn={turn}
        model="model"
        active={false}
        selectedThreadEpisode={null}
        onSelectThread={vi.fn()}
      />,
    );
    expect(screen.getByText("Requested speed: Fast; served tier: Fast")).toBeTruthy();
    expect(
      screen.getByText("Requested speed: Ultrafast; served tier: Standard (provider downgrade)"),
    ).toBeTruthy();
    expect(screen.getByText("Requested speed: Provider default; served tier: Fast")).toBeTruthy();
    expect(screen.getByText("Requested speed: Standard; served tier: Unknown")).toBeTruthy();
    expect(
      screen.getByText(
        "Requested speed: Fast; served tier: Unknown (provider reported: future-tier)",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Requested speed: Ultrafast; served tier: Ultrafast")).toBeTruthy();
  });

  it("shows the total turn duration once when prose separates activity folds", () => {
    const turn: ModelTurn = {
      kind: "model",
      key: "model-duration",
      durationMs: 2300,
      messageIndex: 1,
      blocks: [
        {
          kind: "thoughts",
          key: "first",
          text: "First thought",
          durationMs: null,
          streaming: false,
        },
        { kind: "text", key: "note", text: "Checking the result." },
        {
          kind: "thoughts",
          key: "second",
          text: "Second thought",
          durationMs: null,
          streaming: false,
        },
      ],
    };
    render(
      <ModelMessage
        turn={turn}
        model="model"
        active={false}
        selectedThreadEpisode={null}
        onSelectThread={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Thought" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Total time 2.3s · Thought" })).toBeTruthy();
    expect(screen.getAllByText(/Total time/)).toHaveLength(1);
  });

  it("keeps visible prose and its selection in place when later work arrives and settles", () => {
    const props = {
      model: "model",
      selectedThreadEpisode: null,
      onSelectThread: vi.fn(),
    };
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      durationMs: null,
      messageIndex: 1,
      blocks: [
        {
          kind: "thoughts",
          key: "thought-1",
          text: "Thinking",
          durationMs: null,
          streaming: true,
        },
        { kind: "text", key: "text-1", text: "I will check the tests." },
      ],
    };
    const view = render(<ModelMessage {...props} turn={turn} active />);
    const prose = screen.getByText("I will check the tests.");
    const range = document.createRange();
    range.selectNodeContents(prose);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    const later: ModelTurn = {
      ...turn,
      blocks: [...turn.blocks, { kind: "tool", key: "tool-1", name: "read_file", pending: true }],
    };
    view.rerender(<ModelMessage {...props} turn={later} active />);
    expect(screen.getByText("I will check the tests.")).toBe(prose);
    expect(selection.toString()).toBe("I will check the tests.");
    view.rerender(<ModelMessage {...props} turn={later} active={false} />);
    expect(screen.getByText("I will check the tests.")).toBe(prose);
    expect(selection.toString()).toBe("I will check the tests.");
    selection.removeAllRanges();
  });

  it("remembers a primary nested row when the outer fold is closed and reopened", () => {
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      durationMs: null,
      messageIndex: 1,
      blocks: [
        {
          kind: "thoughts",
          key: "thought-1",
          text: "Kept thought",
          durationMs: null,
          streaming: true,
        },
      ],
    };
    render(
      <ModelMessage
        turn={turn}
        model="model"
        active
        selectedThreadEpisode={null}
        onSelectThread={vi.fn()}
      />,
    );
    const fold = screen.getByRole("button", { name: "Thinking…" });
    fireEvent.click(fold);
    fireEvent.click(screen.getByRole("button", { name: "Thinking…", expanded: false }));
    expect(screen.getByText("Kept thought")).toBeTruthy();
    fireEvent.click(fold);
    fireEvent.click(fold);
    expect(screen.getByText("Kept thought")).toBeTruthy();
  });

  it("uses one live disclosure for reasoning and retains reader choices as it settles", () => {
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      durationMs: null,
      messageIndex: 1,
      blocks: [
        {
          kind: "thoughts",
          key: "thoughts-0",
          text: "First thought",
          durationMs: null,
          streaming: true,
        },
      ],
    };
    const props = {
      model: "model",
      selectedThreadEpisode: null,
      onSelectThread: vi.fn(),
    };
    const view = render(<ModelMessage {...props} turn={turn} active />);
    const fold = screen.getByRole("button", { name: "Thinking…" });
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(fold);
    fireEvent.click(screen.getByRole("button", { name: "Thinking…", expanded: false }));
    expect(screen.getByText("First thought")).toBeTruthy();
    view.rerender(
      <ModelMessage
        {...props}
        active={false}
        turn={{
          ...turn,
          durationMs: 2000,
          blocks: [
            {
              ...turn.blocks[0],
              kind: "thoughts",
              text: "First thought extended",
              durationMs: null,
              streaming: false,
            },
          ],
        }}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Thought for 2.0s" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByText("First thought extended")).toBeTruthy();
  });

  it("keeps reasoning discoverable while the turn starts writing", () => {
    const turn: ModelTurn = {
      kind: "model",
      key: "model-writing",
      durationMs: null,
      messageIndex: 1,
      blocks: [
        {
          kind: "thoughts",
          key: "thought",
          text: "A thought",
          durationMs: null,
          streaming: false,
        },
      ],
    };
    const props = { model: "model", selectedThreadEpisode: null, onSelectThread: vi.fn() };
    const view = render(<ModelMessage {...props} turn={turn} active />);
    expect(screen.getByRole("button", { name: "Thinking…", expanded: false })).toBeTruthy();
    view.rerender(
      <ModelMessage
        {...props}
        active
        turn={{
          ...turn,
          blocks: [...turn.blocks, { kind: "text", key: "answer", text: "The answer so far." }],
        }}
      />,
    );
    const fold = screen.getByRole("button", {
      name: "Writing… · Thought",
      expanded: false,
    });
    expect(screen.getByText("The answer so far.")).toBeTruthy();
    fireEvent.click(fold);
    fireEvent.click(screen.getByRole("button", { name: "Thought" }));
    expect(screen.getByText("A thought")).toBeTruthy();
  });

  it("shows noninteractive progress without a trace and shares density with read-only turns", () => {
    const props = {
      model: "model",
      selectedThreadEpisode: null,
      onSelectThread: vi.fn(),
      readOnly: true,
      interactive: false,
    };
    const empty: ModelTurn = {
      kind: "model",
      key: "model-1",
      durationMs: null,
      messageIndex: 1,
      blocks: [],
    };
    const view = render(<ModelMessage {...props} turn={empty} active />);
    expect(screen.getByRole("status").textContent).toContain("Thinking");
    expect(screen.queryByRole("button", { name: /Thinking/ })).toBeNull();
    act(() => standaloneTranscriptDensityStore.setTranscriptDensity("detailed"));
    const turn: ModelTurn = {
      ...empty,
      blocks: [{ kind: "tool", key: "tool-1", name: "read_file", pending: true }],
    };
    view.rerender(<ModelMessage {...props} turn={turn} active />);
    const fold = screen.getByRole("button", { name: /Using read_file/ });
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      standaloneTranscriptDensityStore.setTranscriptDensity("compact");
      standaloneTranscriptDensityStore.setTranscriptDensity("detailed");
    });
    view.rerender(<ModelMessage {...props} turn={{ ...turn }} active />);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps approval waits and failures visible when activity is folded", () => {
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      durationMs: null,
      messageIndex: 1,
      blocks: ["awaiting-approval", "error"].map((status, index) => ({
        kind: "tool-detail" as const,
        key: `tool-${index}`,
        presentation: {
          callId: `call-${index}`,
          name: "exec_command",
          label: "Run command",
          summary: `command ${index}`,
          resultPreview: null,
          status: status as "awaiting-approval" | "error",
          statusLabel: status,
        },
      })),
    };
    render(
      <ModelMessage
        turn={turn}
        model="model"
        active
        readOnly
        interactive={false}
        selectedThreadEpisode={null}
        onSelectThread={vi.fn()}
      />,
    );
    expect(screen.getByRole("list", { name: "Steps that need attention" })).toBeTruthy();
    expect(screen.getByText("Waiting for approval")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
  });

  it("names destructive replay as regeneration from the original prompt", () => {
    const refresh = vi.fn();
    render(
      <ModelMessage
        turn={{
          kind: "model",
          key: "model-1",
          durationMs: 25,
          messageIndex: 1,
          blocks: [{ kind: "text", key: "text-1", text: "Result" }],
        }}
        model="gpt-5.6-sol"
        active={false}
        selectedThreadEpisode={null}
        onSelectThread={vi.fn()}
        userMessageIndex={0}
        onRefresh={refresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Regenerate from original prompt" }));
    expect(refresh).toHaveBeenCalledWith(0);
  });

  it("folds the workset into one line and selects the thread episode", () => {
    const onSelectThread = vi.fn();
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      durationMs: 25,
      messageIndex: 1,
      blocks: [
        {
          kind: "workset",
          key: "workset-1",
          worksetId: "release",
          pending: false,
        },
        {
          kind: "wave",
          key: "wave-1",
          rows: [
            [
              {
                key: "api:0",
                name: "api",
                action: "Verify the API",
                weight: "light",
                summary: "API verified",
                log: [],
                state: "done",
              },
            ],
          ],
        },
      ],
    };

    render(
      <ModelMessage
        turn={turn}
        model="gpt-5.6-sol"
        active={false}
        selectedThreadEpisode={null}
        onSelectThread={onSelectThread}
      />,
    );

    const fold = screen.getByRole("button", {
      name: "Worked for <1s · Defined 1 workset",
    });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Defined workset")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /api/i }));
    expect(onSelectThread).toHaveBeenCalledWith("api", "api:0", {
      focusDetail: true,
    });
  });

  it("keeps parent-owned transcripts free of mutation affordances", () => {
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      durationMs: 25,
      messageIndex: 1,
      blocks: [{ kind: "text", key: "text-1", text: "Read-only result" }],
    };

    render(
      <ModelMessage
        turn={turn}
        model="gpt-5.6-sol"
        active={false}
        selectedThreadEpisode={null}
        onSelectThread={vi.fn()}
        userMessageIndex={0}
        onRefresh={vi.fn()}
        onRevert={vi.fn()}
        onFork={vi.fn()}
        forks={[
          {
            session_id: "fork-1",
            source_message_idx: 1,
            title: "Forked chat",
            deleted: false,
          },
        ]}
        readOnly
      />,
    );

    expect(screen.queryByRole("button", { name: "Regenerate from original prompt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert to this snapshot" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create fork" })).toBeNull();
    expect(screen.queryByText("Forked chat")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy message" })).not.toBeNull();
  });
});
