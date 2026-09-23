/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import type { ModelTurn } from "@/app/lib/transcript";

const media = vi.hoisted(() => ({ isMobile: false }));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => media.isMobile }));

afterEach(() => {
  media.isMobile = false;
  cleanup();
});

describe("transcript topology badge navigation", () => {
  it("uses the session behavior avatar and keeps running state local to the header", () => {
    const { container } = render(
      <ModelMessage
        turn={{
          kind: "model",
          key: "model-1",
          durationMs: null,
          messageIndex: 1,
          blocks: [{ kind: "text", key: "text-1", text: "Working" }],
        }}
        model="gpt-5.6-sol"
        behavior="direct-with-orchestrator"
        active
        selectedThreadEpisode={null}
        selectedWorkset={null}
        onSelectThread={vi.fn()}
        onSelectWorkset={vi.fn()}
      />,
    );

    const avatar = container.querySelector(".session-type-avatar-shimmer");
    expect(avatar).not.toBeNull();
    expect(avatar?.classList.contains("size-[28px]")).toBe(true);
    expect(avatar?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByText("gpt-5.6-sol")).not.toBeNull();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("preserves the action set, tooltip text, order, and callback arguments", () => {
    const refresh = vi.fn();
    const revert = vi.fn();
    const fork = vi.fn();
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
        selectedWorkset={null}
        onSelectThread={vi.fn()}
        onSelectWorkset={vi.fn()}
        userMessageIndex={0}
        userText="Ship the transcript chrome"
        onRefresh={refresh}
        onRevert={revert}
        onFork={fork}
      />,
    );

    const regenerate = screen.getByRole("button", {
      name: "Regenerate from original prompt",
    });
    const restore = screen.getByRole("button", { name: "Revert to this snapshot" });
    const createFork = screen.getByRole("button", { name: "Create fork" });
    const copy = screen.getByRole("button", { name: "Copy message" });
    expect(screen.getAllByRole("button")).toEqual([regenerate, restore, createFork, copy]);
    expect(
      screen.getByText(
        "Regenerate from the original prompt (rewinds later transcript and workspace changes)",
      ),
    ).not.toBeNull();

    fireEvent.click(regenerate);
    fireEvent.click(restore);
    fireEvent.click(createFork);
    expect(refresh).toHaveBeenCalledWith(0);
    expect(revert).toHaveBeenCalledWith(0, "Ship the transcript chrome");
    expect(fork).toHaveBeenCalledWith(1);
  });

  it("keeps the model action row hover/focus treatment and mobile sizing", () => {
    media.isMobile = true;
    const { container } = render(
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
        selectedWorkset={null}
        onSelectThread={vi.fn()}
        onSelectWorkset={vi.fn()}
        userMessageIndex={0}
        onRefresh={vi.fn()}
        onRevert={vi.fn()}
        onFork={vi.fn()}
      />,
    );

    const actionRow = Array.from(container.querySelectorAll("div")).find((element) =>
      element.className.includes("group-hover/model-msg:opacity-100"),
    );
    expect(actionRow?.className).toContain("group-focus-within/model-msg:opacity-100");
    for (const button of screen.getAllByRole("button")) {
      expect(button.classList.contains("btn-medium")).toBe(true);
      expect(button.classList.contains("btn-ghost")).toBe(true);
    }
  });

  it("keeps mutations disabled during a run without disabling copy", () => {
    const refresh = vi.fn();
    const revert = vi.fn();
    const fork = vi.fn();
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
        selectedWorkset={null}
        onSelectThread={vi.fn()}
        onSelectWorkset={vi.fn()}
        userMessageIndex={0}
        onRefresh={refresh}
        onRevert={revert}
        onFork={fork}
        actionsDisabled
      />,
    );

    const mutationButtons = [
      screen.getByRole("button", { name: "Regenerate from original prompt" }),
      screen.getByRole("button", { name: "Revert to this snapshot" }),
      screen.getByRole("button", { name: "Create fork" }),
    ];
    for (const button of mutationButtons) {
      expect(button.hasAttribute("disabled")).toBe(true);
      fireEvent.click(button);
    }
    expect(screen.getByRole("button", { name: "Copy message" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(revert).not.toHaveBeenCalled();
    expect(fork).not.toHaveBeenCalled();
  });

  it("selects the referenced workset and thread episode", () => {
    const onSelectWorkset = vi.fn();
    const onSelectThread = vi.fn();
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      durationMs: 25,
      messageIndex: 1,
      blocks: [
        { kind: "workset", key: "workset-1", worksetId: "release", pending: false },
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
        selectedWorkset={null}
        onSelectThread={onSelectThread}
        onSelectWorkset={onSelectWorkset}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Worksets_release" }));
    expect(onSelectWorkset).toHaveBeenCalledWith("release");

    fireEvent.click(screen.getByRole("button", { name: /api/i }));
    expect(onSelectThread).toHaveBeenCalledWith("api", "api:0");
  });

  it("groups transcript thoughts and tools and selects the matching Actions group", () => {
    const onSelectActionGroup = vi.fn();
    const { container } = render(
      <ModelMessage
        turn={{
          kind: "model",
          key: "model-tools",
          durationMs: 1200,
          messageIndex: 1,
          blocks: [
            {
              kind: "thoughts",
              key: "thoughts-1",
              text: "Inspect the fixture",
              durationMs: 400,
              streaming: false,
            },
            {
              kind: "tool-detail",
              key: "tool-1",
              presentation: {
                callId: "read-1",
                name: "read",
                label: "Read file",
                summary: "fixture.txt",
                resultPreview: "contents",
                status: "success",
                statusLabel: "Succeeded",
              },
            },
            { kind: "text", key: "text-1", text: "Done" },
          ],
        }}
        model="gpt-5.6-sol"
        active={false}
        selectedThreadEpisode={null}
        selectedWorkset={null}
        selectedActionGroup={null}
        onSelectThread={vi.fn()}
        onSelectWorkset={vi.fn()}
        onSelectActionGroup={onSelectActionGroup}
      />,
    );

    const group = screen.getByRole("button", { name: /Thoughts & tools/ });
    expect(container.querySelector('[data-tool-call-id="read-1"]')).toBeNull();
    expect(screen.getByText("Done")).not.toBeNull();

    fireEvent.click(group);
    expect(onSelectActionGroup).toHaveBeenCalledWith("model-tools:tools-0");
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
        selectedWorkset={null}
        onSelectThread={vi.fn()}
        onSelectWorkset={vi.fn()}
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
