/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";

import { InsightsNavigationProvider } from "./InsightsNavigationProvider";
import { InsightsReturnButton } from "./presentation/InsightsReturnButton";
import { ChildTranscriptScope } from "./transcript/ChildTranscriptScope";
import { useInsightsNavigation } from "./useInsightsNavigation";
import type { SessionPanel } from "@/app/lib/routes";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { standaloneRuntime } from "@/app/runtime/nativeRuntime";
import { createSessionLayoutStore } from "@/app/store/sessionLayoutStore";

const panels: SessionPanel[] = ["insights", "delegated"];
afterEach(cleanup);

function PreviewJump() {
  const navigation = useInsightsNavigation();
  return <button onClick={() => navigation.openGroup("child-action")}>Preview action</button>;
}

it("keeps Back discoverable in a failed/empty panel and restores the saved narrow list after focusPanel", () => {
  const layout = createSessionLayoutStore();
  const selected = { kind: "group", groupId: "parent-action", segmentKey: "spawn" } as const;
  layout.selectInsight(selected);
  layout.selectInsightsFilter("tools");
  layout.showSidePanelList(true);
  layout.rememberInsightsReturn("parent", selected);
  function Surface() {
    const [panel, setPanel] = useState<SessionPanel>("delegated");
    return (
      <InsightsNavigationProvider
        sessionId="parent"
        panels={panels}
        focusPanel={(next) => {
          layout.revealSidePanel(true);
          setPanel(next);
        }}
      >
        <InsightsReturnButton sessionId="parent" />
        <p role="alert">Subagents could not be loaded.</p>
        <output aria-label="Panel">{panel}</output>
        <ChildTranscriptScope sessionId="child" turns={[]}>
          <PreviewJump />
        </ChildTranscriptScope>
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
  fireEvent.click(screen.getByText("Preview action"));
  expect(layout.sessionLayoutStore.getState().selectedInsight).toEqual(selected);
  fireEvent.click(screen.getByRole("button", { name: "Back to Insights" }));
  expect(screen.getByRole("status", { name: "Panel" }).textContent).toBe("insights");
  expect(layout.sessionLayoutStore.getState()).toMatchObject({
    selectedInsight: selected,
    insightsFilter: "tools",
    panelList: true,
  });
  expect(screen.queryByRole("button", { name: "Back to Insights" })).toBeNull();
});
