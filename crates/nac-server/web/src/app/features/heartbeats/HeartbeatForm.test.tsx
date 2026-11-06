/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PresentationBoundary } from "@/app/providers/PresentationBoundary";
import type {
  HeartbeatCalendarPreview,
  HeartbeatCalendarRule,
  HeartbeatSpec,
} from "@/app/types/api";
import { HeartbeatForm } from "./HeartbeatForm";

const api = vi.hoisted(() => ({ previewHeartbeat: vi.fn() }));
vi.mock("@/app/runtime/RuntimeContext", () => ({ useNativeRuntime: () => ({ api }) }));
vi.mock("@/app/hooks/useMediaQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/hooks/useMediaQuery")>()),
  useIsMobile: () => false,
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.resetAllMocks();
});

const calendar: HeartbeatCalendarRule = {
  zone: "America/Los_Angeles",
  data_version: "2026f",
  hour: 9,
  minute: 0,
  days: { kind: "weekdays", days: [1, 3] },
};
const common = {
  name: "Job",
  instructions: "Check the job",
  skills: ["verification"],
  end_condition: "Finish when ready",
  goal_id: null,
  execution_timeout_ms: 300000,
  max_occurrences: 10,
  token_allowance: null,
};
function preview(rule: HeartbeatCalendarRule): HeartbeatCalendarPreview {
  return {
    calendar: rule,
    occurrences: [
      {
        due_ms: 1793638800000,
        utc: "2026-11-02T17:00:00Z",
        local: "2026-11-02T09:00:00",
      },
    ],
  };
}
function mount(initial: HeartbeatSpec) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  const submit = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <PresentationBoundary>
        <HeartbeatForm
          sessionId="chat"
          initial={initial}
          disabled={false}
          onSubmit={submit}
          onCancel={vi.fn()}
        />
      </PresentationBoundary>
    </QueryClientProvider>,
  );
  return submit;
}

it("binds save to the current pinned preview, including while an older zone response arrives", async () => {
  const pending: Array<(value: HeartbeatCalendarPreview) => void> = [];
  api.previewHeartbeat.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
  const submit = mount({ ...common, calendar });
  await waitFor(() => expect(pending).toHaveLength(1));
  const save = screen.getByRole("button", { name: "Save heartbeat" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  expect((screen.getByLabelText("IANA timezone") as HTMLInputElement).value).toBe(calendar.zone);
  fireEvent.change(screen.getByLabelText("IANA timezone"), { target: { value: "Asia/Kolkata" } });
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[0](preview(calendar)));
  expect(save.disabled).toBe(true);
  expect(screen.queryByRole("region", { name: "Upcoming calendar checks" })).toBeNull();
  const changed = { ...calendar, zone: "Asia/Kolkata" };
  const result = {
    calendar: changed,
    occurrences: [
      { due_ms: 1793590200000, utc: "2026-11-02T03:30:00Z", local: "2026-11-02T09:00:00" },
    ],
  };
  await act(async () => pending[1](result));
  await waitFor(() => expect(save.disabled).toBe(false));
  const upcoming = screen.getByRole("region", { name: "Upcoming calendar checks" });
  expect(upcoming.textContent).toContain("2026-11-02 09:00:00 · Asia/Kolkata");
  expect(upcoming.textContent).toContain("UTC 2026-11-02T03:30:00Z");
  expect(api.previewHeartbeat.mock.calls[1][1]).toEqual({ calendar: changed, count: 3 });
  fireEvent.click(save);
  expect(submit).toHaveBeenCalledExactlyOnceWith({ ...common, calendar: changed });
  expect(submit.mock.calls[0][0]).not.toHaveProperty("interval_ms");
});

it("keeps an invalid calendar unsaved and previews selected-day edits before saving", async () => {
  api.previewHeartbeat.mockRejectedValueOnce(new Error("unknown IANA timezone"));
  const submit = mount({ ...common, calendar: { ...calendar, zone: "Invalid/Zone" } });
  expect((await screen.findByRole("alert")).textContent).toBe("unknown IANA timezone");
  const save = screen.getByRole("button", { name: "Save heartbeat" }) as HTMLButtonElement;
  expect(save.disabled).toBe(true);
  fireEvent.submit(screen.getByRole("form", { name: "Edit heartbeat" }));
  expect(submit).not.toHaveBeenCalled();
  api.previewHeartbeat.mockImplementation((_session, request) =>
    Promise.resolve(preview(request.calendar)),
  );
  fireEvent.change(screen.getByLabelText("IANA timezone"), { target: { value: calendar.zone } });
  await waitFor(() => expect(save.disabled).toBe(false));
  fireEvent.click(screen.getByRole("checkbox", { name: "Friday" }));
  await waitFor(() =>
    expect(api.previewHeartbeat.mock.lastCall?.[1].calendar.days).toEqual({
      kind: "weekdays",
      days: [1, 3, 5],
    }),
  );
  await waitFor(() => expect(save.disabled).toBe(false));
  fireEvent.click(save);
  expect(submit).toHaveBeenCalledExactlyOnceWith({
    ...common,
    calendar: { ...calendar, days: { kind: "weekdays", days: [1, 3, 5] } },
  });
});

it("preserves interval payloads and previews daily and weekly rules through the cadence controls", async () => {
  api.previewHeartbeat.mockImplementation((_session, request) =>
    Promise.resolve(preview(request.calendar)),
  );
  const submit = mount({ ...common, interval_ms: 60000 });
  fireEvent.click(screen.getByRole("button", { name: "Save heartbeat" }));
  expect(submit).toHaveBeenCalledExactlyOnceWith({ ...common, interval_ms: 60000 });
  expect(api.previewHeartbeat).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cadence: Elapsed interval" }));
  fireEvent.click(await screen.findByRole("button", { name: "Daily at local time" }));
  await waitFor(() =>
    expect(api.previewHeartbeat.mock.lastCall?.[1].calendar.days).toEqual({ kind: "daily" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cadence: Daily at local time" }));
  fireEvent.click(await screen.findByRole("button", { name: "Weekly" }));
  fireEvent.click(screen.getByRole("button", { name: "Weekday: Monday" }));
  fireEvent.click(await screen.findByRole("button", { name: "Sunday" }));
  await waitFor(() =>
    expect(api.previewHeartbeat.mock.lastCall?.[1].calendar.days).toEqual({
      kind: "weekly",
      day: 7,
    }),
  );
  expect(
    within(screen.getByRole("form", { name: "Edit heartbeat" })).queryByLabelText(
      "Interval in minutes",
    ),
  ).toBeNull();
});
