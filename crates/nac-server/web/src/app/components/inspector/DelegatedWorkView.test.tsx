/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DelegatedWorkView } from "@/app/components/inspector/DelegatedWorkView";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import {
  resetSessionSelection,
  selectSpawn,
  useSelectedSpawn,
} from "@/app/store/sessionLayoutStore";
import type {
  SessionAssignmentRecord,
  SessionSnapshotResponse,
} from "@/app/types/api";

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

class SilentEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

const child: SessionAssignmentRecord = {
  assignment_id: "asgn_child-1",
  child_session_id: "child-1",
  parent_session_id: "parent",
  root_session_id: "parent",
  child_behavior: "direct",
  parent_behavior: "direct",
  description: "Review permissions",
  status: "running",
  generation: 2,
  run_id: "child-run",
  execution_mode: "background",
  report: null,
  failure: null,
  change_summary: null,
  verification_summary: null,
  completion_inbox_id: null,
  completion_suppressed: false,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
  version: 3,
  frozen_message_count: null,
};

const orchestrator: SessionAssignmentRecord = {
  assignment_id: "asgn_orchestrator-1",
  child_session_id: "orchestrator-1",
  parent_session_id: "parent",
  root_session_id: "parent",
  child_behavior: "orchestrator",
  parent_behavior: "direct",
  description: "Run the compatibility audit",
  status: "completed",
  generation: 1,
  run_id: "orchestrator-run",
  execution_mode: "foreground",
  report: "done",
  failure: null,
  change_summary: null,
  verification_summary: null,
  completion_inbox_id: 4,
  completion_suppressed: false,
  created_at: "2026-08-25T00:00:00Z",
  updated_at: "2026-08-25T00:00:00Z",
  version: 2,
  frozen_message_count: 6,
};

const listSpawns = vi.spyOn(api, "listSessionSpawns");
const startSpawn = vi.spyOn(api, "startSessionSpawn");
const cancelSpawn = vi.spyOn(api, "cancelSessionSpawn");
const getSession = vi.spyOn(api, "getSession");

function emptySnapshot(id: string): SessionSnapshotResponse {
  return {
    metadata: {
      cwd: "/tmp/nac-test",
      workspace_host_path: null,
      store_path: "/tmp/nac-test/store.db",
      model: "test-model",
      backend: "test-backend",
      session_id: id,
      sandbox_status: "off",
      agents_md_status: "missing",
    },
    messages: [],
    message_created_at: [],
    message_page: {
      start: 0,
      end: 0,
      total: 0,
      has_older: false,
    },
    response_timing: {
      last_response_duration_ms: null,
      previous_response_duration_ms: null,
      response_durations_ms: [],
    },
    sessions: [],
    active_threads: [],
    threads: [],
    thread_episodes: {},
    thread_events: {},
    thread_event_boundary: { epoch_id: "epoch-test", sequence_id: 0 },
    thread_steering: [],
    worksets: { items: [], error: null },
    workspace: {
      host_root: null,
      workspace_display: "nac-test",
      repo_label: null,
      branch: null,
      changed_files: [],
      total_additions: 0,
      total_deletions: 0,
      error: null,
    },
  } as SessionSnapshotResponse;
}

function View({
  behavior,
}: {
  behavior: "direct" | "direct-with-orchestrator";
}) {
  const selected = useSelectedSpawn();
  return (
    <DelegatedWorkView
      sessionId="parent"
      behavior={behavior}
      selected={selected}
      onSelect={selectSpawn}
    />
  );
}

function mount(behavior: "direct" | "direct-with-orchestrator", seed = true) {
  window.matchMedia = () =>
    ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("EventSource", SilentEventSource);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (seed) {
    client.setQueryData(queryKeys.sessionSpawns("parent"), [
      child,
      orchestrator,
    ]);
  }
  client.setQueryData(queryKeys.sessionSnapshot("child-1"), emptySnapshot("child-1"));
  client.setQueryData(
    queryKeys.sessionSnapshot("orchestrator-1"),
    emptySnapshot("orchestrator-1"),
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/sessions/parent"]}>
        <Routes>
          <Route
            path="*"
            element={
              <ToastProvider>
                <View behavior={behavior} />
                <Location />
              </ToastProvider>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  listSpawns.mockReset().mockResolvedValue([child, orchestrator]);
  startSpawn.mockReset().mockResolvedValue(child);
  cancelSpawn.mockReset().mockResolvedValue({ ...child, status: "cancelled" });
  getSession.mockReset().mockImplementation(async (id: string) => emptySnapshot(id));
  resetSessionSelection();
});
afterEach(() => {
  cleanup();
  resetSessionSelection();
  vi.unstubAllGlobals();
});

describe("delegated work", () => {
  it("shows Agent and Orchestrator assignments in one list", () => {
    mount("direct-with-orchestrator");

    expect(
      screen.getByRole("button", { name: /Review permissions/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Run the compatibility audit/ }),
    ).toBeTruthy();
    expect(screen.getByText("Thinking…")).toBeTruthy();
    expect(screen.queryByText("Coding agents")).toBeNull();
    expect(screen.queryByText("NAC orchestrators")).toBeNull();
    expect(screen.getByRole("button", { name: "New Agent" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "New Orchestrator" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: /Run the compatibility audit/ }),
    );
    expect(screen.getByText("No messages yet.")).toBeTruthy();
    expect(screen.queryByText("Thinking…")).toBeNull();
  });

  it("navigates from a delegated preview to its transcript", () => {
    mount("direct");

    expect(screen.getByRole("button", { name: "New Agent" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New Orchestrator" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Go to session" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/session/child-1/actions",
    );
    expect(screen.getByText("Run the compatibility audit")).toBeTruthy();
  });

  it("keeps a recoverable retry entry point after a relationship-list failure", async () => {
    listSpawns
      .mockRejectedValueOnce(new Error("temporary failure"))
      .mockResolvedValue([child]);
    mount("direct", false);

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Spawn sessions could not be loaded",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Review permissions/ }),
      ).toBeTruthy(),
    );
    expect(listSpawns).toHaveBeenCalledTimes(2);
  });

  it("routes pause through the unified spawn API", async () => {
    mount("direct-with-orchestrator");

    fireEvent.click(screen.getByRole("button", { name: "Pause session" }));
    await waitFor(() =>
      expect(cancelSpawn).toHaveBeenCalledWith("parent", "child-1"),
    );
  });

  it("renders cache-driven polling transitions without a page refresh", async () => {
    const client = mount("direct");
    const row = screen.getByRole("button", { name: /Review permissions/ });
    expect(row.querySelector(".text-shimmer-basic")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause session" })).toBeTruthy();

    act(() => {
      client.setQueryData(queryKeys.sessionSpawns("parent"), [
        {
          ...child,
          status: "completed",
          report: "The permissions audit passed.",
          completion_inbox_id: 12,
        },
        orchestrator,
      ]);
    });

    await waitFor(() =>
      expect(row.querySelector(".text-shimmer-basic")).toBeNull(),
    );
    expect(screen.queryByRole("button", { name: "Pause session" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop session" })).toBeNull();
    expect(screen.getByRole("button", { name: "Go to session" })).toBeTruthy();
  });
});
