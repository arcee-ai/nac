/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { HeartbeatInspection, HeartbeatReceipt, HeartbeatSchedule } from "@/app/types/api";
import { heartbeatKey, useHeartbeats } from "./queries";

const api = vi.hoisted(() => ({
  heartbeatInventory: vi.fn(),
  heartbeatInspection: vi.fn(),
  controlHeartbeat: vi.fn(),
}));
vi.mock("@/app/runtime/RuntimeContext", () => ({ useNativeRuntime: () => ({ api }) }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("keeps a same-version suspension when a lost acknowledgement retries the original receipt", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const schedule: HeartbeatSchedule = {
    schedule_id: "schedule",
    session_id: "chat",
    version: 1,
    state: "active",
    binding: {
      config_version: 1,
      cwd: "/repo",
      backend: "local",
      project_id: null,
      execution_cwd: "/repo",
      scheduling_request: "Check job",
      seen_through_sequence: 0,
    },
    spec: {
      name: "Job",
      instructions: "Check job",
      end_condition: "Ready",
      skills: [],
      interval_ms: 60000,
      execution_timeout_ms: 300000,
      max_occurrences: 10,
      goal_id: null,
      token_allowance: null,
    },
    anchor_ms: 1,
    next_due_ms: 60001,
    reason: null,
    starts: 0,
    tokens_used: 0,
    time_used_ms: 0,
    usage_unknown: false,
    created_at_ms: 1,
    updated_at_ms: 1,
  };
  const current: HeartbeatInspection = {
    schedule: {
      ...schedule,
      state: "suspended",
      reason: "Admission requires review",
      updated_at_ms: 2,
    },
    history: [],
  };
  api.heartbeatInventory.mockResolvedValue([current.schedule]);
  api.heartbeatInspection.mockResolvedValue(current);
  const receipt: HeartbeatReceipt = {
    schedule,
    occurrence: null,
    active_occurrence: null,
    request_id: "original",
  };
  api.controlHeartbeat
    .mockRejectedValueOnce(new TypeError("lost acknowledgement"))
    .mockResolvedValueOnce(receipt);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useHeartbeats("chat", "schedule"), { wrapper });
  await waitFor(() => expect(hook.result.current.inspection.data).toEqual(current));
  act(() => hook.result.current.submit({ action: "create", spec: schedule.spec }));
  await waitFor(() => expect(hook.result.current.error).toBeTruthy());
  act(() => hook.result.current.retry());
  await waitFor(() => expect(hook.result.current.control.isSuccess).toBe(true));
  expect(api.controlHeartbeat.mock.calls[0][1]).toEqual(api.controlHeartbeat.mock.calls[1][1]);
  expect(client.getQueryData([...heartbeatKey("chat"), "schedule"])).toEqual(current);
  client.clear();
});
