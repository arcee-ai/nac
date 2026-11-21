/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { api } from "@/app/services/api";
import { UncertainCommandAdmissionError } from "@/app/services/nacClient";
import { queryKeys, useSessionSnapshot, useSubmitRun } from "@/app/services/queries";
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

it("binds only the newest submission even when an older acceptance arrives last", async () => {
  const client = new QueryClient();
  const first = Promise.withResolvers<Awaited<ReturnType<typeof api.submitRun>>>();
  const second = Promise.withResolvers<Awaited<ReturnType<typeof api.submitRun>>>();
  vi.spyOn(api, "submitRun").mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  resetRuntime("a");
  const hook = renderHook(() => useSubmitRun(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  const a = hook.result.current.mutateAsync({ id: "a", prompt: "same" });
  await vi.waitFor(() => expect(api.submitRun).toHaveBeenCalledTimes(1));
  const b = hook.result.current.mutateAsync({ id: "a", prompt: "same" });
  await vi.waitFor(() => expect(api.submitRun).toHaveBeenCalledTimes(2));
  await act(async () => {
    second.resolve({
      status: "accepted",
      requestId: "b",
      response: { run_id: "run-b", display_prompt: "same" },
    });
    await b;
  });
  await act(async () => {
    first.resolve({
      status: "accepted",
      requestId: "a",
      response: { run_id: "run-a", display_prompt: "same" },
    });
    await a;
  });
  expect(runtimeStore.getState()).toMatchObject({
    optimisticUserPrompt: "same",
    optimisticPromptRunId: "run-b",
  });
  hook.unmount();
  client.clear();
});

it("cancels an older snapshot and starts a run-bound read after acceptance", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const first = Promise.withResolvers<Awaited<ReturnType<typeof api.getSession>>>();
  const run = Promise.withResolvers<Awaited<ReturnType<typeof api.submitRun>>>();
  const get = vi
    .spyOn(api, "getSession")
    .mockImplementationOnce(() => first.promise)
    .mockImplementation(
      async () =>
        ({
          metadata: { session_id: "a", behavior: "direct" },
          messages: [],
          message_created_at: [],
          message_page: { start: 0, end: 0, total: 0, has_older: false },
          response_timing: { response_durations_ms: [] },
        }) as never,
    );
  vi.spyOn(api, "submitRun").mockReturnValue(run.promise);
  resetRuntime("a");
  const hook = renderHook(() => ({ snapshot: useSessionSnapshot("a"), submit: useSubmitRun() }), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  const command = hook.result.current.submit.mutateAsync({ id: "a", prompt: "hello" });
  await act(async () => {
    run.resolve({
      status: "accepted",
      requestId: "request",
      response: { run_id: "accepted-run", display_prompt: "hello" },
    });
    await command;
  });
  await vi.waitFor(() =>
    expect(get.mock.calls.some(([, options]) => options?.promptRunId === "accepted-run")).toBe(
      true,
    ),
  );
  expect(get.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(get.mock.calls.every(([, options]) => options?.includeSystem === true)).toBe(true);
  hook.unmount();
  client.clear();
});

it("requests exact proof once for a remotely observed active run", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const base = {
    metadata: { session_id: "a", behavior: "direct" },
    messages: [],
    message_created_at: [],
    message_page: { start: 0, end: 0, total: 0, has_older: false },
    response_timing: { response_durations_ms: [] },
    active_run: {
      run_id: "remote-run",
      started_at_epoch_ms: 1,
      prompt_preview: "prompt",
      submitted_user_message: { run_id: "remote-run", content: "prompt", submitted_at_epoch_ms: 1 },
    },
  };
  const get = vi.spyOn(api, "getSession").mockResolvedValue(base as never);
  resetRuntime("a");
  const hook = renderHook(() => useSessionSnapshot("a"), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  await vi.waitFor(() =>
    expect(get.mock.calls.some(([, options]) => options?.promptRunId === "remote-run")).toBe(true),
  );
  expect(get.mock.calls.every(([, options]) => options?.includeSystem === true)).toBe(true);
  hook.unmount();
  client.clear();
});
