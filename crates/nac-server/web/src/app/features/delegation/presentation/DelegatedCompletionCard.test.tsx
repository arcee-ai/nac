/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DelegatedCompletionCard } from "@/app/features/delegation/presentation/DelegatedCompletionCard";
import { InsightsNavigationContext } from "@/app/features/insights/useInsightsNavigation";
import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { ORCHESTRATION_UI_POLICY } from "@/app/features/ui-policy/policy";
import { sessionLayoutStore } from "@/app/store/sessionLayoutStore";

afterEach(() => {
  cleanup();
  sessionLayoutStore.setState({ selectedSubagents: new Map() });
});

describe("delegated completion card", () => {
  it("renders the child's status card with its links and without user/model actions", () => {
    const focusPanel = vi.fn();
    render(
      <MemoryRouter>
        <UiPolicyContext.Provider value={ORCHESTRATION_UI_POLICY}>
          <InsightsNavigationContext.Provider
            value={{
              sessionId: "parent-1",
              panels: ["insights", "delegated"],
              focusPanel,
              detailFocusRef: { current: null },
            }}
          >
            <DelegatedCompletionCard
              turn={{
                kind: "delegated-completion",
                key: "event-1",
                messageIndex: 9,
                createdAt: null,
                completion: {
                  kind: "coding-agent",
                  sessionId: "child/exact",
                  generation: 2,
                  status: "completed",
                  description: "Audit persistence",
                  outcome: "All checks passed",
                  changes: null,
                  verification: "Vitest passed",
                },
              }}
            />
          </InsightsNavigationContext.Provider>
        </UiPolicyContext.Provider>
      </MemoryRouter>,
    );

    expect(screen.getByRole("status", { name: "Coding agent completed" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Regenerate from original prompt" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revert to this snapshot" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create fork" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Go to session Audit persistence" }).getAttribute("href"),
    ).toBe("/session/child%2Fexact/insights");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open Audit persistence in Subagents, Coding agent",
      }),
    );
    expect(focusPanel).toHaveBeenCalledWith("delegated");
    expect(sessionLayoutStore.getState().selectedSubagents.get("parent-1")).toBe(
      "child:child/exact",
    );
  });
});

function CurrentRoute() {
  return <output aria-label="Route">{useLocation().pathname}</output>;
}

it.each([
  { interactive: true, orchestrationEnabled: true },
  { interactive: false, orchestrationEnabled: true },
  { interactive: true, orchestrationEnabled: false },
  { interactive: false, orchestrationEnabled: false },
])(
  "keeps generation reports reachable with interactive=$interactive and orchestration=$orchestrationEnabled",
  ({ interactive, orchestrationEnabled }) => {
    render(
      <MemoryRouter>
        <UiPolicyContext.Provider value={{ orchestrationEnabled }}>
          {[1, 2].map((generation) => (
            <DelegatedCompletionCard
              key={generation}
              interactive={interactive}
              turn={{
                kind: "delegated-completion",
                key: `event-${generation}`,
                messageIndex: generation,
                createdAt: null,
                completion: {
                  kind: "nac-orchestrator",
                  sessionId: "orchestrator",
                  generation,
                  status: "failed",
                  description: "Plan changes",
                  outcome: `Failure generation ${generation}`,
                  changes: `Changes generation ${generation}`,
                  verification: `Checks generation ${generation}`,
                },
              }}
            />
          ))}
        </UiPolicyContext.Provider>
      </MemoryRouter>,
    );
    for (const generation of [1, 2]) {
      const summary = screen.getByText(`Generation ${generation} result`);
      fireEvent.click(summary);
      const details = summary.closest("details")!;
      expect(details.textContent).toContain(`Failure generation ${generation}`);
      expect(details.textContent).toContain(`Changes: Changes generation ${generation}`);
      expect(details.textContent).toContain(`Verification: Checks generation ${generation}`);
    }
    expect(screen.queryAllByRole("link")).toHaveLength(interactive && orchestrationEnabled ? 2 : 0);
  },
);

it("keeps completion links inside a hosted MemoryRouter", () => {
  render(
    <MemoryRouter initialEntries={["/session/parent/insights"]}>
      <CurrentRoute />
      <DelegatedCompletionCard
        turn={{
          kind: "delegated-completion",
          key: "event",
          messageIndex: 1,
          createdAt: null,
          completion: {
            kind: "coding-agent",
            sessionId: "child",
            generation: 1,
            status: "completed",
            description: "Audit",
            outcome: null,
            changes: null,
            verification: null,
          },
        }}
      />
    </MemoryRouter>,
  );
  const link = screen.getByRole("link", { name: "Go to session Audit" });
  const modified = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
  let routerPrevented = true;
  const stopBrowserNavigation = (event: MouseEvent) => {
    routerPrevented = event.defaultPrevented;
    event.preventDefault();
  };
  document.addEventListener("click", stopBrowserNavigation, { once: true });
  fireEvent(link, modified);
  expect(routerPrevented).toBe(false);
  expect(screen.getByRole("status", { name: "Route" }).textContent).toBe(
    "/session/parent/insights",
  );
  fireEvent.click(link);
  expect(screen.getByRole("status", { name: "Route" }).textContent).toBe("/session/child/insights");
});
