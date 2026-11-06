/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { HeartbeatPanel } from "./HeartbeatPanel";

const api = vi.hoisted(() => ({
  heartbeatInventory: vi.fn(),
  heartbeatInspection: vi.fn(),
  controlHeartbeat: vi.fn(),
}));
vi.mock("@/app/runtime/RuntimeContext", () => ({
  useNativeRuntime: () => ({
    api,
    stores: { sessionLayoutStore: { showSidePanelList: vi.fn() } },
  }),
}));
vi.mock("@/app/components/inspector/PanelSplit", () => ({
  PanelSplit: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PanelRow: () => null,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("shows an initial deep-link inspection failure before any schedule is loaded", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.heartbeatInventory.mockResolvedValue([]);
  api.heartbeatInspection.mockRejectedValue(new Error("Heartbeat could not be inspected (404)"));
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/?heartbeat=missing"]}>
        <HeartbeatPanel sessionId="chat" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Heartbeat could not be inspected (404)",
  );
  expect(screen.queryByText(/Choose a heartbeat/)).toBeNull();
  client.clear();
});
