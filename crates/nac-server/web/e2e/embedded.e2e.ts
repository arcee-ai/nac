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
  const assetPath = source.match(/(?:src|href)="(\/assets\/dist\/assets\/[^"]+)"/)?.[1];
  expect(assetPath).toBeTruthy();
  const asset = await request.get(`${harness.baseUrl}${assetPath}`);
  expect(asset.ok()).toBe(true);
  expect(asset.headers()["cache-control"]).toContain("immutable");

  await page.goto(harness.baseUrl);
  await expect(page.getByText("No projects yet")).toBeVisible();
  await expect(page.getByRole("button", { name: /Get Started/i })).toBeVisible();
});

test("runs a direct session through the loopback scripted Responses provider", async ({
  harness,
  page,
  request,
}) => {
  harness.provider.enqueue(
    "direct-text",
    { token: "E2E_MODEL_TOKEN", requiredTools: ["read", "exec_command"] },
    { kind: "text", text: "production embedded response" },
  );
  const sessionId = await createDirectSession(request, harness);
  const submitted = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "E2E_MODEL_TOKEN" },
  });
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
  expect(modelRequest?.body).toMatchObject({ model: "gpt-5.6-sol", store: false });
});

test("round-trips a native tool result through the scripted Responses provider", async ({
  harness,
  page,
  request,
}) => {
  await fs.writeFile(path.join(harness.runRoot, "workspace", "fixture.txt"), "E2E_FILE_BODY\n");
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
  const submitted = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
    data: { prompt: "E2E_TOOL_TOKEN" },
  });
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

test("asks for immutable behavior on every first and new chat", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness);
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);

  const behaviorChoices = page.getByRole("radio");
  await expect(page.getByRole("dialog")).toContainText("New Chat");
  await expect(behaviorChoices).toHaveCount(3);
  await expect(behaviorChoices.filter({ hasText: "NAC orchestrator" }).first()).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Close" }).click();
  await expect(page).toHaveURL(/\/#\/$/);

  // Re-entering an empty project offers the required first chat again; closing
  // the first offer must not strand the project route behind a loader.
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  await expect(page.getByRole("dialog")).toContainText("New Chat");
  await expect(behaviorChoices.filter({ hasText: "NAC orchestrator" }).first()).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Create chat" }).click();
  await expect(page.getByText("Immutable behavior")).toBeVisible();
  await expect(page.getByText("NAC orchestrator", { exact: true })).toBeVisible();
  await expect(page.getByText("Threads", { exact: true })).toBeVisible();
  await expect(page.getByText("Worksets", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(behaviorChoices.filter({ hasText: "NAC orchestrator" }).first()).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("radio", { name: /^Direct coding agent / }).click();
  await page.getByRole("button", { name: "Create chat" }).click();
  await expect(page).toHaveURL(/\/session\/[^/]+\/delegated$/);
  await expect(page.getByText("Direct coding agent", { exact: true })).toBeVisible();
  await expect(page.getByText("Delegated work", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Threads", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Worksets", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(behaviorChoices.filter({ hasText: "NAC orchestrator" }).first()).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await behaviorChoices.filter({ hasText: "Direct + NAC orchestration" }).click();
  await page.getByRole("button", { name: "Create chat" }).click();
  await expect(page).toHaveURL(/\/session\/[^/]+\/delegated$/);
  await expect(page.getByText("Direct + NAC orchestration", { exact: true })).toBeVisible();
  await expect(page.getByText("Traditional coding agents", { exact: true })).toBeVisible();
  await expect(page.getByText("Managed NAC orchestrators", { exact: true })).toBeVisible();
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
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);

  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("E2E_ACTIVE_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await boundary.accepted;
  await composer.fill("change course safely");
  await page.getByRole("button", { name: "Steer active run" }).click();
  await expect(page.getByLabel("Pending messages")).toContainText("change course safely");

  const pending = await request.get(`${harness.baseUrl}/sessions/${sessionId}/inbox`);
  expect(pending.ok()).toBe(true);
  expect(await pending.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ delivery: "steer", prompt: "change course safely" }),
    ]),
  );
  boundary.release();
  await harness.provider.waitForRequestCount(2);
  await steeredBoundary.accepted;
  harness.provider.assertConsumed();
  const steeredRequest = harness.provider.requests.find(
    (entry) => entry.matchedStep === "steered-continuation",
  );
  expect(JSON.stringify(steeredRequest?.body)).toContain("change course safely");
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
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);

  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("/goal ship the embedded MVP");
  await composer.press("Enter");
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/goal`);
      if (!response.ok()) return null;
      return ((await response.json()) as { objective?: string } | null)?.objective ?? null;
    })
    .toBe("ship the embedded MVP");
  await continuation.accepted;
  expect(harness.provider.requests).toHaveLength(1);
  expect(harness.provider.requests[0]?.matchedStep).toBe("goal-continuation");
  expect(JSON.stringify(harness.provider.requests[0]?.body)).toContain("<nac_goal_continuation");

  await page.getByRole("button", { name: "Goal: active" }).click();
  await expect(page.getByRole("dialog")).toContainText("ship the embedded MVP");
});

test("navigates to read-only child and managed-orchestrator transcripts", async ({
  harness,
  page,
  request,
}) => {
  harness.provider.enqueue(
    "child-completion",
    { token: "E2E_CHILD_TOKEN" },
    { kind: "text", text: "child completed" },
  );
  harness.provider.enqueue(
    "orchestrator-completion",
    { token: "E2E_ORCHESTRATOR_TOKEN" },
    { kind: "text", text: "orchestrator completed" },
  );
  const parentId = await createSession(request, harness, "direct-with-orchestrator");
  const childResponse = await request.post(`${harness.baseUrl}/sessions/${parentId}/children`, {
    data: {
      profile: "general",
      description: "Inspect the child lifecycle",
      prompt: "E2E_CHILD_TOKEN",
      background: false,
    },
    timeout: 15_000,
  });
  expect(childResponse.ok()).toBe(true);
  const childId = ((await childResponse.json()) as { child_session_id?: string }).child_session_id;
  expect(childId).toBeTruthy();

  const orchestratorResponse = await request.post(
    `${harness.baseUrl}/sessions/${parentId}/orchestrators`,
    {
      data: {
        description: "Coordinate the compatibility audit",
        prompt: "E2E_ORCHESTRATOR_TOKEN",
        background: false,
      },
      timeout: 15_000,
    },
  );
  expect(orchestratorResponse.ok()).toBe(true);
  const orchestratorId = (
    (await orchestratorResponse.json()) as { orchestrator_session_id?: string }
  ).orchestrator_session_id;
  expect(orchestratorId).toBeTruthy();
  harness.provider.assertConsumed();

  await page.goto(`${harness.baseUrl}/#/session/${parentId}/delegated`);
  await expect(page.getByText("Traditional coding agents", { exact: true })).toBeVisible();
  await expect(page.getByText("Managed NAC orchestrators", { exact: true })).toBeVisible();
  const childRow = page.getByText("Inspect the child lifecycle", { exact: true }).locator("../..");
  await expect(childRow).toContainText("General coding agent · completed");
  await childRow.getByRole("button", { name: "Open transcript" }).click();
  await expect(
    page.getByText("Traditional coding agent · Inspect the child lifecycle"),
  ).toBeVisible();
  await expect(page.getByText(/delegated transcript is read-only/i)).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Message" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /goal/i })).toHaveCount(0);

  await page.getByRole("button", { name: "Back to Parent" }).click();
  await expect(page).toHaveURL(new RegExp(`/session/${parentId}/delegated$`));
  const orchestratorRow = page
    .getByText("Coordinate the compatibility audit", { exact: true })
    .locator("../..");
  await expect(orchestratorRow).toContainText("Separate NAC orchestrator · completed");
  await orchestratorRow.getByRole("button", { name: "Open transcript" }).click();
  await expect(
    page.getByText("Managed NAC orchestrator · Coordinate the compatibility audit"),
  ).toBeVisible();
  await expect(page.getByText(/delegated transcript is read-only/i)).toBeVisible();
});
