/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SessionDrawer } from "./SessionDrawer";

const controls = vi.hoisted(() => ({
  expanded: false,
  close: vi.fn(),
  toggleExpanded: vi.fn(),
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
  controls.expanded = false;
  vi.clearAllMocks();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1400);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(min-width: 1280px)",
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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

it.each([false, true])("leaves IME and terminal Escape with the input (docked=%s)", (docked) => {
  if (!docked) vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
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
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  mount();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Panel draft" }), { key: "Escape" });
  expect(controls.toggleExpanded).toHaveBeenCalledOnce();
  expect(controls.close).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Insights" })).toBeTruthy();
});

it("resizes the outer dock with keyboard and restores the preference after remount", async () => {
  const { setDockWidth } = await import("@/app/hooks/useDockWidth");
  setDockWidth(560);
  const view = mount();
  const separator = screen.getByRole("separator", { name: "Resize session panel" });
  expect(separator.getAttribute("aria-valuenow")).toBe("560");
  fireEvent.keyDown(separator, { key: "ArrowLeft", shiftKey: true });
  expect(separator.getAttribute("aria-valuenow")).toBe("610");
  view.unmount();
  mount();
  expect(
    screen.getByRole("separator", { name: "Resize session panel" }).getAttribute("aria-valuenow"),
  ).toBe("610");
});

it("keeps the split preference while focused and restores it", async () => {
  const { setDockWidth } = await import("@/app/hooks/useDockWidth");
  setDockWidth(620);
  const view = mount();
  controls.expanded = true;
  view.rerender(
    <SessionDrawer
      sessionId="other"
      snapshot={null}
      behavior="direct"
      panel="insights"
      goalEnabled={false}
    />,
  );
  expect(screen.queryByRole("separator", { name: "Resize session panel" })).toBeNull();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "Panel draft" }), { key: "Escape" });
  expect(controls.toggleExpanded).toHaveBeenCalledOnce();
  controls.expanded = false;
  view.rerender(
    <SessionDrawer
      sessionId="other"
      snapshot={null}
      behavior="direct"
      panel="insights"
      goalEnabled={false}
    />,
  );
  expect(
    screen.getByRole("separator", { name: "Resize session panel" }).getAttribute("aria-valuenow"),
  ).toBe("620");
});

it("falls back to a floating drawer when an embedded container is too narrow", () => {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
  mount();
  expect(screen.queryByRole("separator", { name: "Resize session panel" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Insights" })).toBeTruthy();
});

it("clamps keyboard resizing to useful panel and conversation widths", async () => {
  const { setDockWidth } = await import("@/app/hooks/useDockWidth");
  setDockWidth(560);
  mount();
  const separator = screen.getByRole("separator", { name: "Resize session panel" });
  fireEvent.keyDown(separator, { key: "End" });
  expect(separator.getAttribute("aria-valuenow")).toBe("940");
  fireEvent.keyDown(separator, { key: "Home" });
  expect(separator.getAttribute("aria-valuenow")).toBe("480");
});

it("resizes by pointer and stops at the container limit", async () => {
  const { setDockWidth } = await import("@/app/hooks/useDockWidth");
  setDockWidth(560);
  vi.stubGlobal(
    "PointerEvent",
    class extends MouseEvent {
      pointerId: number;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
      }
    },
  );
  const view = mount();
  const separator = screen.getByRole("separator", { name: "Resize session panel" });
  separator.setPointerCapture = vi.fn();
  separator.releasePointerCapture = vi.fn();
  fireEvent.pointerDown(separator, { button: 0, pointerId: 1, clientX: 800 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 200 });
  expect(separator.getAttribute("aria-valuenow")).toBe("940");
  fireEvent.pointerUp(window, { pointerId: 1 });
  fireEvent.pointerMove(window, { pointerId: 1, clientX: 900 });
  expect(separator.getAttribute("aria-valuenow")).toBe("940");
  view.unmount();
});

it("uses the floating fallback when container observation is unavailable", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  mount();
  expect(screen.queryByRole("separator", { name: "Resize session panel" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Insights" })).toBeTruthy();
});
