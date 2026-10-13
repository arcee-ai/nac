/** @vitest-environment jsdom */
import { QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeRuntime, type NativeRuntime } from "@/app/runtime/nativeRuntime";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNacClient } from "@/app/services/nacClient";
import type { ShellCommandSnapshot } from "@/app/types/api";
import { CommandCard } from "./CommandCard";
const opened: NativeRuntime[] = [];
function runtime(fetch: typeof globalThis.fetch, host = "one") {
  const endpoint = `https://${host}.example/nac`;
  const value = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host,
      incarnation: host,
      endpoint,
      release: "test",
    },
    client: createNacClient({ endpoint, credentials: "omit", fetch }),
    storage: { getItem: () => null, setItem: vi.fn() },
  });
  opened.push(value);
  return value;
}
const command: ShellCommandSnapshot = {
  request_id: "id",
  operation_id: "operation",
  command: "printf output; exit 7",
  state: "completed",
  exit_code: 7,
  timeout_ms: 30000,
  accepted_at_epoch_ms: 1,
  stdout: "preview",
  stderr: "error",
  output_id: "output",
};
function tree(value: NativeRuntime, snapshot = command, readOnly = false) {
  return (
    <QueryClientProvider client={value.queryClient}>
      <RuntimeContext.Provider value={value}>
        <CommandCard sessionId="same" command={snapshot} readOnly={readOnly} />
      </RuntimeContext.Provider>
    </QueryClientProvider>
  );
}
afterEach(() => {
  cleanup();
  for (const value of opened.splice(0)) value.close();
});

describe("retained human command presentation", () => {
  it("drafts an explicit follow-up only in its originating consumer without sending or fetching", () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const origin = runtime(fetch);
    const next = runtime(vi.fn(), "two");
    const receive = vi.fn();
    const nextReceive = vi.fn();
    origin.stores.composerStore.consumeDraftRequests("same", receive);
    next.stores.composerStore.consumeDraftRequests("same", nextReceive);
    render(tree(origin));
    expect(screen.getByRole("article", { name: "User command" }).textContent).toContain(
      "completed · exit 7",
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask about this" }));
    expect(receive).toHaveBeenCalledExactlyOnceWith(
      "Explain the result of my command id:\n!printf output; exit 7",
    );
    expect(nextReceive).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("pages retained output explicitly and reports overflow and unavailable retention", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url) => {
      if (String(url).endsWith("offset=0"))
        return Response.json({
          content: "first",
          offset: 0,
          next_offset: 5,
          eof: false,
          overflowed: true,
        });
      return Response.json({ error: "expired" }, { status: 404 });
    });
    render(tree(runtime(fetch)));
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Full output" }));
    await screen.findByText("Only retained output is available.");
    await screen.findByText("first");
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Full output is no longer retained.");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["cancelled", "timed_out", "outcome_unknown"] as const)(
    "shows durable %s without offering active cancellation or read-only follow-up",
    (state) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      render(tree(runtime(fetch), { ...command, state, exit_code: null }, true));
      expect(screen.getByRole("status").textContent).toBe(state.replaceAll("_", " "));
      expect(screen.queryByRole("button", { name: "Cancel command" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Ask about this" })).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it("explicitly cancels only the bound active command", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ...command, state: "cancelled" }),
    );
    render(tree(runtime(fetch, "two"), { ...command, state: "started" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel command" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    expect(fetch.mock.calls[0][0]).toBe(
      "https://two.example/nac/sessions/same/user-commands/id/cancel",
    );
    expect(fetch.mock.calls[0][1]?.method).toBe("POST");
  });
});
