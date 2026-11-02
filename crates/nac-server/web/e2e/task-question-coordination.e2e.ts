import fs from "node:fs/promises";
import path from "node:path";
import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";
import {
  answer,
  configuration,
  createQuestion,
  finishNative,
  identity,
  matched,
  native,
  permissions,
  question,
  retain,
  startNative,
  waitArgs,
  type Evidence,
  type Question,
} from "./question-coordination-fixture";

type TaskRead = {
  status: string;
  task: {
    session_id: string;
    project_id: string;
    durable: {
      run_count: number;
      pending_inbox_items: number;
      pending_question: Question | null;
      goal: { goal_id: string; status: string } | null;
    };
  };
};
type Wait = {
  status: string;
  targets: Array<{
    status: string;
    resolved_identity: string;
    after_cursor: string;
    resync: boolean;
    unchanged?: boolean;
    proof?: { last_run_id?: string };
    attention?: { request_id?: string; navigation?: string; [key: string]: unknown };
  }>;
};

test("ALL472-D4 human cancellation after settled question wakes once without answering", async ({
  harness,
  request,
  page,
}, info) => {
  const evidence: Evidence = { case: "d4", calls: {} };
  try {
    evidence.identity = await identity(request, harness);
    const project = await createProject(request, harness);
    const caller = await createSession(request, harness, "direct", project);
    for (const mode of ["active", "paused", "none"] as const) {
      const peer = await createSession(request, harness, "direct", project);
      const { q, goal } = await createQuestion(
        request,
        harness,
        peer,
        evidence,
        `d4-${mode}`,
        "human_decision",
        mode === "none" ? undefined : mode,
      );
      const configBefore = await configuration(request, harness, peer);
      const before = await native<TaskRead>(
        request,
        harness,
        caller,
        evidence,
        `d4-${mode}-before`,
        "read_task",
        { session_id: peer, project_id: project },
      );
      expect(before.status).toBe("found");
      expect(before.task.durable.pending_question).toMatchObject({ status: "pending" });
      const attention = await native<Wait>(
        request,
        harness,
        caller,
        evidence,
        `d4-${mode}-attention`,
        "wait_tasks",
        waitArgs(q, null, goal?.goal_id ?? null),
      );
      expect(attention.targets[0]).toMatchObject({
        status: "question_attention",
        attention: { request_id: q.request.request_id },
      });
      if (mode === "active") {
        expect(before.task.durable.goal?.status).toBe("active");
        harness.provider.enqueue(
          "d4-ordinary-continuation",
          { token: "nac_goal_continuation", requiredTools: ["update_goal"] },
          {
            kind: "function_call",
            stream: "request",
            name: "update_goal",
            callId: "d4-complete",
            arguments: { goal_id: goal!.goal_id, status: "complete" },
          },
        );
        harness.provider.enqueue(
          "d4-completed",
          { functionOutputCallId: "d4-complete" },
          { kind: "text", stream: "request", text: "Continued after exact cancellation." },
        );
      }
      await page.goto(
        `${harness.baseUrl}/#/session/${peer}/insights?question_request=${q.request.request_id}`,
      );
      await expect(page.getByRole("region", { name: "Task question", exact: true })).toBeVisible();
      if (mode === "active")
        await page.screenshot({ path: info.outputPath("d4-pending.png"), animations: "disabled" });
      const acknowledgement = page.waitForResponse(
        (r) =>
          r.url() ===
            `${harness.baseUrl}/sessions/${peer}/questions/${q.request.request_id}/cancel` &&
          r.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Cancel question", exact: true }).click();
      const response = await acknowledgement;
      expect(response.status()).toBe(200);
      const cancelled = await response.json();
      expect(cancelled).toMatchObject({
        status: "cancelled",
        answer: null,
        continuation_state: null,
      });
      if (mode === "active") await matched(harness, "d4-completed");
      await waitForRunIdle(request, harness, peer);
      const after = await native<TaskRead>(
        request,
        harness,
        caller,
        evidence,
        `d4-${mode}-after`,
        "read_task",
        { session_id: peer, project_id: project },
      );
      expect(after.task.durable.run_count).toBe(
        before.task.durable.run_count + (mode === "active" ? 1 : 0),
      );
      expect(after.task.durable.pending_inbox_items).toBe(0);
      expect(after.task.durable.pending_question).toBeNull();
      expect(after.task.durable.goal?.status ?? null).toBe(
        mode === "active" ? "complete" : mode === "paused" ? "paused" : null,
      );
      expect(await question(request, harness, q)).toEqual(cancelled);
      expect(await configuration(request, harness, peer)).toEqual(configBefore);
      expect(await (await request.get(`${harness.baseUrl}/sessions/${peer}/inbox`)).json()).toEqual(
        [],
      );
      const staleAnswer = await request.post(
        `${harness.baseUrl}/sessions/${peer}/questions/${q.request.request_id}/answer`,
        { data: answer(q, "CSV") },
      );
      expect(staleAnswer.status()).toBe(409);
      evidence[`d4-${mode}-cancel`] = {
        cancelled,
        before: before.task.durable,
        after: after.task.durable,
        unchanged_configuration: configBefore,
        stale_answer_status: staleAnswer.status(),
      };
    }
    expect(
      harness.provider.requests.filter((r) => r.matchedStep === "d4-ordinary-continuation"),
    ).toHaveLength(1);
    const peer = await createSession(request, harness, "direct", project);
    const { q } = await createQuestion(
      request,
      harness,
      peer,
      evidence,
      "d4-reserved",
      "human_decision",
      "paused",
    );
    const guidance = new ScriptGate();
    harness.provider.enqueue(
      "d4-guidance",
      { token: "D4_HELD_GUIDANCE" },
      { kind: "text", stream: "request", text: "Guidance survives reservation cancellation." },
      guidance,
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${peer}/runs`, {
          data: { prompt: "D4_HELD_GUIDANCE" },
        })
      ).status(),
    ).toBe(202);
    await guidance.accepted;
    const accepted = await request.post(
      `${harness.baseUrl}/sessions/${peer}/questions/${q.request.request_id}/answer`,
      { data: answer(q, "CSV") },
    );
    expect(accepted.status()).toBe(200);
    const receipt = await accepted.json();
    expect((await question(request, harness, q)).continuation_state).toBe("pending");
    const cancelled = await request.post(
      `${harness.baseUrl}/sessions/${peer}/questions/${q.request.request_id}/cancel`,
      { data: { expected_revision: receipt.revision } },
    );
    expect(cancelled.status()).toBe(200);
    expect(await cancelled.json()).toMatchObject({
      status: "answered",
      answer: receipt,
      continuation_state: "cancelled",
    });
    const live = await (await request.get(`${harness.baseUrl}/sessions/${peer}`)).json();
    expect(live.active_run).not.toBeNull();
    guidance.release();
    await waitForRunIdle(request, harness, peer);
    const replay = await request.post(
      `${harness.baseUrl}/sessions/${peer}/questions/${q.request.request_id}/answer`,
      { data: answer(q, "CSV") },
    );
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(receipt);
    const inbox = await (await request.get(`${harness.baseUrl}/sessions/${peer}/inbox`)).json();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ id: receipt.inbox_item_id, status: "cancelled" });
    const noReservedRun = await native<TaskRead>(
      request,
      harness,
      caller,
      evidence,
      "d4-reservation-final",
      "read_task",
      { session_id: peer, project_id: project },
    );
    expect(noReservedRun.task.durable.run_count).toBe(2);
    expect(noReservedRun.task.durable.pending_inbox_items).toBe(0);
    evidence.cancelled_reservation = {
      receipt,
      question: await question(request, harness, q),
      inbox,
      guidance_run: live.active_run,
    };
    const reservedUrl = `${harness.baseUrl}/#/session/${peer}/insights?question_request=${q.request.request_id}`;
    await page.goto(reservedUrl);
    await expect(page).toHaveURL(reservedUrl);
    await expect
      .poll(() => question(request, harness, q))
      .toMatchObject({
        request: q.request,
        status: "answered",
        answer: receipt,
        continuation_state: "cancelled",
      });
    await expect(
      page.getByText("Guidance survives reservation cancellation.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/This task question is no longer pending/)).toBeVisible();
    await expect(page.getByRole("region", { name: "Task question", exact: true })).toHaveCount(0);
    await page.evaluate("document.fonts.ready");
    const screenshot = "d4-reserved-continuation-cancelled.png";
    evidence.cancelled_reservation_visual = {
      session_id: peer,
      request: q.request,
      url: page.url(),
      screenshot,
    };
    await page.screenshot({ path: info.outputPath(screenshot), animations: "disabled" });
    harness.provider.assertConsumed();
  } finally {
    await retain(info, harness, evidence);
  }
});

test("ALL472-D5 exact native and human responses preserve isolation and fail closed", async ({
  harness,
  request,
  page,
}, info) => {
  const evidence: Evidence = { case: "d5", calls: {} };
  try {
    evidence.identity = await identity(request, harness);
    const project = await createProject(request, harness, {
      name: "question A",
      cwd: path.join(harness.runRoot, "workspace", "a"),
    });
    const foreign = await createProject(request, harness, {
      name: "question B",
      cwd: path.join(harness.runRoot, "workspace", "b"),
    });
    const caller = await createSession(request, harness, "direct", project);
    const humanPeer = await createSession(request, harness, "direct", project);
    const foreignPeer = await createSession(request, harness, "direct", foreign);
    const askPeer = await createSession(request, harness, "direct", project);
    const denyPeer = await createSession(request, harness, "direct", project);
    const { q: human } = await createQuestion(
      request,
      harness,
      humanPeer,
      evidence,
      "d5-human",
      "human_decision",
      undefined,
      "shared-question",
    );
    const { q: other } = await createQuestion(
      request,
      harness,
      foreignPeer,
      evidence,
      "d5-FOREIGN_SECRET",
      "information",
      undefined,
      "shared-question",
    );
    const { q: ask } = await createQuestion(
      request,
      harness,
      askPeer,
      evidence,
      "d5-ask",
      "information",
      undefined,
      "ask-info",
    );
    const { q: deny } = await createQuestion(
      request,
      harness,
      denyPeer,
      evidence,
      "d5-deny",
      "information",
      undefined,
      "deny-info",
    );
    const config = [
      "[[permissions.rules]]",
      'action = "task_question_answer"',
      `resource = "session:${askPeer}/question:ask-info"`,
      'effect = "ask"',
      "[[permissions.rules]]",
      'action = "task_question_answer"',
      `resource = "session:${denyPeer}/question:deny-info"`,
      'effect = "deny"',
      "",
    ].join("\n");
    await fs.writeFile(path.join(harness.runRoot, "nac-home", "config.toml"), config);
    await harness.restart("1");
    evidence.restarted = await identity(request, harness);
    const before = await permissions(request, harness, caller);
    const configBefore = await configuration(request, harness, caller);
    const deniedRead = await native<{ status: string }>(
      request,
      harness,
      caller,
      evidence,
      "d5-foreign-read",
      "read_question",
      { session_id: foreignPeer, project_id: null, request_id: other.request.request_id },
    );
    expect(deniedRead.status).toBe("outside_scope");
    expect(JSON.stringify(deniedRead)).not.toContain("FOREIGN_SECRET");
    const deniedAnswer = await native<{ status: string }>(
      request,
      harness,
      caller,
      evidence,
      "d5-foreign-answer",
      "answer_question",
      { session_id: foreignPeer, project_id: null, ...answer(other, "Unscoped information") },
    );
    expect(deniedAnswer.status).toBe("outside_scope");
    expect(JSON.stringify(deniedAnswer)).not.toContain("FOREIGN_SECRET");
    const humanRequired = await native<{ status: string }>(
      request,
      harness,
      caller,
      evidence,
      "d5-human-native",
      "answer_question",
      { session_id: humanPeer, project_id: null, ...answer(human, "Known information") },
    );
    expect(humanRequired.status).toBe("human_required");
    const forged = await finishNative(
      await startNative(request, harness, caller, evidence, "d5-forged-human", "answer_question", {
        session_id: humanPeer,
        project_id: null,
        ...answer(human, "Known information"),
        origin: "human",
      }),
    );
    expect(forged).toMatch(/invalid answer_question|unknown field/i);
    const askOutput = await finishNative(
      await startNative(request, harness, caller, evidence, "d5-headless-ask", "answer_question", {
        session_id: askPeer,
        project_id: null,
        ...answer(ask, "Known information"),
      }),
    );
    expect(askOutput).toMatch(/permission|approval|denied/i);
    expect(askOutput).not.toContain("continuation_run_id");
    const denyOutput = await finishNative(
      await startNative(
        request,
        harness,
        caller,
        evidence,
        "d5-configured-deny",
        "answer_question",
        { session_id: denyPeer, project_id: null, ...answer(deny, "Known information") },
      ),
    );
    expect(denyOutput).toMatch(/denied/i);
    const humanDenied = await request.post(
      `${harness.baseUrl}/sessions/${denyPeer}/questions/deny-info/answer`,
      { data: answer(deny, "CSV") },
    );
    expect(humanDenied.status()).toBe(403);
    for (const patch of [
      { run_id: other.request.run_id },
      { generation: other.request.generation },
      { expected_revision: human.revision + 1 },
    ]) {
      const rejected = await request.post(
        `${harness.baseUrl}/sessions/${humanPeer}/questions/shared-question/answer`,
        { data: { ...answer(human, "CSV"), ...patch } },
      );
      expect(rejected.status()).toBe(409);
    }
    for (const q of [human, other, ask, deny]) {
      expect(await question(request, harness, q)).toEqual(q);
      expect(
        await (
          await request.get(`${harness.baseUrl}/sessions/${q.request.session_id}/inbox`)
        ).json(),
      ).toEqual([]);
    }
    const after = await permissions(request, harness, caller);
    expect(after.approval_mode).toBe(before.approval_mode);
    expect(after.grants).toEqual(before.grants);
    expect(after.requests).toEqual([]);
    expect(await configuration(request, harness, caller)).toEqual(configBefore);
    evidence.authority = {
      before,
      after,
      unchanged_configuration: configBefore,
      forged,
      headless: askOutput,
      denied: denyOutput,
      human_deny_status: humanDenied.status(),
    };
    harness.provider.enqueue(
      "d5-human-resumed",
      { token: "D5_HUMAN_DECISION" },
      { kind: "text", stream: "request", text: "Exact human decision received." },
    );
    await page.goto(
      `${harness.baseUrl}/#/session/${humanPeer}/insights?question_request=shared-question`,
    );
    await page.getByLabel("Your answer", { exact: true }).fill("D5_HUMAN_DECISION");
    const acknowledgement = page.waitForResponse(
      (r) =>
        r.url() === `${harness.baseUrl}/sessions/${humanPeer}/questions/shared-question/answer` &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send answer", exact: true }).click();
    const accepted = await acknowledgement;
    expect(accepted.status()).toBe(200);
    const receipt = await accepted.json();
    await matched(harness, "d5-human-resumed");
    await waitForRunIdle(request, harness, humanPeer);
    const replay = await request.post(
      `${harness.baseUrl}/sessions/${humanPeer}/questions/shared-question/answer`,
      { data: answer(human, "D5_HUMAN_DECISION") },
    );
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(receipt);
    const changed = await request.post(
      `${harness.baseUrl}/sessions/${humanPeer}/questions/shared-question/answer`,
      { data: answer(human, "changed") },
    );
    expect(changed.status()).toBe(409);
    expect(await question(request, harness, other)).toEqual(other);
    expect(
      harness.provider.requests.filter((r) => r.matchedStep === "d5-human-resumed"),
    ).toHaveLength(1);
    await page.screenshot({ path: info.outputPath("d5-exact-human.png"), animations: "disabled" });
    // Human invocation skips Ask without granting it to the agent route.
    harness.provider.enqueue(
      "d5-human-ask-resumed",
      { token: "D5_SETTLED_INFORMATION" },
      { kind: "text", stream: "request", text: "Human information response admitted." },
    );
    const humanAsk = await request.post(
      `${harness.baseUrl}/sessions/${askPeer}/questions/ask-info/answer`,
      { data: answer(ask, "D5_SETTLED_INFORMATION") },
    );
    expect(humanAsk.status()).toBe(200);
    await matched(harness, "d5-human-ask-resumed");
    await waitForRunIdle(request, harness, askPeer);
    expect((await permissions(request, harness, askPeer)).requests).toEqual([]);
    expect((await permissions(request, harness, askPeer)).grants).toEqual([]);
    const replacementPeer = await createSession(request, harness, "direct", project);
    const { q: old } = await createQuestion(
      request,
      harness,
      replacementPeer,
      evidence,
      "d5-old-config",
      "information",
    );
    const replacementConfig = await configuration(request, harness, replacementPeer);
    const updated = await request.patch(`${harness.baseUrl}/sessions/${replacementPeer}/config`, {
      data: { reasoning_effort: "low" },
    });
    expect(updated.ok()).toBe(true);
    expect((await configuration(request, harness, replacementPeer)).backend).toEqual(
      replacementConfig.backend,
    );
    expect((await question(request, harness, old)).status).toBe("cancelled");
    const stale = await request.post(
      `${harness.baseUrl}/sessions/${replacementPeer}/questions/${old.request.request_id}/answer`,
      { data: answer(old, "late") },
    );
    expect(stale.status()).toBe(409);
    const { q: fresh } = await createQuestion(
      request,
      harness,
      replacementPeer,
      evidence,
      "d5-new-config",
      "information",
    );
    expect(fresh.request.run_id).not.toBe(old.request.run_id);
    const wrongGeneration = await request.post(
      `${harness.baseUrl}/sessions/${replacementPeer}/questions/${fresh.request.request_id}/answer`,
      {
        data: {
          ...answer(fresh, "late"),
          run_id: old.request.run_id,
          generation: old.request.generation,
        },
      },
    );
    expect(wrongGeneration.status()).toBe(409);
    expect(await question(request, harness, fresh)).toEqual(fresh);
    evidence.resolution = {
      receipt,
      question: await question(request, harness, human),
      foreign_unchanged: await question(request, harness, other),
      config_invalidated: await question(request, harness, old),
      replacement: fresh,
      rejected_old_generation: wrongGeneration.status(),
    };
    harness.provider.assertConsumed();
  } finally {
    await retain(info, harness, evidence);
  }
});

test("ALL472-D6 composed question wait, human interruption, restart and approval stay distinct", async ({
  harness,
  request,
  page,
}, info) => {
  const evidence: Evidence = { case: "d6", calls: {} };
  const observer = new AbortController();
  try {
    const initialIdentity = await identity(request, harness);
    evidence.identity = initialIdentity;
    const project = await createProject(request, harness);
    const caller = await createSession(request, harness, "direct", project);
    const peer = await createSession(request, harness, "direct", project);
    const { q, goal } = await createQuestion(
      request,
      harness,
      peer,
      evidence,
      "d6-decision",
      "human_decision",
      "active",
    );
    const before = await permissions(request, harness, peer);
    const configBefore = await configuration(request, harness, peer);
    const first = await native<Wait>(
      request,
      harness,
      caller,
      evidence,
      "d6-first-wait",
      "wait_tasks",
      waitArgs(q, null, goal!.goal_id),
    );
    expect(first.targets[0]).toMatchObject({
      status: "question_attention",
      resolved_identity: goal!.goal_id,
      attention: { request_id: q.request.request_id },
    });
    expect(first.targets[0].attention?.navigation).toContain(
      `question_request=${q.request.request_id}`,
    );
    const cursor = first.targets[0].after_cursor;
    const quiet = await native<Wait>(
      request,
      harness,
      caller,
      evidence,
      "d6-quiet",
      "wait_tasks",
      waitArgs(q, cursor, goal!.goal_id, 30),
    );
    expect(quiet.status).toBe("timeout");
    expect(quiet.targets[0]).toMatchObject({ status: "question_attention", unchanged: true });
    expect(quiet.targets[0].attention).toBeUndefined();
    const waiting = await startNative(
      request,
      harness,
      caller,
      evidence,
      "d6-interrupt",
      "wait_tasks",
      waitArgs(q, cursor, goal!.goal_id, 30_000),
    );
    await page.goto(`${harness.baseUrl}/#/session/${caller}/insights`);
    await page.getByRole("combobox", { name: "Message" }).fill("D6 exact coordinator guidance");
    await page.getByRole("button", { name: "Steer active run", exact: true }).click();
    const interrupted = await finishNative(waiting);
    expect(JSON.parse(interrupted).status).toBe("coordinator_input");
    const followup = await matched(harness, "d6-interrupt-result");
    expect(JSON.stringify(followup.body)).toContain("D6 exact coordinator guidance");
    expect(await question(request, harness, q)).toEqual(q);
    const currentGoal = await (
      await request.get(`${harness.baseUrl}/sessions/${peer}/goal`)
    ).json();
    expect(currentGoal.status).toBe("active");
    await harness.restart("1", undefined, true);
    const restartedIdentity = await identity(request, harness);
    expect(restartedIdentity.incarnation).not.toBe(initialIdentity.incarnation);
    expect(restartedIdentity.release).toBe(initialIdentity.release);
    expect(await question(request, harness, q)).toEqual(q);
    evidence.restarted = restartedIdentity;
    const restarted = await native<Wait>(
      request,
      harness,
      caller,
      evidence,
      "d6-restart-cursor",
      "wait_tasks",
      waitArgs(q, cursor, goal!.goal_id, 30),
    );
    expect(restarted.status).toBe("timeout");
    expect(restarted.targets[0]).toMatchObject({
      resolved_identity: goal!.goal_id,
      status: "question_attention",
      unchanged: true,
      resync: true,
    });
    harness.provider.enqueue(
      "d6-reserved-continuation",
      { token: "Structured question response", requiredTools: ["update_goal"] },
      {
        kind: "function_call",
        stream: "request",
        name: "update_goal",
        callId: "d6-complete",
        arguments: { goal_id: goal!.goal_id, status: "complete" },
      },
    );
    harness.provider.enqueue(
      "d6-target-complete",
      { functionOutputCallId: "d6-complete" },
      { kind: "text", stream: "request", text: "Exact decision task complete." },
    );
    await page.goto(
      `${harness.baseUrl}/#/session/${peer}/insights?question_request=${q.request.request_id}`,
    );
    await page.getByRole("button", { name: "CSV", exact: true }).click();
    const acknowledgement = page.waitForResponse(
      (r) =>
        r.url() ===
          `${harness.baseUrl}/sessions/${peer}/questions/${q.request.request_id}/answer` &&
        r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Send answer", exact: true }).click();
    const accepted = await acknowledgement;
    expect(accepted.status()).toBe(200);
    const receipt = await accepted.json();
    await matched(harness, "d6-target-complete");
    await expect
      .poll(async () => (await question(request, harness, q)).continuation_state)
      .toBe("delivered");
    await waitForRunIdle(request, harness, peer);
    expect(
      harness.provider.requests.filter((r) => r.matchedStep === "d6-reserved-continuation"),
    ).toHaveLength(1);
    const finished = await native<Wait>(
      request,
      harness,
      caller,
      evidence,
      "d6-finished",
      "wait_tasks",
      waitArgs(q, restarted.targets[0].after_cursor, goal!.goal_id),
    );
    expect(finished.targets[0]).toMatchObject({
      status: "goal_complete",
      resolved_identity: goal!.goal_id,
    });
    expect(finished.targets[0].proof?.last_run_id).toBe(receipt.continuation_run_id);
    expect((await permissions(request, harness, peer)).grants).toEqual(before.grants);
    expect((await permissions(request, harness, peer)).requests).toEqual([]);
    expect(await configuration(request, harness, peer)).toEqual(configBefore);
    const approvalPeer = await createSession(request, harness, "direct", project);
    const approvalConfig = await configuration(request, harness, approvalPeer);
    const outside = path.join(harness.runRoot, "d6-approval.txt");
    await fs.writeFile(outside, "D6 approved native read\n");
    const interactive = await fetch(`${harness.baseUrl}/sessions/${approvalPeer}/events/stream`, {
      signal: observer.signal,
    });
    expect(interactive.ok).toBe(true);
    harness.provider.enqueue(
      "d6-permission-read",
      { token: "D6_PERMISSION_READ", requiredTools: ["read"] },
      {
        kind: "function_call",
        stream: "request",
        name: "read",
        callId: "d6-read",
        arguments: { path: outside },
      },
    );
    harness.provider.enqueue(
      "d6-approved-result",
      { functionOutputCallId: "d6-read" },
      { kind: "text", stream: "request", text: "Approval read complete." },
    );
    expect(
      (
        await request.post(`${harness.baseUrl}/sessions/${approvalPeer}/runs`, {
          data: { prompt: "D6_PERMISSION_READ" },
        })
      ).status(),
    ).toBe(202);
    let pending: { id: string } | undefined;
    await expect
      .poll(async () => {
        pending = (await permissions(request, harness, approvalPeer)).requests[0];
        return pending?.id;
      })
      .toBeTruthy();
    const approval = await native<Wait>(
      request,
      harness,
      caller,
      evidence,
      "d6-approval-wait",
      "wait_tasks",
      {
        targets: [
          {
            session_id: approvalPeer,
            project_id: null,
            mode: "run",
            run_id: null,
            goal_id: null,
            after_cursor: null,
          },
        ],
        timeout_ms: 0,
      },
    );
    expect(approval.targets[0].status).toBe("approval_attention");
    expect(JSON.stringify(approval.targets[0].attention)).toContain(pending!.id);
    // Replaying a real question receipt does not answer this different Ask.
    const replay = await request.post(
      `${harness.baseUrl}/sessions/${peer}/questions/${q.request.request_id}/answer`,
      { data: answer(q, "CSV") },
    );
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(receipt);
    expect((await permissions(request, harness, approvalPeer)).requests[0].id).toBe(pending!.id);
    expect((await permissions(request, harness, approvalPeer)).grants).toEqual([]);
    await page.goto(
      `${harness.baseUrl}/#/session/${approvalPeer}/insights?permission_request=${pending!.id}`,
    );
    await expect(
      page.getByRole("dialog", { name: "Permission required", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("d6-distinct-approval.png"),
      animations: "disabled",
    });
    await page.getByRole("button", { name: "Allow once", exact: true }).click();
    await matched(harness, "d6-approved-result");
    await waitForRunIdle(request, harness, approvalPeer);
    const approvedFollowup = await matched(harness, "d6-approved-result");
    expect(JSON.stringify(approvedFollowup.body)).toContain("D6 approved native read");
    const approvalAfter = await permissions(request, harness, approvalPeer);
    expect(approvalAfter.requests).toEqual([]);
    expect(approvalAfter.grants).toEqual([]);
    expect(await configuration(request, harness, approvalPeer)).toEqual(approvalConfig);
    evidence.resolution = {
      receipt,
      question: await question(request, harness, q),
      unchanged_question_configuration: configBefore,
      approval_target: approvalPeer,
      unchanged_approval_configuration: approvalConfig,
      approval_request: pending,
      approval_attention: approval,
      permission_after: approvalAfter,
    };
    await page.goto(
      `${harness.baseUrl}/#/session/${peer}/insights?question_request=${q.request.request_id}`,
    );
    await expect(page.getByText(/This task question is no longer pending/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send answer", exact: true })).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("d6-resolved-question.png"),
      animations: "disabled",
    });
    harness.provider.assertConsumed();
  } finally {
    observer.abort();
    await retain(info, harness, evidence);
  }
});
