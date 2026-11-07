/** @vitest-environment jsdom */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ActionListButtonStatus, IconName } from "@/app/atoms";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { createSessionLayoutStore } from "@/app/store/sessionLayoutStore";
import { InsightsNavigationProvider } from "../InsightsNavigationProvider";
import type { InsightTurnSection } from "../model/types";
import { InsightsNavigationContext } from "../useInsightsNavigation";
import { InsightsList } from "./InsightsList";
import { InsightsReturnButton } from "./InsightsReturnButton";
import type { InsightsRowController } from "./InsightsTurnSection";
import type { SessionPanel } from "@/app/lib/routes";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useIsTablet: () => true }));
const selection = { kind: "group", groupId: "action", segmentKey: null } as const;
const sections: InsightTurnSection[] = [
  {
    key: "turn",
    ordinal: 1,
    promptPreview: "Inspect",
    createdAt: null,
    entries: [
      {
        kind: "group",
        id: "action",
        group: {
          id: "action",
          segments: [],
          status: "ready",
          durationMs: null,
        },
      },
    ],
  },
];
const controller: InsightsRowController = {
  expanded: new Set(),
  entryView: () => ({
    icon: IconName.ReadFile,
    label: "Saved action",
    status: ActionListButtonStatus.Ready,
  }),
  segmentView: () => ({
    icon: IconName.ReadFile,
    label: "Segment",
    status: ActionListButtonStatus.Ready,
  }),
  entrySelected: () => true,
  segmentSelected: () => false,
  entryShown: () => true,
  segmentShown: () => false,
  entryAction: () => () => {},
  segmentAction: () => null,
};
let rowShift = 0;
beforeEach(() => {
  rowShift = 0;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const scroller = this.closest<HTMLElement>('[data-testid="scroller"]');
      if (this === scroller) return new DOMRect(0, 40, 300, 200);
      if (this.matches("button[data-shown]") && this.isConnected && scroller)
        return new DOMRect(0, 350 + rowShift - scroller.scrollTop, 280, 24);
      return new DOMRect();
    },
  );
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.dataset.testid === "scroller" ? 200 : 0;
    },
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function surface(
  layout: ReturnType<typeof createSessionLayoutStore>,
  rows: readonly InsightTurnSection[],
  nonce: number,
) {
  return (
    <RuntimeContext
      value={{
        ...standaloneRuntime,
        stores: { ...standaloneRuntime.stores, sessionLayoutStore: layout },
      }}
    >
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <InsightsList
          sessionId="parent"
          sections={rows}
          pendingPrompt=""
          emptyCopy={{ title: "None", body: "None" }}
          focusNonce={nonce}
          controller={controller}
        />
      </div>
    </RuntimeContext>
  );
}

it("captures a list that first gains rows, then restores its child and keyboard Back origin", async () => {
  const layout = createSessionLayoutStore();
  layout.selectInsight(selection);
  layout.showSidePanelList(true);
  function Surface() {
    const [rows, setRows] = useState<readonly InsightTurnSection[]>([]);
    const [panel, setPanel] = useState<SessionPanel>("insights");
    return (
      <RuntimeContext
        value={{
          ...standaloneRuntime,
          stores: { ...standaloneRuntime.stores, sessionLayoutStore: layout },
        }}
      >
        <InsightsNavigationProvider
          sessionId="parent"
          panels={["insights", "delegated"]}
          focusPanel={setPanel}
        >
          {panel === "insights" ? (
            <>
              <button onClick={() => setRows(sections)}>Populate</button>
              <button
                onClick={() => {
                  layout.rememberInsightsReturn("parent", selection);
                  setPanel("delegated");
                }}
              >
                Inspect child
              </button>
              <div data-testid="scroller" style={{ overflowY: "auto" }}>
                <InsightsList
                  sessionId="parent"
                  sections={rows}
                  pendingPrompt=""
                  emptyCopy={{ title: "None", body: "None" }}
                  focusNonce={layout.sessionLayoutStore.getState().insightFocusNonce}
                  controller={controller}
                />
              </div>
            </>
          ) : (
            <InsightsReturnButton sessionId="parent" />
          )}
        </InsightsNavigationProvider>
      </RuntimeContext>
    );
  }
  render(<Surface />);
  fireEvent.click(screen.getByText("Populate"));
  const scroller = screen.getByTestId("scroller");
  scroller.scrollTop = 245;
  fireEvent.scroll(scroller);
  expect(layout.sessionLayoutStore.getState().insightListPositions.get("parent")?.top).toBe(245);
  fireEvent.click(screen.getByText("Inspect child"));
  layout.selectInsight({ ...selection, groupId: "later-action" });
  fireEvent.click(screen.getByRole("button", { name: "Back to Insights" }), { detail: 0 });
  expect(screen.getByTestId("scroller").scrollTop).toBe(245);
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Saved action" })),
  );
});

it("remembers the current row anchor after populated, empty and populated renders", () => {
  const layout = createSessionLayoutStore();
  layout.selectInsight(selection);
  const rendered = render(surface(layout, sections, 1));
  const first = screen.getByRole("button", { name: "Saved action" });
  rendered.rerender(surface(layout, [], 1));
  expect(first.isConnected).toBe(false);
  rendered.rerender(surface(layout, sections, 1));
  const scroller = screen.getByTestId("scroller");
  scroller.scrollTop = 245;
  fireEvent.scroll(scroller);
  expect(layout.sessionLayoutStore.getState().insightListPositions.get("parent")?.anchor).toEqual({
    key: JSON.stringify(["entry", "group", "action"]),
    offset: 65,
  });
});

it("keeps keyboard return intent pending until its list becomes available", async () => {
  const layout = createSessionLayoutStore();
  layout.showSidePanelList(true);
  const returnFocusRef = { current: true };
  const detailFocusRef = { current: selection as typeof selection | null };
  const content = (rows: readonly InsightTurnSection[]) => (
    <InsightsNavigationContext.Provider
      value={{
        sessionId: "parent",
        panels: ["insights"],
        focusPanel: () => {},
        returnFocusRef,
        detailFocusRef,
      }}
    >
      {surface(layout, rows, 0)}
    </InsightsNavigationContext.Provider>
  );
  const rendered = render(content([]));
  await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  expect(returnFocusRef.current).toBe(true);
  rendered.rerender(content(sections));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Saved action" })),
  );
  expect(returnFocusRef.current).toBe(false);
  expect(detailFocusRef.current).toBeNull();
});

it("reveals an explicit pick made while empty without restoring on later nonempty updates", () => {
  const layout = createSessionLayoutStore();
  layout.selectInsight(selection);
  const rendered = render(surface(layout, [], 1));
  layout.selectInsight(selection);
  rendered.rerender(surface(layout, [], 2));
  rendered.rerender(surface(layout, sections, 2));
  const scroller = screen.getByTestId("scroller");
  expect(scroller.scrollTop).toBeGreaterThan(0);
  scroller.scrollTop = 260;
  fireEvent.scroll(scroller);
  rowShift = 80; // A streamed turn reflows existing rows without a new explicit pick.
  rendered.rerender(
    surface(
      layout,
      [{ ...sections[0], promptPreview: "Streamed update", entries: [...sections[0].entries] }],
      2,
    ),
  );
  expect(scroller.scrollTop).toBe(260);
});
