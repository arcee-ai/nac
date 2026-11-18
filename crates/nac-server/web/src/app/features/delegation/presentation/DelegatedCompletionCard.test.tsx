/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { DelegatedCompletionCard } from "./DelegatedCompletionCard";
import { InsightsNavigationContext } from "@/app/features/insights/useInsightsNavigation";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import { sessionLayoutStore } from "@/app/store/sessionLayoutStore";
import type { DelegatedCompletionTurn } from "@/app/lib/transcript";

afterEach(() => {
  cleanup();
  sessionLayoutStore.setState({ selectedSubagents: new Map() });
});

function receipt(generation: number): DelegatedCompletionTurn {
  return {
    kind: "delegated-completion",
    key: `receipt-${generation}`,
    messageIndex: generation,
    createdAt: null,
    completion: {
      kind: "coding-agent",
      sessionId: "child",
      generation,
      status: generation === 1 ? "failed" : "completed",
      description: "Audit",
      outcome: `Outcome ${generation}`,
      changes: null,
      verification: null,
    },
  };
}
function mount(records: unknown[] | undefined, interactive = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (records) client.setQueryData(queryKeys.traditionalChildren("parent"), records);
  const focusPanel = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/session/parent/insights"]}>
        <InsightsNavigationContext.Provider
          value={{
            sessionId: "parent",
            panels: ["delegated"],
            focusPanel,
            detailFocusRef: { current: null },
          }}
        >
          <Routes>
            <Route
              path="/session/:sessionId/insights"
              element={
                <>
                  {[1, 2].map((n) => (
                    <DelegatedCompletionCard key={n} turn={receipt(n)} interactive={interactive} />
                  ))}
                </>
              }
            />
          </Routes>
        </InsightsNavigationContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return focusPanel;
}
it("keeps each historical outcome and selects the verified child in the parent panel", () => {
  const focus = mount([{ child_session_id: "child", generation: 2, status: "completed" }]);
  for (const n of [1, 2]) {
    const summary = screen.getByText(`Generation ${n} result`);
    fireEvent.click(summary);
    expect(summary.closest("details")?.textContent).toContain(`Outcome ${n}`);
  }
  expect(screen.getByText("Subagent · Generation 1 · failed")).toBeTruthy();
  fireEvent.click(screen.getAllByRole("button", { name: "Open Audit in Subagents" })[0]);
  expect(focus).toHaveBeenCalledWith("delegated");
  expect(sessionLayoutStore.getState().selectedSubagents.get("parent")).toBe("child:child");
  expect(screen.queryByRole("link")).toBeNull();
});
it("keeps deleted or unowned receipts readable without creating a target", () => {
  mount([]);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getAllByText("Session not found")).toHaveLength(2);
  fireEvent.click(screen.getByText("Generation 1 result"));
  expect(screen.getByText("Outcome 1")).toBeTruthy();
});
it("keeps preview receipts noninteractive", () => {
  mount([{ child_session_id: "child" }], false);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Generation 2 result")).toBeTruthy();
});

it("does not offer a target while inventory loads or after it fails", async () => {
  let reject!: (reason: Error) => void;
  const query = vi.spyOn(api, "listTraditionalChildren").mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  mount(undefined);
  expect(screen.getAllByText("Checking session…")).toHaveLength(2);
  expect(screen.queryByRole("button")).toBeNull();
  reject(new Error("offline"));
  await waitFor(() => expect(screen.getAllByText("Session unavailable")).toHaveLength(2));
  expect(screen.queryByRole("button")).toBeNull();
  query.mockRestore();
});
