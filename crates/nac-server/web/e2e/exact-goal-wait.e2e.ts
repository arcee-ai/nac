import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { APIRequestContext, TestInfo } from "@playwright/test";
import {
  createProject,
  createSession,
  expect,
  test,
  waitForRunIdle,
  type EmbeddedHarness,
} from "./harness";
import { ScriptGate } from "./scripted-provider";

type Goal = {
  goal_id: string;
  status: string;
  version: number;
  accounting_run_id: string | null;
  last_failure: unknown;
};
type Observation = {
  session_id: string;
  mode: string;
  status: string;
  resolved_identity: string;
  after_cursor: string;
  resync: boolean;
  unchanged?: boolean;
  proof?: { goal_id: string; version: number; last_run_id: string; retained: boolean };
  attention?: unknown;
};
type WaitResult = { status: string; targets: Observation[] };
type TaskRead = {
  session_id: string;
  project_id: string;
  durable: {
    goal: Goal | null;
    goal_last_run_id: string | null;
    pending_inbox_items: number;
    run_count: number;
  };
  ephemeral: { approvals: string };
};
type Evidence = { calls: Record<string, unknown>; [key: string]: unknown };
type NativeCall = {
  id: string;
  caller: string;
  harness: EmbeddedHarness;
  request: APIRequestContext;
  end: ScriptGate;
  evidence: Evidence;
  followup?: unknown;
};

async function step(harness: EmbeddedHarness, id: string) {
  await expect
    .poll(() => harness.provider.requests.some((entry) => entry.matchedStep === id), {
      timeout: 10_000,
      intervals: [25, 50, 100, 250],
    })
    .toBe(true);
  return harness.provider.requests.find((entry) => entry.matchedStep === id)!;
}

function output(body: unknown, callId: string): string {
  const input = (body as { input?: Array<{ type?: string; call_id?: string; output?: string }> })
    .input;
  expect(Array.isArray(input)).toBe(true);
  const result = input!.find(
    (entry) => entry.type === "function_call_output" && entry.call_id === callId,
  );
  expect(typeof result?.output).toBe("string");
  return result!.output!;
}

async function startNative(
  request: APIRequestContext,
  harness: EmbeddedHarness,
  caller: string,
  evidence: Evidence,
  id: string,
  name: "wait_tasks" | "read_task",
  args: Record<string, unknown>,
): Promise<NativeCall> {
  const end = new ScriptGate();
  harness.provider.enqueue(
    `${id}-call`,
    { token: id, requiredTools: [name] },
    { kind: "function_call", stream: "request", name, callId: id, arguments: args },
  );
  harness.provider.enqueue(
    `${id}-result`,
    { functionOutputCallId: id },
    { kind: "text", stream: "request", text: `${id} inspected` },
    end,
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${caller}/runs`, { data: { prompt: id } })
    ).status(),
  ).toBe(202);
  await step(harness, `${id}-call`);
  return { id, caller, harness, request, end, evidence };
}

async function finishNative<T>(call: NativeCall): Promise<T> {
  try {
    const followup = await step(call.harness, `${call.id}-result`);
    call.followup = followup.body;
    const value = JSON.parse(output(followup.body, call.id)) as T;
    call.evidence.calls[call.id] = value;
    call.end.release();
    await waitForRunIdle(call.request, call.harness, call.caller);
    return value;
  } finally {
    call.end.release();
  }
}

async function finishTaskRead(
  call: NativeCall,
  session: string,
  project: string,
): Promise<TaskRead> {
  const result = await finishNative<{ status: string; task: TaskRead }>(call);
  expect(result.status).toBe("found");
  expect(result.task).toMatchObject({ session_id: session, project_id: project });
  return result.task;
}

function goalArgs(session: string, project: string, goal: string, cursor: string | null, ms = 0) {
  return {
    targets: [
      {
        session_id: session,
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

function observed(result: WaitResult, session: string, goal: string): Observation {
  expect(result.targets).toHaveLength(1);
  const target = result.targets[0];
  expect(target).toMatchObject({ session_id: session, mode: "goal", resolved_identity: goal });
  expect(target.after_cursor.length).toBeGreaterThan(0);
  return target;
}

function quiet(result: WaitResult, session: string, goal: string, status: string) {
  expect(result.status).toBe("timeout");
  const target = observed(result, session, goal);
  expect(target).toMatchObject({ status, unchanged: true });
  expect(target.proof).toBeUndefined();
  expect(target.attention).toBeUndefined();
  return target;
}

async function currentGoal(request: APIRequestContext, harness: EmbeddedHarness, session: string) {
  const response = await request.get(`${harness.baseUrl}/sessions/${session}/goal`);
  expect(response.ok()).toBe(true);
  const goal = (await response.json()) as Goal | null;
  expect(goal).not.toBeNull();
  return goal!;
}

async function retainGoalEvidence(
  info: TestInfo,
  harness: EmbeddedHarness,
  caseId: "g1" | "g2",
  evidence: Evidence,
) {
  // The existing harness writes its final stop receipt to this same inode,
  // then removes runRoot. Retain that ledger, without changing teardown.
  const processFile = path.join(harness.runRoot, "process.json");
  const processStat = await fs.lstat(processFile);
  expect(processStat.isFile()).toBe(true);
  expect(processStat.isSymbolicLink()).toBe(false);
  await fs.link(processFile, info.outputPath(`all471-${caseId}-cleanup.json`));
  const proofFile = info.outputPath(`all471-${caseId}-proof.json`);
  const proof = JSON.stringify(evidence, null, 2);
  expect(Buffer.byteLength(proof)).toBeLessThanOrEqual(131_072);
  await fs.writeFile(proofFile, proof);
  await info.attach(`ALL471-${caseId.toUpperCase()} evidence`, {
    path: proofFile,
    contentType: "application/json",
  });
}

async function identity(request: APIRequestContext, harness: EmbeddedHarness) {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
  const { stdout } = await promisify(execFile)("git", ["rev-parse", "HEAD"], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
  });
  const response = await request.get(harness.baseUrl);
  expect(response.ok()).toBe(true);
  const match = (await response.text()).match(
    /<script id="nac-presentation-binding" type="application\/json">([^<]+)<\/script>/,
  );
  expect(match).not.toBeNull();
  const binding = JSON.parse(match![1]) as { scope: { release: string; incarnation: string } };
  expect(JSON.parse(binding.scope.release)[3]).toBe(stdout.trim());
  return {
    source: stdout.trim(),
    binary: harness.binaryPath,
    binary_sha256: createHash("sha256")
      .update(await fs.readFile(harness.binaryPath))
      .digest("hex"),
    ...binding.scope,
  };
}

test("ALL471-G1 exact completed goal stays quiet through settlement, clear and restart", async ({
  harness,
  request,
}, info) => {
  test.setTimeout(120_000);
  const evidence: Evidence = { calls: {} };
  const begin = new ScriptGate();
  const read = new ScriptGate();
  const settle = new ScriptGate();
  try {
    evidence.identity = await identity(request, harness);
    const project = await createProject(request, harness);
    const target = await createSession(request, harness, "direct", project);
    const caller = await createSession(request, harness, "direct", project);
    const marker = "all471-g1-native-read-confirmed";
    const file = path.join(harness.runRoot, "workspace", "goal-marker.txt");
    await fs.writeFile(file, marker);
    harness.provider.enqueue(
      "g1-read",
      { token: "ALL471_G1_OBJECTIVE", requiredTools: ["read", "update_goal"] },
      {
        kind: "function_call",
        stream: "request",
        name: "read",
        callId: "g1-read",
        arguments: { path: file },
      },
      begin,
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${target}/goal`, {
          data: {
            objective:
              "ALL471_G1_OBJECTIVE: verify the exact contents of goal-marker.txt, then complete this goal.",
          },
        })
      ).status(),
    ).toBe(201);
    await step(harness, "g1-read");
    const initial = await currentGoal(request, harness, target);
    expect(initial.status).toBe("active");
    expect(initial.accounting_run_id).not.toBeNull();
    const run = initial.accounting_run_id!;
    const goal = initial.goal_id;
    evidence.initial = { target, caller, project, goal: initial };
    const snapshot = await finishNative<WaitResult>(
      await startNative(
        request,
        harness,
        caller,
        evidence,
        "g1-snapshot",
        "wait_tasks",
        goalArgs(target, project, goal, null),
      ),
    );
    expect(snapshot.status).toBe("snapshot");
    const active = observed(snapshot, target, goal);
    expect(active.status).toBe("active");
    harness.provider.enqueue(
      "g1-complete",
      { functionOutputCallId: "g1-read" },
      {
        kind: "function_call",
        stream: "request",
        name: "update_goal",
        callId: "g1-complete",
        arguments: { goal_id: goal, status: "complete" },
      },
      read,
    );
    harness.provider.enqueue(
      "g1-settle",
      { functionOutputCallId: "g1-complete" },
      { kind: "text", stream: "request", text: "verified marker; finite goal complete" },
      settle,
    );
    const waiting = await startNative(
      request,
      harness,
      caller,
      evidence,
      "g1-completion-wake",
      "wait_tasks",
      goalArgs(target, project, goal, active.after_cursor, 30_000),
    );
    begin.release();
    const verified = await step(harness, "g1-complete");
    evidence.verified_read = output(verified.body, "g1-read");
    expect(output(verified.body, "g1-read")).toContain(marker);
    read.release();
    const goalUpdate = await step(harness, "g1-settle");
    evidence.native_complete = output(goalUpdate.body, "g1-complete");
    const completed = await finishNative<WaitResult>(waiting);
    expect(completed.status).toBe("target_changed");
    const terminal = observed(completed, target, goal);
    expect(terminal).toMatchObject({
      status: "goal_complete",
      proof: { goal_id: goal, last_run_id: run, retained: false },
    });
    const beforeSettlement = await currentGoal(request, harness, target);
    expect(beforeSettlement).toMatchObject({ status: "complete", accounting_run_id: run });
    settle.release();
    await waitForRunIdle(request, harness, target);
    const settled = await currentGoal(request, harness, target);
    expect(settled).toMatchObject({
      status: "complete",
      accounting_run_id: null,
      last_failure: null,
    });
    expect(settled.version).toBeGreaterThan(beforeSettlement.version);
    evidence.settled = settled;
    quiet(
      await finishNative<WaitResult>(
        await startNative(
          request,
          harness,
          caller,
          evidence,
          "g1-quiet-settlement",
          "wait_tasks",
          goalArgs(target, project, goal, terminal.after_cursor, 250),
        ),
      ),
      target,
      goal,
      "goal_complete",
    );
    expect(
      (
        await request.delete(`${harness.baseUrl}/sessions/${target}/goal/${goal}`, {
          data: { expected_version: settled.version },
        })
      ).status(),
    ).toBe(204);
    expect(
      await (await request.get(`${harness.baseUrl}/sessions/${target}/goal`)).json(),
    ).toBeNull();
    quiet(
      await finishNative<WaitResult>(
        await startNative(
          request,
          harness,
          caller,
          evidence,
          "g1-quiet-clear",
          "wait_tasks",
          goalArgs(target, project, goal, terminal.after_cursor, 250),
        ),
      ),
      target,
      goal,
      "goal_complete",
    );
    const previous = await identity(request, harness);
    await harness.restart("1", undefined, true);
    const restarted = await identity(request, harness);
    expect(restarted.source).toBe(previous.source);
    expect(restarted.binary_sha256).toBe(previous.binary_sha256);
    expect(restarted.incarnation).not.toBe(previous.incarnation);
    evidence.restarted = restarted;
    const resynced = quiet(
      await finishNative<WaitResult>(
        await startNative(
          request,
          harness,
          caller,
          evidence,
          "g1-restart-cursor",
          "wait_tasks",
          goalArgs(target, project, goal, terminal.after_cursor, 250),
        ),
      ),
      target,
      goal,
      "goal_complete",
    );
    expect(resynced.resync).toBe(true);
    const fresh = await finishNative<WaitResult>(
      await startNative(
        request,
        harness,
        caller,
        evidence,
        "g1-retained-proof",
        "wait_tasks",
        goalArgs(target, project, goal, null),
      ),
    );
    expect(fresh.status).toBe("target_changed");
    expect(observed(fresh, target, goal)).toMatchObject({
      status: "goal_complete",
      proof: { goal_id: goal, last_run_id: run, retained: true },
    });
    harness.provider.assertConsumed();
  } finally {
    begin.release();
    read.release();
    settle.release();
    await retainGoalEvidence(info, harness, "g1", evidence);
  }
});

test("ALL471-G2 input interruption and human pause preserve exact goal and independent run", async ({
  harness,
  request,
}, info) => {
  test.setTimeout(120_000);
  const evidence: Evidence = { calls: {} };
  const begin = new ScriptGate();
  try {
    evidence.identity = await identity(request, harness);
    const project = await createProject(request, harness);
    const target = await createSession(request, harness, "direct", project);
    const caller = await createSession(request, harness, "direct", project);
    const file = path.join(harness.runRoot, "workspace", "pause-marker.txt");
    const marker = "all471-g2-native-read-confirmed";
    await fs.writeFile(file, marker);
    harness.provider.enqueue(
      "g2-read",
      { token: "ALL471_G2_OBJECTIVE", requiredTools: ["read"] },
      {
        kind: "function_call",
        stream: "request",
        name: "read",
        callId: "g2-read",
        arguments: { path: file },
      },
      begin,
    );
    harness.provider.enqueue(
      "g2-settle",
      { functionOutputCallId: "g2-read" },
      { kind: "text", stream: "request", text: "marker read; human pause remains authoritative" },
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${target}/goal`, {
          data: {
            objective:
              "ALL471_G2_OBJECTIVE: inspect pause-marker.txt; human will pause this goal before completion.",
          },
        })
      ).status(),
    ).toBe(201);
    await step(harness, "g2-read");
    const initial = await currentGoal(request, harness, target);
    expect(initial).toMatchObject({ status: "active", last_failure: null });
    expect(initial.accounting_run_id).not.toBeNull();
    const run = initial.accounting_run_id!;
    const goal = initial.goal_id;
    evidence.initial = { target, caller, project, goal: initial };
    const before = await finishTaskRead(
      await startNative(request, harness, caller, evidence, "g2-passive-before", "read_task", {
        session_id: target,
        project_id: project,
      }),
      target,
      project,
    );
    const snapshot = await finishNative<WaitResult>(
      await startNative(
        request,
        harness,
        caller,
        evidence,
        "g2-snapshot",
        "wait_tasks",
        goalArgs(target, project, goal, null),
      ),
    );
    expect(snapshot.status).toBe("snapshot");
    const active = observed(snapshot, target, goal);
    expect(active.status).toBe("active");
    const interrupted = await startNative(
      request,
      harness,
      caller,
      evidence,
      "g2-input-wait",
      "wait_tasks",
      goalArgs(target, project, goal, active.after_cursor, 30_000),
    );
    const guidance = "all471-g2-exact-coordinator-guidance";
    const inputStarted = Date.now();
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${caller}/inbox`, {
          data: { delivery: "steer", prompt: guidance },
        })
      ).status(),
    ).toBe(202);
    const input = await finishNative<WaitResult>(interrupted);
    expect(Date.now() - inputStarted).toBeLessThan(3_000);
    expect(input.status).toBe("coordinator_input");
    expect(observed(input, target, goal).status).toBe("active");
    expect(JSON.stringify(interrupted.followup)).toContain(guidance);
    const after = await finishTaskRead(
      await startNative(request, harness, caller, evidence, "g2-passive-after-input", "read_task", {
        session_id: target,
        project_id: project,
      }),
      target,
      project,
    );
    expect(after.durable.goal).toEqual(before.durable.goal);
    expect(after.durable.pending_inbox_items).toBe(before.durable.pending_inbox_items);
    expect(after.durable.run_count).toBe(before.durable.run_count);
    expect(after.ephemeral.approvals).toBe("unknown");
    expect(await currentGoal(request, harness, target)).toEqual(initial);
    const waiting = await startNative(
      request,
      harness,
      caller,
      evidence,
      "g2-pause-wait",
      "wait_tasks",
      goalArgs(target, project, goal, active.after_cursor, 30_000),
    );
    const pauseStarted = Date.now();
    const pause = await request.patch(`${harness.baseUrl}/sessions/${target}/goal/${goal}`, {
      data: { expected_version: initial.version, status: "paused" },
    });
    expect(pause.status()).toBe(200);
    const paused = (await pause.json()) as Goal;
    evidence.human_pause = { http_status: pause.status(), goal: paused };
    expect(paused).toMatchObject({ goal_id: goal, status: "paused", accounting_run_id: run });
    const changed = await finishNative<WaitResult>(waiting);
    expect(Date.now() - pauseStarted).toBeLessThan(3_000);
    expect(changed.status).toBe("target_changed");
    const stopped = observed(changed, target, goal);
    expect(stopped).toMatchObject({
      status: "goal_paused",
      proof: { goal_id: goal, last_run_id: run },
    });
    expect(await currentGoal(request, harness, target)).toEqual(paused);
    begin.release();
    const targetResult = await step(harness, "g2-settle");
    evidence.verified_read = output(targetResult.body, "g2-read");
    expect(output(targetResult.body, "g2-read")).toContain(marker);
    await waitForRunIdle(request, harness, target);
    const settled = await currentGoal(request, harness, target);
    expect(settled).toMatchObject({
      goal_id: goal,
      status: "paused",
      accounting_run_id: null,
      last_failure: null,
    });
    expect(settled.version).toBeGreaterThan(paused.version);
    evidence.settled = settled;
    quiet(
      await finishNative<WaitResult>(
        await startNative(
          request,
          harness,
          caller,
          evidence,
          "g2-quiet-settlement",
          "wait_tasks",
          goalArgs(target, project, goal, stopped.after_cursor, 250),
        ),
      ),
      target,
      goal,
      "goal_paused",
    );
    const fresh = await finishNative<WaitResult>(
      await startNative(
        request,
        harness,
        caller,
        evidence,
        "g2-fresh-proof",
        "wait_tasks",
        goalArgs(target, project, goal, null),
      ),
    );
    expect(fresh.status).toBe("target_changed");
    expect(observed(fresh, target, goal)).toMatchObject({
      status: "goal_paused",
      proof: { goal_id: goal, last_run_id: run, version: settled.version },
    });
    const retained = await finishTaskRead(
      await startNative(request, harness, caller, evidence, "g2-passive-final", "read_task", {
        session_id: target,
        project_id: project,
      }),
      target,
      project,
    );
    expect(retained.durable.goal).toEqual(settled);
    expect(retained.durable.goal_last_run_id).toBe(run);
    expect(retained.durable.run_count).toBe(before.durable.run_count);
    expect(retained.durable.pending_inbox_items).toBe(before.durable.pending_inbox_items);
    harness.provider.assertConsumed();
  } finally {
    begin.release();
    await retainGoalEvidence(info, harness, "g2", evidence);
  }
});
