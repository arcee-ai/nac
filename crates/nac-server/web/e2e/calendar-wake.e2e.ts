import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createProject, createSession, expect, test } from "./harness";
import { ScriptGate } from "./scripted-provider";
import type { HeartbeatInspection, ManagedSessionSummary } from "../src/app/types/api";

test.use({ managedNativeWeb: false });

test("native calendar edit ends the chat then wakes at a real future minute and finishes", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(160000);
  const project = await createProject(request, harness);
  const session = await createSession(request, harness, "direct", project);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  const workspace = path.join(harness.runRoot, "workspace");
  await fs.writeFile(path.join(workspace, "calendar-ready.txt"), "JOB_READY\n");
  const common = {
    name: "Future calendar wake",
    instructions: "Read calendar-ready.txt and finish when JOB_READY is present.",
    skills: [],
    end_condition: "Finish once JOB_READY is present.",
    goal_id: null,
    execution_timeout_ms: 30000,
    max_occurrences: 10,
    token_allowance: 100000,
  };
  const initial = await request.post(`${harness.baseUrl}/sessions/${session}/heartbeats/control`, {
    data: {
      request_id: randomUUID(),
      operation: {
        action: "create",
        spec: {
          ...common,
          calendar: {
            zone: "America/Los_Angeles",
            data_version: "2026f",
            hour: 9,
            minute: 0,
            days: { kind: "weekdays", days: [1, 2, 3, 4, 5] },
          },
        },
      },
    },
  });
  expect(initial.status()).toBe(200);
  const { schedule } = await initial.json();
  const due = Math.floor((Date.now() + 90000) / 60000) * 60000;
  const target = new Date(due);
  const calendar = {
    zone: "Etc/UTC",
    data_version: "2026f",
    hour: target.getUTCHours(),
    minute: target.getUTCMinutes(),
    days: { kind: "weekly", day: ((target.getUTCDay() + 6) % 7) + 1 },
  };
  harness.provider.enqueue(
    "future-calendar-preview",
    {
      token: "FUTURE_CALENDAR_HUMAN_EDIT",
      requiredTools: ["preview_heartbeat", "heartbeat_control"],
    },
    {
      kind: "function_call",
      stream: "request",
      name: "preview_heartbeat",
      callId: "future-preview",
      arguments: { calendar, count: 3 },
    },
  );
  harness.provider.enqueue(
    "future-calendar-edit",
    { functionOutputCallId: "future-preview" },
    {
      kind: "function_call",
      stream: "request",
      name: "heartbeat_control",
      callId: "future-edit",
      arguments: {
        request_id: randomUUID(),
        operation: {
          action: "edit",
          schedule_id: schedule.schedule_id,
          expected_version: 1,
          spec: { ...common, calendar },
        },
      },
    },
  );
  harness.provider.enqueue(
    "future-edit-ended",
    { functionOutputCallId: "future-edit" },
    {
      kind: "text",
      stream: "request",
      text: "The exact future UTC calendar check is saved; this turn is done.",
    },
  );
  await page.goto(`${harness.baseUrl}/#/session/${session}/heartbeats`);
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
        data: {
          prompt: `FUTURE_CALENDAR_HUMAN_EDIT: Preview and edit existing heartbeat ${schedule.schedule_id} version1 to weekly day${calendar.days.day} at ${String(calendar.hour).padStart(2, "0")}:${String(calendar.minute).padStart(2, "0")} Etc/UTC. Keep the saved instructions and finish once JOB_READY is present. Do this scheduled check after this chat turn ends.`,
        },
      })
    ).status(),
  ).toBe(202);
  await expect(
    page.getByText("The exact future UTC calendar check is saved; this turn is done.", {
      exact: true,
    }),
  ).toBeVisible();
  const inspect = async (): Promise<HeartbeatInspection> =>
    (
      await request.get(`${harness.baseUrl}/sessions/${session}/heartbeats/${schedule.schedule_id}`)
    ).json();
  const before = await inspect();
  expect(before.schedule.version).toBe(2);
  expect(before.schedule.next_due_ms).toBe(due);
  expect(before.schedule.spec.calendar).toEqual(calendar);
  expect(before.history).toEqual([]);
  await expect
    .poll(async () => {
      const entries: ManagedSessionSummary[] = await (
        await request.get(`${harness.baseUrl}/sessions`)
      ).json();
      return entries[0].active_run ?? null;
    })
    .toBeNull();
  const endedAt = Date.now();
  expect(endedAt).toBeLessThan(due);
  await page.close();
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "future-calendar-read",
    { token: "Durable heartbeat occurrence", requiredTools: ["read", "report_heartbeat"] },
    {
      kind: "function_call",
      stream: "request",
      name: "read",
      callId: "future-read",
      arguments: { path: path.join(workspace, "calendar-ready.txt") },
    },
    gate,
  );
  // This journey waits for the actual clock. It does not seed a due cursor,
  // use Run now, or inject a clock into the production scheduler.
  await gate.accepted;
  const observedAt = Date.now();
  const active = (await inspect()).history.find((item) => item.state === "admitted")!;
  expect(observedAt).toBeGreaterThanOrEqual(due);
  expect(active).toMatchObject({
    schedule_version: 2,
    due_first_ms: due,
    due_last_ms: due,
    coalesced_count: 1,
    run_now: false,
  });
  expect(active.spec.calendar).toEqual(calendar);
  harness.provider.enqueue(
    "future-calendar-report",
    { functionOutputCallId: "future-read" },
    {
      kind: "function_call",
      stream: "request",
      name: "report_heartbeat",
      callId: "future-report",
      arguments: {
        occurrence_id: active.occurrence_id,
        generation: active.generation,
        expected_revision: active.revision,
        outcome: "finished",
        evidence: "calendar-ready.txt contains JOB_READY at the actual scheduled minute.",
      },
    },
  );
  harness.provider.enqueue(
    "future-calendar-finished",
    { functionOutputCallId: "future-report" },
    {
      kind: "text",
      stream: "request",
      text: "The calendar job is ready and the schedule has finished.",
    },
  );
  gate.release();
  await expect
    .poll(async () => (await inspect()).schedule.state, { timeout: 15000 })
    .toBe("finished");
  const finished = await inspect();
  expect(finished.schedule.starts).toBe(1);
  expect(finished.history).toHaveLength(1);
  expect(finished.history[0]).toMatchObject({
    run_id: active.run_id,
    outcome: "finished",
    state: "settled",
  });
  const sessions: ManagedSessionSummary[] = await (
    await request.get(`${harness.baseUrl}/sessions`)
  ).json();
  expect(sessions.map((item) => item.summary.session_id)).toEqual([session]);
  expect(sessions[0].heartbeat_results).toEqual([
    expect.objectContaining({ run_id: active.run_id, outcome: "finished", seen: false }),
  ]);
  expect(await api.getGoal(session)).toBeNull();
  await info.attach("actual-calendar-wake", {
    body: JSON.stringify(
      { before, endedAt, due, observedAt, lateness_ms: observedAt - due, active, finished },
      null,
      2,
    ),
    contentType: "application/json",
  });
  harness.provider.assertConsumed();
});
