/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrchestratorControls } from "@/app/components/inspector/OrchestratorControls";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import type { ManagedOrchestratorRecord } from "@/app/types/api";

const SESSION_ID = "delegating-session";
const fakes = { list: vi.fn(), start: vi.fn(), cancel: vi.fn() };

vi.spyOn(api, "listManagedOrchestrators").mockImplementation((...args) => fakes.list(...args));
vi.spyOn(api, "startManagedOrchestrator").mockImplementation((...args) => fakes.start(...args));
vi.spyOn(api, "cancelManagedOrchestrator").mockImplementation((...args) => fakes.cancel(...args));

function orchestrator(
  status: ManagedOrchestratorRecord["status"] = "running",
): ManagedOrchestratorRecord {
  return {
    orchestrator_session_id: "orchestrator-1",
    parent_session_id: SESSION_ID,
    root_session_id: SESSION_ID,
    description: "Implement persistence",
    status,
    generation: 1,
    run_id: "run-1",
    execution_mode: "background",
    report: null,
    failure: null,
    completion_inbox_id: null,
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
    version: 1,
  };
}

function mount(records: ManagedOrchestratorRecord[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.managedOrchestrators(SESSION_ID), records);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <OrchestratorControls sessionId={SESSION_ID} behavior="direct-with-orchestrator" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  fakes.list.mockReset().mockResolvedValue([]);
  fakes.start.mockReset().mockImplementation(async () => orchestrator());
  fakes.cancel.mockReset().mockImplementation(async () => orchestrator("cancelled"));
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

describe("managed orchestrator controls", () => {
  it("starts a background orchestrator objective", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Managed orchestrators" }));
    const [description, prompt] = screen.getAllByRole("textbox");
    fireEvent.change(description, { target: { value: "Implement persistence" } });
    fireEvent.change(prompt, { target: { value: "Implement and verify the durable store." } });
    fireEvent.click(screen.getByRole("button", { name: "Start orchestrator" }));
    await waitFor(() =>
      expect(fakes.start).toHaveBeenCalledWith(SESSION_ID, {
        description: "Implement persistence",
        prompt: "Implement and verify the durable store.",
        background: true,
      }),
    );
  });

  it("shows durable status and propagates cancellation", async () => {
    mount([orchestrator()]);
    fireEvent.click(screen.getByRole("button", { name: "Managed orchestrators" }));
    expect(screen.getByRole("dialog").textContent).toContain("running · generation 1");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(fakes.cancel).toHaveBeenCalledWith(SESSION_ID, "orchestrator-1"));
  });
});
