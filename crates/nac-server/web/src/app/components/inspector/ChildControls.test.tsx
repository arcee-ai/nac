/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  start: vi.fn(),
  cancel: vi.fn(),
};

class SilentEventSource {
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  addEventListener() {}
  close() {}
}

vi.spyOn(api, "listTraditionalChildren").mockImplementation((...args) => fakes.list(...args));
vi.spyOn(api, "startTraditionalChild").mockImplementation((...args) => fakes.start(...args));
vi.spyOn(api, "cancelTraditionalChild").mockImplementation((...args) => fakes.cancel(...args));

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
  fakes.start.mockReset().mockImplementation(async () => child());
  fakes.cancel.mockReset().mockImplementation(async () => child("cancelled"));
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
  it("starts the visible general profile in background mode", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Launch coding agent" }));
    const [description, prompt] = screen.getAllByRole("textbox");
    fireEvent.change(description, { target: { value: "Review persistence" } });
    fireEvent.change(prompt, { target: { value: "Inspect the store and run focused tests." } });
    fireEvent.click(screen.getByRole("button", { name: "Start coding agent" }));

    await waitFor(() =>
      expect(fakes.start).toHaveBeenCalledWith(SESSION_ID, {
        profile: "general",
        description: "Review persistence",
        prompt: "Inspect the store and run focused tests.",
        background: true,
      }),
    );
  });

  it("keeps the control launch-only while preserving running permission bridges", async () => {
    mount([child()]);
    expect(screen.getByRole("button", { name: "Permissions for Review persistence" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Launch coding agent" }));
    expect(screen.getByRole("dialog").textContent).not.toContain("generation 1");
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});
