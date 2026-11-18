/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TopSingleSessionHeader } from "@/app/components/inspector/TopSingleSessionHeader";

const fakes = vi.hoisted(() => ({
  phone: false,
  drawer: {
    open: false,
    panel: "files",
    close: vi.fn(),
    openPanel: vi.fn(),
  },
}));

vi.mock("@/app/features/session-chrome/useSessionDrawer", () => ({
  useSessionDrawer: () => fakes.drawer,
}));
vi.mock("@/app/features/session-chrome/useSessionFacts", () => ({
  useSessionFacts: () => ({
    title: "Fixture session",
    status: "idle",
    running: false,
    meta: [],
    parent: null,
    lineage: null,
  }),
}));
vi.mock("@/app/features/session-chrome/SessionMenu", () => ({
  SessionMenu: () => <button type="button">Session menu</button>,
}));
vi.mock("@/app/features/sidebar/useSidebar", () => ({
  SidebarToggle: () => null,
  useSidebar: () => ({ mode: "none", open: false }),
}));
vi.mock("@/app/features/terminal/terminalLinkMode", () => ({
  useTerminalLinkMode: () => "browser",
}));
vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => fakes.phone,
}));

beforeEach(() => {
  fakes.phone = false;
  fakes.drawer.open = false;
  fakes.drawer.close.mockReset();
  fakes.drawer.openPanel.mockReset();
});

afterEach(cleanup);

function mount() {
  return render(
    <MemoryRouter>
      <TopSingleSessionHeader sessionId="s1" snapshot={null} entry={null} panel="files" />
    </MemoryRouter>,
  );
}

it("opens the drawer on the route's panel from beside the Session menu", () => {
  mount();
  const toggle = screen.getByRole("button", { name: "Session panel" });
  expect(toggle.getAttribute("aria-pressed")).toBe("false");
  const menu = screen.getByRole("button", { name: "Session menu" });
  expect(menu.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.click(toggle);
  expect(fakes.drawer.openPanel).toHaveBeenCalledWith("files");
});

it("hides an open drawer", () => {
  fakes.drawer.open = true;
  mount();
  const toggle = screen.getByRole("button", { name: "Session panel" });
  expect(toggle.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(toggle);
  expect(fakes.drawer.close).toHaveBeenCalledOnce();
  expect(fakes.drawer.openPanel).not.toHaveBeenCalled();
});

it("leaves phones to the Session menu", () => {
  fakes.phone = true;
  mount();
  expect(screen.queryByRole("button", { name: "Session panel" })).toBeNull();
});
