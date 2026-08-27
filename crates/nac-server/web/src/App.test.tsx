/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, useNavigate, useParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import App from "@/App";

vi.mock("@/app/components/AppShell", () => ({ AppShell: () => <Outlet /> }));
vi.mock("@/app/providers/ProjectActionsProvider", () => ({
  ProjectActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/providers/SessionActionsProvider", () => ({
  SessionActionsProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/features/managed/controller/ManagedHostProvider", () => ({
  ManagedHostProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/providers/ToastProvider", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/app/components/pages/DesignPreviewPage", () => ({ default: () => null }));
vi.mock("@/app/components/pages/ProjectRedirectPage", () => ({ default: () => null }));
vi.mock("@/app/components/pages/ProjectsListPage", () => ({ default: () => null }));
vi.mock("@/app/components/pages/SessionPage", () => ({
  default: function SessionPageMock() {
    const { sessionId } = useParams<{ sessionId: string }>();
    const navigate = useNavigate();
    return (
      <>
        <output data-testid="session-id">{sessionId}</output>
        <input aria-label="Draft" defaultValue="" />
        <button onClick={() => navigate("/session/session-b")}>Open session B</button>
      </>
    );
  },
}));

afterEach(cleanup);

describe("session routing", () => {
  it("remounts the complete session page when the session id changes", () => {
    render(
      <MemoryRouter initialEntries={["/session/session-a"]}>
        <App />
      </MemoryRouter>,
    );

    const draft = screen.getByRole("textbox", { name: "Draft" });
    fireEvent.change(draft, { target: { value: "session A draft" } });
    expect((draft as HTMLInputElement).value).toBe("session A draft");

    fireEvent.click(screen.getByRole("button", { name: "Open session B" }));
    expect(screen.getByTestId("session-id").textContent).toBe("session-b");
    expect((screen.getByRole("textbox", { name: "Draft" }) as HTMLInputElement).value).toBe("");
  });
});
