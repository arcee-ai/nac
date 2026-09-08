/** @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ModelPicker } from "@/app/components/inspector/ModelPicker";
import { ToastProvider } from "@/app/providers/ToastProvider";
import { api } from "@/app/services/api";
import type { ManagedHostStatus, SessionMetadata } from "@/app/types/api";

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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("lists and persists another mounted-key model without exposing a browser credential", async () => {
  vi.spyOn(api, "getManagedStatus").mockResolvedValue({
    model_ready: true,
    model: {
      backend: "arcee-api",
      id: "trinity-large-thinking",
      endpoint: "https://api.arcee.ai/api/v1",
      display_name: "Managed Arcee",
    },
  } as ManagedHostStatus);
  const discovery = vi.spyOn(api, "listProviderModels").mockResolvedValue({
    base_url: "https://api.arcee.ai/api/v1",
    models: [
      { id: "trinity-large-thinking", display_name: "Trinity" },
      { id: "moonshotai/kimi-k3", display_name: "Kimi" },
    ],
  });
  const update = vi.spyOn(api, "updateConfig").mockResolvedValue(undefined);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <ModelPicker
          sessionId="managed-session"
          metadata={
            {
              backend: "arcee-api",
              model: "trinity-large-thinking",
              base_url: "https://api.arcee.ai/api/v1",
              api_key_env: null,
            } as SessionMetadata
          }
          label="Trinity"
          disabled={false}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
  try {
    await waitFor(() => expect(client.getQueryData(["managed-host-status"])).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Model" }));
    fireEvent.click(await screen.findByText("Kimi"));
    await waitFor(() =>
      expect(update).toHaveBeenCalledExactlyOnceWith("managed-session", {
        model: "moonshotai/kimi-k3",
      }),
    );
    expect(discovery).toHaveBeenCalledExactlyOnceWith({
      backend: "arcee-api",
      base_url: "https://api.arcee.ai/api/v1",
    });
    const request = discovery.mock.calls[0]?.[0];
    expect(request).not.toHaveProperty("api_key");
    expect(request).not.toHaveProperty("api_key_env");
  } finally {
    view.unmount();
    client.clear();
  }
});
