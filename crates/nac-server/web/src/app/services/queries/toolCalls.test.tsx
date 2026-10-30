/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { InsightItemCodeDisplayerState } from "@/app/atoms";
import { assistant, snapshot, toolCall } from "@/app/features/insights/model/fixtures.test-support";
import { FileChange } from "@/app/features/insights/presentation/items/FileChange";
import type { ItemContext } from "@/app/features/insights/presentation/items/itemContent";
import { useFullContent } from "@/app/features/insights/presentation/items/useFullContent";
import { buildTranscript } from "@/app/lib/transcript";
import { api } from "@/app/services/api";
import { type ToolCallRef, useToolCallContent } from "@/app/services/queries/toolCalls";

type Content = Awaited<ReturnType<typeof api.getToolCallContent>>;
const firstCall: ToolCallRef = { id: "call_0", blockKey: "tool-1-call_0" };
const laterCall: ToolCallRef = { id: "call_0", blockKey: "tool-25-call_0" };
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  };
}
const content = (output: string | null = "finished"): Content => ({
  call_id: "call_0",
  arguments: '{"path":"first.txt"}',
  arguments_truncated: false,
  output,
  output_truncated: false,
});

it("keeps absolute block identity across overlapping pages and separates reused IDs", () => {
  const messages = [
    assistant({ calls: [toolCall("call_0", "edit")] }),
    assistant({ calls: [toolCall("call_0", "edit")] }),
  ];
  const full = snapshot(messages, "direct");
  full.message_page = { start: 24, end: 26, total: 26, has_older: true };
  const tail = {
    ...full,
    messages: messages.slice(1),
    message_created_at: ["t-1"],
    message_page: { start: 25, end: 26, total: 26, has_older: true },
  };
  const keys = (value: typeof full) =>
    buildTranscript(value, {}).flatMap((turn) =>
      turn.kind === "model"
        ? turn.blocks.flatMap((block) => (block.kind === "tool-detail" ? [block.key] : []))
        : [],
    );
  expect(keys(full)).toEqual(["tool-24-call_0", "tool-25-call_0"]);
  expect(keys(tail)).toEqual(["tool-25-call_0"]);
});

it("does not reuse completed content for a later block carrying the same provider ID", async () => {
  const { wrapper } = fixture();
  const request = vi.spyOn(api, "getToolCallContent").mockResolvedValue(content());
  const first = renderHook(() => useToolCallContent("session", firstCall), { wrapper });
  await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
  first.unmount();
  request.mockRejectedValue(new Error("404 ambiguous call"));
  const later = renderHook(() => useToolCallContent("session", laterCall), { wrapper });
  await waitFor(() => expect(later.result.current.isError).toBe(true));
  expect(later.result.current.data).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(2);
});

it("reuses a completed answer for the same absolute block when it remounts", async () => {
  const { wrapper } = fixture();
  const request = vi.spyOn(api, "getToolCallContent").mockResolvedValue(content());
  const first = renderHook(() => useToolCallContent("session", firstCall), { wrapper });
  await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
  first.unmount();
  const next = renderHook(() => useToolCallContent("session", firstCall), { wrapper });
  expect(next.result.current.data?.output).toBe("finished");
  expect(request).toHaveBeenCalledOnce();
});

it("cancels an earlier read when the mounted item changes blocks and excludes late data", async () => {
  const { wrapper } = fixture();
  const old = Promise.withResolvers<Content>();
  const request = vi
    .spyOn(api, "getToolCallContent")
    .mockReturnValueOnce(old.promise)
    .mockRejectedValue(new Error("404 ambiguous call"));
  const view = renderHook(({ call }) => useToolCallContent("session", call), {
    wrapper,
    initialProps: { call: firstCall },
  });
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  const signal = request.mock.calls[0][2];
  view.rerender({ call: laterCall });
  await waitFor(() => expect(view.result.current.isError).toBe(true));
  expect(signal?.aborted).toBe(true);
  await act(async () => old.resolve(content()));
  expect(view.result.current.data).toBeUndefined();
});

it("shows a focused Retry after a failed pending poll, stops, and resumes through settlement", async () => {
  const { wrapper } = fixture();
  const request = vi
    .spyOn(api, "getToolCallContent")
    .mockResolvedValueOnce(content(null))
    .mockRejectedValue(new Error("redaction unavailable"));
  render(
    <FileChange path={null} call={firstCall} context={{ sessionId: "session" } as ItemContext} />,
    { wrapper },
  );
  await screen.findByText("Loading the change…");
  await screen.findByText("Could not load this change.", {}, { timeout: 3500 });
  expect(screen.queryByText("Loading the change…")).toBeNull();
  const retry = screen.getByRole("button", { name: "Retry" });
  await new Promise((resolve) => setTimeout(resolve, 2200));
  expect(request).toHaveBeenCalledTimes(2);
  const manual = Promise.withResolvers<Content>();
  request
    .mockReturnValueOnce(manual.promise)
    .mockResolvedValue(content('{"path":"first.txt","diff":"@@ -1 +1 @@\\n-old\\n+new\\n"}'));
  retry.focus();
  fireEvent.click(retry);
  expect(document.activeElement).toBe(retry);
  await act(async () => manual.resolve(content(null)));
  await screen.findByText("Loading the change…");
  await screen.findByRole("group", { name: "Changes to first.txt" }, { timeout: 3500 });
  const count = request.mock.calls.length;
  await new Promise((resolve) => setTimeout(resolve, 2200));
  expect(request).toHaveBeenCalledTimes(count);
}, 12000);

it("keeps an output's Show full waiting until settled and caches hide/show", async () => {
  const { wrapper } = fixture();
  const request = vi
    .spyOn(api, "getToolCallContent")
    .mockResolvedValueOnce(content(null))
    .mockResolvedValue(content());
  const view = renderHook(() => useFullContent("session", firstCall, true), { wrapper });
  expect(request).not.toHaveBeenCalled();
  act(() => view.result.current.showFull());
  await waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(view.result.current.state).toBe(InsightItemCodeDisplayerState.Loading);
  expect(view.result.current.content).toBeUndefined();
  await waitFor(
    () => expect(view.result.current.state).toBe(InsightItemCodeDisplayerState.Expanded),
    { timeout: 3500 },
  );
  act(() => view.result.current.hide());
  act(() => view.result.current.showFull());
  expect(view.result.current.content?.output).toBe("finished");
  expect(request).toHaveBeenCalledTimes(2);
});

it("keeps a failed pending poll stopped when the same block remounts", async () => {
  const { wrapper } = fixture();
  const request = vi
    .spyOn(api, "getToolCallContent")
    .mockResolvedValueOnce(content(null))
    .mockRejectedValue(new Error("unavailable"));
  const first = renderHook(() => useToolCallContent("session", firstCall), { wrapper });
  await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
  await act(async () => {
    await first.result.current.refetch();
  });
  await waitFor(() => expect(first.result.current.isError).toBe(true));
  first.unmount();
  const next = renderHook(() => useToolCallContent("session", firstCall), { wrapper });
  expect(next.result.current.isError).toBe(true);
  expect(next.result.current.isFetching).toBe(false);
  expect(request).toHaveBeenCalledTimes(2);
});

it("withholds retained completed content when fresh server validation rejects the ID", async () => {
  const { wrapper } = fixture();
  const request = vi
    .spyOn(api, "getToolCallContent")
    .mockResolvedValueOnce(content())
    .mockRejectedValue(new Error("404 ambiguous call"));
  const view = renderHook(
    () => {
      const query = useToolCallContent("session", firstCall);
      return { data: query.data, isError: query.isError, refetch: query.refetch };
    },
    { wrapper },
  );
  await waitFor(() => expect(view.result.current.data?.output).toBe("finished"));
  await act(async () => {
    await view.result.current.refetch();
  });
  await waitFor(() => expect(view.result.current.isError).toBe(true));
  expect(view.result.current.data).toBeUndefined();
  expect(request).toHaveBeenCalledTimes(2);
});
