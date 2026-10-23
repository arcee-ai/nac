/** @vitest-environment jsdom */
import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ORCHESTRATION_UI_POLICY } from "@/app/features/ui-policy/policy";
import { UiPolicyContext } from "@/app/features/ui-policy/UiPolicyContext";
import { RuntimeContext } from "@/app/runtime/RuntimeContext";
import { createNativeRuntime } from "@/app/runtime/nativeRuntime";
import { createNacClient } from "@/app/services/nacClient";
import type { ManagedOrchestratorRecord, TraditionalChildRecord } from "@/app/types/api";
import {
  useCancelManagedOrchestrator,
  useCancelTraditionalChild,
  useManagedOrchestrators,
  useStartManagedOrchestrator,
  useStartTraditionalChild,
  useTraditionalChildren,
} from "./direct";
import { queryKeys } from "./keys";

const runtimes: ReturnType<typeof createNativeRuntime>[] = [];
afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.close();
});

function record(generation: number, version: number) {
  return {
    child_session_id: "target",
    orchestrator_session_id: "target",
    parent_session_id: "parent",
    root_session_id: "parent",
    profile: "general",
    description: "Inspect the lifecycle",
    nesting_depth: 1,
    status: "completed",
    generation,
    version,
    run_id: `run-${generation}`,
    execution_mode: "foreground",
    report: `result-${generation}`,
    failure: null,
    change_summary: null,
    verification_summary: null,
    completion_inbox_id: null,
    created_at: "2026-10-22T00:00:00Z",
    updated_at: "2026-10-22T00:00:00Z",
  } satisfies TraditionalChildRecord & ManagedOrchestratorRecord;
}

function mount(fetch: typeof globalThis.fetch) {
  const runtime = createNativeRuntime({
    scope: {
      owner: "owner",
      profile: "profile",
      organization: "org",
      host: "host",
      incarnation: "incarnation",
      endpoint: "/api",
      release: "release",
    },
    client: createNacClient({ endpoint: "/api", fetch }),
  });
  runtimes.push(runtime);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <RuntimeContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>
        <UiPolicyContext.Provider value={ORCHESTRATION_UI_POLICY}>
          {children}
        </UiPolicyContext.Provider>
      </QueryClientProvider>
    </RuntimeContext.Provider>
  );
  return { client: runtime.queryClient, wrapper };
}

for (const [mode, useList, key] of [
  ["child", useTraditionalChildren, queryKeys.traditionalChildren],
  ["orchestrator", useManagedOrchestrators, queryKeys.managedOrchestrators],
] as const) {
  it(`${mode} cache keeps newer generations and versions when earlier commands finish late`, async () => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi.fn(() => response.promise);
    const { client, wrapper } = mount(fetch);
    const hook = renderHook(
      () => ({
        startChild: useStartTraditionalChild(),
        startOrchestrator: useStartManagedOrchestrator(),
        cancelChild: useCancelTraditionalChild(),
        cancelOrchestrator: useCancelManagedOrchestrator(),
      }),
      { wrapper },
    );
    const current = record(3, 8);
    client.setQueryData(key("parent"), [current]);
    let command!: Promise<unknown>;
    act(() => {
      command =
        mode === "child"
          ? hook.result.current.startChild.mutateAsync({
              sessionId: "parent",
              payload: {
                profile: "general",
                description: current.description,
                prompt: "a different message",
                child_session_id: "target",
                background: false,
              },
            })
          : hook.result.current.startOrchestrator.mutateAsync({
              sessionId: "parent",
              payload: {
                description: current.description,
                prompt: "a different message",
                orchestrator_session_id: "target",
                background: false,
              },
            });
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    await act(async () => {
      response.resolve(Response.json(record(2, 4)));
      await command;
    });
    expect(client.getQueryData(key("parent"))).toEqual([current]);

    fetch.mockResolvedValueOnce(Response.json(record(3, 7)));
    await act(async () => {
      if (mode === "child")
        await hook.result.current.cancelChild.mutateAsync({
          sessionId: "parent",
          childId: "target",
        });
      else
        await hook.result.current.cancelOrchestrator.mutateAsync({
          sessionId: "parent",
          orchestratorId: "target",
        });
    });
    expect(client.getQueryData(key("parent"))).toEqual([current]);
  });

  it(`${mode} polling cannot rewind a newer record and a fresh empty list removes it`, async () => {
    const response = Promise.withResolvers<Response>();
    const fetch = vi.fn(() => response.promise);
    const { client, wrapper } = mount(fetch);
    client.setQueryData(key("parent"), [record(2, 4)]);
    const hook = renderHook(() => useList("parent", false), { wrapper });
    let poll!: ReturnType<typeof hook.result.current.refetch>;
    act(() => {
      poll = hook.result.current.refetch();
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    const current = record(3, 8);
    act(() => client.setQueryData(key("parent"), [current]));
    await act(async () => {
      response.resolve(Response.json([record(2, 5)]));
      await poll;
    });
    expect(client.getQueryData(key("parent"))).toEqual([current]);
    fetch.mockResolvedValueOnce(Response.json([]));
    await act(async () => {
      await hook.result.current.refetch();
    });
    expect(client.getQueryData(key("parent"))).toEqual([]);
  });
}
