/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { HeaderMenu } from "./HeaderMenu";

const view = vi.hoisted(() => ({ mobile: false }));
vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => view.mobile }));
vi.mock("@/app/services/queries", () => ({
  useStoreInfo: () => ({ data: { store_path: "/fixture/store.db" } }),
}));
beforeEach(() => {
  view.mobile = false;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  "keeps docs/repository as real links and settings as a command (mobile=%s)",
  async (mobile) => {
    view.mobile = mobile;
    const settings = vi.fn();
    render(
      <MemoryRouter>
        <HeaderMenu onConfigurations={settings} onSshConfigs={() => {}} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open the menu" }));
    for (const [label, href] of [
      ["See docs", "https://github.com/arcee-ai/nac#readme"],
      ["See Github", "https://github.com/arcee-ai/nac"],
    ]) {
      const link = await screen.findByRole("link", { name: label });
      expect(link.getAttribute("href")).toBe(href);
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
      expect(link.classList.contains(mobile ? "btn-large" : "btn-medium")).toBe(true);
      link.focus();
      expect(document.activeElement).toBe(link);
    }
    fireEvent.click(screen.getByRole("button", { name: "Configurations" }));
    expect(settings).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Open the menu" })).toBeTruthy();
  },
);
