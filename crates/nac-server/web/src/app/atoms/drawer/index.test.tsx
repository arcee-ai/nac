/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import Drawer from ".";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("removes closing controls from keyboard and accessibility before the exit animation finishes", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  const view = render(
    <Drawer open onClose={() => {}} title="Changes">
      <button>Review change</button>
    </Drawer>,
  );
  const surface = screen.getByRole("dialog", { name: "Changes" });
  view.rerender(
    <Drawer open={false} onClose={() => {}} title="Changes">
      <button>Review change</button>
    </Drawer>,
  );
  expect(surface.isConnected).toBe(true);
  expect(surface.hasAttribute("inert")).toBe(true);
  expect(surface.getAttribute("aria-hidden")).toBe("true");
  expect(screen.queryByRole("button", { name: "Review change" })).toBeNull();
});
