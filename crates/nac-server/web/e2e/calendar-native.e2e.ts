import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createProject, createSession, expect, showSidePanel, test } from "./harness";
import { ScriptGate } from "./scripted-provider";
import type {
  HeartbeatInspection,
  HeartbeatSchedule,
  ManagedSessionSummary,
} from "../src/app/types/api";

test.use({ managedNativeWeb: false });

test("native calendar preview and creation survive an ended chat and restart; unchanged remains quiet", async ({
  harness,
  page,
  request,
  context,
}, info) => {
  test.setTimeout(120000);
  const workspace = path.join(harness.runRoot, "workspace");
  const skill = path.join(workspace, ".agents/skills/verification");
  await fs.mkdir(skill, { recursive: true });
  await fs.writeFile(
    path.join(skill, "SKILL.md"),
    "---\nname: verification\ndescription: Verify the disposable Local calendar job.\n---\nCALENDAR_VERIFICATION_SKILL_TOKEN: Read calendar-result.txt and retain evidence.\n",
  );
  await fs.writeFile(path.join(workspace, "calendar-result.txt"), "No change.\n");
  const project = await createProject(request, harness);
  const session = await createSession(request, harness, "direct", project);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  const calendar = {
    zone: "America/Los_Angeles",
    data_version: "2026f",
    hour: 9,
    minute: 0,
    days: { kind: "weekdays", days: [1, 2, 3, 4, 5] },
  };
  const spec = {
    name: "Native weekday calendar check",
    instructions:
      "Check calendar-result.txt with the verification skill and report unchanged while it says No change.",
    skills: ["verification"],
    calendar,
    end_condition: "Finish once JOB_READY is present.",
    goal_id: null,
    execution_timeout_ms: 30000,
    max_occurrences: 10,
    token_allowance: 100000,
  };
  harness.provider.enqueue(
    "calendar-preview",
    {
      token: "CALENDAR_SAME_CHAT_CONTEXT_TOKEN",
      requiredTools: ["preview_heartbeat", "heartbeat_control"],
    },
    {
      kind: "function_call",
      stream: "request",
      name: "preview_heartbeat",
      callId: "calendar-preview",
      arguments: {
        calendar: { ...calendar, data_version: null, days: { ...calendar.days, day: null } },
        count: 3,
      },
    },
  );
  harness.provider.enqueue(
    "calendar-create",
    { functionOutputCallId: "calendar-preview" },
    {
      kind: "function_call",
      stream: "request",
      name: "heartbeat_control",
      callId: "calendar-create",
      arguments: {
        request_id: randomUUID(),
        operation: {
          action: "create",
          schedule_id: null,
          expected_version: null,
          spec: { ...spec, interval_ms: null },
        },
      },
    },
  );
  harness.provider.enqueue(
    "calendar-created-ended",
    { functionOutputCallId: "calendar-create" },
    {
      kind: "text",
      stream: "request",
      text: "Weekdays at 09:00 America/Los_Angeles are scheduled in this chat.",
    },
  );
  await page.goto(`${harness.baseUrl}/#/session/${session}/heartbeats`);
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
        data: {
          prompt:
            "CALENDAR_SAME_CHAT_CONTEXT_TOKEN: Preview and schedule this Local job in this same chat on Monday through Friday at 09:00 America/Los_Angeles using $verification until JOB_READY is present. Report unchanged quietly when there is no change.",
        },
      })
    ).status(),
  ).toBe(202);
  await expect(
    page.getByText("Weekdays at 09:00 America/Los_Angeles are scheduled in this chat.", {
      exact: true,
    }),
  ).toBeVisible();
  let schedules: HeartbeatSchedule[] = [];
  await expect
    .poll(async () => {
      schedules = await (
        await request.get(`${harness.baseUrl}/heartbeats?session_id=${session}`)
      ).json();
      return schedules.length;
    })
    .toBe(1);
  const schedule = schedules[0];
  expect(schedule.spec.calendar).toEqual(calendar);
  expect(schedule.spec).not.toHaveProperty("interval_ms");
  const inspect = async (): Promise<HeartbeatInspection> =>
    (
      await request.get(`${harness.baseUrl}/sessions/${session}/heartbeats/${schedule.schedule_id}`)
    ).json();
  const listing = async (): Promise<ManagedSessionSummary> => {
    const entries: ManagedSessionSummary[] = await (
      await request.get(`${harness.baseUrl}/sessions`)
    ).json();
    expect(entries.map((entry) => entry.summary.session_id)).toEqual([session]);
    return entries[0];
  };
  await expect.poll(async () => (await listing()).active_run ?? null).toBeNull();
  const before = await listing();
  expect(await api.getGoal(session)).toBeNull();
  expect((await inspect()).history).toEqual([]);
  await page.close();
  // This stopped-store fixture models missed wall-clock time. It does not
  // change the host clock or claim that a real day elapsed during this test.
  // The production pinned engine must accept this canonical LA weekday due.
  const owned = JSON.parse(await fs.readFile(path.join(harness.runRoot, "process.json"), "utf8"));
  expect(owned.binaryPath).toBe(harness.binaryPath);
  expect(owned.baseUrl).toBe(harness.baseUrl);
  process.kill(owned.pid, "SIGTERM");
  await expect
    .poll(() => {
      try {
        process.kill(owned.pid, 0);
        return false;
      } catch {
        return true;
      }
    })
    .toBe(true);
  const { stdout } = await promisify(execFile)("python3", [
    "-c",
    `
import datetime,json,pathlib,sqlite3,sys
from zoneinfo import ZoneInfo
db,schedule,session,root=sys.argv[1:]
assert pathlib.Path(db).resolve()==pathlib.Path(root).resolve()/'store.db'
now=datetime.datetime.now(datetime.timezone.utc)
zone=ZoneInfo('America/Los_Angeles')
due=now.astimezone(zone).replace(hour=9,minute=0,second=0,microsecond=0)
while due>=now or due.weekday()>4: due-=datetime.timedelta(days=1)
due_ms=int(due.timestamp()*1000)
with sqlite3.connect(db) as c:
 c.execute('BEGIN IMMEDIATE')
 row=c.execute('SELECT specification_json,version,state,starts FROM heartbeat_schedules WHERE schedule_id=? AND session_id=?',(schedule,session)).fetchone()
 assert row is not None and row[1:]==(1,'active',0)
 rule=json.loads(row[0])['calendar']
 assert rule=={'zone':'America/Los_Angeles','data_version':'2026f','hour':9,'minute':0,'days':{'kind':'weekdays','days':[1,2,3,4,5]}}
 assert c.execute('SELECT count(*) FROM heartbeat_occurrences').fetchone()[0]==0
 receipts=c.execute('SELECT canonical_digest,response_json FROM heartbeat_commands ORDER BY request_id').fetchall()
 assert c.execute('UPDATE heartbeat_schedules SET anchor_ms=?,next_due_ms=? WHERE schedule_id=? AND session_id=? AND version=1 AND state=? AND starts=0',(due_ms-1,due_ms,schedule,session,'active')).rowcount==1
 assert receipts==c.execute('SELECT canonical_digest,response_json FROM heartbeat_commands ORDER BY request_id').fetchall()
print(json.dumps({'kind':'stopped-store canonical due fixture','due_ms':due_ms,'utc':due.astimezone(datetime.timezone.utc).isoformat(),'local':due.isoformat(),'zone':rule['zone'],'data_version':rule['data_version'],'command_receipts_unchanged':True}))
`,
    path.join(harness.runRoot, "store.db"),
    schedule.schedule_id,
    session,
    harness.runRoot,
  ]);
  const fixture = JSON.parse(stdout);
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "calendar-automatic-read",
    { token: "Durable heartbeat occurrence", requiredTools: ["read", "report_heartbeat"] },
    {
      kind: "function_call",
      stream: "request",
      name: "read",
      callId: "calendar-read",
      arguments: { path: path.join(workspace, "calendar-result.txt") },
    },
    gate,
  );
  await harness.restart("1");
  await gate.accepted;
  const active = (await inspect()).history.find((item) => item.state === "admitted")!;
  expect(active).toBeTruthy();
  expect(active.run_now).toBe(false);
  expect(active.spec.calendar).toEqual(calendar);
  expect(active.schedule_version).toBe(1);
  expect(active.due_first_ms).toBe(fixture.due_ms);
  expect(active.due_last_ms).toBe(fixture.due_ms);
  expect(active.coalesced_count).toBe(1);
  harness.provider.enqueue(
    "calendar-quiet-report",
    { functionOutputCallId: "calendar-read" },
    {
      kind: "function_call",
      stream: "request",
      name: "report_heartbeat",
      callId: "calendar-report",
      arguments: {
        occurrence_id: active.occurrence_id,
        generation: active.generation,
        expected_revision: active.revision,
        outcome: "unchanged",
        evidence: "calendar-result.txt confirms no change.",
      },
    },
  );
  harness.provider.enqueue(
    "calendar-quiet-ended",
    { functionOutputCallId: "calendar-report" },
    { kind: "text", stream: "request", text: "No change in the calendar job." },
  );
  gate.release();
  await expect.poll(async () => (await inspect()).history[0]?.state).toBe("settled");
  const after = await inspect();
  expect(after.schedule.state).toBe("active");
  expect(after.schedule.starts).toBe(1);
  expect(after.schedule.next_due_ms).toBeGreaterThan(Date.now());
  expect(after.history).toHaveLength(1);
  expect(after.history[0]).toMatchObject({
    occurrence_id: active.occurrence_id,
    run_id: active.run_id,
    outcome: "unchanged",
  });
  await expect.poll(async () => (await listing()).active_run ?? null).toBeNull();
  const quiet = await listing();
  expect(quiet.attention_updated_at).toBe(before.attention_updated_at ?? before.summary.updated_at);
  expect(quiet.attention_revision).toBeGreaterThan(before.attention_revision ?? 0);
  // Store timestamps are UTC without a zone marker, as in parseStoreTime.
  const beforeUpdatedAt = Date.parse(`${before.summary.updated_at.replace(" ", "T")}Z`);
  const quietUpdatedAt = Date.parse(`${quiet.summary.updated_at.replace(" ", "T")}Z`);
  expect(quietUpdatedAt).toBeGreaterThan(beforeUpdatedAt);
  expect(quiet.heartbeat_results).toEqual([
    expect.objectContaining({ run_id: active.run_id, outcome: "unchanged" }),
  ]);
  const observed = harness.provider.requests.find(
    (entry) => entry.matchedStep === "calendar-automatic-read",
  )!;
  expect(JSON.stringify(observed.body)).toContain("CALENDAR_SAME_CHAT_CONTEXT_TOKEN");
  expect(JSON.stringify(observed.body)).toContain("CALENDAR_VERIFICATION_SKILL_TOKEN");
  expect(
    JSON.stringify(
      harness.provider.requests.find((entry) => entry.matchedStep === "calendar-create")!.body,
    ),
  ).toContain("2026f");
  await harness.restart("1");
  expect((await inspect()).history).toEqual(after.history);
  expect((await inspect()).schedule.starts).toBe(1);
  const restartedApi = createNacApi(
    new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }),
  );
  expect(await restartedApi.getGoal(session)).toBeNull();
  const reopened = await context.newPage();
  await reopened.goto(
    `${harness.baseUrl}/#/session/${session}/heartbeats?heartbeat=${schedule.schedule_id}`,
  );
  await showSidePanel(reopened);
  await expect(reopened.getByRole("region", { name: "Upcoming calendar checks" })).toContainText(
    "09:00:00 · America/Los_Angeles",
  );
  await expect(
    reopened.getByRole("link", { name: `Run ${active.run_id}`, exact: true }),
  ).toBeVisible();
  await reopened.screenshot({
    path: info.outputPath("calendar-native-restarted-history.png"),
    fullPage: true,
  });
  await info.attach("calendar-native-restart", {
    body: JSON.stringify(
      { fixture, schedule, before, active, after, quiet, restarted: await inspect() },
      null,
      2,
    ),
    contentType: "application/json",
  });
  harness.provider.assertConsumed();
});
