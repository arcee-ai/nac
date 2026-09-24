/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { SessionIdentity } from "@/app/components/inspector/SessionIdentity";

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

afterEach(cleanup);

describe("session identity", () => {
  it("leaves a primary session without a behavior strip", () => {
    const { container } = render(
      <MemoryRouter>
        <SessionIdentity behavior="direct-with-orchestrator" lineage={null} />
      </MemoryRouter>,
    );

    expect(container.textContent).toBe("");
    expect(screen.queryByText("Immutable behavior")).toBeNull();
  });

  it("identifies a child transcript and navigates back to its parent", () => {
    render(
      <MemoryRouter initialEntries={["/sessions/child"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <SessionIdentity
                  behavior="direct"
                  lineage={{
                    kind: "traditional-child",
                    parent_session_id: "parent",
                    root_session_id: "parent",
                    description: "Check the lifecycle seam",
                  }}
                />
                <Location />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole("navigation", { name: "Delegated session breadcrumb" })).toBeTruthy();
    expect(screen.getByText("Traditional coding agent")).toBeTruthy();
    expect(screen.getByText("Check the lifecycle seam")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Parent chat" }));
    expect(screen.getByTestId("location").textContent).toBe("/session/parent/delegated");
  });

  it("keeps managed-orchestrator lineage explicit alongside its behavior", () => {
    render(
      <MemoryRouter>
        <SessionIdentity
          behavior="orchestrator"
          lineage={{
            kind: "managed-orchestrator",
            parent_session_id: "parent",
            root_session_id: "parent",
            description: "Coordinate the release audit",
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Managed NAC orchestrator")).toBeTruthy();
    expect(screen.getByText("Coordinate the release audit")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Parent chat" })).toBeTruthy();
  });
});
