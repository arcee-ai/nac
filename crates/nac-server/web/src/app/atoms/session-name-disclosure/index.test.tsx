/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresentationBoundary } from "../../providers/PresentationBoundary";
import ChatSessionButton from "../chat-session-button";
import ChatSessionTab from "../chat-session-tab";
import ProjectButton, { ProjectButtonVariant } from "../project-button";
import SessionNameDisclosure from ".";

vi.mock("../../hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});
afterEach(cleanup);
const long = "same prefix ".repeat(12) + "雪🙂" + "x".repeat(180);
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <PresentationBoundary>{children}</PresentationBoundary>
    </MemoryRouter>
  );
}

describe("session name disclosure", () => {
  it.each([
    [
      "list",
      (name: string, navigate: () => void) => <ChatSessionButton title={name} onClick={navigate} />,
    ],
    [
      "tab",
      (name: string, navigate: () => void) => (
        <ChatSessionTab title={name} behaviorLabel="Direct coding agent" onClick={navigate} />
      ),
    ],
    [
      "orphan",
      (name: string, navigate: () => void) => (
        <ProjectButton
          entityId="a"
          name={name}
          variant={ProjectButtonVariant.Orphan}
          onClick={navigate}
        />
      ),
    ],
  ] as const)(
    "reveals and copies the current %s name without activating navigation",
    async (_, consumer) => {
      const navigate = vi.fn();
      const view = render(consumer(long, navigate), { wrapper: Wrapper });
      const row = screen.getByRole("button", { name: new RegExp("^same prefix") });
      expect(row.hasAttribute("title")).toBe(false);
      act(() => row.focus());
      expect(screen.getByRole("tooltip").textContent).toContain(long);
      expect(row.getAttribute("aria-describedby")).toBe(screen.getByRole("tooltip").id);
      fireEvent.keyDown(row, { key: "Escape" });
      expect(screen.queryByRole("tooltip")).toBeNull();
      const action = screen.getByRole("button", { name: "View full name" });
      act(() => action.focus());
      fireEvent.click(action);
      expect(
        screen.getByRole("dialog").querySelector("[data-full-session-name]")?.textContent,
      ).toBe(long);
      view.rerender(consumer("Renamed 雪🙂", navigate));
      expect(
        screen.getByRole("dialog").querySelector("[data-full-session-name]")?.textContent,
      ).toBe("Renamed 雪🙂");
      fireEvent.click(screen.getByRole("button", { name: "Copy name" }));
      await waitFor(() =>
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Renamed 雪🙂"),
      );
      expect(navigate).not.toHaveBeenCalled();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() => expect(document.activeElement).toBe(action));
      expect(screen.queryByRole("dialog")).toBeNull();
      fireEvent.click(action);
      view.unmount();
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  it("keeps overlays inside their consumer and closes on route changes", async () => {
    function Navigate() {
      const navigate = useNavigate();
      return <button onClick={() => navigate("/other")}>Navigate</button>;
    }
    const view = render(
      <>
        <SessionNameDisclosure name={long} />
        <Navigate />
      </>,
      { wrapper: Wrapper },
    );
    const trigger = screen.getByRole("button", { name: `View full name: ${long}` });
    act(() => trigger.focus());
    expect(screen.getByRole("tooltip").closest("[data-nac-overlays]")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog").closest("[data-nac-overlays]")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Navigate" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    view.unmount();
  });

  it("preserves selectable text when clipboard access fails", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("denied"));
    render(<SessionNameDisclosure name={long} />, { wrapper: Wrapper });
    const trigger = screen.getByRole("button", { name: `View full name: ${long}` });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Copy name" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Select the name"),
    );
    expect(screen.getByRole("dialog").querySelector("[data-full-session-name]")?.textContent).toBe(
      long,
    );
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });
});
