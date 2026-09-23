/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionCollection } from "@/app/components/sessions/SessionCollection";
import { clearAttention, trackAttention } from "@/app/store/attentionStore";
import { sessionNavigationStore } from "@/app/store/sessionNavigationStore";
import type { ManagedSessionSummary, ProjectRecord } from "@/app/types/api";

const actions = { rename: vi.fn(), remove: vi.fn() };

vi.mock("@/app/hooks/useSessionTitle", () => ({
  useSessionTitle: () => (summary: { title: string | null }) => summary.title ?? "Untitled",
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
vi.mock("@/app/providers/SessionActionsProvider", () => ({
  useSessionActions: () => actions,
}));

function session(
  id: string,
  projectId: string | null,
  options: { lineage?: ManagedSessionSummary["lineage"]; running?: boolean; error?: string } = {},
): ManagedSessionSummary {
  return {
    active: options.running ?? false,
    active_run: options.running
      ? { run_id: `${id}-run`, prompt_preview: "work", started_at_epoch_ms: 1 }
      : null,
    lineage: options.lineage ?? null,
    summary: {
      backend: "openai-responses",
      behavior: "direct",
      created_at: "2026-09-22T12:00:00Z",
      cwd: "/workspace",
      forked_from: null,
      last_user_prompt: null,
      model: "gpt-5.6-sol",
      model_config_error: options.error ?? null,
      project_id: projectId,
      sandboxed: false,
      session_id: id,
      ssh_host: null,
      title: id,
      updated_at: "2026-09-22T12:00:00Z",
      visible_message_count: 1,
    },
    workspace_diff: null,
  };
}

const projects = [
  { project_id: "one", name: "Project One" },
  { project_id: "two", name: "Project Two" },
] as ProjectRecord[];

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderCollection(sessions: ManagedSessionSummary[], activeSessionId = "one-active") {
  return render(
    <MemoryRouter initialEntries={["/session/one-active/sessions"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SessionCollection
                sessions={sessions}
                projects={projects}
                activeSessionId={activeSessionId}
              />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  actions.rename.mockReset();
  actions.remove.mockReset();
  sessionNavigationStore.setState({ pinned: new Set(), lastViewedAt: {} });
  clearAttention("finished-run");
});

afterEach(cleanup);

describe("global session collection", () => {
  it("is a labeled default-visible parent collection with project, state, and unread cues", () => {
    renderCollection([
      session("one-active", "one"),
      session("one-updated", "one"),
      session("two-running", "two", { running: true }),
      session("two-failed", "two", { error: "configuration failed" }),
      session("child-hidden", "one", {
        lineage: {
          kind: "traditional-child",
          parent_session_id: "one-active",
          root_session_id: "one-active",
          description: "child",
        },
      }),
    ]);

    expect(screen.getByRole("navigation", { name: "All sessions" })).toBeTruthy();
    expect(screen.getByText("Pinned")).toBeTruthy();
    expect(screen.getByText("Project One")).toBeTruthy();
    expect(screen.getByText("Project Two")).toBeTruthy();
    expect(screen.queryByText("child-hidden")).toBeNull();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
    expect(screen.getAllByText("Updated").length).toBeGreaterThan(0);
    const activeRow = screen.getByRole("button", { name: /^one-active/ });
    expect(activeRow.getAttribute("aria-current")).toBe("page");
    activeRow.focus();
    expect(document.activeElement).toBe(activeRow);
    expect(activeRow.className).toContain("focus-visible:outline");
  });

  it("pins locally, navigates while marking viewed, and reuses rename/delete actions", () => {
    const sessions = [session("one-active", "one"), session("two-chat", "two")];
    renderCollection(sessions);

    fireEvent.click(screen.getByRole("button", { name: "Pin two-chat" }));
    expect(screen.getByRole("button", { name: "Unpin two-chat" })).toBeTruthy();
    expect(sessionNavigationStore.getState().pinned).toEqual(new Set(["two-chat"]));
    fireEvent.click(screen.getByRole("button", { name: "Unpin two-chat" }));
    expect(sessionNavigationStore.getState().pinned.size).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Pin two-chat" }));

    fireEvent.click(screen.getByRole("button", { name: "Rename two-chat" }));
    expect(actions.rename).toHaveBeenCalledWith(sessions[1].summary);
    fireEvent.click(screen.getByRole("button", { name: "Delete two-chat" }));
    expect(actions.remove).toHaveBeenCalledWith(sessions[1].summary);

    fireEvent.click(screen.getByRole("button", { name: /^two-chat/ }));
    expect(screen.getByTestId("location").textContent).toBe("/session/two-chat/sessions");
    expect(sessionNavigationStore.getState().lastViewedAt["two-chat"]).toBe("2026-09-22T12:00:00Z");
  });

  it("surfaces a completed run as a non-color attention state", () => {
    trackAttention([session("finished-run", "one", { running: true })], "one-active");
    const finished = session("finished-run", "one");
    trackAttention([finished], "one-active");

    renderCollection([session("one-active", "one"), finished]);

    expect(screen.getByText("Run finished")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^finished-run, Run finished/ })).toBeTruthy();
  });
});
