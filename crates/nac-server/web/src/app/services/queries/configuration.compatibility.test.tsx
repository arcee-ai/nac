/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/app/services/api";
import { useMcpRuntimeAction, useMcpRuntimeStatus } from "@/app/services/queries/configuration";

function Harness() {
  const runtime = useMcpRuntimeStatus();
  const action = useMcpRuntimeAction();
  return (
    <>
      <output>{runtime.isSuccess ? "Runtime ready" : "Runtime loading"}</output>
      <button onClick={() => action.mutate({ serverName: "peer", action: "reload" })}>
        Reload MCP
      </button>
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

it("keeps MCP runtime reload live independently of model selection", async () => {
  const runtime = vi.spyOn(api, "listMcpRuntimeStatus").mockResolvedValue({ servers: [] });
  const reload = vi.spyOn(api, "reloadMcpServer").mockResolvedValue({
    name: "peer",
    state: "connected",
    auth_required: false,
    required: false,
    sessions_blocked: false,
    tool_count: 0,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>
  );
  const rendered = render(view());
  try {
    await screen.findByText("Runtime ready");
    expect(runtime.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    fireEvent.click(screen.getByRole("button", { name: "Reload MCP" }));
    await waitFor(() => expect(reload).toHaveBeenCalledExactlyOnceWith("peer"));
    await waitFor(() => expect(runtime).toHaveBeenCalledTimes(2));
  } finally {
    rendered.unmount();
    client.clear();
  }
});
