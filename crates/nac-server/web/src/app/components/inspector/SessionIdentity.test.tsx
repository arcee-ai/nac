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
  it("always labels the immutable primary-session behavior", () => {
    render(
      <MemoryRouter>
        <SessionIdentity behavior="direct-with-orchestrator" lineage={null} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Immutable behavior")).toBeTruthy();
    expect(screen.getByText("Direct + NAC orchestration")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Back to Parent" })).toBeNull();
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

    expect(screen.getByText(/Traditional coding agent · Check the lifecycle seam/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to Parent" }));
    expect(screen.getByTestId("location").textContent).toBe("/session/parent/threads");
  });
});
