/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionDrawer } from "./SessionDrawer";

const controls = vi.hoisted(() => ({
  pinned: false,
  expanded: false,
  close: vi.fn(),
  toggleExpanded: vi.fn(),
  togglePinned: vi.fn(),
  openPanel: vi.fn(),
}));
vi.mock("./useSessionDrawer", () => ({
  useSessionDrawer: () => ({ ...controls, open: true, content: "panel" }),
}));
vi.mock("@/app/components/inspector/SessionSideBox", () => ({
  SessionSideBox: () => (
    <div>
      <textarea aria-label="Panel draft" />
      <div className="xterm">
        <textarea aria-label="Terminal input" />
      </div>
    </div>
  ),
}));
beforeEach(() => {
  controls.pinned = false;
  controls.expanded = false;
  vi.clearAllMocks();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1280px)",
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount() {
  return render(
    <SessionDrawer
      sessionId="session"
      snapshot={null}
      behavior="direct"
      panel="insights"
      goalEnabled={false}
    />,
  );
}

it.each([false, true])("leaves IME and terminal Escape with the input (docked=%s)", (pinned) => {
  controls.pinned = pinned;
  mount();
  const draft = screen.getByRole("textbox", { name: "Panel draft" });
  fireEvent.keyDown(draft, { key: "Escape", isComposing: true });
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Terminal input" }), { key: "Escape" });
  expect(controls.close).not.toHaveBeenCalled();
  fireEvent.keyDown(draft, { key: "Escape" });
  expect(controls.close).toHaveBeenCalledOnce();
});

it("leaves full width through the shared Escape owner while keeping the drawer mounted", () => {
  controls.expanded = true;
  mount();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Panel draft" }), { key: "Escape" });
  expect(controls.toggleExpanded).toHaveBeenCalledOnce();
  expect(controls.close).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Insights" })).toBeTruthy();
});
