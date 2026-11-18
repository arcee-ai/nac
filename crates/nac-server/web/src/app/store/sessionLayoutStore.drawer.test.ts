import { describe, expect, it } from "vitest";

import { createSessionLayoutStore } from "@/app/store/sessionLayoutStore";

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

describe("session drawer state", () => {
  it("opens quiet: no drawer until something asks, whatever a project stored", () => {
    const storage = memoryStorage({ "nac.rightSidebar.collapsed.p1": "0" });
    const layout = createSessionLayoutStore(storage);
    layout.activateSessionSelection("one");
    layout.bindSidePanelProject("p1");
    expect(layout.sessionLayoutStore.getState().collapsed).toBe(true);

    layout.openDrawer();
    expect(layout.sessionLayoutStore.getState()).toMatchObject({
      collapsed: false,
      drawerContent: "panel",
    });
    // Per-project memory is off by default: opening writes nothing.
    expect(storage.values.get("nac.rightSidebar.collapsed.p1")).toBe("0");
    layout.unbindSidePanelProject();
    expect(layout.sessionLayoutStore.getState().collapsed).toBe(false);
  });

  it("keeps the per-project preference when a host opts into it", () => {
    const storage = memoryStorage({ "nac.rightSidebar.collapsed.p1": "0" });
    const layout = createSessionLayoutStore(storage, { rememberPerProject: true });
    layout.bindSidePanelProject("p1");
    expect(layout.sessionLayoutStore.getState().collapsed).toBe(false);
    layout.closeDrawer();
    expect(storage.values.get("nac.rightSidebar.collapsed.p1")).toBe("1");
  });

  it("switches between a panel and the goal, and closes from either", () => {
    const layout = createSessionLayoutStore();
    layout.openDrawer("goal");
    expect(layout.sessionLayoutStore.getState()).toMatchObject({
      collapsed: false,
      drawerContent: "goal",
    });
    // The transcript pointing at a row always shows the panels.
    layout.revealSidePanel();
    expect(layout.sessionLayoutStore.getState().drawerContent).toBe("panel");
    layout.toggleSidePanelExpanded();
    layout.closeDrawer();
    expect(layout.sessionLayoutStore.getState()).toMatchObject({
      collapsed: true,
      expanded: false,
    });
  });

  it("keeps a docked drawer open across sessions, but closes one with no room to dock", () => {
    const layout = createSessionLayoutStore();
    layout.setDrawerDockable(true);
    layout.activateSessionSelection("one");
    layout.openDrawer();
    layout.activateSessionSelection("two");
    expect(layout.sessionLayoutStore.getState().collapsed).toBe(false);

    layout.setDrawerDockable(false);
    layout.activateSessionSelection("three");
    expect(layout.sessionLayoutStore.getState().collapsed).toBe(true);
  });

  it("lets a desktop command open the drawer on its panel's list", () => {
    const layout = createSessionLayoutStore();
    layout.openDrawer("goal");
    layout.closeDrawer();
    layout.openSidePanelList();
    expect(layout.sessionLayoutStore.getState()).toMatchObject({
      collapsed: false,
      panelList: true,
      drawerContent: "panel",
    });
  });
});
