/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatSessionList } from "@/app/components/projects/ChatSessionList";
import type { ManagedSessionSummary, SessionBehavior } from "@/app/types/api";

vi.mock("@/app/hooks/useSessionTitle", () => ({
  useSessionTitle: () => (summary: { title: string | null }) => summary.title ?? "Untitled",
}));

function session(
  sessionId: string,
  title: string,
  behavior: SessionBehavior,
): ManagedSessionSummary {
  return {
    active: false,
    active_run: null,
    lineage: null,
    summary: {
      backend: "openai-responses",
      behavior,
      created_at: "2026-08-28T12:00:00Z",
      cwd: "/workspace",
      forked_from: null,
      last_user_prompt: null,
      model: "gpt-5.6-sol",
      project_id: "project",
      sandboxed: false,
      session_id: sessionId,
      ssh_host: null,
      title,
      updated_at: "2026-08-28T12:00:00Z",
      visible_message_count: 1,
    },
    workspace_diff: null,
  };
}

afterEach(cleanup);

describe("chat session behavior identity", () => {
  it("keeps every behavior identifiable in the chat list", () => {
    const onOpen = vi.fn();
    render(
      <ChatSessionList
        sessions={[
          session("orchestrator", "Plan the release", "orchestrator"),
          session("direct", "Fix the parser", "direct"),
          session("hybrid", "Coordinate the migration", "direct-with-orchestrator"),
        ]}
        onOpen={onOpen}
      />,
    );

    expect(screen.getByRole("button", { name: "Plan the release, Orchestrator" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Fix the parser, Agent" })).toBeTruthy();
    const hybrid = screen.getByRole("button", {
      name: "Coordinate the migration, Agent",
    });
    expect(hybrid).toBeTruthy();

    fireEvent.click(hybrid);
    expect(onOpen).toHaveBeenCalledWith(
      expect.objectContaining({ summary: expect.objectContaining({ session_id: "hybrid" }) }),
    );
  });
});
