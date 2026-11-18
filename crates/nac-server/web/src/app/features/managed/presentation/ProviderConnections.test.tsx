/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ProviderConnections } from "./ProviderConnections";

const create = vi.hoisted(() => vi.fn().mockResolvedValue({ connection_id: "connection" }));
vi.mock("@/app/runtime/RuntimeContext", () => ({
  useNativeRuntime: () => ({ api: { createProviderConnection: create } }),
}));
vi.mock("./ManagedAuthCallout", () => ({ ManagedAuthCallout: () => null }));

it("saves a provider route without a model and clears the submitted key", async () => {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const view = render(
    <QueryClientProvider client={client}>
      <ProviderConnections />
    </QueryClientProvider>,
  );
  try {
    fireEvent.change(screen.getByLabelText("Endpoint URL (optional)"), {
      target: { value: "https://gateway.example/v1" },
    });
    fireEvent.change(screen.getByLabelText("API key"), { target: { value: "test-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith({
      backend: "openai-responses",
      base_url: "https://gateway.example/v1",
      allow_insecure_http: false,
      api_key: "test-secret",
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("saved"));
    expect((screen.getByLabelText("API key") as HTMLInputElement).value).toBe("");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["model-catalog"] });
  } finally {
    view.unmount();
    client.clear();
  }
});
