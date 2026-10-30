/** @vitest-environment jsdom */
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import MarkdownRenderer from "@/app/lib/markdown-renderer";
import { ToastProvider } from "@/app/providers/ToastProvider";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
afterEach(cleanup);
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <ToastProvider>{children}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
describe("settled streamed Markdown", () => {
  it.each([
    "[1]: https://example.com/docs",
    "- [1]: https://example.com/docs",
    "1. [1]: https://example.com/docs",
    "> - [1]: https://example.com/docs",
    "- parent\n  - [1]: https://example.com/docs",
  ])("resolves cross-block references in %s", (definition) => {
    const source = `[docs][1]\n\n${definition}`;
    const view = render(<MarkdownRenderer streaming>{source}</MarkdownRenderer>, { wrapper });
    view.rerender(<MarkdownRenderer>{source}</MarkdownRenderer>);
    expect(view.container.querySelector("a")?.getAttribute("href")).toBe(
      "https://example.com/docs",
    );
  });
  it.each(["Hello\n\nWorld", "Hello\n\n```ts\n[key: string]: T;\n```"])(
    "preserves settled nodes without definitions: %s",
    (source) => {
      const view = render(<MarkdownRenderer streaming>{source}</MarkdownRenderer>, { wrapper });
      const paragraph = view.container.querySelector("p");
      view.rerender(<MarkdownRenderer>{source}</MarkdownRenderer>);
      expect(view.container.querySelector("p")).toBe(paragraph);
    },
  );
});
