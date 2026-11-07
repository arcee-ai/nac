/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError } from "@/app/services/api";
import type {
  FreshTaskDestination,
  FreshTaskScheduleInspection,
  HeartbeatReceipt,
  HeartbeatSchedule,
} from "@/app/types/api";
import { freshScheduleKey, useFreshTaskSchedules, useFreshRetainedAllowance } from "./queries";

const api = vi.hoisted(() => ({
  freshTaskScheduleInventory: vi.fn(),
  freshTaskScheduleInspection: vi.fn(),
  controlFreshTaskSchedule: vi.fn(),
  heartbeatInventory: vi.fn(),
  changeFreshTaskRetainedAllowance: vi.fn(),
}));
vi.mock("@/app/runtime/RuntimeContext", () => ({ useNativeRuntime: () => ({ api }) }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("retries one frozen host allowance change without overwriting newer passive inventory", async () => {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: 3 } } });
  const latest = { revision: 3, retained_limit: 4, retained_count: 3 };
  client.setQueryData([...freshScheduleKey("project"), "schedule"], { host_allowance: latest });
  const accepted = vi.fn();
  api.changeFreshTaskRetainedAllowance
    .mockRejectedValueOnce(new TypeError("lost acknowledgement"))
    .mockResolvedValueOnce({
      request_id: "original",
      allowance: { revision: 2, retained_limit: 2, retained_count: 0 },
    });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const h = renderHook(() => useFreshRetainedAllowance("project", accepted), { wrapper });
  act(() => h.result.current.submit(1, 2));
  await waitFor(() => expect(h.result.current.error).toBeTruthy());
  expect(api.changeFreshTaskRetainedAllowance).toHaveBeenCalledTimes(1);
  const original = structuredClone(api.changeFreshTaskRetainedAllowance.mock.calls[0]);
  act(() => h.result.current.submit(3, 5));
  expect(api.changeFreshTaskRetainedAllowance).toHaveBeenCalledTimes(1);
  act(() => h.result.current.retry());
  await waitFor(() => expect(accepted).toHaveBeenCalledTimes(1));
  expect(api.changeFreshTaskRetainedAllowance.mock.calls[1]).toEqual(original);
  expect(client.getQueryData([...freshScheduleKey("project"), "schedule"])).toEqual({
    host_allowance: latest,
  });
  client.clear();
});

const destination: FreshTaskDestination = {
  project_id: "project",
  pinned_commit: null,
  default_ref: "main",
  model: null,
  reasoning_effort: null,
  retained_limit: 2,
};
const schedule: HeartbeatSchedule = {
  schedule_id: "schedule",
  session_id: null,
  version: 1,
  state: "active",
  binding: {
    config_version: 1,
    cwd: "/repo",
    project_id: "project",
    backend: "local",
    execution_cwd: "/repo",
    scheduling_request: "Run isolated inspections",
    seen_through_sequence: 0,
    fresh_task: destination,
  },
  spec: {
    name: "Inspection",
    instructions: "Inspect seed",
    skills: [],
    interval_ms: 60000,
    end_condition: "Keep each result separate",
    goal_id: null,
    execution_timeout_ms: 30000,
    max_occurrences: 10,
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

function hook() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 3 } },
  });
  const current: FreshTaskScheduleInspection = {
    heartbeat: {
      schedule: { ...schedule, state: "suspended", reason: "Retained allowance exhausted" },
      history: [],
    },
    inventory: [],
    launches: [],
    host_retained_limit: 100,
    host_allowance: { revision: 1, retained_limit: 100, retained_count: 0 },
  };
  api.freshTaskScheduleInventory.mockResolvedValue([current.heartbeat.schedule]);
  api.freshTaskScheduleInspection.mockResolvedValue(current);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    current,
    ...renderHook(() => useFreshTaskSchedules("project", "schedule"), { wrapper }),
  };
}

it("freezes uncertain control intent, retries identically and keeps the latest passive inspection", async () => {
  const receipt: HeartbeatReceipt = {
    request_id: "receipt",
    schedule,
    occurrence: null,
    active_occurrence: null,
  };
  api.controlFreshTaskSchedule
    .mockRejectedValueOnce(new TypeError("lost acknowledgement"))
    .mockResolvedValueOnce(receipt);
  const h = hook();
  await waitFor(() => expect(h.result.current.inspection.data).toEqual(h.current));
  act(() => h.result.current.submit({ action: "create", spec: schedule.spec }, destination));
  await waitFor(() => expect(h.result.current.error).toBeTruthy());
  expect(api.controlFreshTaskSchedule).toHaveBeenCalledTimes(1);
  const first = structuredClone(api.controlFreshTaskSchedule.mock.calls[0]);
  act(() => {
    h.result.current.submit(
      { action: "create", spec: { ...schedule.spec, name: "Different intent" } },
      { ...destination, retained_limit: 3 },
    );
    h.result.current.reviewLatest();
  });
  expect(api.controlFreshTaskSchedule).toHaveBeenCalledTimes(1);
  expect(h.result.current.intent).not.toBeNull();
  act(() => h.result.current.retry());
  await waitFor(() => expect(h.result.current.control.isSuccess).toBe(true));
  expect(api.controlFreshTaskSchedule.mock.calls[1]).toEqual(first);
  expect(h.client.getQueryData([...freshScheduleKey("project"), "schedule"])).toEqual(h.current);
  h.client.clear();
});

it("requires explicit review after a version conflict before allowing a new intent", async () => {
  api.controlFreshTaskSchedule.mockRejectedValue(
    new ApiError(409, "POST", "/control", "conflict: schedule changed", "request"),
  );
  const h = hook();
  act(() =>
    h.result.current.submit(
      { action: "pause", schedule_id: "schedule", expected_version: 1 },
      null,
    ),
  );
  await waitFor(() => expect(h.result.current.rejected).toBe(true));
  const original = h.result.current.intent?.request_id;
  act(() =>
    h.result.current.submit(
      { action: "pause", schedule_id: "schedule", expected_version: 2 },
      null,
    ),
  );
  expect(api.controlFreshTaskSchedule).toHaveBeenCalledTimes(1);
  expect(h.result.current.intent?.request_id).toBe(original);
  act(() => h.result.current.reviewLatest());
  await waitFor(() => expect(h.result.current.intent).toBeNull());
  act(() =>
    h.result.current.submit(
      { action: "pause", schedule_id: "schedule", expected_version: 2 },
      null,
    ),
  );
  await waitFor(() => expect(api.controlFreshTaskSchedule).toHaveBeenCalledTimes(2));
  expect(h.result.current.intent?.request_id).not.toBe(original);
  expect(api.controlFreshTaskSchedule.mock.calls[1][1].operation.expected_version).toBe(2);
  h.client.clear();
});
