/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/app/services/api";
import { UncertainCommandAdmissionError } from "@/app/services/nacClient";
import { queryKeys, useSubmitRun } from "@/app/services/queries";
import { resetRuntime, runtimeStore, setOptimisticUserPrompt } from "@/app/store/runtimeStore";

afterEach(() => {
  vi.restoreAllMocks();
  resetRuntime(null);
});

for (const outcome of ["rejected", "uncertain"] as const) {
  it(`settles a late ${outcome} in its origin without changing a reopened chat`, async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } });
    const admission = Promise.withResolvers<Awaited<ReturnType<typeof api.submitRun>>>();
    const submit = vi.spyOn(api, "submitRun").mockReturnValue(admission.promise);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    resetRuntime("a");
    const hook = renderHook(() => useSubmitRun(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    const command = hook.result.current.mutateAsync({ id: "a", prompt: "old prompt" });
    const failed =
      outcome === "uncertain"
        ? expect(command).rejects.toBeInstanceOf(UncertainCommandAdmissionError)
        : expect(command).rejects.toThrow("rejected");
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(runtimeStore.getState().optimisticUserPrompt).toBe("old prompt");
    hook.unmount();
    resetRuntime("a");
    setOptimisticUserPrompt("new prompt");
    const next = runtimeStore.getState();
    await act(async () => {
      if (outcome === "uncertain")
        admission.resolve({
          status: "uncertain",
          requestId: "origin-request",
          error: new Error("connection lost"),
        });
      else admission.reject(new Error("rejected"));
      await failed;
    });
    expect(runtimeStore.getState()).toBe(next);
    expect(submit).toHaveBeenCalledOnce();
    if (outcome === "uncertain")
      expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.sessionRoot("a") });
    client.clear();
  });
}
