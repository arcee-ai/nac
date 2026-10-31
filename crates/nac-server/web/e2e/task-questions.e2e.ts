import fs from "node:fs/promises";
import path from "node:path";
import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import { ScriptGate } from "./scripted-provider";

test("native information answer resolves a dormant exact owner after restart", async ({
  harness,
  request,
}) => {
  const project = await createProject(request, harness);
  const peer = await createSession(request, harness, "direct", project);
  const coordinator = await createSession(request, harness, "direct", project);
  harness.provider.enqueue(
    "dormant-question",
    { token: "DORMANT_QUESTION" },
    {
      kind: "function_call",
      stream: "request",
      name: "request_question",
      callId: "dormant-question",
      arguments: {
        request_id: "dormant-info",
        text: "Which branch is already authorized?",
        choices: null,
        responder_class: "information",
      },
    },
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${peer}/runs`, {
        data: { prompt: "DORMANT_QUESTION" },
      })
    ).ok(),
  ).toBe(true);
  await waitForRunIdle(request, harness, peer);
  const question = (
    await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json()
  )[0];
  await harness.restart("1");
  // This read is deliberately passive; no target run/view attaches its owner.
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json())[0],
  ).toEqual(question);
  harness.provider.enqueue(
    "answer-dormant",
    { token: "ANSWER_DORMANT_INFO" },
    {
      kind: "function_call",
      stream: "request",
      name: "answer_question",
      callId: "answer-dormant",
      arguments: {
        session_id: peer,
        project_id: null,
        request_id: question.request.request_id,
        run_id: question.request.run_id,
        generation: question.request.generation,
        expected_revision: question.revision,
        answer: "The person selected codex/export.",
      },
    },
  );
  harness.provider.enqueue(
    "dormant-continuation",
    { token: "Structured question response" },
    { kind: "text", stream: "request", text: "Resumed the exact dormant request." },
  );
  harness.provider.enqueue(
    "dormant-coordinator-result",
    { functionOutputCallId: "answer-dormant" },
    { kind: "text", stream: "request", text: "The exact dormant question was answered." },
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${coordinator}/runs`, {
        data: { prompt: "ANSWER_DORMANT_INFO" },
      })
    ).ok(),
  ).toBe(true);
  await waitForRunIdle(request, harness, coordinator);
  await waitForRunIdle(request, harness, peer);
  const resolved = (
    await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json()
  )[0];
  expect(resolved.status).toBe("answered");
  expect(resolved.continuation_state).toBe("delivered");
  expect(resolved.request).toEqual(question.request);
  expect(
    harness.provider.requests.filter((r) => r.matchedStep === "dormant-continuation"),
  ).toHaveLength(1);
  harness.provider.assertConsumed();
});

test("exact human question survives restart, gates a goal, and resumes its reserved continuation once", async ({
  harness,
  page,
  request,
}, info) => {
  const project = await createProject(request, harness);
  const peer = await createSession(request, harness, "direct", project);
  const coordinator = await createSession(request, harness, "direct", project);
  const gate = new ScriptGate();
  harness.provider.enqueue(
    "human-question",
    { token: "HUMAN_QUESTION_START", requiredTools: ["request_question"] },
    {
      kind: "function_call",
      stream: "request",
      name: "request_question",
      callId: "human-question",
      arguments: {
        request_id: "release-choice",
        text: "Which export format should this task use?",
        choices: ["CSV", "JSON"],
        responder_class: "human_decision",
      },
    },
    gate,
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${peer}/runs`, {
        data: { prompt: "HUMAN_QUESTION_START" },
      })
    ).ok(),
  ).toBe(true);
  await gate.accepted;
  const goalResponse = await request.post(`${harness.baseUrl}/sessions/${peer}/goal`, {
    data: { objective: "Deliver the selected export after the person chooses a format" },
  });
  expect(goalResponse.ok()).toBe(true);
  const goal = await goalResponse.json();
  gate.release();
  await waitForRunIdle(request, harness, peer);
  let questions = await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json();
  expect(questions).toHaveLength(1);
  const question = questions[0];
  expect(question.status).toBe("pending");
  expect(question.request.generation).toBe(question.request.run_id);
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${peer}/goal`)).json()).status,
  ).toBe("active");
  expect(
    harness.provider.requests.filter((entry) => entry.matchedStep === "human-question"),
  ).toHaveLength(1);

  await harness.restart("1");
  questions = await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json();
  expect(questions[0].request).toEqual(question.request);
  expect(questions[0].status).toBe("pending");
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${peer}/goal`)).json()).status,
  ).toBe("active");
  harness.provider.enqueue(
    "question-wait",
    { token: "WAIT_HUMAN_QUESTION", requiredTools: ["wait_tasks"] },
    {
      kind: "function_call",
      stream: "request",
      name: "wait_tasks",
      callId: "question-wait",
      arguments: {
        targets: [
          {
            session_id: peer,
            project_id: null,
            mode: "goal",
            run_id: null,
            goal_id: goal.goal_id,
            after_cursor: null,
          },
        ],
        timeout_ms: 30000,
      },
    },
  );
  harness.provider.enqueue(
    "question-attention",
    { functionOutputCallId: "question-wait" },
    { kind: "text", stream: "request", text: "The exact human question is ready." },
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${coordinator}/runs`, {
        data: { prompt: "WAIT_HUMAN_QUESTION" },
      })
    ).ok(),
  ).toBe(true);
  await waitForRunIdle(request, harness, coordinator);
  const observed = JSON.stringify(
    harness.provider.requests.find((entry) => entry.matchedStep === "question-attention")?.body,
  );
  expect(observed).toContain("question_attention");
  expect(observed).toContain("release-choice");
  expect(observed).toContain("question_request");
  await page.goto(`${harness.baseUrl}/#/session/${peer}/insights?question_request=release-choice`);
  await expect(page.getByRole("region", { name: "Task question", exact: true })).toBeVisible();
  await expect(
    page.getByText("Which export format should this task use?", { exact: true }),
  ).toBeVisible();
  const desktop = page.viewportSize() ?? { width: 1280, height: 720 };
  const baselineAssets = process.env.NAC_QUESTION_BASELINE_ASSETS;
  if (baselineAssets) {
    await page.route("**/assets/dist/**", async (route) => {
      const relative = new URL(route.request().url()).pathname.split("/assets/dist/")[1];
      if (!relative || relative.includes("..")) throw new Error("Invalid baseline asset path");
      await route.fulfill({ path: path.join(baselineAssets, relative) });
    });
    await page.route(harness.baseUrl + "/", (route) =>
      route.fulfill({ path: path.join(baselineAssets, "index.html"), contentType: "text/html" }),
    );
    await page.reload();
    await expect(page.getByRole("button", { name: "Permissions", exact: true })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: info.outputPath("human-question-before-desktop.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: info.outputPath("human-question-before-mobile.png"),
      animations: "disabled",
    });
    await page.unroute("**/assets/dist/**");
    await page.unroute(harness.baseUrl + "/");
    await page.setViewportSize(desktop);
    await page.reload();
    await expect(page.getByRole("region", { name: "Task question", exact: true })).toBeVisible();
  }
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: info.outputPath("human-question-pending.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("human-question-after-mobile.png"),
    animations: "disabled",
  });
  await page.setViewportSize(desktop);
  await fs.writeFile(
    info.outputPath("question-visual-context.json"),
    JSON.stringify(
      {
        base: "e86e3bc2aae112185dce6a41e0a4051641899c35",
        head: process.env.NAC_QUESTION_HEAD_SHA ?? null,
        desktop,
        mobile: { width: 390, height: 844 },
        baselineClient: Boolean(baselineAssets),
        scenario:
          "same durable pending human question, exact navigation; baseline is unmodified base client served with the head backend fixture",
      },
      null,
      2,
    ),
  );

  harness.provider.enqueue(
    "resumed-question-goal",
    { token: "Structured question response" },
    {
      kind: "function_call",
      stream: "request",
      name: "update_goal",
      callId: "question-goal-complete",
      arguments: { goal_id: goal.goal_id, status: "complete" },
    },
  );
  harness.provider.enqueue(
    "resumed-question-result",
    { functionOutputCallId: "question-goal-complete" },
    { kind: "text", stream: "request", text: "The CSV export is complete." },
  );
  await page.getByRole("button", { name: "CSV", exact: true }).click();
  await page.getByRole("button", { name: "Send answer", exact: true }).click();
  await waitForRunIdle(request, harness, peer);
  const resolved = (
    await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json()
  )[0];
  expect(resolved.status).toBe("answered");
  expect(resolved.answer.answer).toBe("CSV");
  expect(resolved.continuation_state).toBe("delivered");
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${peer}/goal`)).json()).status,
  ).toBe("complete");
  const retry = await request.post(
    `${harness.baseUrl}/sessions/${peer}/questions/release-choice/answer`,
    {
      data: {
        request_id: "release-choice",
        run_id: question.request.run_id,
        generation: question.request.generation,
        expected_revision: question.revision,
        answer: "CSV",
      },
    },
  );
  expect(retry.ok()).toBe(true);
  expect(await retry.json()).toEqual(resolved.answer);
  const changed = await request.post(
    `${harness.baseUrl}/sessions/${peer}/questions/release-choice/answer`,
    {
      data: {
        request_id: "release-choice",
        run_id: question.request.run_id,
        generation: question.request.generation,
        expected_revision: question.revision,
        answer: "JSON",
      },
    },
  );
  expect(changed.status()).toBe(409);
  expect(
    harness.provider.requests.filter((entry) => entry.matchedStep === "resumed-question-goal"),
  ).toHaveLength(1);
  await page.reload();
  await expect(page.getByText(/This task question is no longer pending/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Send answer", exact: true })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("human-question-answered.png"),
    animations: "disabled",
  });
  harness.provider.assertConsumed();
});

test("native coordinator answers only exact authorized information and does not transfer approval authority", async ({
  harness,
  request,
}) => {
  const project = await createProject(request, harness);
  const peer = await createSession(request, harness, "direct", project);
  const coordinator = await createSession(request, harness, "direct", project);
  harness.provider.enqueue(
    "information-question",
    { token: "INFORMATION_QUESTION_START" },
    {
      kind: "function_call",
      stream: "request",
      name: "request_question",
      callId: "information-question",
      arguments: {
        request_id: "known-branch",
        text: "Which branch did the person already select?",
        choices: null,
        responder_class: "information",
      },
    },
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${peer}/runs`, {
        data: { prompt: "INFORMATION_QUESTION_START" },
      })
    ).ok(),
  ).toBe(true);
  await waitForRunIdle(request, harness, peer);
  const question = (
    await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json()
  )[0];
  const guidanceGate = new ScriptGate();
  harness.provider.enqueue(
    "question-guidance",
    { token: "UNRELATED_QUESTION_GUIDANCE" },
    { kind: "text", stream: "request", text: "Unrelated guidance was retained." },
    guidanceGate,
  );
  const guidanceResponse = await request.post(`${harness.baseUrl}/sessions/${peer}/runs`, {
    data: { prompt: "UNRELATED_QUESTION_GUIDANCE" },
  });
  expect(guidanceResponse.ok()).toBe(true);
  await guidanceGate.accepted;
  expect(
    (await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json())[0].status,
  ).toBe("pending");
  harness.provider.enqueue(
    "read-exact-question",
    { token: "ANSWER_KNOWN_INFORMATION", requiredTools: ["read_question", "answer_question"] },
    {
      kind: "function_call",
      stream: "request",
      name: "read_question",
      callId: "read-question",
      arguments: { session_id: peer, request_id: "known-branch", project_id: null },
    },
  );
  harness.provider.enqueue(
    "answer-exact-question",
    { functionOutputCallId: "read-question" },
    {
      kind: "function_call",
      stream: "request",
      name: "answer_question",
      callId: "answer-question",
      arguments: {
        session_id: peer,
        project_id: null,
        request_id: "known-branch",
        run_id: question.request.run_id,
        generation: question.request.generation,
        expected_revision: question.revision,
        answer: "The person selected codex/export.",
      },
    },
  );
  harness.provider.enqueue(
    "answered-information",
    { token: "Structured question response" },
    { kind: "text", stream: "request", text: "Continue on the selected branch." },
  );
  harness.provider.enqueue(
    "coordinator-information-result",
    { functionOutputCallId: "answer-question" },
    { kind: "text", stream: "request", text: "The exact known-information answer was admitted." },
  );
  expect(
    (
      await request.post(`${harness.baseUrl}/sessions/${coordinator}/runs`, {
        data: { prompt: "ANSWER_KNOWN_INFORMATION" },
      })
    ).ok(),
  ).toBe(true);
  await waitForRunIdle(request, harness, coordinator);
  const queued = (
    await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json()
  )[0];
  expect(queued.status).toBe("answered");
  expect(queued.continuation_state).toBe("pending");
  expect(queued.request.run_id).toBe(question.request.run_id);
  expect(
    harness.provider.requests.filter((entry) => entry.matchedStep === "answered-information"),
  ).toHaveLength(0);
  guidanceGate.release();
  await waitForRunIdle(request, harness, peer);
  const resolved = (
    await (await request.get(`${harness.baseUrl}/sessions/${peer}/questions`)).json()
  )[0];
  expect(resolved.status).toBe("answered");
  expect(resolved.continuation_state).toBe("delivered");
  const permissions = await (
    await request.get(`${harness.baseUrl}/sessions/${peer}/permissions`)
  ).json();
  expect(permissions.approval_mode).toBe("manual");
  expect(permissions.grants).toHaveLength(0);
  expect(permissions.requests).toHaveLength(0);
  harness.provider.assertConsumed();
});
