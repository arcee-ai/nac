/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { loadMarkdownRenderer } from "@/app/lib/markdownChunk";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ReasoningItem } from "./ReasoningItem";
import type { ReasoningSegment } from "./itemContent";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));

// Synchronize the real renderer before testing focus and selection retention.
beforeAll(async () => {
  await loadMarkdownRenderer();
});

afterEach(() => {
  cleanup();
  document.getSelection()?.removeAllRanges();
});

const segment: ReasoningSegment = {
  kind: "reasoning",
  key: "r1",
  text: "Inspect the cache key.",
  streaming: true,
  durationMs: null,
};
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ToastProvider>{children}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
const mount = (element: React.ReactElement) => render(element, { wrapper });
const view = (updates: Partial<ReasoningSegment> = {}) => (
  <ReasoningItem segment={{ ...segment, ...updates }} active={false} />
);

describe("reasoning reading choice", () => {
  it.each(["focus", "selection"])(
    "preserves %s in the visible tail of long live reasoning",
    async (reading) => {
      const text =
        Array.from({ length: 220 }, (_, i) => `Paragraph ${i}: inspect the cache.`).join("\n\n") +
        "\n\n[Cache notes](https://example.test/cache)";
      const mounted = mount(view({ text }));
      const link = await screen.findByRole("link", { name: "Cache notes" });
      if (reading === "focus") link.focus();
      else {
        const range = document.createRange();
        range.selectNodeContents(link);
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
      }
      mounted.rerender(view({ text, streaming: false }));
      expect(screen.getByRole("button", { name: "Reasoning" }).getAttribute("aria-expanded")).toBe(
        "true",
      );
      expect(screen.getByRole("link", { name: "Cache notes" })).toBe(link);
      if (reading === "focus") expect(document.activeElement).toBe(link);
      else expect(document.getSelection()?.toString()).toBe("Cache notes");
    },
  );
  it("opens live reasoning and collapses on settlement; a new completed mount starts closed", () => {
    const { rerender, unmount } = mount(view());
    expect(screen.getByRole("button", { name: "Thinking…" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    rerender(view({ streaming: false, durationMs: 2300 }));
    expect(
      screen.getByRole("button", { name: /^Reasoning, 2.3/ }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText(/Thinking/)).toBeNull();
    unmount();
    mount(view({ streaming: false }));
    expect(screen.getByRole("button", { name: "Reasoning" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("keeps an explicit close across chunks, settlement and refetch, and an explicit open on resume", () => {
    const { rerender } = mount(view());
    fireEvent.click(screen.getByRole("button", { name: "Thinking…" }));
    rerender(view({ text: "Another chunk" }));
    expect(screen.getByRole("button", { name: "Thinking…" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    rerender(view({ streaming: false }));
    expect(screen.getByRole("button", { name: "Reasoning" }).getAttribute("aria-expanded")).toBe(
      "false",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reasoning" }));
    rerender(view({ streaming: false, text: "Refetched reasoning" }));
    expect(screen.getByRole("button", { name: "Reasoning" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    rerender(view());
    expect(screen.getByRole("button", { name: "Thinking…" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("keeps focused links and selected text in place through settlement", async () => {
    const { rerender, unmount } = mount(
      view({ text: "[Cache notes](https://example.test/cache)" }),
    );
    const link = await screen.findByRole("link", { name: "Cache notes" });
    link.focus();
    rerender(view({ streaming: false, text: "[Cache notes](https://example.test/cache)" }));
    expect(document.activeElement).toBe(link);
    expect(screen.getByRole("button", { name: "Reasoning" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    unmount();
    const second = mount(view());
    await waitFor(() => expect(second.container.querySelector("p")).not.toBeNull());
    const text = screen.getByText(segment.text);
    const range = document.createRange();
    range.selectNodeContents(text);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);
    second.rerender(view({ streaming: false }));
    expect(screen.getByRole("button", { name: "Reasoning" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(document.getSelection()?.toString()).toBe(segment.text);
  });

  it("renders no blank disclosure or rule and never clips settled long reasoning", () => {
    const { container, rerender } = mount(view({ text: " \n " }));
    expect(container.childElementCount).toBe(0);
    rerender(
      view({
        streaming: false,
        text: Array.from({ length: 220 }, (_, i) => `Line ${i}`).join("\n"),
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reasoning" }));
    expect(screen.getByText(/Line 0/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
    expect(screen.getByRole("button", { name: "Copy Reasoning" })).not.toBeNull();
    expect(container.querySelector("[aria-controls]")?.getAttribute("aria-controls")).toBe(
      container.querySelector('[id$="-body"]')?.id,
    );
  });
});
