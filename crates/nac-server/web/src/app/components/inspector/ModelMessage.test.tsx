/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelMessage } from "@/app/components/inspector/ModelMessage";
import type { ModelTurn } from "@/app/lib/transcript";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));

afterEach(cleanup);

describe("transcript topology badge navigation", () => {
  it("selects the referenced workset and thread episode", () => {
    const onSelectWorkset = vi.fn();
    const onSelectThread = vi.fn();
    const onSelectAgentSegment = vi.fn();
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      originKey: "model-1",
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
        onSelectAgentSegment={onSelectAgentSegment}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Worksets_release" }));
    expect(onSelectAgentSegment).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /api/i }));
    expect(onSelectThread).toHaveBeenCalledWith("api", "api:0");
  });

  it("offers continue-in-X on a finished model turn", () => {
    const onContinue = vi.fn();
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      originKey: "model-1",
      durationMs: 25,
      messageIndex: 2,
      blocks: [{ kind: "text", key: "text-1", text: "Ready to hand off" }],
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
        onContinue={onContinue}
        continueLabel="Continue in Orchestrator"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Continue in Orchestrator" }));
    expect(onContinue).toHaveBeenCalledWith(2);
  });

  it("keeps parent-owned transcripts free of mutation affordances", () => {
    const turn: ModelTurn = {
      kind: "model",
      key: "model-1",
      originKey: "model-1",
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
        onContinue={vi.fn()}
        continueLabel="Continue in Orchestrator"
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

    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert to this snapshot" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create fork" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue in Orchestrator" })).toBeNull();
    expect(screen.queryByText("Forked chat")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy message" })).not.toBeNull();
  });
});
