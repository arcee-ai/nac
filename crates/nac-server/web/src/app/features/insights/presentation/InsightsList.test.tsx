/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { ActionListButtonStatus, IconName } from "@/app/atoms";
import { InsightsNavigationProvider } from "../InsightsNavigationProvider";
import type { InsightTurnSection } from "../model/types";
import { InsightsList } from "./InsightsList";
import { InsightsReturnButton } from "./InsightsReturnButton";
import type { InsightsRowController } from "./InsightsTurnSection";
import type { SessionPanel } from "@/app/lib/routes";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { createSessionLayoutStore } from "@/app/store/sessionLayoutStore";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false, useIsTablet: () => true }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const selection = { kind: "group", groupId: "saved-action", segmentKey: null } as const;
const sections: InsightTurnSection[] = [
  {
    key: "turn",
    ordinal: 1,
    promptPreview: "Review changes",
    createdAt: null,
    entries: [
      {
        kind: "group",
        id: "saved-action",
        group: { id: "saved-action", segments: [], status: "ready", durationMs: null },
      },
    ],
  },
];
const view = () => ({
  icon: IconName.ReadFile,
  label: "Saved action",
  status: ActionListButtonStatus.Ready,
});
const controller: InsightsRowController = {
  expanded: new Set(),
  entryView: view,
  segmentView: view,
  entrySelected: () => true,
  segmentSelected: () => false,
  entryShown: () => true,
  segmentShown: () => false,
  entryAction: () => () => {},
  segmentAction: () => null,
};

it("restores the reader's list position and keyboard focus on a narrow Back round trip", async () => {
  const layout = createSessionLayoutStore();
  layout.selectInsight(selection);
  layout.showSidePanelList(true);
  function Surface() {
    const [panel, setPanel] = useState<SessionPanel>("insights");
    return (
      <InsightsNavigationProvider
        sessionId="parent"
        panels={["insights", "delegated"]}
        focusPanel={setPanel}
      >
        {panel === "insights" ? (
          <>
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
                sections={sections}
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
    );
  }
  render(
    <RuntimeContext
      value={{
        ...standaloneRuntime,
        stores: { ...standaloneRuntime.stores, sessionLayoutStore: layout },
      }}
    >
      <Surface />
    </RuntimeContext>,
  );
  screen.getByTestId("scroller").scrollTop = 248;
  fireEvent.scroll(screen.getByTestId("scroller"));
  fireEvent.click(screen.getByText("Inspect child"));
  layout.selectInsight({ kind: "group", groupId: "new-action", segmentKey: null });
  fireEvent.click(screen.getByRole("button", { name: "Back to Insights" }), { detail: 0 });
  expect(screen.getByTestId("scroller").scrollTop).toBe(248);
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Saved action" })),
  );
});

it("does not apply an old scroll position after an explicit new pick", () => {
  const layout = createSessionLayoutStore();
  layout.selectInsight(selection);
  layout.rememberInsightListPosition("parent", 248);
  layout.selectInsight(selection); // Even reactivating the same detail is a fresh explicit jump.
  render(
    <RuntimeContext
      value={{
        ...standaloneRuntime,
        stores: { ...standaloneRuntime.stores, sessionLayoutStore: layout },
      }}
    >
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <InsightsList
          sessionId="parent"
          sections={sections}
          pendingPrompt=""
          emptyCopy={{ title: "None", body: "None" }}
          focusNonce={2}
          controller={controller}
        />
      </div>
    </RuntimeContext>,
  );
  expect(screen.getByTestId("scroller").scrollTop).toBe(0);
});

it.each([false, true])(
  "keeps the original row offset after a prepended turn and label update (segment=%s)",
  (segmentPick) => {
    const layout = createSessionLayoutStore();
    const origin = { ...selection, segmentKey: segmentPick ? "picked-segment" : null };
    layout.selectInsight(origin);
    layout.showSidePanelList(true);
    let prepend = false;
    const newer: InsightTurnSection = {
      ...sections[0],
      key: "new-turn",
      promptPreview: "New streamed prompt",
      entries: [
        {
          kind: "group",
          id: "new-action",
          group: { id: "new-action", segments: [], status: "ready", durationMs: null },
        },
      ],
    };
    const originalSections: InsightTurnSection[] = segmentPick
      ? [
          {
            ...sections[0],
            entries: [
              {
                kind: "group",
                id: "saved-action",
                group: {
                  id: "saved-action",
                  status: "ready",
                  durationMs: null,
                  segments: ["picked-segment", "other-segment"].map((key) => ({
                    kind: "tool",
                    key,
                    name: "read",
                    action: "read-file",
                    presentation: null,
                    pending: false,
                  })),
                },
              },
            ],
          },
        ]
      : sections;
    const targetName = () =>
      segmentPick
        ? prepend
          ? "Updated segment"
          : "Saved segment"
        : prepend
          ? "Updated action"
          : "Saved action";
    const rows: InsightsRowController = {
      ...controller,
      expanded: new Set(segmentPick ? ["saved-action"] : []),
      segmentView: (segment) => ({
        ...view(),
        label:
          segment.key === "picked-segment"
            ? prepend
              ? "Updated segment"
              : "Saved segment"
            : "Other segment",
      }),
      segmentShown: (_entry, segment) => segment.key === "picked-segment",
      segmentSelected: (_entry, segment) => segment.key === "picked-segment",
      entryView: (entry) => ({
        ...view(),
        label:
          entry.id === "new-action" ? "New action" : prepend ? "Updated action" : "Saved action",
      }),
      entryShown: (entry) => entry.id === "saved-action",
      entrySelected: (entry) => entry.id === "saved-action",
    };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const scroller = this.closest<HTMLElement>('[data-testid="scroller"]');
        if (this === scroller) return new DOMRect(0, 100, 300, 200);
        if (this.matches("button[data-shown]") && scroller) {
          // A new turn contributes a heading and row above the retained action.
          const added = scroller.querySelector('button[aria-label="New action"]') ? 96 : 0;
          const contentTop =
            segmentPick && !(this.getAttribute("aria-label") ?? "").includes("segment") ? 264 : 300;
          return new DOMRect(0, 100 + contentTop + added - scroller.scrollTop, 300, 36);
        }
        return new DOMRect();
      },
    );
    function Surface() {
      const [panel, setPanel] = useState<SessionPanel>("insights");
      return (
        <InsightsNavigationProvider
          sessionId="parent"
          panels={["insights", "delegated"]}
          focusPanel={setPanel}
        >
          {panel === "insights" ? (
            <>
              <button
                onClick={() => {
                  layout.rememberInsightsReturn("parent", origin);
                  setPanel("delegated");
                }}
              >
                Inspect child
              </button>
              <div data-testid="scroller" style={{ overflowY: "auto" }}>
                <InsightsList
                  sessionId="parent"
                  sections={prepend ? [newer, ...originalSections] : originalSections}
                  pendingPrompt=""
                  emptyCopy={{ title: "None", body: "None" }}
                  focusNonce={layout.sessionLayoutStore.getState().insightFocusNonce}
                  controller={rows}
                />
              </div>
            </>
          ) : (
            <InsightsReturnButton sessionId="parent" />
          )}
        </InsightsNavigationProvider>
      );
    }
    render(
      <RuntimeContext
        value={{
          ...standaloneRuntime,
          stores: { ...standaloneRuntime.stores, sessionLayoutStore: layout },
        }}
      >
        <Surface />
      </RuntimeContext>,
    );
    const scroller = screen.getByTestId("scroller");
    scroller.scrollTop = 248;
    fireEvent.scroll(scroller);
    const originalOffset =
      screen.getByRole("button", { name: targetName() }).getBoundingClientRect().top -
      scroller.getBoundingClientRect().top;
    fireEvent.click(screen.getByText("Inspect child"));
    prepend = true;
    fireEvent.click(screen.getByRole("button", { name: "Back to Insights" }));
    const restoredOffset =
      screen.getByRole("button", { name: targetName() }).getBoundingClientRect().top -
      screen.getByTestId("scroller").getBoundingClientRect().top;
    expect(restoredOffset).toBe(originalOffset);
    expect(layout.sessionLayoutStore.getState().selectedInsight).toEqual(origin);
  },
);

it("does not reuse an old list position when a fresh parent visit reuses the same pick nonce", () => {
  const layout = createSessionLayoutStore();
  layout.activateSessionSelection("parent");
  layout.selectInsight(selection);
  layout.rememberInsightListPosition("parent", 248);
  layout.activateSessionSelection("other");
  layout.activateSessionSelection("parent");
  layout.selectInsight(selection);
  render(
    <RuntimeContext
      value={{
        ...standaloneRuntime,
        stores: { ...standaloneRuntime.stores, sessionLayoutStore: layout },
      }}
    >
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <InsightsList
          sessionId="parent"
          sections={sections}
          pendingPrompt=""
          emptyCopy={{ title: "None", body: "None" }}
          focusNonce={1}
          controller={controller}
        />
      </div>
    </RuntimeContext>,
  );
  expect(screen.getByTestId("scroller").scrollTop).toBe(0);
});

it("keeps the numeric fallback when the saved row's identity is unavailable", () => {
  const layout = createSessionLayoutStore();
  layout.selectInsight(selection);
  layout.rememberInsightListPosition("parent", 248, {
    key: "unavailable-original-row",
    offset: 52,
  });
  render(
    <RuntimeContext
      value={{
        ...standaloneRuntime,
        stores: { ...standaloneRuntime.stores, sessionLayoutStore: layout },
      }}
    >
      <div data-testid="scroller" style={{ overflowY: "auto" }}>
        <InsightsList
          sessionId="parent"
          sections={sections}
          pendingPrompt=""
          emptyCopy={{ title: "None", body: "None" }}
          focusNonce={1}
          controller={controller}
        />
      </div>
    </RuntimeContext>,
  );
  expect(screen.getByTestId("scroller").scrollTop).toBe(248);
});

it("does not let unmount stamp the old DOM position as a new explicit pick", () => {
  const layout = createSessionLayoutStore();
  layout.selectInsight(selection);
  const next = { ...selection, groupId: "new-action" };
  const all = [
    {
      ...sections[0],
      entries: [
        ...sections[0].entries,
        {
          ...sections[0].entries[0],
          id: "new-action",
          group: { id: "new-action", segments: [], status: "ready" as const, durationMs: null },
        },
      ],
    },
  ] as InsightTurnSection[];
  function Surface() {
    const [visible, setVisible] = useState(true);
    const selected = layout.sessionLayoutStore.getState().selectedInsight;
    const current: InsightsRowController = {
      ...controller,
      entryView: (entry) => ({
        ...view(),
        label: entry.id === "new-action" ? "New action" : "Saved action",
      }),
      entryShown: (entry) => selected?.kind === "group" && entry.id === selected.groupId,
      entrySelected: (entry) => selected?.kind === "group" && entry.id === selected.groupId,
    };
    return (
      <>
        {visible ? (
          <>
            <button
              onClick={() => {
                layout.selectInsight(next);
                setVisible(false);
              }}
            >
              Open different action
            </button>
            <div data-testid="scroller" style={{ overflowY: "auto" }}>
              <InsightsList
                sessionId="parent"
                sections={all}
                pendingPrompt=""
                emptyCopy={{ title: "None", body: "None" }}
                focusNonce={layout.sessionLayoutStore.getState().insightFocusNonce}
                controller={current}
              />
            </div>
          </>
        ) : (
          <button onClick={() => setVisible(true)}>Show list</button>
        )}
      </>
    );
  }
  render(
    <RuntimeContext
      value={{
        ...standaloneRuntime,
        stores: { ...standaloneRuntime.stores, sessionLayoutStore: layout },
      }}
    >
      <Surface />
    </RuntimeContext>,
  );
  screen.getByTestId("scroller").scrollTop = 248;
  fireEvent.scroll(screen.getByTestId("scroller"));
  fireEvent.click(screen.getByText("Open different action"));
  fireEvent.click(screen.getByText("Show list"));
  expect(screen.getByRole("button", { name: "New action" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(screen.getByTestId("scroller").scrollTop).toBe(0);
});
