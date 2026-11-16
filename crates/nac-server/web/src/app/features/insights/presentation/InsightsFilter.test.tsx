/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InsightsFilter } from "@/app/features/insights/presentation/InsightsFilter";
import type { InsightsFilterOption } from "@/app/features/insights/model/types";

const viewport = vi.hoisted(() => ({ mobile: true, tablet: false }));
vi.mock("@/app/hooks/useMediaQuery", () => ({
  useIsMobile: () => viewport.mobile,
  useIsTablet: () => viewport.tablet,
}));

const options: readonly InsightsFilterOption[] = [
  { value: "all", label: "All actions" },
  { value: "tools", label: "Tools & reasoning" },
  { value: "threads", label: "Threads" },
];

beforeEach(() => {
  viewport.mobile = true;
  viewport.tablet = false;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Insights filter controls", () => {
  it("opens the real phone choice sheet and keeps selection controlled by its caller", () => {
    const onChange = vi.fn();
    const view = (value: "all" | "tools") => (
      <MemoryRouter>
        <InsightsFilter options={options} value={value} onChange={onChange} />
      </MemoryRouter>
    );
    const { rerender } = render(view("all"));
    const trigger = screen.getByRole("button", { name: "Show All" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    trigger.focus();
    // Keyboard activation reaches the native button's click handler with detail=0.
    fireEvent.click(trigger, { detail: 0 });
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "All actions" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Threads" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Tools & reasoning" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith("tools");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("button", { name: "Show All" })).toBe(trigger);
    rerender(view("tools"));
    expect(screen.getByRole("button", { name: "Show Tools & reasoning" })).toBe(trigger);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("dismisses the phone sheet with Escape and restores the original trigger focus without changing its filter", async () => {
    const onChange = vi.fn();
    render(
      <MemoryRouter>
        <InsightsFilter options={options} value="threads" onChange={onChange} />
      </MemoryRouter>,
    );
    const trigger = screen.getByRole("button", { name: "Show Threads" });
    trigger.focus();
    fireEvent.click(trigger, { detail: 0 });
    const row = screen.getByRole("button", { name: "Tools & reasoning" });
    row.focus();
    fireEvent.keyDown(row, { key: "Escape" });
    await waitFor(() => expect(trigger.getAttribute("aria-expanded")).toBe("false"));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Show Threads" })).toBe(trigger);
  });

  it.each([false, true])(
    "retains the existing non-phone filter behavior at tablet=%s",
    (tablet) => {
      viewport.mobile = false;
      viewport.tablet = tablet;
      const onChange = vi.fn();
      render(
        <MemoryRouter>
          <InsightsFilter options={options} value="all" onChange={onChange} />
        </MemoryRouter>,
      );
      expect(screen.queryByRole("button", { name: "Show All" })).toBeNull();
      const trigger = screen.getByRole("button", { name: "All actions" });
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
      fireEvent.click(trigger);
      fireEvent.click(screen.getByRole("button", { name: "Threads" }));
      expect(onChange).toHaveBeenCalledExactlyOnceWith("threads");
      expect(trigger.getAttribute("aria-expanded")).toBe("false");
    },
  );
});
