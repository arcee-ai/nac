/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/app/services/api";
import {
  useMcpRuntimeAction,
  useMcpRuntimeStatus,
  useModelConfigs,
} from "@/app/services/queries/configuration";

function Harness({ modelsEnabled }: { modelsEnabled: boolean }) {
  const models = useModelConfigs(modelsEnabled);
  const runtime = useMcpRuntimeStatus();
  const action = useMcpRuntimeAction();
  return (
    <>
      <output>{runtime.isSuccess ? "Runtime ready" : "Runtime loading"}</output>
      <output>{models.isSuccess ? "Models ready" : "Models deferred"}</output>
      <button onClick={() => action.mutate({ serverName: "peer", action: "reload" })}>
        Reload MCP
      </button>
    </>
  );
}

afterEach(() => vi.restoreAllMocks());

it("keeps MCP runtime reload live while setup defers model discovery", async () => {
  const models = vi.spyOn(api, "listModelConfigs").mockResolvedValue({ configurations: [] });
  const runtime = vi.spyOn(api, "listMcpRuntimeStatus").mockResolvedValue({ servers: [] });
  const reload = vi.spyOn(api, "reloadMcpServer").mockResolvedValue({
    name: "peer",
    state: "connected",
    auth_required: false,
    required: false,
    tool_count: 0,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (modelsEnabled: boolean) => (
    <QueryClientProvider client={client}>
      <Harness modelsEnabled={modelsEnabled} />
    </QueryClientProvider>
  );
  const rendered = render(view(false));
  try {
    await screen.findByText("Runtime ready");
    expect(models).not.toHaveBeenCalled();
    expect(runtime.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
    fireEvent.click(screen.getByRole("button", { name: "Reload MCP" }));
    await waitFor(() => expect(reload).toHaveBeenCalledExactlyOnceWith("peer"));
    await waitFor(() => expect(runtime).toHaveBeenCalledTimes(2));
    expect(models).not.toHaveBeenCalled();
    rendered.rerender(view(true));
    await screen.findByText("Models ready");
    expect(models).toHaveBeenCalledTimes(1);
    expect(models.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  } finally {
    rendered.unmount();
    client.clear();
  }
});
