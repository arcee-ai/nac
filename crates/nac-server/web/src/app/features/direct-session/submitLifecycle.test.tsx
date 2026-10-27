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

for (const outcome of ["rejected", "not-sent", "uncertain"] as const) {
  it(`retains the prior stream and settles its prompt fence after current ${outcome} admission`, async () => {
    const client = new QueryClient();
    const admission = Promise.withResolvers<Awaited<ReturnType<typeof api.submitRun>>>();
    const submit = vi.spyOn(api, "submitRun").mockReturnValue(admission.promise);
    resetRuntime("a");
    runtimeStore.setState({
      streamText: "prior answer",
      streamReasoning: "prior reasoning",
      streamSettled: true,
    });
    const hook = renderHook(() => useSubmitRun(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    const command = hook.result.current.mutateAsync({ id: "a", prompt: "new prompt" });
    const failure = expect(command).rejects.toThrow();
    await vi.waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(runtimeStore.getState().streamPredatesPrompt).toBe(true);
    await act(async () => {
      if (outcome === "rejected") admission.reject(new Error("rejected"));
      else if (outcome === "not-sent")
        admission.resolve({ status: "not-sent", requestId: "aborted-request", reason: "aborted" });
      else
        admission.resolve({
          status: "uncertain",
          requestId: "uncertain-request",
          error: new Error("connection lost"),
        });
      await failure;
    });
    expect(runtimeStore.getState()).toMatchObject({
      optimisticUserPrompt: outcome === "uncertain" ? "new prompt" : null,
      streamPredatesPrompt: outcome === "uncertain",
      streamText: "prior answer",
      streamReasoning: "prior reasoning",
    });
    expect(submit).toHaveBeenCalledOnce();
    hook.unmount();
    client.clear();
  });
}
