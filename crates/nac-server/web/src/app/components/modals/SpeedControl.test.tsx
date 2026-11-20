/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpeedControl } from "./SpeedControl";

const priority = { id: "priority", name: "Fast", description: "Priority" };
const ultra = { id: "ultrafast", name: "Ultrafast", description: "Ultra" };
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("toggles explicit Standard and Fast independently of provider default", () => {
  const onChange = vi.fn();
  const view = render(<SpeedControl tiers={[priority]} value={null} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Speed: Provider default" }));
  expect(onChange).toHaveBeenCalledWith("fast");
  view.rerender(<SpeedControl tiers={[priority]} value="fast" onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "Speed: Fast" }));
  expect(onChange).toHaveBeenLastCalledWith("standard");
});

it("hides the composer for revoked or unknown tiers but keeps a repair path in settings", () => {
  const onChange = vi.fn();
  const view = render(<SpeedControl tiers={[]} value="fast" onChange={onChange} />);
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(<SpeedControl form tiers={[]} value="fast" onChange={onChange} />);
  expect(screen.getByText("Fast (unavailable)")).toBeTruthy();
});

it("offers three-way choices only when discovery includes Ultrafast", () => {
  render(<SpeedControl tiers={[priority, ultra]} value="standard" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /standard/i }));
  expect(screen.getByText("Ultrafast")).toBeTruthy();
  expect(screen.getByText("Use provider default")).toBeTruthy();
});
