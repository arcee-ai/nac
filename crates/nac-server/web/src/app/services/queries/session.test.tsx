/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { api } from "@/app/services/api";
import { queryKeys } from "@/app/services/queries/keys";
import { useUpdateConfig } from "@/app/services/queries/session";

it("keeps a configuration change pending until the active snapshot refreshes", async () => {
  const refresh = Promise.withResolvers<string>();
  const update = vi.spyOn(api, "updateConfig").mockResolvedValueOnce(undefined);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Harness() {
    const snapshot = useQuery({
      queryKey: queryKeys.sessionSnapshot("s"),
      queryFn: () => refresh.promise,
      initialData: "old",
      staleTime: Infinity,
    });
    const mutation = useUpdateConfig();
    return (
      <>
        <output data-testid="snapshot">{snapshot.data}</output>
        <output data-testid="state">{mutation.status}</output>
        <button
          disabled={mutation.isPending}
          onClick={() => mutation.mutate({ id: "s", patch: { service_tier: "fast" } })}
        >
          Save
        </button>
      </>
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  fireEvent.click(view.getByText("Save"));
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  await waitFor(() => expect(view.getByTestId("state").textContent).toBe("pending"));
  expect((view.getByText("Save") as HTMLButtonElement).disabled).toBe(true);
  expect(view.getByTestId("snapshot").textContent).toBe("old");
  await act(async () => {
    refresh.resolve("updated");
    await refresh.promise;
  });
  await waitFor(() => expect(view.getByTestId("state").textContent).toBe("success"));
  expect(view.getByTestId("snapshot").textContent).toBe("updated");
  view.unmount();
  client.clear();
  update.mockRestore();
});

it("does not refresh a rejected configuration change", async () => {
  const update = vi.spyOn(api, "updateConfig").mockRejectedValueOnce(new Error("rejected"));
  const fetch = vi.fn().mockResolvedValue("updated");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Harness() {
    useQuery({
      queryKey: queryKeys.sessionSnapshot("s"),
      queryFn: fetch,
      initialData: "old",
      staleTime: Infinity,
    });
    const mutation = useUpdateConfig();
    return (
      <>
        <output data-testid="state">{mutation.status}</output>
        <button onClick={() => mutation.mutate({ id: "s", patch: { service_tier: "fast" } })}>
          Save
        </button>
      </>
    );
  }
  const view = render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  fireEvent.click(view.getByText("Save"));
  await waitFor(() => expect(view.getByTestId("state").textContent).toBe("error"));
  expect(fetch).not.toHaveBeenCalled();
  expect(client.getQueryData(queryKeys.sessionSnapshot("s"))).toBe("old");
  view.unmount();
  client.clear();
  update.mockRestore();
});
