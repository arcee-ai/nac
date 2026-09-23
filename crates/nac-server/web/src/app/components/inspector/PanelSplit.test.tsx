/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelSplit } from "@/app/components/inspector/PanelSplit";
import { sessionLayoutStore } from "@/app/store/sessionLayoutStore";

const viewport = vi.hoisted(() => ({ mobile: false, tablet: false }));

vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => viewport.mobile,
  useIsTablet: () => viewport.tablet,
}));
vi.mock("@/app/hooks/usePanelListWidth", () => ({
  PANEL_LIST_MAX_RATIO: 0.5,
  PANEL_LIST_MIN_WIDTH: 160,
  clampPanelListWidth: (width: number) => width,
  setPanelListWidth: vi.fn(),
  usePanelListWidth: () => 208,
}));

class ResizeObserverStub {
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  viewport.mobile = false;
  viewport.tablet = false;
  sessionLayoutStore.setState({ panelList: false });
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSplit() {
  return render(
    <MemoryRouter>
      <PanelSplit
        list={<div>action rows</div>}
        listTitle="Actions"
        title="Thoughts and tools"
        listClassName="timeline-list"
      >
        <div>action detail</div>
      </PanelSplit>
    </MemoryRouter>,
  );
}

describe("PanelSplit responsive action list", () => {
  it("keeps timeline headers flush in the desktop split", () => {
    renderSplit();
    expect(screen.getByRole("separator", { name: "Resize list panel" })).toBeTruthy();
    expect(screen.getByText("action rows").parentElement?.className).toContain("timeline-list");
    expect(screen.getByText("action detail")).toBeTruthy();
  });

  it("preserves the tablet list/detail switch", () => {
    viewport.tablet = true;
    renderSplit();
    expect(screen.queryByText("action rows")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open list" }));
    expect(screen.getByText("action rows").parentElement?.className).toContain("timeline-list");
    expect(screen.queryByText("action detail")).toBeNull();
  });

  it("keeps the phone list in its existing overlay", () => {
    viewport.mobile = true;
    sessionLayoutStore.setState({ panelList: true });
    renderSplit();
    expect(screen.getByText("action rows").parentElement?.className).toContain("timeline-list");
    expect(screen.getByText("action detail")).toBeTruthy();
  });
});
