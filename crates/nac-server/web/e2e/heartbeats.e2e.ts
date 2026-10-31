import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import { createProject, createSession, expect, test } from "./harness";
import { ScriptGate } from "./scripted-provider";
import type { HeartbeatInspection, HeartbeatSchedule } from "../src/app/types/api";

test.use({ managedNativeWeb: false });
const specification = {
  name: "Local job check",
  instructions: "Check JOB_READY in job-result.txt using the verification skill.",
  skills: ["verification"],
  interval_ms: 60000,
  end_condition: "Finish once JOB_READY is present.",
  goal_id: null,
  execution_timeout_ms: 30000,
  max_occurrences: 10,
  token_allowance: 100000,
};

test("native heartbeat survives ended chat, closed client and restart, then finishes exactly once", async ({
  harness,
  page,
  request,
  context,
}, info) => {
  test.setTimeout(150000);
  const workspace = path.join(harness.runRoot, "workspace");
  const skill = path.join(workspace, ".agents/skills/verification");
  await fs.mkdir(skill, { recursive: true });
  await fs.writeFile(
    path.join(skill, "SKILL.md"),
    "---\nname: verification\ndescription: Verify the disposable Local job result.\n---\nVERIFICATION_SKILL_TOKEN: Read job-result.txt and retain concrete evidence.\n",
  );
  const project = await createProject(request, harness);
  const session = await createSession(request, harness, "direct", project);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  // UI subscriptions can change between requests; honor each request transport.
  harness.provider.enqueue(
    "native-schedule",
    { token: "SAME_CHAT_CONTEXT_TOKEN", requiredTools: ["heartbeat_control"] },
    {
      kind: "function_call",
      stream: "request",
      name: "heartbeat_control",
      callId: "schedule",
      arguments: {
        request_id: randomUUID(),
        operation: {
          action: "create",
          schedule_id: null,
          expected_version: null,
          spec: specification,
        },
      },
    },
  );
  harness.provider.enqueue(
    "schedule-ended",
    { functionOutputCallId: "schedule" },
    { kind: "text", stream: "request", text: "The recurring job check is scheduled in this chat." },
  );
  await page.goto(`${harness.baseUrl}/#/session/${session}/heartbeats`);
  const run = await request.post(`${harness.baseUrl}/sessions/${session}/runs`, {
    data: {
      prompt:
        "SAME_CHAT_CONTEXT_TOKEN: Check this Local job every minute using $verification until JOB_READY is ready. Schedule this heartbeat in this chat.",
    },
  });
  expect(run.status()).toBe(202);
  await expect(
    page.getByText("The recurring job check is scheduled in this chat.", { exact: true }),
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
  const initialList = await (await request.get(`${harness.baseUrl}/sessions`)).json();
  const initialIds = initialList.map(
    (entry: { summary: { session_id: string } }) => entry.summary.session_id,
  );
  expect(initialIds).toEqual([session]);
  expect(schedule.spec.goal_id).toBeNull();
  expect(await api.getGoal(session)).toBeNull();
  await promisify(execFile)("sh", ["-c", "sleep 1; printf JOB_READY > job-result.txt"], {
    cwd: workspace,
  });
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "automatic-job-read",
    { token: "Durable heartbeat occurrence", requiredTools: ["read", "report_heartbeat"] },
    {
      kind: "function_call",
      stream: "request",
      name: "read",
      callId: "job-read",
      arguments: { path: path.join(workspace, "job-result.txt") },
    },
    gate,
  );
  await page.close();
  // No recovering session read or subscription is used after restart. The
  // passive schedule inspection cannot attach or wake the execution owner.
  await harness.restart("1");
  await gate.accepted;
  const inspect = () =>
    request
      .get(`${harness.baseUrl}/sessions/${session}/heartbeats/${schedule.schedule_id}`)
      .then((r) => r.json() as Promise<HeartbeatInspection>);
  const admitted = await inspect();
  const active = admitted.history.find((entry) => entry.state === "admitted")!;
  expect(active).toBeTruthy();
  harness.provider.enqueue(
    "automatic-report",
    { functionOutputCallId: "job-read" },
    {
      kind: "function_call",
      stream: "request",
      name: "report_heartbeat",
      callId: "job-report",
      arguments: {
        occurrence_id: active.occurrence_id,
        generation: active.generation,
        expected_revision: active.revision,
        outcome: "finished",
        evidence: "Local job-result.txt contains JOB_READY.",
      },
    },
  );
  harness.provider.enqueue(
    "automatic-ended",
    { functionOutputCallId: "job-report" },
    { kind: "text", stream: "request", text: "JOB_READY verified; this heartbeat is finished." },
  );
  gate.release();
  await expect
    .poll(async () => (await inspect()).schedule.state, { timeout: 20000 })
    .toBe("finished");
  const finished = await inspect();
  expect(finished.history).toHaveLength(1);
  expect(finished.history[0]).toMatchObject({
    run_id: active.run_id,
    outcome: "finished",
    state: "settled",
  });
  expect(finished.schedule.starts).toBe(1);
  const restartedApi = createNacApi(
    new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }),
  );
  expect(await restartedApi.getGoal(session)).toBeNull();
  const automated = harness.provider.requests.find(
    (entry) => entry.matchedStep === "automatic-job-read",
  )!;
  expect(JSON.stringify(automated.body)).toContain("SAME_CHAT_CONTEXT_TOKEN");
  expect(JSON.stringify(automated.body)).toContain("VERIFICATION_SKILL_TOKEN");
  const reportRequest = harness.provider.requests.find(
    (entry) => entry.matchedStep === "automatic-report",
  )!;
  expect(JSON.stringify(reportRequest.body)).toContain("JOB_READY");
  const after = await (await request.get(`${harness.baseUrl}/sessions`)).json();
  expect(
    after.map((entry: { summary: { session_id: string } }) => entry.summary.session_id),
  ).toEqual(initialIds);
  expect(after[0].heartbeat_results).toEqual([
    expect.objectContaining({ run_id: active.run_id, outcome: "finished", seen: false }),
  ]);
  const reopened = await context.newPage();
  await reopened.goto(`${harness.baseUrl}/#/session/${session}/heartbeats`);
  await reopened.getByRole("button", { name: "Show panel", exact: true }).click();
  await reopened.getByRole("button", { name: "Local job check finished", exact: true }).click();
  await expect(reopened.getByRole("link", { name: `Run ${active.run_id}` })).toBeVisible();
  await expect(
    reopened.getByText("Local job-result.txt contains JOB_READY.", { exact: true }),
  ).toBeVisible();
  await reopened.screenshot({ path: info.outputPath("heartbeat-history.png"), fullPage: true });
  await info.attach("heartbeat-history", {
    body: JSON.stringify(finished, null, 2),
    contentType: "application/json",
  });
  harness.provider.assertConsumed();
});

test("human heartbeat UI reconciles lost create acknowledgement and controls an admitted check", async ({
  harness,
  page,
  request,
}) => {
  const project = await createProject(request, harness);
  const session = await createSession(request, harness, "direct", project);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  const ids: string[] = [];
  const routePattern = `**/sessions/${session}/heartbeats/control`;
  await page.route(routePattern, async (route) => {
    ids.push(route.request().postDataJSON().request_id);
    await route.fetch();
    await route.abort("failed");
  });
  await page.goto(`${harness.baseUrl}/#/session/${session}/heartbeats`);
  await page.getByRole("button", { name: "Show panel", exact: true }).click();
  await page.getByRole("button", { name: "New heartbeat", exact: true }).click();
  await page.getByRole("textbox", { name: "Heartbeat name" }).fill("Human Local check");
  await page
    .getByRole("textbox", { name: "Heartbeat instructions" })
    .fill("Check this authorized Local job.");
  await page.getByRole("button", { name: "Create heartbeat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
  await page.unroute(routePattern);
  await page.route(routePattern, async (route) => {
    ids.push(route.request().postDataJSON().request_id);
    await route.continue();
  });
  await page.getByRole("button", { name: "Retry same request" }).click();
  await expect(page.getByRole("button", { name: "Run now", exact: true })).toBeEnabled();
  expect(ids).toHaveLength(2);
  expect(ids[0]).toBe(ids[1]);
  const inventory = await (
    await request.get(`${harness.baseUrl}/heartbeats?session_id=${session}`)
  ).json();
  expect(inventory).toHaveLength(1);
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "human-now",
    { token: "Durable heartbeat occurrence" },
    { kind: "text", text: "Held heartbeat result." },
    gate,
  );
  await page.getByRole("button", { name: "Run now", exact: true }).click();
  await gate.accepted;
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await page.getByRole("spinbutton", { name: "Interval in minutes" }).fill("10");
  await page.getByRole("button", { name: "Save heartbeat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  gate.release();
  await expect
    .poll(async () => {
      const inspection = await (
        await request.get(
          `${harness.baseUrl}/sessions/${session}/heartbeats/${inventory[0].schedule_id}`,
        )
      ).json();
      return inspection.history[0]?.outcome;
    })
    .toBe("interrupted");
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
  await expect
    .poll(
      async () =>
        (await (await request.get(`${harness.baseUrl}/heartbeats?session_id=${session}`)).json())
          .length,
    )
    .toBe(0);
  harness.provider.assertConsumed();
});

test("heartbeat execution deadline cancels supervised descendants and suspends future checks", async ({
  harness,
  request,
}) => {
  const project = await createProject(request, harness);
  const session = await createSession(request, harness, "direct", project);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  const control = (operation: unknown) =>
    request.post(`${harness.baseUrl}/sessions/${session}/heartbeats/control`, {
      data: { request_id: randomUUID(), operation },
    });
  // A permitted file-backed program creates a real supervised descendant.
  // Shell redirection/nested shell bodies remain hard-denied in this journey.
  await fs.writeFile(
    path.join(harness.runRoot, "workspace/heartbeat-deadline.cjs"),
    "const fs = require('node:fs');\nconst { spawn } = require('node:child_process');\nconst child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });\nfs.writeFileSync('heartbeat-child.pid', String(child.pid));\nchild.on('exit', () => process.exit(0));\nsetInterval(() => {}, 1000);\n",
  );
  const created = await control({
    action: "create",
    spec: {
      ...specification,
      name: "Deadline check",
      skills: [],
      instructions: "Run the authorized disposable child process and wait for its result.",
      execution_timeout_ms: 2000,
    },
  });
  expect(created.ok()).toBeTruthy();
  const { schedule } = await created.json();
  harness.provider.enqueue(
    "deadline-child",
    { token: "Durable heartbeat occurrence", requiredTools: ["exec_command"] },
    {
      kind: "function_call",
      name: "exec_command",
      callId: "deadline-child",
      arguments: {
        cmd: "node heartbeat-deadline.cjs",
        yield_time_ms: 30000,
      },
    },
  );
  expect(
    (
      await control({
        action: "run_now",
        schedule_id: schedule.schedule_id,
        expected_version: schedule.version,
      })
    ).ok(),
  ).toBeTruthy();
  const pidFile = path.join(harness.runRoot, "workspace/heartbeat-child.pid");
  await expect.poll(async () => fs.readFile(pidFile, "utf8").catch(() => "")).toMatch(/^\d+\s*$/);
  const pid = (await fs.readFile(pidFile, "utf8")).trim();
  await expect
    .poll(
      async () => {
        try {
          const { stdout } = await promisify(execFile)("ps", ["-p", pid, "-o", "stat="]);
          return stdout.trim() === "" || stdout.trim().startsWith("Z") ? "settled" : "live";
        } catch {
          return "settled";
        }
      },
      { timeout: 15000 },
    )
    .toBe("settled");
  let inspection: HeartbeatInspection | undefined;
  await expect
    .poll(async () => {
      inspection = await (
        await request.get(
          `${harness.baseUrl}/sessions/${session}/heartbeats/${schedule.schedule_id}`,
        )
      ).json();
      return inspection?.history[0]?.state;
    })
    .toBe("settled");
  expect(inspection!.schedule.state).toBe("suspended");
  expect(inspection!.history[0].outcome).toBe("interrupted");
  expect(inspection!.history[0].evidence).toContain("deadline");
  expect(inspection!.schedule.starts).toBe(1);
  expect(await api.getGoal(session)).toBeNull();
  harness.provider.assertConsumed();
});

test("crash after a Local effect suspends the exact occurrence without replaying it", async ({
  harness,
  request,
}) => {
  const project = await createProject(request, harness);
  const session = await createSession(request, harness, "direct", project);
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  await api.setPermissionApprovalMode(session, "auto_approve");
  const control = (operation: unknown) =>
    request.post(`${harness.baseUrl}/sessions/${session}/heartbeats/control`, {
      data: { request_id: randomUUID(), operation },
    });
  await fs.writeFile(
    path.join(harness.runRoot, "workspace/heartbeat-crash.cjs"),
    "require('node:fs').appendFileSync('crash-effect.txt', 'one effect\\n');\n",
  );
  const created = await control({
    action: "create",
    spec: {
      ...specification,
      skills: [],
      execution_timeout_ms: 120000,
      instructions: "Append one receipt to crash-effect.txt for the authorized Local check.",
    },
  });
  expect(created.ok()).toBeTruthy();
  const { schedule } = await created.json();
  harness.provider.enqueue(
    "crash-effect",
    { token: "Durable heartbeat occurrence" },
    {
      kind: "function_call",
      name: "exec_command",
      callId: "crash-effect",
      arguments: { cmd: "node heartbeat-crash.cjs", yield_time_ms: 1000 },
    },
  );
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "effect-observed",
    { functionOutputCallId: "crash-effect" },
    { kind: "text", text: "Effect was observed before the crash." },
    gate,
  );
  expect(
    (
      await control({
        action: "run_now",
        schedule_id: schedule.schedule_id,
        expected_version: schedule.version,
      })
    ).ok(),
  ).toBeTruthy();
  await gate.accepted;
  const effect = path.join(harness.runRoot, "workspace/crash-effect.txt");
  expect(await fs.readFile(effect, "utf8")).toBe("one effect\n");
  const inspect = () =>
    request
      .get(`${harness.baseUrl}/sessions/${session}/heartbeats/${schedule.schedule_id}`)
      .then((response) => response.json() as Promise<HeartbeatInspection>);
  const active = (await inspect()).history[0];
  expect(active.state).toBe("admitted");
  const owned = JSON.parse(await fs.readFile(path.join(harness.runRoot, "process.json"), "utf8"));
  expect(owned.binaryPath).toBe(harness.binaryPath);
  expect(owned.baseUrl).toBe(harness.baseUrl);
  process.kill(owned.pid, "SIGKILL");
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
  gate.release();
  await harness.restart("1");
  await expect.poll(async () => (await inspect()).history[0]?.state).toBe("settled");
  const recovered = await inspect();
  expect(recovered.schedule.state).toBe("suspended");
  expect(recovered.schedule.starts).toBe(1);
  expect(recovered.schedule.usage_unknown).toBe(true);
  expect(recovered.history).toHaveLength(1);
  expect(recovered.history[0]).toMatchObject({
    occurrence_id: active.occurrence_id,
    receipt_id: active.receipt_id,
    run_id: active.run_id,
    outcome: "interrupted",
  });
  expect(await fs.readFile(effect, "utf8")).toBe("one effect\n");
  harness.provider.assertConsumed();
});
