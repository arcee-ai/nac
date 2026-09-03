import fs from "node:fs/promises";
import path from "node:path";

import {
  createDirectSession,
  createProject,
  createSession,
  expect,
  test,
  waitForRunIdle,
} from "./harness";
import { ScriptGate } from "./scripted-provider";

test("serves the production-embedded application and hashed assets", async ({
  harness,
  page,
  request,
}) => {
  const health = await request.get(`${harness.baseUrl}/health`);
  expect(health.ok()).toBe(true);

  const html = await request.get(harness.baseUrl);
  expect(html.ok()).toBe(true);
  expect(html.headers()["cache-control"]).toContain("no-cache");
  const source = await html.text();
  const assetPath = source.match(
    /(?:src|href)="(\/assets\/dist\/assets\/[^"]+)"/,
  )?.[1];
  expect(assetPath).toBeTruthy();
  const asset = await request.get(`${harness.baseUrl}${assetPath}`);
  expect(asset.ok()).toBe(true);
  expect(asset.headers()["cache-control"]).toContain("immutable");

  await page.goto(harness.baseUrl);
  await expect(page.getByText("No projects yet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Get Started/i }),
  ).toBeVisible();
});

test("runs a direct session through the loopback scripted Responses provider", async ({
  harness,
  page,
  request,
}) => {
  harness.provider.enqueue(
    "direct-text",
    {
      token: "E2E_MODEL_TOKEN",
      requiredTools: ["read", "exec_command"],
      forbiddenTools: ["web_search", "web_fetch"],
    },
    { kind: "text", text: "production embedded response" },
  );
  const sessionId = await createDirectSession(request, harness);
  const submitted = await request.post(
    `${harness.baseUrl}/sessions/${sessionId}/runs`,
    {
      data: { prompt: "E2E_MODEL_TOKEN" },
    },
  );
  expect(submitted.status()).toBe(202);
  await harness.provider.waitForRequestCount(1);
  await waitForRunIdle(request, harness, sessionId);
  harness.provider.assertConsumed();

  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/threads`);
  await expect(page.getByText("production embedded response")).toBeVisible();
  const modelRequest = harness.provider.requests.find(
    (entry) => entry.matchedStep === "direct-text",
  );
  expect(modelRequest?.headers.authorization).toBe("Bearer nac-e2e-dummy-only");
  expect(modelRequest?.body).toMatchObject({
    model: "gpt-5.6-sol",
    store: false,
  });
});

test.describe("with an isolated Exa credential", () => {
  test.use({ exaCredential: "production-e2e-exa-canary" });

  test("exposes native web retrieval in the production direct-agent request", async ({
    harness,
    page,
    request,
  }) => {
    harness.provider.enqueue(
      "exa-enabled-direct",
      {
        token: "E2E_EXA_ENABLED",
        requiredTools: ["read", "web_search", "web_fetch"],
      },
      { kind: "text", text: "web retrieval is available" },
    );
    const sessionId = await createDirectSession(request, harness);
    const submitted = await request.post(
      `${harness.baseUrl}/sessions/${sessionId}/runs`,
      {
        data: { prompt: "E2E_EXA_ENABLED" },
      },
    );
    expect(submitted.status()).toBe(202);
    await harness.provider.waitForRequestCount(1);
    await waitForRunIdle(request, harness, sessionId);
    harness.provider.assertConsumed();

    const requestJson = JSON.stringify(harness.provider.requests[0]?.body);
    expect(requestJson).not.toContain("production-e2e-exa-canary");
    await page.goto(`${harness.baseUrl}/#/session/${sessionId}/threads`);
    await expect(page.getByText("web retrieval is available")).toBeVisible();
  });
});

test("round-trips a native tool result through the scripted Responses provider", async ({
  harness,
  page,
  request,
}) => {
  await fs.writeFile(
    path.join(harness.runRoot, "workspace", "fixture.txt"),
    "E2E_FILE_BODY\n",
  );
  harness.provider.enqueue(
    "request-read",
    { token: "E2E_TOOL_TOKEN", requiredTools: ["read"] },
    {
      kind: "function_call",
      name: "read",
      callId: "read-e2e-1",
      arguments: { path: "fixture.txt" },
    },
  );
  harness.provider.enqueue(
    "finish-after-read",
    { functionOutputCallId: "read-e2e-1" },
    { kind: "text", text: "tool result received" },
  );

  const sessionId = await createDirectSession(request, harness);
  const submitted = await request.post(
    `${harness.baseUrl}/sessions/${sessionId}/runs`,
    {
      data: { prompt: "E2E_TOOL_TOKEN" },
    },
  );
  expect(submitted.status()).toBe(202);
  await harness.provider.waitForRequestCount(2);
  await waitForRunIdle(request, harness, sessionId);
  harness.provider.assertConsumed();

  const resultRequest = harness.provider.requests.find(
    (entry) => entry.matchedStep === "finish-after-read",
  );
  expect(JSON.stringify(resultRequest?.body)).toContain("E2E_FILE_BODY");
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/threads`);
  await expect(page.getByText("tool result received")).toBeVisible();
});

for (const behavior of ["direct", "direct-with-orchestrator"] as const) {
  test(`keeps rich ${behavior} primary tool details through live settlement and reload`, async ({
    harness,
    page,
    request,
  }) => {
    const callId = `all1-${behavior}`;
    const command = "sleep 1; printf ALL1_TOOL_COMPLETE";
    harness.provider.enqueue(
      `${behavior}-tool-call`,
      { token: `ALL1_${behavior}_TOKEN`, requiredTools: ["exec_command"] },
      {
        kind: "function_call",
        name: "exec_command",
        callId,
        arguments: { cmd: command },
        stream: true,
      },
    );
    harness.provider.enqueue(
      `${behavior}-tool-finished`,
      { functionOutputCallId: callId },
      { kind: "text", text: `${behavior} rich tool complete`, stream: true },
    );

    const sessionId = await createSession(request, harness, behavior);
    await page.goto(`${harness.baseUrl}/#/session/${sessionId}/actions`);
    const composer = page.getByRole("combobox", { name: "Message" });
    await composer.fill(`ALL1_${behavior}_TOKEN`);
    await page.getByRole("button", { name: "Send" }).click();
    await harness.provider.waitForRequestCount(1);

    const card = page.locator(`[data-tool-call-id="${callId}"]`);
    await expect(card).toContainText("Run command");
    await expect(card).toContainText(command);
    await expect(card).toContainText("Running");
    await page.getByRole("button", { name: "Allow once" }).click();
    await expect(card).toContainText("Running");

    await harness.provider.waitForRequestCount(2);
    await waitForRunIdle(request, harness, sessionId);
    await expect(card).toContainText("Succeeded");
    await expect(card).toContainText("ALL1_TOOL_COMPLETE");
    await expect(
      page.getByText(`${behavior} rich tool complete`),
    ).toBeVisible();

    await page.reload();
    const reloaded = page.locator(`[data-tool-call-id="${callId}"]`);
    await expect(reloaded).toContainText("Run command");
    await expect(reloaded).toContainText(command);
    await expect(reloaded).toContainText("Succeeded");
    await expect(reloaded).toContainText("ALL1_TOOL_COMPLETE");
    await expect(reloaded).toHaveCount(1);
    harness.provider.assertConsumed();
  });
}

test("renders an unknown primary tool failure safely after reload", async ({
  harness,
  page,
  request,
}) => {
  harness.provider.enqueue(
    "all1-unknown-call",
    { token: "ALL1_UNKNOWN_TOKEN" },
    {
      kind: "function_call",
      name: "mcp__unknown__dangerous_tool",
      callId: "all1-unknown",
      arguments: {
        authorization: "Bearer RAW_SECRET_MUST_NOT_RENDER",
        body: "UNBOUNDED_RAW_BODY_MUST_NOT_RENDER",
      },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "all1-unknown-finished",
    { functionOutputCallId: "all1-unknown" },
    { kind: "text", text: "unknown failure observed", stream: true },
  );
  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/actions`);
  await page
    .getByRole("combobox", { name: "Message" })
    .fill("ALL1_UNKNOWN_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await harness.provider.waitForRequestCount(2);
  await waitForRunIdle(request, harness, sessionId);

  const card = page.locator('[data-tool-call-id="all1-unknown"]');
  await expect(card).toContainText("MCP · Dangerous tool");
  await expect(card).toContainText("Failed");
  await expect(page.locator("body")).not.toContainText(
    "RAW_SECRET_MUST_NOT_RENDER",
  );
  await expect(page.locator("body")).not.toContainText(
    "UNBOUNDED_RAW_BODY_MUST_NOT_RENDER",
  );
  await page.reload();
  await expect(
    page.locator('[data-tool-call-id="all1-unknown"]'),
  ).toContainText("Failed");
  await expect(page.locator('[data-tool-call-id="all1-unknown"]')).toHaveCount(
    1,
  );
  harness.provider.assertConsumed();
});

test("creates Agent by default and offers Orchestrator from the new-session popover", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness);
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  await expect(page).toHaveURL(/\/session\/[^/]+\/actions$/);
  const agentSessionId = page.url().match(/\/session\/([^/]+)\//)?.[1];
  expect(agentSessionId).toBeTruthy();
  await expect(page.getByText("Agent", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(page.getByText("Agent", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Actions" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Related Sessions" })).toBeVisible();
  await expect(page.getByText("Delegated work", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Threads", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Worksets", { exact: true })).toHaveCount(0);

  await page
    .getByRole("button", { name: "Create new session", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "New Agent" })).toBeVisible();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New Orchestrator" }).click();
  await expect
    .poll(() => page.url())
    .not.toContain(`/session/${agentSessionId}/`);
  await expect(page).toHaveURL(/\/session\/[^/]+\/actions$/);
  await expect(
    page.getByText("Orchestrator", { exact: true }).first(),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Orchestrator", { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText("Actions", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Threads" })).toBeVisible();
  await expect(page.getByText("Worksets", { exact: true })).toBeVisible();

  const tabs = page.locator(".chat-session-tab button");
  await expect(
    tabs.filter({ has: page.getByText("Agent", { exact: true }) }),
  ).toHaveCount(1);
  await expect(
    tabs.filter({ has: page.getByText("Orchestrator", { exact: true }) }),
  ).toHaveCount(1);
  await tabs.filter({ has: page.getByText("Agent", { exact: true }) }).click();
  await expect(page.getByText("Agent", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "Actions" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Related Sessions" })).toBeVisible();
  await expect(page.getByText("Delegated work", { exact: true })).toHaveCount(
    0,
  );
});

test("converges concurrent required-first-chat tabs and refreshes deleted ownership", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness);
  const second = await page.context().newPage();
  try {
    await Promise.all([
      page.goto(`${harness.baseUrl}/#/project/${projectId}`),
      second.goto(`${harness.baseUrl}/#/project/${projectId}`),
    ]);
    await Promise.all([
      expect(page).toHaveURL(/\/session\/([^/]+)\/actions$/),
      expect(second).toHaveURL(/\/session\/([^/]+)\/actions$/),
    ]);
    const firstSessionId = page.url().match(/\/session\/([^/]+)\//)?.[1];
    const secondSessionId = second.url().match(/\/session\/([^/]+)\//)?.[1];
    expect(firstSessionId).toBeTruthy();
    expect(secondSessionId).toBe(firstSessionId);

    const sessions = await request.get(
      `${harness.baseUrl}/sessions?project_id=${encodeURIComponent(projectId)}`,
    );
    expect(sessions.ok()).toBe(true);
    expect((await sessions.json()) as unknown[]).toHaveLength(1);

    const deleted = await request.delete(
      `${harness.baseUrl}/projects/${projectId}`,
    );
    expect(deleted.ok()).toBe(true);
    await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
    await expect(page).toHaveURL(/\/#\/$/);
  } finally {
    await second.close();
  }
});

test("steers an active direct run from the ordinary composer", async ({
  harness,
  page,
  request,
}) => {
  const boundary = new ScriptGate();
  const steeredBoundary = new ScriptGate();
  harness.provider.enqueue(
    "active-boundary",
    { token: "E2E_ACTIVE_TOKEN" },
    {
      kind: "function_call",
      name: "unknown_alpha",
      callId: "steer-boundary-1",
      arguments: {},
      stream: true,
    },
    boundary,
  );
  harness.provider.enqueue(
    "steered-continuation",
    { token: "change course safely" },
    { kind: "text", text: "steered response complete", stream: true },
    steeredBoundary,
  );
  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/actions`);

  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("E2E_ACTIVE_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await boundary.accepted;
  await composer.fill("change course safely");
  await page.getByRole("button", { name: "Queue message" }).click();
  await expect(page.getByLabel("Queued (1)")).toContainText(
    "change course safely",
  );
  await page.getByRole("button", { name: "Steer now" }).click();
  await expect(page.getByLabel("Queued (1)")).toHaveCount(0);

  const inbox = await request.get(
    `${harness.baseUrl}/sessions/${sessionId}/inbox`,
  );
  expect(inbox.ok()).toBe(true);
  expect(await inbox.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        delivery: "steer",
        prompt: "change course safely",
        status: "delivered",
      }),
    ]),
  );
  boundary.release();
  await harness.provider.waitForRequestCount(2);
  await steeredBoundary.accepted;
  harness.provider.assertConsumed();
  const steeredRequest = harness.provider.requests.find(
    (entry) => entry.matchedStep === "steered-continuation",
  );
  expect(JSON.stringify(steeredRequest?.body)).toContain(
    "change course safely",
  );
});

test("queues, edits, cancels pending input, and stops an active direct run", async ({
  harness,
  page,
  request,
}) => {
  const boundary = new ScriptGate();
  harness.provider.enqueue(
    "queue-stop-boundary",
    { token: "E2E_QUEUE_STOP_TOKEN" },
    { kind: "text", text: "must be cancelled", stream: true },
    boundary,
  );
  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/actions`);

  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("E2E_QUEUE_STOP_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await boundary.accepted;

  await composer.fill("queued follow-up");
  await page.getByRole("button", { name: "Queue message" }).click();
  const pending = page.getByLabel("Queued (1)");
  await expect(pending).toContainText("queued follow-up");
  await pending.hover();
  await pending.getByRole("button", { name: "Remove from queue" }).click();
  await expect(page.getByLabel("Queued (1)")).toHaveCount(0);

  await page.getByRole("button", { name: "Stop run" }).click();
  await waitForRunIdle(request, harness, sessionId);
  const inbox = await request.get(
    `${harness.baseUrl}/sessions/${sessionId}/inbox`,
  );
  expect(inbox.ok()).toBe(true);
  expect(await inbox.json()).toEqual([
    expect.objectContaining({
      delivery: "queue",
      prompt: "queued follow-up",
      status: "cancelled",
    }),
  ]);
  boundary.release();
  harness.provider.assertConsumed();
});

test("interprets literal goal commands before launching goal continuation", async ({
  harness,
  page,
  request,
}) => {
  const continuation = new ScriptGate();
  harness.provider.enqueue(
    "goal-continuation",
    { token: "Continue autonomously pursuing this durable goal" },
    { kind: "text", text: "goal continuation reached", stream: true },
    continuation,
  );
  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/actions`);

  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("/goal ship the embedded MVP");
  await composer.press("Enter");
  await expect
    .poll(async () => {
      const response = await request.get(
        `${harness.baseUrl}/sessions/${sessionId}/goal`,
      );
      if (!response.ok()) return null;
      return (
        ((await response.json()) as { objective?: string } | null)?.objective ??
        null
      );
    })
    .toBe("ship the embedded MVP");
  await continuation.accepted;
  expect(harness.provider.requests).toHaveLength(1);
  expect(harness.provider.requests[0]?.matchedStep).toBe("goal-continuation");
  expect(JSON.stringify(harness.provider.requests[0]?.body)).toContain(
    "<nac_goal_continuation",
  );

  // The run attaches durable accounting after goal creation. Reload so the
  // versioned controls exercise the current post-attachment record.
  await page.reload();
  await page.getByRole("button", { name: "Goal: active" }).click();
  await expect(page.getByRole("dialog")).toContainText("ship the embedded MVP");
  await page.getByRole("button", { name: "Pause" }).click();
  await expect
    .poll(async () => {
      const response = await request.get(
        `${harness.baseUrl}/sessions/${sessionId}/goal`,
      );
      return ((await response.json()) as { status?: string } | null)?.status;
    })
    .toBe("paused");
  await page.getByRole("button", { name: "Resume" }).click();
  await expect
    .poll(async () => {
      const response = await request.get(
        `${harness.baseUrl}/sessions/${sessionId}/goal`,
      );
      return ((await response.json()) as { status?: string } | null)?.status;
    })
    .toBe("active");
  await page.getByRole("button", { name: "Clear" }).click();
  await expect
    .poll(async () => {
      const response = await request.get(
        `${harness.baseUrl}/sessions/${sessionId}/goal`,
      );
      return await response.json();
    })
    .toBeNull();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Stop run" }).click();
  await waitForRunIdle(request, harness, sessionId);
  continuation.release();
  harness.provider.assertConsumed();
});

test("replaces a completed durable goal from the production dialog", async ({
  harness,
  page,
  request,
}) => {
  const original = new ScriptGate();
  const replacement = new ScriptGate();
  harness.provider.enqueue(
    "inspect-original-goal",
    {
      token: "Continue autonomously pursuing this durable goal",
      requiredTools: ["get_goal", "update_goal"],
    },
    {
      kind: "function_call",
      name: "get_goal",
      callId: "get-original-goal",
      arguments: {},
      stream: true,
    },
    original,
  );
  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/actions`);
  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("/goal original objective");
  await composer.press("Enter");
  await original.accepted;

  const currentResponse = await request.get(
    `${harness.baseUrl}/sessions/${sessionId}/goal`,
  );
  const current = (await currentResponse.json()) as {
    goal_id: string;
  };
  harness.provider.enqueue(
    "complete-original-goal",
    { functionOutputCallId: "get-original-goal" },
    {
      kind: "function_call",
      name: "update_goal",
      callId: "complete-original-goal",
      arguments: { goal_id: current.goal_id, status: "complete" },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "finish-original-goal",
    { functionOutputCallId: "complete-original-goal" },
    { kind: "text", text: "original goal completed", stream: true },
  );
  original.release();
  await harness.provider.waitForRequestCount(3);
  await waitForRunIdle(request, harness, sessionId);
  await expect
    .poll(async () => {
      const response = await request.get(
        `${harness.baseUrl}/sessions/${sessionId}/goal`,
      );
      return ((await response.json()) as { status?: string } | null)?.status;
    })
    .toBe("complete");

  harness.provider.enqueue(
    "replacement-goal",
    { token: "replacement objective" },
    { kind: "text", text: "replacement goal response", stream: true },
    replacement,
  );

  await expect(
    page.getByRole("button", { name: "Goal: complete" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Goal: complete" }).click();
  await page
    .getByPlaceholder("Describe the concrete outcome")
    .fill("replacement objective");
  await page.getByRole("button", { name: "Replace and start" }).click();
  await replacement.accepted;
  await expect
    .poll(async () => {
      const response = await request.get(
        `${harness.baseUrl}/sessions/${sessionId}/goal`,
      );
      return (await response.json()) as {
        goal_id?: string;
        objective?: string;
      } | null;
    })
    .toMatchObject({ objective: "replacement objective" });
  const replacedResponse = await request.get(
    `${harness.baseUrl}/sessions/${sessionId}/goal`,
  );
  const replaced = (await replacedResponse.json()) as { goal_id: string };
  expect(replaced.goal_id).not.toBe(current.goal_id);
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Stop run" }).click();
  await waitForRunIdle(request, harness, sessionId);
  replacement.release();
  harness.provider.assertConsumed();
});

test.skip("shows live background delegated work, terminal events, cancellation, and generation 2", async ({
  harness,
  page,
  request,
}) => {
  const success = new ScriptGate();
  const cancelled = new ScriptGate();
  const continued = new ScriptGate();
  harness.provider.enqueue(
    "background-success",
    { token: "E2E_BACKGROUND_SUCCESS" },
    { kind: "text", text: "background child completed" },
    success,
  );
  harness.provider.enqueue(
    "background-cancel",
    { token: "E2E_BACKGROUND_CANCEL" },
    { kind: "text", text: "should be cancelled" },
    cancelled,
  );
  harness.provider.enqueue(
    "background-failure",
    { token: "E2E_BACKGROUND_FAILURE" },
    { kind: "http_error", status: 400, body: "scripted child failure" },
  );
  for (const [id, token, afterStep] of [
    ["observe-failure", "Background failure", "background-failure"],
    ["observe-cancel", "Background cancellation", "background-cancel"],
    ["observe-success", "Background success", "background-success"],
  ] as const) {
    harness.provider.enqueue(
      id,
      { token, afterStep },
      { kind: "text", text: `${id} acknowledged` },
    );
  }
  harness.provider.enqueue(
    "background-generation-2",
    { token: "E2E_GENERATION_TWO" },
    { kind: "text", text: "second generation completed" },
    continued,
  );
  harness.provider.enqueue(
    "observe-generation-2",
    { token: "Background success", afterStep: "background-generation-2" },
    { kind: "text", text: "generation 2 acknowledged" },
  );

  const parentId = await createSession(request, harness, "direct");
  await page.goto(`${harness.baseUrl}/#/session/${parentId}/delegated`);
  const launch = async (description: string, prompt: string) => {
    const response = await request.post(
      `${harness.baseUrl}/sessions/${parentId}/children`,
      {
        data: { profile: "general", description, prompt, background: true },
      },
    );
    expect(response.ok()).toBe(true);
    return (await response.json()) as { child_session_id: string };
  };
  const successChild = await launch(
    "Background success",
    "E2E_BACKGROUND_SUCCESS",
  );
  await success.accepted;
  await launch("Background cancellation", "E2E_BACKGROUND_CANCEL");
  await cancelled.accepted;
  await launch("Background failure", "E2E_BACKGROUND_FAILURE");

  const successRow = page
    .locator("article")
    .filter({ hasText: "Background success" });
  const cancelRow = page
    .locator("article")
    .filter({ hasText: "Background cancellation" });
  const failureRow = page
    .locator("article")
    .filter({ hasText: "Background failure" });
  await expect(successRow).toContainText("Running");
  await expect(cancelRow).toContainText("Running");
  await expect(successRow.getByRole("button", { name: "Steer" })).toBeVisible();
  await cancelRow.getByRole("button", { name: "Cancel" }).click();
  await expect(cancelRow).toContainText("Cancelled");
  cancelled.release();
  await expect(failureRow).toContainText("Failed");

  success.release();
  await expect(successRow).toContainText("Completed");
  await expect(page.getByLabel("Coding agent completed")).toContainText(
    "Background success",
  );
  await expect(page.getByLabel("Coding agent failed")).toContainText(
    "Background failure",
  );
  await expect(page.getByLabel("Coding agent cancelled")).toContainText(
    "Background cancellation",
  );
  await expect(page.getByRole("button", { name: "Resend" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revert to this snapshot" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create fork" })).toHaveCount(
    0,
  );

  await successRow.getByRole("button", { name: "Continue" }).click();
  await page
    .getByRole("textbox", { name: "Continuation prompt" })
    .fill("E2E_GENERATION_TWO");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await continued.accepted;
  await expect(successRow).toContainText("Running");
  await expect(successRow).toContainText("Generation 2");
  continued.release();
  await expect(successRow).toContainText("Completed");
  await expect(page.getByLabel("Coding agent completed").last()).toContainText(
    "Generation 2",
  );
  await expect(
    page.getByRole("button", { name: "Open exact transcript" }).last(),
  ).toBeVisible();
  expect(successChild.child_session_id).toBeTruthy();
  harness.provider.assertConsumed();
});

test("navigates to read-only child and managed-orchestrator transcripts", async ({
  harness,
  page,
  request,
}) => {
  const orchestratorCompletion = new ScriptGate();
  harness.provider.enqueue(
    "child-completion",
    { token: "E2E_CHILD_TOKEN" },
    { kind: "text", text: "child completed" },
  );
  harness.provider.enqueue(
    "orchestrator-workset",
    {
      token: "E2E_ORCHESTRATOR_TOKEN",
      requiredTools: ["thread", "workset_define"],
    },
    {
      kind: "function_call",
      name: "workset_define",
      callId: "managed-workset-1",
      arguments: {
        id: "managed-release",
        goal: "Verify the managed transcript topology",
        status: "running",
        summary: "Managed transcript topology",
        verification_recipe: "Open the managed transcript panels",
        workset_items: [
          {
            title: "Verify managed panels",
            scope: "web session UI",
            description:
              "Create one retained worker episode for panel navigation.",
            role: "verification",
            depends_on: [],
            acceptance:
              "The managed transcript exposes its own thread and workset.",
          },
        ],
      },
    },
  );
  harness.provider.enqueue(
    "orchestrator-thread",
    { functionOutputCallId: "managed-workset-1" },
    {
      kind: "function_call",
      name: "thread",
      callId: "managed-thread-1",
      arguments: {
        name: "managed-ui",
        action: "E2E_MANAGED_THREAD_TOKEN verify the managed transcript UI",
      },
    },
  );
  harness.provider.enqueue(
    "managed-worker-completion",
    { token: "E2E_MANAGED_THREAD_TOKEN", requiredTools: ["read"] },
    { kind: "text", text: "managed worker completed" },
  );
  harness.provider.enqueue(
    "orchestrator-completion",
    { functionOutputCallId: "managed-thread-1" },
    { kind: "text", text: "orchestrator completed" },
    orchestratorCompletion,
  );
  harness.provider.enqueue(
    "orchestrator-parent-observation",
    {
      token: "Coordinate the compatibility audit",
      afterStep: "orchestrator-completion",
    },
    { kind: "text", text: "managed completion acknowledged" },
  );
  const parentId = await createSession(
    request,
    harness,
    "direct-with-orchestrator",
  );
  const childResponse = await request.post(
    `${harness.baseUrl}/sessions/${parentId}/children`,
    {
      data: {
        profile: "general",
        description: "Inspect the child lifecycle",
        prompt: "E2E_CHILD_TOKEN",
        background: false,
      },
      timeout: 15_000,
    },
  );
  expect(childResponse.ok()).toBe(true);
  const childId = (
    (await childResponse.json()) as { child_session_id?: string }
  ).child_session_id;
  expect(childId).toBeTruthy();

  const orchestratorResponse = await request.post(
    `${harness.baseUrl}/sessions/${parentId}/orchestrators`,
    {
      data: {
        description: "Coordinate the compatibility audit",
        prompt: "E2E_ORCHESTRATOR_TOKEN",
        background: true,
      },
      timeout: 15_000,
    },
  );
  expect(orchestratorResponse.ok()).toBe(true);
  const orchestratorId = (
    (await orchestratorResponse.json()) as { orchestrator_session_id?: string }
  ).orchestrator_session_id;
  expect(orchestratorId).toBeTruthy();
  await orchestratorCompletion.accepted;

  await page.goto(`${harness.baseUrl}/#/session/${childId}/files`);
  await expect(page).toHaveURL(new RegExp(`/session/${childId}/`));
  await expect(
    page.getByText("Inspect the child lifecycle", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/delegated transcript is read-only/i),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Message" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /goal/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Branch:/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Commit", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText("Threads", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Worksets", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Delegated work", { exact: true })).toHaveCount(
    0,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open panel" }).click();
  const mobilePanel = page.getByRole("dialog");
  await expect(mobilePanel).toBeVisible();
  await expect(mobilePanel.getByRole("tab", { name: "Files" })).toBeVisible();
  await expect(mobilePanel.getByRole("tab", { name: "History" })).toBeVisible();
  await expect(mobilePanel.getByRole("tab", { name: "Threads" })).toHaveCount(
    0,
  );
  await expect(mobilePanel.getByRole("tab", { name: "Worksets" })).toHaveCount(
    0,
  );
  await expect(mobilePanel.getByRole("tab", { name: "Delegated" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: /^Branch:/ })).toHaveCount(0);
  await mobilePanel.getByRole("button", { name: "Close" }).click();
  await expect(mobilePanel).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto(`${harness.baseUrl}/#/session/${parentId}/actions`);
  await expect(page).toHaveURL(new RegExp(`/session/${parentId}/actions$`));
  await expect(page.getByText("Delegated work", { exact: true })).toHaveCount(
    0,
  );
  orchestratorCompletion.release();
  await expect(page.getByLabel("Orchestrator completed")).toContainText(
    "Coordinate the compatibility audit",
  );
  harness.provider.assertConsumed();
  await page.goto(`${harness.baseUrl}/#/session/${orchestratorId}/actions`);
  await expect(page).toHaveURL(new RegExp(`/session/${orchestratorId}/`));
  await expect(
    page.getByText("Coordinate the compatibility audit", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/delegated transcript is read-only/i),
  ).toBeVisible();
  await expect(page.getByRole("tab", { name: "Actions" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Threads" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Files" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Worksets" })).toBeVisible();
  await expect(page.getByText("Delegated work", { exact: true })).toHaveCount(
    0,
  );

  await expect(
    page.getByRole("button", {
      name: /Worksets_managed-release|Thoughts & tools/,
    }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Worksets" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/session/${orchestratorId}/worksets$`),
  );
  await expect(
    page.getByText("Verify the managed transcript topology", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /managed-ui/i }).click();
  await expect(page).toHaveURL(
    new RegExp(`/session/${orchestratorId}/threads$`),
  );
  await expect(
    page.getByText("managed worker completed", { exact: true }),
  ).toBeVisible();

  await expect(page.getByRole("button", { name: /^Branch:/ })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Commit", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Resend" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Revert to this snapshot" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create fork" })).toHaveCount(
    0,
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Open panel" }).click();
  const managedMobilePanel = page.getByRole("dialog");
  await expect(
    managedMobilePanel.getByRole("tab", { name: "Actions" }),
  ).toBeVisible();
  await expect(
    managedMobilePanel.getByRole("tab", { name: "Threads" }),
  ).toBeVisible();
  await expect(
    managedMobilePanel.getByRole("tab", { name: "Files" }),
  ).toBeVisible();
  await expect(
    managedMobilePanel.getByRole("tab", { name: "Worksets" }),
  ).toBeVisible();
  await expect(
    managedMobilePanel.getByRole("tab", { name: "History" }),
  ).toBeVisible();
  await managedMobilePanel.getByRole("tab", { name: "History" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/session/${orchestratorId}/history$`),
  );
  await expect(page.getByRole("button", { name: /^Branch:/ })).toHaveCount(0);
  await managedMobilePanel.getByRole("button", { name: "Close" }).click();
  await expect(managedMobilePanel).toBeHidden();
});
