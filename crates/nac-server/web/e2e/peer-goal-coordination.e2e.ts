import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { APIRequestContext, Page, TestInfo } from "@playwright/test";
import {
  createProject,
  createSession,
  expect,
  test,
  waitForRunIdle,
  type EmbeddedHarness,
} from "./harness";
import {
  configuration,
  finishNative,
  identity,
  matched,
  native,
  permissions,
  startNative,
  toolOutput,
  type Evidence,
  type Question,
} from "./question-coordination-fixture";
import { ScriptGate } from "./scripted-provider";

type Goal = {
  goal_id: string;
  status: string;
  version: number;
  token_budget: number | null;
  tokens_used: number;
  accounting_run_id: string | null;
  accounting_token_baseline: number | null;
};
type Outcome = {
  status: string;
  receipt?: { admitted_goal: Goal; [key: string]: unknown };
  goal?: Goal | null;
  prior_goals?: Array<{ goal_id: string; status: string; version: number; last_run_id: string }>;
};
type Wait = {
  status: string;
  targets: Array<{
    status: string;
    resolved_identity: string;
    after_cursor: string;
    unchanged?: boolean;
    resync: boolean;
    proof?: { goal_id: string; version: number; last_run_id: string; retained: boolean };
    attention?: { request_id: string; run_id: string; generation: string; revision: number };
  }>;
};
type TaskRead = {
  status: string;
  task: { durable: { run_count: number; pending_inbox_items: number } };
};

function args(
  action: "start" | "read" | "pause" | "resume",
  peer: string,
  project: string,
  goal?: Goal,
  requestId = "e-admission",
) {
  return {
    action,
    session_id: peer,
    project_id: project,
    request_id: action === "start" ? requestId : null,
    objective: action === "start" ? "Finish the exact finite peer fixture" : null,
    token_budget: action === "start" ? 1_000 : null,
    goal_id: action === "pause" || action === "resume" ? goal!.goal_id : null,
    expected_version: action === "pause" || action === "resume" ? goal!.version : null,
  };
}

async function get<T>(request: APIRequestContext, harness: EmbeddedHarness, route: string) {
  const response = await request.get(`${harness.baseUrl}${route}`);
  expect(response.ok(), route).toBe(true);
  return (await response.json()) as T;
}

async function current(request: APIRequestContext, harness: EmbeddedHarness, peer: string) {
  const goal = await get<Goal | null>(request, harness, `/sessions/${peer}/goal`);
  expect(goal).not.toBeNull();
  return goal!;
}

async function goalCall(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  page: Page,
  info: TestInfo,
  caller: string,
  evidence: Evidence,
  id: string,
  input: ReturnType<typeof args>,
  manual = true,
) {
  const before = await permissions(request, harness, caller);
  const call = await startNative(request, harness, caller, evidence, id, "task_goal", input);
  const replies: unknown[] = [];
  for (let ordinal = 0; ordinal < 3; ordinal++) {
    let pending: { id: string; resources: Array<{ action: string; resource: string }> } | undefined;
    await expect
      .poll(async () => {
        pending = (await permissions(request, harness, caller)).requests[0];
        if (pending) return "permission";
        return harness.provider.requests.some((entry) => entry.matchedStep === `${id}-result`)
          ? "done"
          : "waiting";
      })
      .not.toBe("waiting");
    if (!pending) break;
    expect(manual, "receipt reconciliation requires no fresh goal-action authorization").toBe(true);
    expect(ordinal).toBeLessThan(2);
    expect(pending.resources).toContainEqual(
      expect.objectContaining({
        action: `task_goal_${input.action}`,
        resource: `session:${input.session_id}`,
      }),
    );
    await page.goto(
      `${harness.baseUrl}/#/session/${caller}/insights?permission_request=${pending.id}`,
    );
    await expect(
      page.getByRole("dialog", { name: "Permission required", exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath(`${id}-${ordinal}-permission.png`) });
    const acknowledgement = page.waitForResponse(
      (r) =>
        r.url() === `${harness.baseUrl}/sessions/${caller}/permissions/${pending!.id}` &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    const response = await acknowledgement;
    expect(response.status()).toBe(204);
    replies.push({ request: pending, post: response.request().postDataJSON(), status: 204 });
    await expect
      .poll(async () =>
        (await permissions(request, harness, caller)).requests.map((r: { id: string }) => r.id),
      )
      .not.toContain(pending.id);
  }
  expect(replies.length).toBe(manual ? 1 : 0);
  const value = JSON.parse(await finishNative(call)) as Outcome;
  const after = await permissions(request, harness, caller);
  expect(after.requests).toEqual([]);
  expect(after.grants).toEqual(before.grants);
  expect(after.approval_mode).toBe(before.approval_mode);
  evidence[`${id}-human-replies`] = replies;
  return value;
}

function waitArgs(peer: string, project: string, goal: string, cursor: string | null, ms = 0) {
  return {
    targets: [
      {
        session_id: peer,
        project_id: project,
        mode: "goal",
        run_id: null,
        goal_id: goal,
        after_cursor: cursor,
      },
    ],
    timeout_ms: ms,
  };
}

async function retain(info: TestInfo, harness: EmbeddedHarness, evidence: Evidence) {
  const processFile = path.join(harness.runRoot, "process.json");
  const state = await fs.lstat(processFile);
  expect(state.isFile() && !state.isSymbolicLink()).toBe(true);
  await fs.link(processFile, info.outputPath(`all473-${evidence.case}-cleanup.json`));
  await fs.writeFile(
    info.outputPath(`all473-${evidence.case}-proof.json`),
    JSON.stringify(evidence, null, 2),
  );
}

test("ALL473-E1 peer controls compose with quiet waits and exact human question continuation", async ({
  harness,
  request,
  page,
}, info) => {
  test.setTimeout(120_000);
  const evidence: Evidence = { case: "e1", calls: {} };
  const begin = new ScriptGate();
  const interactive = new AbortController();
  let callerEvents: Response | undefined;
  try {
    evidence.identity = await identity(request, harness);
    const project = await createProject(request, harness);
    const peer = await createSession(request, harness, "direct", project);
    const caller = await createSession(request, harness, "direct", project);
    const observer = await createSession(request, harness, "direct", project);
    evidence.actors = { project, peer, caller, observer };
    const config = await configuration(request, harness, caller);
    expect(await get(request, harness, `/sessions/${peer}/goal`)).toBeNull();
    callerEvents = await fetch(`${harness.baseUrl}/sessions/${caller}/events/stream`, {
      signal: interactive.signal,
    });
    expect(callerEvents.ok).toBe(true);
    harness.provider.enqueue(
      "e1-initial",
      { token: "E1_BEGIN" },
      { kind: "text", stream: "request", text: "E1_TARGET_INITIAL_DONE" },
      begin,
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${peer}/runs`, {
          data: { prompt: "E1_BEGIN" },
        })
      ).status(),
    ).toBe(202);
    await begin.accepted;
    const running = await get<{ active_run: { run_id: string } }>(
      request,
      harness,
      `/sessions/${peer}`,
    );
    const started = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e1-start",
      args("start", peer, project),
    );
    expect(started.status).toBe("started");
    const goal = await current(request, harness, peer);
    expect(goal.goal_id).toBe(started.receipt!.admitted_goal.goal_id);
    expect(goal.accounting_run_id).toBe(running.active_run.run_id);
    const snapshot = await native<Wait>(
      request,
      harness,
      observer,
      evidence,
      "e1-active",
      "wait_tasks",
      waitArgs(peer, project, goal.goal_id, null),
    );
    expect(snapshot.targets[0].status).toBe("active");
    const waiting = await startNative(
      request,
      harness,
      observer,
      evidence,
      "e1-pause-wait",
      "wait_tasks",
      waitArgs(peer, project, goal.goal_id, snapshot.targets[0].after_cursor, 30_000),
    );
    const paused = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e1-pause",
      args("pause", peer, project, goal),
    );
    expect(paused.status).toBe("paused");
    expect(paused.goal).toMatchObject({
      goal_id: goal.goal_id,
      accounting_run_id: goal.accounting_run_id,
      accounting_token_baseline: goal.accounting_token_baseline,
    });
    expect(
      (await get<{ active_run: { run_id: string } }>(request, harness, `/sessions/${peer}`))
        .active_run.run_id,
    ).toBe(running.active_run.run_id);
    const pauseWait = JSON.parse(await finishNative(waiting)) as Wait;
    expect(pauseWait.targets[0]).toMatchObject({
      status: "goal_paused",
      resolved_identity: goal.goal_id,
    });
    begin.release();
    await waitForRunIdle(request, harness, peer);
    const settled = await current(request, harness, peer);
    expect(settled).toMatchObject({ status: "paused", accounting_run_id: null });
    const quiet = await native<Wait>(
      request,
      harness,
      observer,
      evidence,
      "e1-quiet-settlement",
      "wait_tasks",
      waitArgs(peer, project, goal.goal_id, pauseWait.targets[0].after_cursor, 250),
    );
    expect(quiet.status).toBe("timeout");
    expect(quiet.targets[0]).toMatchObject({ status: "goal_paused", unchanged: true });
    expect(quiet.targets[0].proof).toBeUndefined();
    harness.provider.enqueue(
      "e1-question",
      { token: "E1_TARGET_INITIAL_DONE", requiredTools: ["request_question"] },
      {
        kind: "function_call",
        stream: "request",
        name: "request_question",
        callId: "e1-question",
        arguments: {
          request_id: "e1-format",
          text: "Which exact fixture format?",
          choices: ["CSV", "JSON"],
          responder_class: "human_decision",
        },
      },
    );
    const resumed = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e1-resume",
      args("resume", peer, project, settled),
    );
    expect(resumed.status).toBe("resumed");
    expect(resumed.goal).toMatchObject({
      goal_id: goal.goal_id,
      token_budget: settled.token_budget,
      tokens_used: settled.tokens_used,
    });
    await matched(harness, "e1-question");
    await waitForRunIdle(request, harness, peer);
    const q = await get<Question>(request, harness, `/sessions/${peer}/questions/e1-format`);
    expect(q.status).toBe("pending");
    const attention = await native<Wait>(
      request,
      harness,
      observer,
      evidence,
      "e1-question-wait",
      "wait_tasks",
      waitArgs(peer, project, goal.goal_id, quiet.targets[0].after_cursor),
    );
    expect(attention.targets[0]).toMatchObject({
      status: "question_attention",
      resolved_identity: goal.goal_id,
      attention: {
        request_id: q.request.request_id,
        run_id: q.request.run_id,
        generation: q.request.generation,
        revision: q.revision,
      },
    });
    harness.provider.enqueue(
      "e1-complete",
      { token: "Structured question response", requiredTools: ["update_goal"] },
      {
        kind: "function_call",
        stream: "request",
        name: "update_goal",
        callId: "e1-complete",
        arguments: { goal_id: goal.goal_id, status: "complete" },
      },
    );
    harness.provider.enqueue(
      "e1-completed",
      { functionOutputCallId: "e1-complete" },
      { kind: "text", stream: "request", text: "Exact CSV goal completed by target." },
    );
    await page.goto(`${harness.baseUrl}/#/session/${peer}/insights?question_request=e1-format`);
    await expect(page.getByRole("region", { name: "Task question", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("e1-question.png") });
    await page.getByRole("button", { name: "CSV", exact: true }).click();
    const acknowledgement = page.waitForResponse(
      (r) =>
        r.url() === `${harness.baseUrl}/sessions/${peer}/questions/e1-format/answer` &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send answer", exact: true }).click();
    const response = await acknowledgement;
    expect(response.status()).toBe(200);
    const receipt = await response.json();
    await waitForRunIdle(request, harness, peer);
    const resolved = await get<Question>(request, harness, `/sessions/${peer}/questions/e1-format`);
    expect(resolved.status).toBe("answered");
    expect(resolved.continuation_state).toBe("delivered");
    expect(resolved.answer).toEqual(receipt);
    const complete = await native<Wait>(
      request,
      harness,
      observer,
      evidence,
      "e1-finished",
      "wait_tasks",
      waitArgs(peer, project, goal.goal_id, attention.targets[0].after_cursor),
    );
    expect(complete.targets[0]).toMatchObject({
      status: "goal_complete",
      resolved_identity: goal.goal_id,
      proof: { goal_id: goal.goal_id, last_run_id: receipt.continuation_run_id },
    });
    expect(harness.provider.requests.filter((r) => r.matchedStep === "e1-complete")).toHaveLength(
      1,
    );
    expect((await permissions(request, harness, caller)).grants).toEqual([]);
    expect(await configuration(request, harness, caller)).toEqual(config);
    evidence.resolution = {
      initial: goal,
      settled,
      question: q,
      answer_post: response.request().postDataJSON(),
      receipt,
      resolved,
      complete,
    };
    expect(harness.provider.requests.every((r) => r.matchedStep != null)).toBe(true);
    harness.provider.assertConsumed();
  } finally {
    begin.release();
    interactive.abort();
    await Promise.allSettled([callerEvents?.body?.cancel()]);
    await retain(info, harness, evidence);
  }
});

test("ALL473-E2 restart reconciles original peer receipts and preserves exact retained goal evidence", async ({
  harness,
  request,
  page,
}, info) => {
  test.setTimeout(120_000);
  const evidence: Evidence = { case: "e2", calls: {} };
  const begin = new ScriptGate();
  let interactive = new AbortController();
  let callerEvents: Response | undefined;
  try {
    evidence.identity = await identity(request, harness);
    const project = await createProject(request, harness);
    const peer = await createSession(request, harness, "direct", project);
    const caller = await createSession(request, harness, "direct", project);
    evidence.actors = { project, peer, caller };
    const config = await configuration(request, harness, caller);
    const file = path.join(harness.runRoot, "workspace", "e2-marker.txt");
    await fs.writeFile(file, "exact E2 target marker\n");
    callerEvents = await fetch(`${harness.baseUrl}/sessions/${caller}/events/stream`, {
      signal: interactive.signal,
    });
    expect(callerEvents.ok).toBe(true);
    harness.provider.enqueue(
      "e2-read",
      { token: "E2_BEGIN", requiredTools: ["read", "update_goal"] },
      {
        kind: "function_call",
        stream: "request",
        name: "read",
        callId: "e2-read",
        arguments: { path: file },
      },
      begin,
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${peer}/runs`, {
          data: { prompt: "E2_BEGIN" },
        })
      ).status(),
    ).toBe(202);
    await begin.accepted;
    const input = args("start", peer, project, undefined, "e2-admission");
    const started = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e2-start",
      input,
    );
    expect(started.status).toBe("started");
    const initial = await current(request, harness, peer);
    harness.provider.enqueue(
      "e2-complete",
      { functionOutputCallId: "e2-read" },
      {
        kind: "function_call",
        stream: "request",
        name: "update_goal",
        callId: "e2-complete",
        arguments: { goal_id: initial.goal_id, status: "complete" },
      },
    );
    harness.provider.enqueue(
      "e2-completed",
      { functionOutputCallId: "e2-complete" },
      { kind: "text", stream: "request", text: "E2 exact marker verified and goal complete." },
    );
    begin.release();
    await matched(harness, "e2-completed");
    await waitForRunIdle(request, harness, peer);
    expect(toolOutput((await matched(harness, "e2-complete")).body, "e2-read")).toContain(
      "exact E2 target marker",
    );
    const settled = await current(request, harness, peer);
    expect(settled).toMatchObject({ status: "complete", accounting_run_id: null });
    const firstIdentity = await identity(request, harness);
    const processBefore = JSON.parse(
      await fs.readFile(path.join(harness.runRoot, "process.json"), "utf8"),
    ) as { pid: number };
    const birth = await promisify(execFile)("ps", [
      "-p",
      String(processBefore.pid),
      "-o",
      "pid=,lstart=,command=",
    ]);
    interactive.abort();
    await Promise.allSettled([callerEvents?.body?.cancel()]);
    callerEvents = undefined;
    await harness.restart("1", undefined, true);
    const restarted = await identity(request, harness);
    expect(restarted.binary_sha256).toBe(firstIdentity.binary_sha256);
    expect(restarted.incarnation).not.toBe(firstIdentity.incarnation);
    expect(() => process.kill(processBefore.pid, 0)).toThrow();
    evidence.restart = {
      before: firstIdentity,
      after: restarted,
      prior_process: processBefore,
      prior_birth: birth.stdout,
      prior_pid_absent: true,
      stop: "existing harness.stopServer completed; old exit code is not exposed by restart",
    };
    interactive = new AbortController();
    callerEvents = await fetch(`${harness.baseUrl}/sessions/${caller}/events/stream`, {
      signal: interactive.signal,
    });
    expect(callerEvents.ok).toBe(true);
    const beforeReplay = await native<TaskRead>(
      request,
      harness,
      caller,
      evidence,
      "e2-before-replay",
      "read_task",
      { session_id: peer, project_id: project },
    );
    expect(beforeReplay.status).toBe("found");
    const replay = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e2-replay",
      input,
      false,
    );
    expect(replay).toEqual({ status: "replayed", receipt: started.receipt });
    expect(await current(request, harness, peer)).toEqual(settled);
    const changed = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e2-changed",
      { ...input, objective: "Different finite intent" },
      false,
    );
    expect(changed.status).toBe("conflict");
    const read = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e2-fresh-read",
      args("read", peer, project),
    );
    expect(read.goal).toEqual(settled);
    const stale = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e2-stale",
      args("pause", peer, project, initial),
    );
    expect(stale.status).toBe("conflict");
    expect(await current(request, harness, peer)).toEqual(settled);
    const afterReplay = await native<TaskRead>(
      request,
      harness,
      caller,
      evidence,
      "e2-after-replay",
      "read_task",
      { session_id: peer, project_id: project },
    );
    expect(afterReplay.task.durable.run_count).toBe(beforeReplay.task.durable.run_count);
    expect(afterReplay.task.durable.pending_inbox_items).toBe(
      beforeReplay.task.durable.pending_inbox_items,
    );
    harness.provider.enqueue(
      "e2-replacement-question",
      { token: "E2_REPLACEMENT_OBJECTIVE", requiredTools: ["request_question"] },
      {
        kind: "function_call",
        stream: "request",
        name: "request_question",
        callId: "e2-replacement-question",
        arguments: {
          request_id: "e2-replacement",
          text: "Hold the replacement goal",
          choices: ["CSV", "JSON"],
          responder_class: "human_decision",
        },
      },
    );
    const replacementResponse = await request.post(`${harness.baseUrl}/sessions/${peer}/goal`, {
      data: {
        objective: "E2_REPLACEMENT_OBJECTIVE: wait for the exact decision",
        token_budget: 1_000,
      },
    });
    expect(replacementResponse.status()).toBe(201);
    await matched(harness, "e2-replacement-question");
    await waitForRunIdle(request, harness, peer);
    const replacement = await current(request, harness, peer);
    expect(replacement.goal_id).not.toBe(initial.goal_id);
    const paused = await request.patch(
      `${harness.baseUrl}/sessions/${peer}/goal/${replacement.goal_id}`,
      { data: { expected_version: replacement.version, status: "paused" } },
    );
    expect(paused.ok()).toBe(true);
    const pausedGoal = (await paused.json()) as Goal;
    const clear = await request.delete(
      `${harness.baseUrl}/sessions/${peer}/goal/${replacement.goal_id}`,
      { data: { expected_version: pausedGoal.version } },
    );
    expect(clear.status()).toBe(204);
    const retained = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e2-retained-read",
      args("read", peer, project),
    );
    expect(retained.goal).toBeNull();
    expect(retained.prior_goals).toContainEqual(
      expect.objectContaining({
        goal_id: settled.goal_id,
        status: "complete",
        version: settled.version,
        last_run_id: initial.accounting_run_id,
      }),
    );
    const finalReplay = await goalCall(
      request,
      harness,
      page,
      info,
      caller,
      evidence,
      "e2-retired-replay",
      input,
      false,
    );
    expect(finalReplay).toEqual(replay);
    expect(await get(request, harness, `/sessions/${peer}/goal`)).toBeNull();
    expect((await permissions(request, harness, caller)).grants).toEqual([]);
    expect(await configuration(request, harness, caller)).toEqual(config);
    evidence.resolution = {
      initial,
      settled,
      beforeReplay,
      afterReplay,
      replacement,
      pausedGoal,
      retained,
      finalReplay,
    };
    expect(harness.provider.requests.every((r) => r.matchedStep != null)).toBe(true);
    harness.provider.assertConsumed();
  } finally {
    begin.release();
    interactive.abort();
    await Promise.allSettled([callerEvents?.body?.cancel()]);
    await retain(info, harness, evidence);
  }
});
