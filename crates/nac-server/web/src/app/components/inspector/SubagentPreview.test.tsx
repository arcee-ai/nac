/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";

import { IconName } from "@/app/atoms";
import { SubagentPreview } from "./SubagentPreview";
import { snapshot } from "@/app/features/insights/model/fixtures.test-support";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries";
import { fenceSessionSnapshot, sessionRefreshKey } from "@/app/services/sessionRefresh";
import type { MessagesPageResponse } from "@/app/types/api";

vi.mock("@/app/hooks/useMediaQuery", () => ({ useIsMobile: () => false }));
vi.mock("@/app/hooks/useDelegatedPreviewStream", () => ({
  useDelegatedPreviewStream: () => ({ running: false, text: "", reasoning: "" }),
}));
vi.mock("@/app/hooks/useTranscriptReveal", () => ({ useTranscriptReveal: () => true }));

const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("explains a failed child snapshot, retains Open and retries without changing its identity", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const data = snapshot([]);
  data.metadata.session_id = "child";
  const get = vi
    .spyOn(api, "getSession")
    .mockRejectedValueOnce(new Error("Controlled unavailable snapshot"))
    .mockResolvedValue(data);
  const open = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SubagentPreview
          sessionId="child"
          title="Audit history"
          fallbackText="Retained report"
          icon={IconName.Chat}
          onOpen={open}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Couldn’t load the child conversation.Try again",
  );
  expect(screen.getByText("Retained report")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(open).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(get).toHaveBeenCalledTimes(2);
  expect(get.mock.calls.every(([id]) => id === "child")).toBe(true);
});

it.each(["rejected", "generation-fenced"] as const)(
  "retains the child and explicitly recovers a %s older-history read",
  async (settlement) => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const latest = snapshot([
      { role: "user", content: "Latest child prompt" },
      { role: "assistant", content: "Latest child answer remains" },
    ]);
    latest.metadata.session_id = "child";
    latest.message_page = { start: 2, end: 4, total: 4, has_older: true };
    const earlier: MessagesPageResponse = {
      messages: [
        { role: "user", content: "Earlier child prompt" },
        { role: "assistant", content: "Earlier child answer recovered" },
      ],
      created_at: [null, null],
      page: { start: 0, end: 2, total: 4, has_older: false },
    };
    const delayed = Promise.withResolvers<MessagesPageResponse>();
    const get = vi.spyOn(api, "getSession").mockResolvedValue(latest);
    const history = vi
      .spyOn(api, "getMessages")
      .mockImplementationOnce(() =>
        settlement === "rejected"
          ? Promise.reject(new Error("Controlled unavailable history"))
          : delayed.promise,
      )
      .mockResolvedValue(earlier);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    clients.push(client);
    const parent = snapshot([]);
    parent.metadata.session_id = "parent";
    client.setQueryData(queryKeys.sessionSnapshot("parent"), parent);
    const open = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <SubagentPreview
            sessionId="child"
            title="Audit history"
            fallbackText="Retained report"
            icon={IconName.Chat}
            onOpen={open}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(history).toHaveBeenCalledOnce());
    if (settlement === "generation-fenced") {
      // Use the real query generation fence; the transport still resolves its stale page.
      fenceSessionSnapshot(sessionRefreshKey(client, "child"));
      await act(async () => {
        delayed.resolve(earlier);
        await delayed.promise;
      });
      expect(history.mock.calls[0][1]?.signal?.aborted).toBe(true);
    }
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      "Couldn’t load older messages.Try again",
    );
    expect(screen.getByText("Latest child answer remains")).toBeTruthy();
    expect(screen.queryByText("Earlier child answer recovered")).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy();
    await act(async () => undefined);
    expect(history).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByText("Earlier child answer recovered")).toBeTruthy();
    expect(screen.getByText("Latest child answer remains")).toBeTruthy();
    expect(history).toHaveBeenCalledTimes(2);
    expect(
      history.mock.calls.every(([id, options]) => id === "child" && options?.before === 2),
    ).toBe(true);
    expect(get).toHaveBeenCalledOnce();
    expect(client.getQueryData(queryKeys.sessionSnapshot("parent"))).toBe(parent);
    expect(open).not.toHaveBeenCalled();
  },
);
