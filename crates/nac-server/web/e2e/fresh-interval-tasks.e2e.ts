import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { APIRequestContext, Locator } from "@playwright/test";
import type {
  FreshTaskScheduleInspection,
  HeartbeatSchedule,
  HeartbeatSpec,
} from "../src/app/types/api";
import { createNacApi } from "../packages/nac-client/dist/api.js";
import { NacClient } from "../packages/nac-client/dist/nacClient.js";
import {
  createProject,
  createSession,
  expect,
  test,
  waitForRunIdle,
  type EmbeddedHarness,
} from "./harness";
import { ScriptGate } from "./scripted-provider";

test.use({ managedNativeWeb: false });
const execute = promisify(execFile);
const brief = "FRESH_INTERVAL_BRIEF: Inspect seed with $verification and report unchanged.";
const specification: HeartbeatSpec = {
  name: "Retained interval inspection",
  instructions: brief,
  skills: ["verification"],
  interval_ms: 600000,
  end_condition: "Keep the schedule active after each isolated inspection.",
  goal_id: null,
  execution_timeout_ms: 30000,
  max_occurrences: 10,
  token_allowance: 100000,
};

async function fixture(request: APIRequestContext, harness: EmbeddedHarness) {
  const repo = path.join(harness.runRoot, "workspace");
  const git = (...args: string[]) => execute("git", ["-C", repo, ...args]);
  // Disposable ordinary policy is explicit. Saved human intent must not turn an
  // unattended Ask into permission to prepare a worktree or admit a run.
  await fs.writeFile(
    path.join(harness.runRoot, "nac-home/config.toml"),
    "[[permissions.rules]]\naction='*'\nresource='*'\neffect='allow'\n",
  );
  const skill = path.join(repo, ".agents/skills/verification");
  await fs.mkdir(skill, { recursive: true });
  await fs.writeFile(
    path.join(skill, "SKILL.md"),
    "---\nname: verification\ndescription: Inspect the disposable interval fixture.\n---\nFRESH_SKILL_TOKEN: Read seed, retain evidence, do not change source files.\n",
  );
  await fs.writeFile(path.join(repo, "seed"), "committed seed");
  await git("add", ".");
  await git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "-m",
    "interval fixture",
  );
  const commit = (await git("rev-parse", "HEAD")).stdout.trim();
  await fs.writeFile(path.join(repo, "seed"), "staged source");
  await git("add", "seed");
  await fs.writeFile(path.join(repo, "seed"), "unstaged source");
  await fs.writeFile(path.join(repo, "untracked"), "source only");
  const index = await fs.readFile(path.join(repo, ".git/index"));
  const status = (await git("status", "--porcelain=v1")).stdout;
  await harness.restart("1", undefined, true);
  const project = await createProject(request, harness, { name: "Standalone interval fixture" });
  return {
    repo,
    project,
    commit,
    destination: {
      project_id: project,
      default_ref: "main",
      pinned_commit: null,
      model: null,
      reasoning_effort: null,
      retained_limit: 2,
    },
    async assertSourcePreserved() {
      expect((await git("rev-parse", "HEAD")).stdout.trim()).toBe(commit);
      expect(await fs.readFile(path.join(repo, ".git/index"))).toEqual(index);
      expect((await git("status", "--porcelain=v1")).stdout).toBe(status);
      expect(await fs.readFile(path.join(repo, "seed"), "utf8")).toBe("unstaged source");
      expect(await fs.readFile(path.join(repo, "untracked"), "utf8")).toBe("source only");
    },
  };
}

async function inspect(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  project: string,
  schedule: string,
): Promise<FreshTaskScheduleInspection> {
  const response = await request.get(
    `${harness.baseUrl}/projects/${project}/task-schedules/${schedule}`,
  );
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

function holdInspection(harness: EmbeddedHarness, id: string) {
  const gate = new ScriptGate();
  harness.provider.enqueue(
    `${id}-read`,
    {
      token: "Scheduled fresh direct task, occurrence",
      requiredTools: ["read", "report_heartbeat"],
    },
    {
      kind: "function_call",
      stream: "request",
      name: "read",
      callId: `${id}-read`,
      arguments: { path: "seed" },
    },
    gate,
  );
  return gate;
}

async function finishInspection(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  project: string,
  schedule: string,
  id: string,
  gate: ScriptGate,
) {
  await gate.accepted;
  const active = (await inspect(request, harness, project, schedule)).heartbeat.history.find(
    (item) => item.state === "admitted",
  );
  if (!active) throw new Error("Provider request has no admitted initial occurrence");
  harness.provider.enqueue(
    `${id}-report`,
    { functionOutputCallId: `${id}-read` },
    {
      kind: "function_call",
      stream: "request",
      name: "report_heartbeat",
      callId: `${id}-report`,
      arguments: {
        occurrence_id: active.occurrence_id,
        generation: active.generation,
        expected_revision: active.revision,
        outcome: "unchanged",
        evidence: `${id}: committed seed verified in the retained task.`,
      },
    },
  );
  harness.provider.enqueue(
    `${id}-ended`,
    { functionOutputCallId: `${id}-report` },
    { kind: "text", stream: "request", text: `${id} initial inspection complete.` },
  );
  gate.release();
  await expect
    .poll(
      async () => {
        const current = await inspect(request, harness, project, schedule);
        return current.inventory.find((item) => item.occurrence_id === active.occurrence_id)
          ?.initial_outcome?.outcome;
      },
      { timeout: 30000 },
    )
    .toBe("unchanged");
  const current = await inspect(request, harness, project, schedule);
  const receipt = current.inventory.find((item) => item.occurrence_id === active.occurrence_id)!;
  expect(receipt.initial_run_id).toBe(active.run_id);
  expect(receipt.first_input_id).not.toBeNull();
  expect(receipt.shared_directory).toBe(false);
  const launch = current.launches.find((item) => item.session_id === receipt.session_id)!;
  expect(launch.phase).toBe("ready");
  expect(await fs.readFile(path.join(launch.workspace_path, "seed"), "utf8")).toBe(
    "committed seed",
  );
  await expect(fs.access(path.join(launch.workspace_path, "untracked"))).rejects.toThrow();
  const api = createNacApi(new NacClient({ endpoint: harness.baseUrl, credentials: "omit" }));
  expect(await api.getGoal(receipt.session_id)).toBeNull();
  expect(
    JSON.stringify(
      harness.provider.requests.find((item) => item.matchedStep === `${id}-read`)?.body,
    ),
  ).toContain("FRESH_SKILL_TOKEN");
  return { receipt, launch };
}

async function unobscuredPageTarget(target: Locator) {
  await expect(target).toBeVisible();
  const measure = () =>
    target.evaluate((element) => {
      const document = element.ownerDocument;
      const view = document.defaultView!;
      const rect = element.getBoundingClientRect();
      const points = [
        [rect.left + 1, rect.top + 1],
        [rect.right - 1, rect.top + 1],
        [rect.left + 1, rect.bottom - 1],
        [rect.right - 1, rect.bottom - 1],
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
      ];
      const fixedHeaders = [...document.querySelectorAll("header")]
        .filter((header) => view.getComputedStyle(header).position === "fixed")
        .map((header) => header.getBoundingClientRect())
        .filter((header) => header.width > 0 && header.height > 0);
      return {
        box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        inViewport:
          rect.width > 0 &&
          rect.height > 0 &&
          rect.left >= 0 &&
          rect.top >= 0 &&
          rect.right <= view.innerWidth &&
          rect.bottom <= view.innerHeight,
        clearOfFixedHeaders: fixedHeaders.every(
          (header) =>
            rect.bottom <= header.top ||
            rect.top >= header.bottom ||
            rect.right <= header.left ||
            rect.left >= header.right,
        ),
        hitTargets: points.map(([x, y]) => {
          const hit = document.elementFromPoint(x, y);
          return hit !== null && (hit === element || element.contains(hit));
        }),
      };
    });
  await expect.poll(measure).toMatchObject({
    inViewport: true,
    clearOfFixedHeaders: true,
    hitTargets: [true, true, true, true, true],
  });
  return measure();
}

test("standalone human interval schedule retries one intent and retains two independent tasks across restart", async ({
  harness,
  page,
  request,
}, info) => {
  test.setTimeout(150000);
  const f = await fixture(request, harness);
  await page.goto(`${harness.baseUrl}/#/project/${f.project}/task-schedules`);
  await page.getByRole("button", { name: "New task schedule", exact: true }).click();
  const form = page.getByRole("form", { name: "Create interval task schedule" });
  await form.getByRole("textbox", { name: "Scheduled project default branch" }).fill("main");
  await form.getByRole("textbox", { name: "Heartbeat name" }).fill(specification.name);
  await form.getByRole("textbox", { name: "Heartbeat instructions" }).fill(brief);
  await form.getByRole("textbox", { name: "Heartbeat skills" }).fill("verification");
  await form.getByRole("spinbutton", { name: "Interval in minutes" }).fill("10");
  await form.getByRole("spinbutton", { name: "Retained task allowance" }).fill("2");
  await page.screenshot({ path: info.outputPath("fresh-interval-form.png") });
  const pattern = `**/projects/${f.project}/task-schedules/control`;
  const intents: unknown[] = [];
  await page.route(pattern, async (route) => {
    intents.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    await route.abort("failed");
  });
  await form.getByRole("button", { name: "Create task schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Retry same request" })).toBeVisible();
  await page.unroute(pattern);
  await page.route(pattern, async (route) => {
    intents.push(route.request().postDataJSON());
    await route.continue();
  });
  await page.getByRole("button", { name: "Retry same request" }).click();
  await expect(page.getByRole("button", { name: "Run now", exact: true })).toBeEnabled();
  expect(intents).toHaveLength(2);
  expect(intents[1]).toEqual(intents[0]);
  await page.unroute(pattern);
  const inventory: HeartbeatSchedule[] = await (
    await request.get(`${harness.baseUrl}/projects/${f.project}/task-schedules`)
  ).json();
  expect(inventory).toHaveLength(1);
  const schedule = inventory[0];
  expect(schedule.session_id).toBeNull();
  expect(schedule.binding.creator_session_id ?? null).toBeNull();
  expect(await (await request.get(`${harness.baseUrl}/sessions`)).json()).toHaveLength(0);
  const firstGate = holdInspection(harness, "first");
  await page.getByRole("button", { name: "Run now", exact: true }).click();
  const first = await finishInspection(
    request,
    harness,
    f.project,
    schedule.schedule_id,
    "first",
    firstGate,
  );
  expect(first.launch.source.commit).toBe(f.commit);
  await expect(page.locator(`[data-occurrence="${first.receipt.occurrence_id}"]`)).toContainText(
    "Initial occurrence settled: unchanged",
  );
  await harness.restart("1", undefined, true);
  await page.reload();
  // Respect the real shared 15-second admission bound; no fixture clock bypass.
  await expect
    .poll(() => Date.now() - first.receipt.created_at_ms, { timeout: 20000 })
    .toBeGreaterThan(16000);
  const secondGate = holdInspection(harness, "second");
  await page.getByRole("button", { name: "Run now", exact: true }).click();
  const second = await finishInspection(
    request,
    harness,
    f.project,
    schedule.schedule_id,
    "second",
    secondGate,
  );
  expect(second.receipt.session_id).not.toBe(first.receipt.session_id);
  expect(second.launch.workspace_path).not.toBe(first.launch.workspace_path);
  expect(second.launch.source.commit).toBe(f.commit);
  expect((await inspect(request, harness, f.project, schedule.schedule_id)).inventory).toHaveLength(
    2,
  );
  await page.screenshot({ path: info.outputPath("fresh-interval-two-tasks.png") });
  const firstCard = page.locator(`[data-occurrence="${first.receipt.occurrence_id}"]`);
  await firstCard.getByRole("link", { name: "Open task" }).click();
  const composer = page.getByRole("combobox", { name: "Message" });
  await expect
    .poll(
      async () => {
        const summaries = await (await request.get(`${harness.baseUrl}/sessions`)).json();
        return summaries.find(
          (item: { summary: { session_id: string } }) =>
            item.summary.session_id === first.receipt.session_id,
        )?.heartbeat_results?.[0]?.seen;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const otherSummary = await (await request.get(`${harness.baseUrl}/sessions`)).json();
  expect(
    otherSummary.find(
      (item: { summary: { session_id: string } }) =>
        item.summary.session_id === second.receipt.session_id,
    )?.heartbeat_results?.[0]?.seen,
  ).toBe(false);
  const humanGate = new ScriptGate();
  harness.provider.enqueue(
    "human-continue",
    { token: "HUMAN_CONTINUE_FRESH" },
    { kind: "text", stream: "request", text: "Later human work remains separate." },
    humanGate,
  );
  await composer.fill("HUMAN_CONTINUE_FRESH");
  await page
    .locator("form")
    .filter({ has: composer })
    .getByRole("button", { name: "Send", exact: true })
    .click();
  await humanGate.accepted;
  const controls = await page.context().newPage();
  await controls.goto(
    `${harness.baseUrl}/#/project/${f.project}/task-schedules?schedule=${schedule.schedule_id}`,
  );
  // V483-1: page-owned scroll content must clear shell chrome at both widths.
  // Exercise the page link while the older task has a later human run and a
  // newer scheduled task is retained; navigation must not mutate either.
  const beforeNavigation = await inspect(request, harness, f.project, schedule.schedule_id);
  const humanRun = (
    await (await request.get(`${harness.baseUrl}/sessions/${first.receipt.session_id}`)).json()
  ).active_run;
  expect(humanRun).not.toBeNull();
  const providerRequests = harness.provider.requests.length;
  const scheduleMutations: string[] = [];
  controls.on("request", (request) => {
    if (request.method() !== "GET" && request.url().endsWith("/task-schedules/control"))
      scheduleMutations.push(request.method());
  });
  const clearance = [];
  const originalViewport = controls.viewportSize()!;
  for (const viewport of [
    { width: 1440, height: 1400 },
    { width: 390, height: 844 },
  ]) {
    await controls.setViewportSize(viewport);
    const heading = controls.getByRole("heading", { name: "Interval tasks", exact: true });
    const pageHeader = controls.locator("header").filter({ has: heading });
    const back = pageHeader.getByRole("link", { name: "All projects", exact: true });
    // Only reset the owning page scroll, as a user returning to its top would.
    await heading.evaluate((element) => {
      element.closest("main")!.scrollTop = 0;
    });
    clearance.push({
      viewport,
      heading: await unobscuredPageTarget(heading),
      back: await unobscuredPageTarget(back),
    });
    await back.click();
    await expect(controls).toHaveURL(`${harness.baseUrl}/#/`);
    await controls.goto(
      `${harness.baseUrl}/#/project/${f.project}/task-schedules?schedule=${schedule.schedule_id}`,
    );
    await expect(controls.getByRole("button", { name: "Run now", exact: true })).toBeEnabled();
    const afterNavigation = await inspect(request, harness, f.project, schedule.schedule_id);
    expect(afterNavigation.heartbeat.schedule.version).toBe(
      beforeNavigation.heartbeat.schedule.version,
    );
    expect(afterNavigation.heartbeat.schedule.state).toBe(
      beforeNavigation.heartbeat.schedule.state,
    );
    expect(afterNavigation.inventory).toEqual(beforeNavigation.inventory);
    expect(
      (await (await request.get(`${harness.baseUrl}/sessions/${first.receipt.session_id}`)).json())
        .active_run,
    ).toEqual(humanRun);
    expect(harness.provider.requests).toHaveLength(providerRequests);
    expect(scheduleMutations).toEqual([]);
  }
  const readiness = await request.get(`${harness.baseUrl}/readyz`);
  expect(readiness.ok()).toBe(true);
  await info.attach("interval page clearance and production identity", {
    body: JSON.stringify({ clearance, readiness: await readiness.json() }, null, 2),
    contentType: "application/json",
  });
  await controls.setViewportSize(originalViewport);
  await controls.getByRole("button", { name: "Change host allowance", exact: true }).click();
  const allowance = controls.getByRole("form", { name: "Change host retained allowance" });
  await allowance
    .getByRole("spinbutton", { name: "Host retained allowance", exact: true })
    .fill("2");
  await allowance.getByRole("button", { name: "Save host allowance", exact: true }).click();
  await expect(
    controls.getByRole("region", { name: "Host retained task allowance" }),
  ).toContainText("Host retained resources: 2 / 2");
  await controls.getByRole("button", { name: "Stop schedule", exact: true }).click();
  await expect(controls.getByRole("button", { name: "Stop schedule", exact: true })).toBeDisabled();
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${first.receipt.session_id}`)).json())
      .active_run,
  ).not.toBeNull();
  humanGate.release();
  await expect(page.getByText("Later human work remains separate.", { exact: true })).toBeVisible();
  await waitForRunIdle(request, harness, first.receipt.session_id);
  await controls.close();
  expect(
    (await inspect(request, harness, f.project, schedule.schedule_id)).inventory.find(
      (item) => item.occurrence_id === first.receipt.occurrence_id,
    )?.initial_outcome,
  ).toEqual(first.receipt.initial_outcome);
  await fs.writeFile(
    path.join(first.launch.workspace_path, "retained-work"),
    "keep after task deletion",
  );
  expect(
    (await request.delete(`${harness.baseUrl}/sessions/${first.receipt.session_id}`)).ok(),
  ).toBe(true);
  await page.goto(
    `${harness.baseUrl}/#/project/${f.project}/task-schedules?schedule=${schedule.schedule_id}`,
  );
  await expect(page.locator(`[data-occurrence="${first.receipt.occurrence_id}"]`)).toContainText(
    "Task removed",
  );
  expect(await fs.readFile(path.join(first.launch.workspace_path, "retained-work"), "utf8")).toBe(
    "keep after task deletion",
  );
  await expect(page.getByRole("button", { name: "Stop schedule", exact: true })).toBeDisabled();
  await f.assertSourcePreserved();
  harness.provider.assertConsumed();
});

test("native saved-project schedule outlives its creator and runs through the same prepared launch", async ({
  harness,
  request,
}) => {
  test.setTimeout(90000);
  const f = await fixture(request, harness);
  const creator = await createSession(request, harness, "direct", f.project);
  const requestId = randomUUID();
  harness.provider.enqueue(
    "native-create",
    {
      token: "AUTHORIZE_FRESH_NATIVE",
      requiredTools: ["fresh_task_schedule_control", "fresh_task_schedule_read"],
    },
    {
      kind: "function_call",
      stream: "request",
      name: "fresh_task_schedule_control",
      callId: "native-create",
      arguments: {
        request_id: requestId,
        operation: { action: "create", spec: specification },
        destination: {
          default_ref: f.destination.default_ref,
          retained_limit: f.destination.retained_limit,
        },
      },
    },
  );
  harness.provider.enqueue(
    "native-read",
    { functionOutputCallId: "native-create" },
    {
      kind: "function_call",
      stream: "request",
      name: "fresh_task_schedule_read",
      callId: "native-read",
      arguments: {},
    },
  );
  harness.provider.enqueue(
    "native-created",
    { functionOutputCallId: "native-read" },
    { kind: "text", stream: "request", text: "Standalone interval schedule saved." },
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${creator}/runs`, {
        data: {
          prompt:
            "AUTHORIZE_FRESH_NATIVE: Create a standalone interval task schedule in this chat's exact saved Local project, using the saved inspection brief and skill. Retain at most two tasks.",
        },
      })
    ).status(),
  ).toBe(202);
  let schedules: HeartbeatSchedule[] = [];
  await expect
    .poll(async () => {
      schedules = await (
        await request.get(`${harness.baseUrl}/projects/${f.project}/task-schedules`)
      ).json();
      return schedules.length;
    })
    .toBe(1);
  await waitForRunIdle(request, harness, creator);
  const schedule = schedules[0];
  expect(schedule.session_id).toBeNull();
  expect(schedule.binding.creator_session_id).toBe(creator);
  expect((await request.delete(`${harness.baseUrl}/sessions/${creator}`)).ok()).toBe(true);
  await harness.restart("1", undefined, true);
  const gate = holdInspection(harness, "native-initial");
  const run = await request.post(
    `${harness.baseUrl}/projects/${f.project}/task-schedules/control`,
    {
      data: {
        request_id: randomUUID(),
        operation: {
          action: "run_now",
          schedule_id: schedule.schedule_id,
          expected_version: schedule.version,
        },
      },
    },
  );
  expect(run.ok(), await run.text()).toBe(true);
  const result = await finishInspection(
    request,
    harness,
    f.project,
    schedule.schedule_id,
    "native-initial",
    gate,
  );
  expect(result.receipt.session_id).not.toBe(creator);
  expect(result.launch.source.commit).toBe(f.commit);
  expect(
    (await inspect(request, harness, f.project, schedule.schedule_id)).heartbeat.schedule.binding
      .creator_session_id,
  ).toBe(creator);
  await f.assertSourcePreserved();
  harness.provider.assertConsumed();
});

type ElapsedPage = import("@playwright/test").Page;
type ElapsedInfo = import("@playwright/test").TestInfo;
type ElapsedSummary = import("../src/app/types/api").ManagedSessionSummary;
type ElapsedTask = Awaited<ReturnType<typeof finishElapsedInspection>>;

const elapsedCadenceMs = 60000;
const elapsedRunTimeoutMs = 30000;
const elapsedPreparationMarginMs = 15000;

async function finishElapsedInspection(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  project: string,
  schedule: string,
  id: string,
  gate: ScriptGate,
) {
  await expect
    .poll(() => harness.provider.requests.some((item) => item.matchedStep === `${id}-read`), {
      timeout: elapsedCadenceMs + elapsedRunTimeoutMs + elapsedPreparationMarginMs,
    })
    .toBe(true);
  const occurrence = (await inspect(request, harness, project, schedule)).heartbeat.history.find(
    (item) => item.state === "admitted",
  );
  if (!occurrence) throw new Error("Elapsed inspection has no admitted occurrence");
  expect(occurrence.run_now).toBe(false);
  expect(occurrence.coalesced_count).toBe(1);
  const task = await finishInspection(request, harness, project, schedule, id, gate);
  await waitForRunIdle(request, harness, task.receipt.session_id);
  return { ...task, occurrence };
}

async function elapsedScreenshot(page: ElapsedPage, info: ElapsedInfo, name: string) {
  expect(await page.evaluate<boolean>("document.fonts.ready.then(() => true)")).toBe(true);
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  expect(png.byteLength).toBeLessThanOrEqual(2 * 1024 * 1024);
  await fs.writeFile(info.outputPath(name), png);
}

async function continueElapsedTasks(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  page: ElapsedPage,
  tasks: ElapsedTask[],
  lane: string,
) {
  const continuations = [];
  for (const [index, task] of tasks.entries()) {
    const id = `${lane}-continue-${index}`;
    const token = `CONTINUE_ELAPSED_${lane}_${index}_${task.receipt.session_id}`;
    const file = `elapsed-continuation-${index}.txt`;
    harness.provider.enqueue(
      `${id}-write`,
      { token, requiredTools: ["write"] },
      {
        kind: "function_call",
        stream: "request",
        name: "write",
        callId: `${id}-write`,
        arguments: { path: file, content: token + "\n", expected_revision: null },
      },
    );
    const completion = new ScriptGate();
    harness.provider.enqueue(
      `${id}-ended`,
      { functionOutputCallId: `${id}-write` },
      { kind: "text", stream: "request", text: `${id} independently continued.` },
      completion,
    );
    await page.goto(`${harness.baseUrl}/#/session/${task.receipt.session_id}/insights`);
    const composer = page.getByRole("combobox", { name: "Message" });
    await composer.fill(token);
    await page
      .locator("form")
      .filter({ has: composer })
      .getByRole("button", { name: "Send", exact: true })
      .click();
    await expect
      .poll(() => harness.provider.requests.some((item) => item.matchedStep === `${id}-ended`), {
        timeout: 15000,
      })
      .toBe(true);
    const live: { active_run: { run_id: string } | null } = await (
      await request.get(`${harness.baseUrl}/sessions/${task.receipt.session_id}`)
    ).json();
    if (!live.active_run) throw new Error("Continuation has no distinct active run");
    expect(live.active_run.run_id).not.toBe(task.receipt.initial_run_id);
    const run = live.active_run.run_id;
    completion.release();
    await expect(page.getByText(`${id} independently continued.`, { exact: true })).toBeVisible();
    await waitForRunIdle(request, harness, task.receipt.session_id);
    expect(await fs.readFile(path.join(task.launch.workspace_path, file), "utf8")).toBe(
      token + "\n",
    );
    await expect(
      fs.access(path.join(tasks[1 - index].launch.workspace_path, file)),
    ).rejects.toThrow();
    const summaries: ElapsedSummary[] = await (
      await request.get(`${harness.baseUrl}/sessions`)
    ).json();
    const summary = summaries.find((item) => item.summary.session_id === task.receipt.session_id);
    expect(summary?.summary.run_count).toBe(2);
    continuations.push({ session_id: task.receipt.session_id, run_id: run, proof_file: file });
  }
  expect(new Set(continuations.map((item) => item.run_id)).size).toBe(2);
  return continuations;
}

function elapsedRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

for (const lane of ["human", "model-native"] as const) {
  test(`elapsed ${lane} interval creates two real one-minute tasks and independently continues both`, async ({
    harness,
    page,
    request,
  }, info) => {
    // Body/setup budget; fixture teardown has a separate timeout.
    test.setTimeout(240000);
    const controls: string[] = [];
    const acknowledgements: Array<{ session: string; through_sequence: number; status: number }> =
      [];
    page.context().on("response", (response) => {
      const sent = response.request();
      if (sent.method() !== "POST") return;
      const pathname = new URL(response.url()).pathname;
      if (!pathname.includes("/task-schedules/") && !pathname.endsWith("/heartbeats/attention"))
        return;
      const body: unknown = sent.postDataJSON();
      if (!elapsedRecord(body)) return;
      if (elapsedRecord(body.operation) && typeof body.operation.action === "string") {
        controls.push(body.operation.action);
      }
      const match = pathname.match(/^\/sessions\/([^/]+)\/heartbeats\/attention$/);
      if (match && typeof body.through_sequence === "number") {
        acknowledgements.push({
          session: match[1],
          through_sequence: body.through_sequence,
          status: response.status(),
        });
      }
    });
    let qualification: unknown = { status: "INCOMPLETE", lane };
    try {
      const f = await fixture(request, harness);
      const spec = {
        ...specification,
        interval_ms: elapsedCadenceMs,
        execution_timeout_ms: elapsedRunTimeoutMs,
      };
      const firstId = `elapsed-${lane}-one`;
      const secondId = `elapsed-${lane}-two`;
      const firstGate = holdInspection(harness, firstId);
      const started = Date.now();
      let creatorRun: string | undefined;
      let creatorSession: string | undefined;
      if (lane === "human") {
        await page.goto(`${harness.baseUrl}/#/project/${f.project}/task-schedules`);
        await page.getByRole("button", { name: "New task schedule", exact: true }).click();
        const form = page.getByRole("form", { name: "Create interval task schedule" });
        await form.getByRole("textbox", { name: "Scheduled project default branch" }).fill("main");
        await form.getByRole("textbox", { name: "Heartbeat name" }).fill(spec.name);
        await form.getByRole("textbox", { name: "Heartbeat instructions" }).fill(brief);
        await form.getByRole("textbox", { name: "Heartbeat skills" }).fill("verification");
        await form.getByRole("textbox", { name: "When to finish" }).fill(spec.end_condition);
        await form.getByRole("spinbutton", { name: "Interval in minutes" }).fill("1");
        await form.getByRole("spinbutton", { name: "Execution deadline in seconds" }).fill("30");
        await form.getByRole("spinbutton", { name: "Heartbeat token allowance" }).fill("100000");
        await form.getByRole("spinbutton", { name: "Maximum scheduled tasks" }).fill("10");
        await form.getByRole("spinbutton", { name: "Retained task allowance" }).fill("2");
        await form.getByRole("button", { name: "Create task schedule", exact: true }).click();
      } else {
        creatorSession = await createSession(request, harness, "direct", f.project);
        harness.provider.enqueue(
          "elapsed-native-create",
          {
            token: "AUTHORIZE_ELAPSED_NATIVE",
            requiredTools: ["fresh_task_schedule_control", "fresh_task_schedule_read"],
          },
          {
            kind: "function_call",
            stream: "request",
            name: "fresh_task_schedule_control",
            callId: "elapsed-native-create",
            arguments: {
              request_id: randomUUID(),
              operation: { action: "create", spec },
              destination: { default_ref: "main", retained_limit: 2 },
            },
          },
        );
        harness.provider.enqueue(
          "elapsed-native-read",
          { functionOutputCallId: "elapsed-native-create" },
          {
            kind: "function_call",
            stream: "request",
            name: "fresh_task_schedule_read",
            callId: "elapsed-native-read",
            arguments: {},
          },
        );
        harness.provider.enqueue(
          "elapsed-native-created",
          { functionOutputCallId: "elapsed-native-read" },
          { kind: "text", stream: "request", text: "One-minute standalone schedule saved." },
        );
        const admitted = await request.post(`${harness.baseUrl}/sessions/${creatorSession}/runs`, {
          data: {
            prompt:
              "AUTHORIZE_ELAPSED_NATIVE: Create one standalone one-minute interval task schedule in this exact saved Local project using the saved inspection brief and $verification. Retain at most two tasks. Do not invoke Run now.",
          },
        });
        expect(admitted.status()).toBe(202);
        const accepted: import("../src/app/types/api").SubmitPromptResponse = await admitted.json();
        creatorRun = accepted.run_id;
        await waitForRunIdle(request, harness, creatorSession);
      }
      let schedules: HeartbeatSchedule[] = [];
      await expect
        .poll(async () => {
          schedules = await (
            await request.get(`${harness.baseUrl}/projects/${f.project}/task-schedules`)
          ).json();
          return schedules.length;
        })
        .toBe(1);
      const schedule = schedules[0];
      expect(schedule.session_id).toBeNull();
      expect(schedule.spec).toEqual(spec);
      expect(schedule.binding.project_id).toBe(f.project);
      expect(schedule.binding.creator_session_id ?? undefined).toBe(creatorSession);
      const first = await finishElapsedInspection(
        request,
        harness,
        f.project,
        schedule.schedule_id,
        firstId,
        firstGate,
      );
      const secondGate = holdInspection(harness, secondId);
      const second = await finishElapsedInspection(
        request,
        harness,
        f.project,
        schedule.schedule_id,
        secondId,
        secondGate,
      );
      expect(first.occurrence.due_first_ms).toBe(schedule.next_due_ms);
      expect(first.occurrence.due_first_ms).toBeGreaterThanOrEqual(started + 60000);
      expect(second.occurrence.due_first_ms - first.occurrence.due_first_ms).toBe(60000);
      expect(Date.now() - started).toBeGreaterThanOrEqual(120000);
      expect(second.receipt.occurrence_id).not.toBe(first.receipt.occurrence_id);
      expect(second.receipt.session_id).not.toBe(first.receipt.session_id);
      expect(second.receipt.initial_run_id).not.toBe(first.receipt.initial_run_id);
      expect(second.receipt.first_input_id).not.toBe(first.receipt.first_input_id);
      expect(second.launch.workspace_path).not.toBe(first.launch.workspace_path);
      for (const task of [first, second]) expect(task.launch.source.commit).toBe(f.commit);
      await page.goto(
        `${harness.baseUrl}/#/project/${f.project}/task-schedules?schedule=${schedule.schedule_id}`,
      );
      await page.getByRole("button", { name: "Stop schedule", exact: true }).click();
      await expect(page.getByRole("button", { name: "Stop schedule", exact: true })).toBeDisabled();
      const before = await inspect(request, harness, f.project, schedule.schedule_id);
      expect(before.inventory).toHaveLength(2);
      await elapsedScreenshot(page, info, `elapsed-${lane}-two-tasks.png`);
      await page
        .locator(`[data-occurrence="${first.receipt.occurrence_id}"]`)
        .getByRole("link", { name: "Open task" })
        .click();
      await expect(
        page.getByText(`${firstId} initial inspection complete.`, { exact: true }),
      ).toBeVisible();
      await expect
        .poll(
          async () => {
            const summaries: ElapsedSummary[] = await (
              await request.get(`${harness.baseUrl}/sessions`)
            ).json();
            return summaries.find((item) => item.summary.session_id === first.receipt.session_id)
              ?.heartbeat_results?.[0]?.seen;
          },
          { timeout: 15000 },
        )
        .toBe(true);
      const summaries: ElapsedSummary[] = await (
        await request.get(`${harness.baseUrl}/sessions`)
      ).json();
      expect(
        summaries.find((item) => item.summary.session_id === second.receipt.session_id)
          ?.heartbeat_results?.[0]?.seen,
      ).toBe(false);
      await expect
        .poll(
          () =>
            acknowledgements.some(
              (item) =>
                item.session === first.receipt.session_id &&
                item.status === 204 &&
                item.through_sequence === first.receipt.initial_outcome?.settlement_sequence,
            ),
          { timeout: 15000 },
        )
        .toBe(true);
      const continuations = await continueElapsedTasks(
        request,
        harness,
        page,
        [first, second],
        lane,
      );
      const after = await inspect(request, harness, f.project, schedule.schedule_id);
      expect(after.inventory).toHaveLength(2);
      for (const task of [first, second]) {
        expect(
          after.inventory.find((item) => item.occurrence_id === task.receipt.occurrence_id)
            ?.initial_outcome,
        ).toEqual(task.receipt.initial_outcome);
      }
      await f.assertSourcePreserved();
      expect(controls).not.toContain("run_now");
      harness.provider.assertConsumed();
      const expectedSteps = [
        ...(lane === "model-native"
          ? ["elapsed-native-create", "elapsed-native-read", "elapsed-native-created"]
          : []),
        ...[firstId, secondId].flatMap((id) => [`${id}-read`, `${id}-report`, `${id}-ended`]),
        ...[0, 1].flatMap((index) => [
          `${lane}-continue-${index}-write`,
          `${lane}-continue-${index}-ended`,
        ]),
      ];
      const requests = harness.provider.requests.filter((item) => item.path === "/responses");
      expect(requests.map((item) => item.matchedStep)).toEqual(expectedSteps);
      const functionCalls = requests.filter(
        (item) =>
          item.matchedStep !== undefined && /-(read|report|write|create)$/.test(item.matchedStep),
      );
      expect(functionCalls).toHaveLength(lane === "human" ? 6 : 8);
      const runs = [
        first.receipt.initial_run_id,
        second.receipt.initial_run_id,
        ...continuations.map((item) => item.run_id),
        ...(creatorRun ? [creatorRun] : []),
      ];
      expect(runs.every((run) => typeof run === "string" && run.length > 0)).toBe(true);
      expect(new Set(runs).size).toBe(lane === "human" ? 4 : 5);
      await page.goto(
        `${harness.baseUrl}/#/project/${f.project}/task-schedules?schedule=${schedule.schedule_id}`,
      );
      for (const task of [first, second])
        await expect(
          page.locator(`[data-occurrence="${task.receipt.occurrence_id}"]`),
        ).toContainText("Initial occurrence settled: unchanged");
      await elapsedScreenshot(page, info, `elapsed-${lane}-both-continued.png`);
      qualification = {
        status: "PASS",
        lane,
        started_at_ms: started,
        finished_at_ms: Date.now(),
        schedule_id: schedule.schedule_id,
        creator_session_id: creatorSession ?? null,
        creator_run_id: creatorRun ?? null,
        source_commit: f.commit,
        source_preserved: true,
        logical_runs: runs.length,
        function_calls: functionCalls.length,
        continuations,
        tasks: [first, second].map((task) => ({
          occurrence_id: task.receipt.occurrence_id,
          session_id: task.receipt.session_id,
          initial_run_id: task.receipt.initial_run_id,
          first_input_id: task.receipt.first_input_id,
          due_first_ms: task.occurrence.due_first_ms,
          run_now: task.occurrence.run_now,
          initial_outcome: task.receipt.initial_outcome?.outcome,
          settlement_sequence: task.receipt.initial_outcome?.settlement_sequence,
        })),
      };
    } finally {
      // Allowlisted dummy-fixture receipts only: no request bodies, paths, env, logs or DB.
      const json = JSON.stringify({ qualification, controls, acknowledgements }, null, 2);
      expect(Buffer.byteLength(json)).toBeLessThanOrEqual(256 * 1024);
      await fs.writeFile(info.outputPath(`elapsed-qualification-${lane}.json`), json);
    }
  });
}
