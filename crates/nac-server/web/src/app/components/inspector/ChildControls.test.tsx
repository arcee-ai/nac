/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Effect } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChildControls } from "@/app/components/inspector/ChildControls";
import { isolatedRegistry } from "@/app/effect/remote";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { apiEffect } from "@/app/services/api";
import { sessionPermissionsAtom, traditionalChildrenAtom } from "@/app/services/queries/direct";
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

vi.spyOn(apiEffect, "listTraditionalChildren").mockImplementation((...args) =>
  Effect.promise(() => fakes.list(...args)),
);
vi.spyOn(apiEffect, "startTraditionalChild").mockImplementation((...args) =>
  Effect.promise(() => fakes.start(...args)),
);
vi.spyOn(apiEffect, "cancelTraditionalChild").mockImplementation((...args) =>
  Effect.promise(() => fakes.cancel(...args)),
);
vi.spyOn(apiEffect, "getPermissions").mockImplementation(() =>
  Effect.promise(() => Promise.resolve({ approval_mode: "manual", requests: [], grants: [] })),
);

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
  const registry = isolatedRegistry();
  registry.set(traditionalChildrenAtom(SESSION_ID), AsyncResult.success(children));
  for (const record of children) {
    registry.set(
      sessionPermissionsAtom(record.child_session_id),
      AsyncResult.success({ approval_mode: "manual", requests: [], grants: [] }),
    );
  }
  return render(
    <RegistryContext.Provider value={registry}>
      <MemoryRouter>
        <ToastProvider>
          <ChildControls sessionId={SESSION_ID} behavior="direct" />
        </ToastProvider>
      </MemoryRouter>
    </RegistryContext.Provider>,
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
