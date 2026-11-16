/** @vitest-environment jsdom */

import type { FormEvent } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MobileBottomBar } from "@/app/components/inspector/MobileBottomBar";
import { SESSION_PANEL_LABEL, SESSION_PANELS, type SessionPanel } from "@/app/lib/routes";
import { sessionPanelPolicy } from "@/app/lib/sessionBehavior";

afterEach(cleanup);

describe("controlled phone panel navigation", () => {
  it.each([
    ["orchestrator", "orchestrator", null, ["Insights", "Files", "Worksets", "History"]],
    [
      "direct",
      "direct",
      null,
      ["Insights", "Subagents", "Files", "Terminal", "History", "Heartbeats"],
    ],
    [
      "direct with orchestrator",
      "direct-with-orchestrator",
      null,
      ["Insights", "Subagents", "Files", "Terminal", "History"],
    ],
    [
      "managed orchestrator",
      "orchestrator",
      "managed-orchestrator",
      ["Insights", "Files", "Worksets", "History"],
    ],
    ["traditional child", "direct", "traditional-child", ["Insights", "Files", "History"]],
  ] as const)(
    "retains the %s policy's labels, order and controlled selection",
    (_name, behavior, lineage, labels) => {
      const panels = sessionPanelPolicy(behavior, lineage).mobilePanels;
      const originalPanels = [...panels];
      const onPanelChange = vi.fn();
      render(<MobileBottomBar panel="insights" panels={panels} onPanelChange={onPanelChange} />);

      const tabs = within(screen.getByRole("tablist")).getAllByRole("tab");
      expect(tabs.map((tab) => tab.textContent)).toEqual(labels);
      expect(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true")).toEqual([
        screen.getByRole("tab", { name: "Insights" }),
      ]);
      expect(onPanelChange).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("tab", { name: "History" }));
      expect(onPanelChange).toHaveBeenCalledExactlyOnceWith("history");
      // A route owner must supply the new panel; a click never creates local selection.
      expect(screen.getByRole("tab", { name: "Insights" }).getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe(
        "false",
      );
      expect(panels).toEqual(originalPanels);
    },
  );

  it.each([
    ["pointer", 1],
    ["keyboard-style", 0],
  ] as const)(
    "requests direct Heartbeats on a %s click and waits for controlled selection",
    (_input, detail) => {
      const panels = sessionPanelPolicy("direct", null).mobilePanels;
      const originalPanels = [...panels];
      const onPanelChange = vi.fn();
      const view = (panel: SessionPanel) => (
        <MobileBottomBar panel={panel} panels={panels} onPanelChange={onPanelChange} />
      );
      const { rerender } = render(view("insights"));
      const heartbeats = screen.getByRole("tab", { name: "Heartbeats" }) as HTMLButtonElement;
      const insights = screen.getByRole("tab", { name: "Insights" });
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Insights",
        "Subagents",
        "Files",
        "Terminal",
        "History",
        "Heartbeats",
      ]);
      expect(heartbeats.type).toBe("button");
      expect(heartbeats.tabIndex).toBe(0);
      expect(heartbeats.getAttribute("aria-selected")).toBe("false");
      expect(insights.getAttribute("aria-selected")).toBe("true");
      expect(onPanelChange).not.toHaveBeenCalled();

      heartbeats.focus();
      fireEvent.click(heartbeats, { detail });
      expect(onPanelChange).toHaveBeenCalledExactlyOnceWith("heartbeats");
      expect(document.activeElement).toBe(heartbeats);
      expect(heartbeats.getAttribute("aria-selected")).toBe("false");
      expect(insights.getAttribute("aria-selected")).toBe("true");

      rerender(view("heartbeats"));
      expect(
        screen.getAllByRole("tab").filter((tab) => tab.getAttribute("aria-selected") === "true"),
      ).toEqual([heartbeats]);
      expect(insights.getAttribute("aria-selected")).toBe("false");
      expect(onPanelChange).toHaveBeenCalledExactlyOnceWith("heartbeats");
      expect(panels).toEqual(originalPanels);
    },
  );

  it("preserves the existing default panel values rather than filtering legacy labels", () => {
    render(<MobileBottomBar panel="threads" onPanelChange={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(
      SESSION_PANELS.map((panel) => SESSION_PANEL_LABEL[panel]),
    );
    expect(screen.getByRole("tab", { name: "Threads" }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps native focusable buttons and accepts keyboard-style activation without submitting a parent form", () => {
    const onPanelChange = vi.fn();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <MobileBottomBar
          panel="insights"
          panels={sessionPanelPolicy("direct", null).mobilePanels}
          onPanelChange={onPanelChange}
        />
      </form>,
    );
    const tab = screen.getByRole("tab", { name: "Subagents" }) as HTMLButtonElement;
    expect(tab.type).toBe("button");
    expect(tab.tabIndex).toBe(0);
    tab.focus();
    // Native keyboard activation delivers a click with detail=0. Browser key
    // generation and actual hit geometry belong to the production browser lane.
    fireEvent.click(tab, { detail: 0 });
    expect(onPanelChange).toHaveBeenCalledExactlyOnceWith("delegated");
    expect(document.activeElement).toBe(tab);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("follows external panel changes and detail/list remounts without stealing focus or changing a parent draft", () => {
    const onPanelChange = vi.fn();
    const panels = sessionPanelPolicy("direct", null).mobilePanels;
    const view = (panel: SessionPanel, visible = true) => (
      <>
        <input aria-label="Parent draft" defaultValue="Unsent parent draft" />
        {visible ? (
          <MobileBottomBar panel={panel} panels={panels} onPanelChange={onPanelChange} />
        ) : null}
      </>
    );
    const { rerender } = render(view("history"));
    const draft = screen.getByRole("textbox", { name: "Parent draft" }) as HTMLInputElement;
    fireEvent.change(draft, { target: { value: "Reader-owned draft" } });
    draft.focus();
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe("true");

    rerender(view("files"));
    expect(screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "History" }).getAttribute("aria-selected")).toBe(
      "false",
    );
    rerender(view("files", false));
    expect(screen.queryByRole("tablist")).toBeNull();
    rerender(view("files"));
    expect(screen.getByRole("tab", { name: "Files" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("textbox", { name: "Parent draft" })).toBe(draft);
    expect(draft.value).toBe("Reader-owned draft");
    expect(document.activeElement).toBe(draft);
    expect(onPanelChange).not.toHaveBeenCalled();
  });
});
