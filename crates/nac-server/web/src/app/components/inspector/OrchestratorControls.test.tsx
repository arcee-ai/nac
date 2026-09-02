/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrchestratorControls } from "@/app/components/inspector/OrchestratorControls";
import { ToastProvider } from "@/app/providers/ToastProvider";

const SESSION_ID = "delegating-session";

function mount(behavior: "direct" | "direct-with-orchestrator" | "orchestrator" = "direct") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <OrchestratorControls sessionId={SESSION_ID} behavior={behavior} />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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
  it("does not expose a composer launch control", () => {
    mount();
    expect(screen.queryByRole("button", { name: "Launch orchestrator" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Start orchestrator" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
