/** @vitest-environment jsdom */

import { useEffect } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelRow, PanelSplit } from "@/app/components/inspector/PanelSplit";
import * as panelWidth from "@/app/hooks/usePanelListWidth";
import * as layout from "@/app/store/sessionLayoutStore";

const viewport = vi.hoisted(() => ({ mobile: false, tablet: false }));
vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => viewport.mobile,
  useIsTablet: () => viewport.tablet,
}));

let width = 215;
const observers = new Set<() => void>();
const mountDetail = vi.fn();
const unmountDetail = vi.fn();

function resize(next: number) {
  act(() => {
    width = next;
    observers.forEach((measure) => measure());
  });
}

function Detail() {
  useEffect(() => {
    mountDetail();
    return unmountDetail;
  }, []);
  return (
    <section aria-label="Selected detail">
      <p>Read the selected action before changing its context.</p>
      <textarea aria-label="Detail draft" defaultValue="Unsent draft" />
      <button>Copy Reasoning</button>
    </section>
  );
}

function Inspector() {
  const selected = layout.useSelectedInsight();
  const savedWidth = panelWidth.usePanelListWidth();
  return (
    <>
      <output aria-label="Saved list width">{savedWidth ?? "default"}</output>
      <PanelSplit
        title="Selected action"
        listTitle="Actions"
        list={
          <PanelRow
            label="Original action"
            active={selected?.kind === "group" && selected.groupId === "original"}
            onClick={() => {
              layout.selectInsight({ kind: "group", groupId: "original", segmentKey: "spawn" });
              layout.showSidePanelList(false);
            }}
          />
        }
      >
        <Detail />
      </PanelSplit>
    </>
  );
}

beforeEach(() => {
  viewport.mobile = false;
  viewport.tablet = false;
  width = 215;
  observers.clear();
  mountDetail.mockClear();
  unmountDetail.mockClear();
  panelWidth.release();
  layout.release();
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => width);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private measure: () => void) {}
      observe() {
        observers.add(this.measure);
      }
      disconnect() {
        observers.delete(this.measure);
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("inspector container layout", () => {
  it("makes a narrow desktop detail usable without Expand and preserves its draft and scroll on list return", () => {
    render(<Inspector />);
    const detail = screen.getByRole("region", { name: "Selected detail" });
    detail.scrollTop = 124;
    fireEvent.change(screen.getByRole("textbox", { name: "Detail draft" }), {
      target: { value: "Reader-owned draft" },
    });
    expect(screen.getByRole("button", { name: "Copy Reasoning" })).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open list" }));
    expect(screen.queryByRole("region", { name: "Selected detail" })).toBeNull();
    expect(detail.closest("[inert]")?.hasAttribute("hidden")).toBe(true);
    expect(screen.getByRole("button", { name: "Original action" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Close list" }));

    expect(screen.getByRole("region", { name: "Selected detail" })).toBe(detail);
    expect(
      (screen.getByRole("textbox", { name: "Detail draft" }) as HTMLTextAreaElement).value,
    ).toBe("Reader-owned draft");
    expect(detail.scrollTop).toBe(124);
    expect(mountDetail).toHaveBeenCalledTimes(1);
    expect(unmountDetail).not.toHaveBeenCalled();
  });

  it("keeps the normal 480px outer desktop panel split at 479px content and preserves context across resizes", () => {
    // SessionSideBox's existing 1px border is outside PanelSplit's clientWidth.
    width = 480 - 1;
    layout.activateSessionSelection("parent");
    layout.selectInsight({ kind: "group", groupId: "original", segmentKey: "spawn" });
    layout.selectInsightsFilter("tools");
    layout.rememberInsightListPosition("parent", 248);
    layout.rememberInsightsReturn("parent", {
      kind: "group",
      groupId: "original",
      segmentKey: "spawn",
    });
    const before = layout.sessionLayoutStore.getState();
    render(<Inspector />);
    const detail = screen.getByRole("region", { name: "Selected detail" });
    detail.scrollTop = 124;
    fireEvent.change(screen.getByRole("textbox", { name: "Detail draft" }), {
      target: { value: "Boundary draft" },
    });
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("208");
    expect(
      screen.getByRole("button", { name: "Original action" }).getAttribute("aria-pressed"),
    ).toBe("true");
    resize(480);
    expect(screen.queryByRole("button", { name: "Open list" })).toBeNull();
    resize(479);
    expect(screen.queryByRole("button", { name: "Open list" })).toBeNull();
    resize(478);
    expect(screen.getByRole("button", { name: "Open list" })).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open list" }));
    expect(screen.queryByRole("region", { name: "Selected detail" })).toBeNull();
    expect(detail.closest("[inert]")?.hasAttribute("hidden")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close list" }));
    resize(479);
    expect(screen.queryByRole("button", { name: "Open list" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Original action" }).getAttribute("aria-pressed"),
    ).toBe("true");
    resize(900);
    expect(screen.queryByRole("button", { name: "Open list" })).toBeNull();
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("300");
    expect(screen.getByRole("region", { name: "Selected detail" })).toBe(detail);
    expect(detail.scrollTop).toBe(124);
    expect(
      (screen.getByRole("textbox", { name: "Detail draft" }) as HTMLTextAreaElement).value,
    ).toBe("Boundary draft");
    const after = layout.sessionLayoutStore.getState();
    expect(after).toMatchObject({
      selectedInsight: { kind: "group", groupId: "original", segmentKey: "spawn" },
      insightsFilter: "tools",
      insightSelectionEpoch: before.insightSelectionEpoch,
      insightFocusNonce: before.insightFocusNonce,
    });
    expect(after.insightsReturns).toBe(before.insightsReturns);
    expect(after.insightListPositions).toBe(before.insightListPositions);
    expect(after.insightListPositions.get("parent")?.top).toBe(248);
    expect(mountDetail).toHaveBeenCalledTimes(1);
    expect(unmountDetail).not.toHaveBeenCalled();
  });

  it("reserves 240px for detail without overwriting a saved list width when its container shrinks", () => {
    width = 1200;
    panelWidth.setPanelListWidth(600);
    render(<Inspector />);
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("600");
    resize(479);
    const separator = screen.getByRole("separator");
    expect(separator.getAttribute("aria-valuemax")).toBe("238");
    expect(separator.getAttribute("aria-valuenow")).toBe("238");
    expect(screen.getByLabelText("Saved list width").textContent).toBe("600");
    resize(215);
    expect(screen.queryByRole("separator")).toBeNull();
    resize(1200);
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("600");
    // A deliberate resize still uses the same detail floor.
    resize(479);
    fireEvent.keyDown(screen.getByRole("separator"), { key: "ArrowLeft" });
    expect(screen.getByRole("separator").getAttribute("aria-valuenow")).toBe("238");
  });

  it("preserves the captured parent filter, segment and list position across compact selection and return", () => {
    layout.activateSessionSelection("parent");
    layout.selectInsightsFilter("tools");
    layout.rememberInsightListPosition("parent", 248);
    layout.rememberInsightsReturn("parent", {
      kind: "group",
      groupId: "parent-action",
      segmentKey: "spawn",
    });
    render(<Inspector />);
    fireEvent.click(screen.getByRole("button", { name: "Open list" }));
    fireEvent.click(screen.getByRole("button", { name: "Original action" }));
    expect(screen.getByRole("region", { name: "Selected detail" })).toBeTruthy();
    resize(900);
    resize(215);
    act(() => {
      expect(layout.restoreInsightsReturn("parent")).toBe(true);
    });
    expect(layout.sessionLayoutStore.getState()).toMatchObject({
      selectedInsight: { kind: "group", groupId: "parent-action", segmentKey: "spawn" },
      insightsFilter: "tools",
    });
    expect(layout.sessionLayoutStore.getState().insightListPositions.get("parent")?.top).toBe(248);
    expect(layout.restoreInsightsReturn("parent")).toBe(false);
    expect(screen.getByRole("region", { name: "Selected detail" })).toBeTruthy();
  });
});
