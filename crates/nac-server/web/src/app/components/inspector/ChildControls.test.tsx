/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChildControls } from "@/app/components/inspector/ChildControls";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { TraditionalChildRecord } from "@/app/types/api";

const SESSION_ID = "direct-session";
const fakes = {
  list: vi.fn(),
};

class SilentEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

vi.spyOn(api, "listTraditionalChildren").mockImplementation((...args) => fakes.list(...args));

function child(status: TraditionalChildRecord["status"] = "running"): TraditionalChildRecord {
  return {
    child_session_id: "child-1",
    parent_session_id: SESSION_ID,
    root_session_id: SESSION_ID,
    profile: "general",
    description: "Review persistence",
    nesting_depth: 1,
    status,
    generation: 1,
    run_id: "run-1",
    execution_mode: "background",
    report: null,
    failure: null,
    change_summary: null,
    verification_summary: null,
    completion_inbox_id: null,
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
    version: 1,
    frozen_message_count: null,
  };
}

function mount(children: TraditionalChildRecord[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.traditionalChildren(SESSION_ID), children);
  for (const record of children) {
    client.setQueryData(queryKeys.sessionPermissions(record.child_session_id), {
      requests: [],
      grants: [],
    });
  }
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <ChildControls sessionId={SESSION_ID} behavior="direct" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal("EventSource", SilentEventSource);
  fakes.list.mockReset().mockResolvedValue([]);
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    media: "",
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("traditional child controls", () => {
  it("does not expose a composer launch control", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Launch coding agent" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start coding agent" })).toBeNull();
  });

  it("keeps running permission bridges without a launch surface", () => {
    mount([child()]);
    expect(screen.queryByRole("button", { name: "Launch coding agent" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
