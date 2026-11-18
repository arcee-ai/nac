import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "@playwright/test";

import {
  createDirectSession,
  createSession,
  expect,
  startForegroundChild,
  test,
  waitForRunIdle,
} from "./harness";
import {
  dockSessionDrawer,
  hideSessionDrawer,
  openSessionDrawer,
  openSessionPanel,
  openWorkInInsights,
  openGoalFromComposerMenu,
  openPhonePanelSheet,
  sessionPanelTabs,
  settledWorkFold,
  stepAwaitingApproval,
} from "./focus-embedded-helpers";
import { ScriptGate } from "./scripted-provider";

/** The Insights row of a measured group, named by its time and its step count or failure. */
function totalActivityRow(meta: number | "failed"): RegExp {
  return new RegExp(`^Total activity: \\d+\\.\\ds, ${meta}$`);
}

/** Separate child/run requests must not overtake a permission-mode transition. */
async function selectApprovalMode(page: Page, sessionId: string, mode: "manual" | "auto_approve") {
  const group = page.getByRole("radiogroup", { name: "Approval mode" });
  await expect(group.getByRole("radio")).toHaveCount(3);
  const name = mode === "manual" ? "Manual" : "Approve all";
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/sessions/${sessionId}/permissions/mode`) &&
      response.request().method() === "PUT" &&
      response.request().postDataJSON()?.mode === mode,
  );
  await group.getByText(name, { exact: true }).click();
  expect((await response).status()).toBe(204);
  await expect(group.getByRole("radio", { name, exact: true })).toBeChecked();
}

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
    {
      token: "E2E_MODEL_TOKEN",
      requiredTools: ["read", "exec_command"],
      forbiddenTools: ["web_search", "web_fetch"],
    },
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
    const submitted = await request.post(`${harness.baseUrl}/sessions/${sessionId}/runs`, {
      data: { prompt: "E2E_EXA_ENABLED" },
    });
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

test("terminates one exact live terminal through the ordinary session API", async ({
  harness,
  page,
  request,
}) => {
  const completion = new ScriptGate();
  harness.provider.enqueue(
    "terminal-to-stop",
    { token: "E2E_TERMINAL_STOP_TOKEN", requiredTools: ["exec_command"] },
    {
      kind: "function_call",
      name: "exec_command",
      callId: "terminal-stop-e2e-1",
      arguments: {
        cmd: "sleep 30",
        tty: true,
        yield_time_ms: 20,
      },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "finish-after-terminal-stop",
    { functionOutputCallId: "terminal-stop-e2e-1" },
    { kind: "text", text: "terminal stop observed", stream: true },
    completion,
  );

  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("E2E_TERMINAL_STOP_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await harness.provider.waitForRequestCount(1);
  await expect(stepAwaitingApproval(page)).toBeVisible();
  await page.getByRole("button", { name: "Allow once" }).click();
  await harness.provider.waitForRequestCount(2);
  await completion.accepted;

  const continuation = harness.provider.requests.find(
    (entry) => entry.matchedStep === "finish-after-terminal-stop",
  );
  const terminalId = JSON.stringify(continuation?.body).match(
    /shell-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+/,
  )?.[0];
  expect(terminalId).toBeTruthy();
  const endpoint = `${harness.baseUrl}/sessions/${sessionId}/terminals/${encodeURIComponent(terminalId!)}`;
  expect((await request.delete(endpoint)).status()).toBe(204);
  expect((await request.delete(endpoint)).status()).toBe(204);

  completion.release();
  await waitForRunIdle(request, harness, sessionId);
  await expect(page.getByText("terminal stop observed")).toBeVisible();
  harness.provider.assertConsumed();
});

for (const behavior of ["direct"] as const) {
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
    await page.goto(`${harness.baseUrl}/#/session/${sessionId}/insights`);
    // Docked, Insights stays open beside the conversation and its composer.
    await dockSessionDrawer(page);
    const composer = page.getByRole("combobox", { name: "Message" });
    await composer.fill(`ALL1_${behavior}_TOKEN`);
    await page.getByRole("button", { name: "Send" }).click();
    await harness.provider.waitForRequestCount(1);

    // The transcript folds the call into its turn's work line; Insights lists it with its details.
    // A waiting call names its own row; settled, it rows as its group, labelled as the badge.
    const row = (status?: string) =>
      status
        ? page.getByRole("button", { name: `${command}, Exec, ${status}`, exact: true })
        : page.getByRole("button", { name: totalActivityRow(1) });
    const item = page.getByRole("group", { name: command, exact: true });
    await expect(stepAwaitingApproval(page)).toBeVisible();
    await expect(row("pending")).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Awaiting approval…", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Allow once" }).click();
    await expect(
      page.locator("[data-work-fold]").getByRole("button", { name: `Running ${command}…` }),
    ).toBeVisible();

    await harness.provider.waitForRequestCount(2);
    await waitForRunIdle(request, harness, sessionId);
    const fold = settledWorkFold(page, "Ran 1 command");
    await expect(row()).toBeVisible();
    await expect(item).toContainText(command);
    await expect(item).toContainText("ALL1_TOOL_COMPLETE");
    await expect(page.getByText(`${behavior} rich tool complete`)).toBeVisible();
    await openWorkInInsights(page, fold);
    await expect(row()).toHaveAttribute("aria-pressed", "true");

    await page.reload();
    await expect(fold).toHaveCount(1);
    // A reloaded session opens quiet; its drawer reopens on the same Insights.
    await openSessionDrawer(page);
    await expect(row()).toBeVisible();
    await expect(item).toContainText(command);
    await expect(item).toContainText("ALL1_TOOL_COMPLETE");
    harness.provider.assertConsumed();
  });
}

for (const behavior of ["direct"] as const) {
  test(`retains a background subagent acknowledgement in ${behavior} after reload`, async ({
    harness,
    page,
    request,
  }, testInfo) => {
    const childGate = new ScriptGate();
    const callId = `all337-${behavior}`;
    harness.provider.enqueue(
      "all337-parent-call",
      { token: `ALL337_${behavior}`, requiredTools: ["subagent"] },
      {
        kind: "function_call",
        name: "subagent",
        callId,
        arguments: {
          profile: "general",
          description: "Review store",
          prompt: "ALL337_CHILD",
          child_session_id: null,
          background: true,
        },
        stream: true,
      },
    );
    harness.provider.enqueue(
      "all337-child",
      { token: "ALL337_CHILD", forbiddenTools: ["subagent"] },
      { kind: "text", text: "Child finished", stream: "request" },
      childGate,
    );
    harness.provider.enqueue(
      "all337-parent-finished",
      { functionOutputCallId: callId },
      { kind: "text", text: "Delegation accepted", stream: true },
    );
    const sessionId = await createSession(request, harness, behavior);
    await page.goto(`${harness.baseUrl}/#/session/${sessionId}/insights`);
    const composer = page.getByRole("combobox", { name: "Message" });
    await composer.fill(`ALL337_${behavior}`);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("Delegation accepted")).toBeVisible();
    await waitForRunIdle(request, harness, sessionId);
    const assertReceipt = async () => {
      await expect(page.getByText("Subagent · Start · Outcome unavailable")).toBeVisible();
      await expect(page.getByRole("button", { name: "Open Subagent in Subagents" })).toBeVisible();
      await page.getByText("Invocation result").click();
      await expect(page.getByText(/Response reports Generation 1 · Running/)).toBeVisible();
      await expect(page.locator("main")).not.toContainText("parent_session_id");
    };
    await assertReceipt();
    await testInfo.attach("subagent-invocation", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText("Subagent · Start · Outcome unavailable")).toBeVisible();
    await testInfo.attach("subagent-invocation-mobile", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await assertReceipt();
    childGate.release();
  });
}

test("renders a per-call command deadline distinctly through settlement and reload", async ({
  harness,
  page,
  request,
}) => {
  const callId = "all103-command-deadline";
  harness.provider.enqueue(
    "all103-tool-call",
    { token: "ALL103_DEADLINE_TOKEN", requiredTools: ["exec_command"] },
    {
      kind: "function_call",
      name: "exec_command",
      callId,
      arguments: { cmd: "sleep 30", _nac: { timeout_ms: 20 } },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "all103-tool-finished",
    { functionOutputCallId: callId },
    { kind: "text", text: "deadline observed", stream: true },
  );

  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  await page.getByRole("combobox", { name: "Message" }).fill("ALL103_DEADLINE_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await harness.provider.waitForRequestCount(1);

  await expect(stepAwaitingApproval(page)).toBeVisible();
  await page.getByRole("button", { name: "Allow once" }).click();
  await harness.provider.waitForRequestCount(2);
  await waitForRunIdle(request, harness, sessionId);
  await expect(page.getByText("deadline observed")).toBeVisible();

  // The timed-out call marks its turn's work line failed and stays pinned under it.
  const fold = settledWorkFold(page, "Ran 1 command · 1 failed");
  const failedRow = page.getByRole("button", { name: totalActivityRow("failed") });
  const item = page.getByRole("group", { name: "sleep 30", exact: true });
  await openWorkInInsights(page, fold);
  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}/insights$`));
  await expect(failedRow).toHaveAttribute("aria-pressed", "true");
  await expect(item).toContainText("Timed out");

  await page.reload();
  await expect(fold).toHaveCount(1);
  await openSessionDrawer(page);
  await expect(failedRow).toBeVisible();
  await expect(item).toContainText("Timed out");
  harness.provider.assertConsumed();
});

test("keeps approval state and actions reachable with many remembered permissions", async ({
  harness,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 720 });

  const rememberedRequests = 8;
  const fixtureRoot = path.join(harness.runRoot, "external-permission-fixtures");
  await fs.mkdir(fixtureRoot, { recursive: true });
  const fixturePaths = Array.from({ length: rememberedRequests + 1 }, (_, index) =>
    path.join(fixtureRoot, `dependency-${index}-${"long-resource-segment-".repeat(3)}fixture.txt`),
  );
  await Promise.all(
    fixturePaths.map((fixturePath, index) =>
      fs.writeFile(fixturePath, `external permission fixture ${index}\n`),
    ),
  );

  fixturePaths.forEach((fixturePath, index) => {
    harness.provider.enqueue(
      `remembered-permission-${index}`,
      index === 0
        ? { token: "ALL14_ALL15_PERMISSION_TOKEN", requiredTools: ["read"] }
        : { functionOutputCallId: `permission-read-${index - 1}` },
      {
        kind: "function_call",
        name: "read",
        callId: `permission-read-${index}`,
        arguments: { path: fixturePath },
        stream: true,
      },
    );
  });
  harness.provider.enqueue(
    "permissions-complete",
    { functionOutputCallId: `permission-read-${rememberedRequests}` },
    { kind: "text", text: "permission journey complete", stream: true },
  );

  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  await page.getByRole("combobox", { name: "Message" }).fill("ALL14_ALL15_PERMISSION_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();

  // Every read lands in one turn's work, so the attention card names the step.
  const card = page.getByRole("dialog", { name: "Permission required", exact: true });
  const awaiting = stepAwaitingApproval(page);
  const requested = card.getByRole("region", { name: "Requested access" });
  for (let index = 0; index < rememberedRequests; index += 1) {
    await harness.provider.waitForRequestCount(index + 1);
    await expect(requested).toContainText(`dependency-${index}-`);
    await expect(awaiting).toBeVisible();
    await expect(card.getByRole("button", { name: "Always allow" })).toBeEnabled();
    await card.getByRole("button", { name: "Always allow" }).click();
  }

  await harness.provider.waitForRequestCount(rememberedRequests + 1);
  await expect(requested).toContainText(`dependency-${rememberedRequests}-`);
  await expect(awaiting).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /^Reading .*…$/ })).toHaveCount(0);

  // With many remembered permissions the card still keeps every choice on screen.
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  const onScreen = async (target: typeof card) => {
    const bounds = await target.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport!.height);
  };
  await expect(card).toBeVisible();
  for (const name of ["Deny", "Allow once", "Always allow"]) {
    await expect(card.getByRole("button", { name, exact: true })).toBeVisible();
    await onScreen(card.getByRole("button", { name, exact: true }));
  }
  await onScreen(card);

  // Review all opens the full sheet; its body scrolls and keeps the decision reachable.
  await card.getByRole("button", { name: "Review all", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Permission required", exact: true });
  const scrollBody = sheet.locator(":scope > .overflow-y-auto");
  await expect(sheet.getByRole("region", { name: "Pending permission requests" })).toBeVisible();
  await expect(scrollBody).toHaveCount(1);
  await expect(sheet.getByRole("button", { name: "Deny", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Allow once", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Always allow", exact: true })).toBeVisible();
  expect(await scrollBody.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  await onScreen(sheet);
  // The long decision scrolls inside the sheet; its choices stay reachable there.
  const sheetAllow = sheet.getByRole("button", { name: "Allow once", exact: true });
  await sheetAllow.scrollIntoViewIfNeeded();
  await onScreen(sheetAllow);

  // Putting the sheet aside never answers the request: the card comes back with it.
  // (The scrim starts below the live 52px session header.)
  await page.mouse.click(4, 120);
  await expect(sheet.getByRole("region", { name: "Pending permission requests" })).toBeHidden();
  await expect(requested).toContainText(`dependency-${rememberedRequests}-`);
  await expect(awaiting).toBeVisible();
  await page.getByRole("button", { name: "Permissions (1)" }).click();
  await expect(sheet.getByRole("region", { name: "Pending permission requests" })).toBeVisible();
  await sheet.getByRole("button", { name: "Allow once", exact: true }).click();

  await harness.provider.waitForRequestCount(rememberedRequests + 2);
  await waitForRunIdle(request, harness, sessionId);
  await expect(page.getByText("permission journey complete")).toBeVisible();
  // Inspect the grant manager before opening Insights changes the chat width.
  await page.getByRole("button", { name: /^Permissions \(\d+\)$/ }).click();
  const manager = page.getByRole("dialog", { name: "Permissions", exact: true });
  const managerBody = manager.locator(":scope > .overflow-y-auto");
  await expect(manager).toContainText("Remembered access for this session.");
  await expect(managerBody).toHaveCount(1);
  expect(await managerBody.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
    true,
  );
  await expect(
    manager.getByRole("button", { name: /^Forget read permission/ }).first(),
  ).toBeVisible();
  await expect(manager.getByRole("button", { name: "Deny" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(manager).toBeHidden();

  await openWorkInInsights(page, settledWorkFold(page, `Read ${rememberedRequests + 1} files`));
  await expect(
    page.getByRole("button", { name: totalActivityRow(rememberedRequests + 1) }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "File Read", exact: true })).toHaveCount(
    rememberedRequests + 1,
  );

  harness.provider.assertConsumed();
});

test("persists session auto-approval, drains pending asks, and restores manual mode", async ({
  harness,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const fixtureRoot = path.join(harness.runRoot, "auto-approval-fixtures");
  await fs.mkdir(fixtureRoot, { recursive: true });
  const first = path.join(fixtureRoot, "first.txt");
  const second = path.join(fixtureRoot, "second.txt");
  const manual = path.join(fixtureRoot, "manual.txt");
  await Promise.all([
    fs.writeFile(first, "first\n"),
    fs.writeFile(second, "second\n"),
    fs.writeFile(manual, "manual\n"),
  ]);

  harness.provider.enqueue(
    "auto-approve-pending",
    { token: "ALL16_AUTO_APPROVE_TOKEN", requiredTools: ["read"] },
    {
      kind: "function_call",
      name: "read",
      callId: "auto-approve-first",
      arguments: { path: first },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "auto-approve-new",
    { functionOutputCallId: "auto-approve-first" },
    {
      kind: "function_call",
      name: "read",
      callId: "auto-approve-second",
      arguments: { path: second },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "auto-approve-complete",
    { functionOutputCallId: "auto-approve-second" },
    { kind: "text", text: "automatic approvals complete", stream: true },
  );

  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  await page.getByRole("combobox", { name: "Message" }).fill("ALL16_AUTO_APPROVE_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await harness.provider.waitForRequestCount(1);
  await expect(stepAwaitingApproval(page)).toBeVisible();

  // The sheet never opens by itself: the waiting card's Review all opens it.
  await page
    .getByRole("dialog", { name: "Permission required", exact: true })
    .getByRole("button", { name: "Review all", exact: true })
    .click();
  await selectApprovalMode(page, sessionId, "auto_approve");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Auto-approve on — open permissions" }),
  ).toBeVisible();
  await harness.provider.waitForRequestCount(3);
  await waitForRunIdle(request, harness, sessionId);
  await expect(page.getByText("automatic approvals complete")).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole("button", { name: "Auto-approve on — open permissions" }),
  ).toBeVisible();
  // Both reads settle in one turn's work; Insights lists the group as two successful reads.
  await openWorkInInsights(page, settledWorkFold(page, "Read 2 files"));
  await expect(page.getByRole("button", { name: totalActivityRow(2) })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("group", { name: "File Read", exact: true })).toHaveCount(2);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Auto-approve on — open permissions" }).click();
  await expect(page.getByRole("radio", { name: "Approve all", exact: true })).toBeChecked();
  await selectApprovalMode(page, sessionId, "manual");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Permissions", exact: true })).toBeVisible();
  // The drawer slides out before it unmounts; the next ask must find only the
  // attention card's Allow once, not the closing drawer's.
  await expect(page.getByRole("dialog", { name: "Permissions", exact: true })).toHaveCount(0);

  harness.provider.enqueue(
    "manual-after-disable",
    { token: "ALL16_MANUAL_TOKEN", requiredTools: ["read"] },
    {
      kind: "function_call",
      name: "read",
      callId: "manual-after-disable",
      arguments: { path: manual },
      stream: true,
    },
  );
  harness.provider.enqueue(
    "manual-after-disable-complete",
    { functionOutputCallId: "manual-after-disable" },
    { kind: "text", text: "manual approval restored", stream: true },
  );
  await page.getByRole("combobox", { name: "Message" }).fill("ALL16_MANUAL_TOKEN");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await harness.provider.waitForRequestCount(4);
  await expect(stepAwaitingApproval(page)).toBeVisible();
  await page.getByRole("button", { name: "Allow once" }).click();
  await harness.provider.waitForRequestCount(5);
  await waitForRunIdle(request, harness, sessionId);
  await expect(page.getByText("manual approval restored")).toBeVisible();
  harness.provider.assertConsumed();
});

test("applies parent auto-approval to child agents and identifies manual child requests", async ({
  harness,
  page,
  request,
}) => {
  test.setTimeout(90_000);
  const fixtureRoot = path.join(harness.runRoot, "child-auto-approval-fixtures");
  await fs.mkdir(fixtureRoot, { recursive: true });
  const automatic = path.join(fixtureRoot, "automatic.txt");
  const manual = path.join(fixtureRoot, "manual.txt");
  await Promise.all([
    fs.writeFile(automatic, "automatic child permission\n"),
    fs.writeFile(manual, "manual child permission\n"),
  ]);

  harness.provider.enqueue(
    "child-auto-read",
    {
      token: "ALL58_AUTO_CHILD",
      requiredTools: ["read"],
      forbiddenTools: ["spawn_agent"],
    },
    {
      kind: "function_call",
      name: "read",
      callId: "child-auto-read",
      arguments: { path: automatic },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "child-auto-complete",
    { functionOutputCallId: "child-auto-read" },
    { kind: "text", text: "automatic child complete", stream: "request" },
  );
  harness.provider.enqueue(
    "child-manual-read",
    {
      token: "ALL58_MANUAL_CHILD",
      requiredTools: ["read"],
      forbiddenTools: ["spawn_agent"],
    },
    {
      kind: "function_call",
      name: "read",
      callId: "child-manual-read",
      arguments: { path: manual },
      stream: "request",
    },
  );
  harness.provider.enqueue(
    "child-manual-complete",
    { functionOutputCallId: "child-manual-read" },
    { kind: "text", text: "manual child complete", stream: "request" },
  );

  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  await page.getByRole("button", { name: "Permissions", exact: true }).click();
  const permissions = page.getByRole("dialog", { name: "Permissions", exact: true });
  await expect(permissions).toContainText(
    "The mode governs this session and all existing or future owned child agents",
  );
  await selectApprovalMode(page, sessionId, "auto_approve");
  await page.keyboard.press("Escape");

  const automaticStart = startForegroundChild(
    request,
    harness,
    sessionId,
    "Automatic child",
    "ALL58_AUTO_CHILD",
  );
  await harness.provider.waitForRequestCount(2);
  const automaticResult = await automaticStart;
  expect(automaticResult.status()).toBe(201);
  const automaticChild = await automaticResult.json();
  expect(automaticChild).toMatchObject({ status: "completed" });
  await expect(page.getByRole("dialog", { name: "Permission required" })).toHaveCount(0);

  await page.getByRole("button", { name: "Auto-approve on — open permissions" }).click();
  await selectApprovalMode(page, sessionId, "manual");
  await page.keyboard.press("Escape");
  // The drawer slides out before it unmounts; a request arriving meanwhile
  // would retitle it "Permission required" beside the attention card.
  await expect(page.getByRole("dialog", { name: "Permissions", exact: true })).toHaveCount(0);

  const manualStart = startForegroundChild(
    request,
    harness,
    sessionId,
    "Manual child",
    "ALL58_MANUAL_CHILD",
  );
  await harness.provider.waitForRequestCount(3);

  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/children`);
      const children = (await response.json()) as Array<{
        child_session_id: string;
        description: string;
        status: string;
      }>;
      return children.find((child) => child.description === "Manual child")?.child_session_id;
    })
    .toBeTruthy();
  const childrenResponse = await request.get(`${harness.baseUrl}/sessions/${sessionId}/children`);
  const children = (await childrenResponse.json()) as Array<{
    child_session_id: string;
    description: string;
  }>;
  const manualChildId = children.find(
    (child) => child.description === "Manual child",
  )!.child_session_id;
  // The child's request surfaces in the parent's attention card; Review all
  // identifies the exact child and why manual approval applies.
  const card = page.getByRole("dialog", { name: "Permission required", exact: true });
  await expect(card).toContainText(
    "read requested by child agent “Manual child” is paused before execution",
  );
  await card.getByRole("button", { name: "Review all", exact: true }).click();
  const permissionDialog = page.getByRole("dialog", { name: "Permission required", exact: true });
  await expect(
    permissionDialog.getByRole("region", { name: "Pending permission requests" }),
  ).toBeVisible();
  await expect(permissionDialog).toContainText(`Requested by child agent “Manual child”`);
  await expect(permissionDialog).toContainText("automatic approval is off");
  await expect(permissionDialog).toContainText(String(manualChildId));
  await permissionDialog.getByRole("button", { name: "Allow once" }).click();
  await harness.provider.waitForRequestCount(4);
  const manualResult = await manualStart;
  expect(manualResult.status()).toBe(201);
  expect(await manualResult.json()).toMatchObject({
    child_session_id: manualChildId,
    status: "completed",
  });
  harness.provider.assertConsumed();
  expect(harness.provider.requests.map((entry) => entry.matchedStep)).toEqual([
    "child-auto-read",
    "child-auto-complete",
    "child-manual-read",
    "child-manual-complete",
  ]);
});

test("renders an unknown primary tool failure safely after reload", async ({
  harness,
  page,
  request,
}) => {
  const body = "RAW_BODY_RENDERS_ONLY_ON_REQUEST";
  harness.provider.enqueue(
    "all1-unknown-call",
    { token: "ALL1_UNKNOWN_TOKEN" },
    {
      kind: "function_call",
      name: "mcp__unknown__dangerous_tool",
      callId: "all1-unknown",
      arguments: {
        authorization: "Bearer RAW_SECRET_MUST_NOT_RENDER",
        body,
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
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  await page.getByRole("combobox", { name: "Message" }).fill("ALL1_UNKNOWN_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await harness.provider.waitForRequestCount(2);
  await waitForRunIdle(request, harness, sessionId);

  const fold = settledWorkFold(page, "Used 1 tool · 1 failed");
  const failedRow = page.getByRole("button", { name: "MCP · Dangerous tool, failed", exact: true });
  await openWorkInInsights(page, fold);
  await expect(failedRow).toHaveAttribute("aria-pressed", "true");
  const item = page.getByRole("group", { name: "MCP · Dangerous tool", exact: true });
  await expect(item).toBeVisible();
  // Checked with the call's Insights details open, since they render its input too.
  await expect(page.locator("body")).not.toContainText("RAW_SECRET_MUST_NOT_RENDER");
  await expect(page.locator("body")).not.toContainText(body);
  // On request the input renders in full as the server redacted it, still valid JSON.
  const input = item.getByRole("group", { name: "Input", exact: true });
  await input.getByRole("button", { name: "Show full" }).click();
  await expect(input).toContainText(`"authorization": "[REDACTED]", "body": "${body}"`);
  await expect(page.locator("body")).not.toContainText("RAW_SECRET_MUST_NOT_RENDER");
  await page.reload();
  await expect(fold).toHaveCount(1);
  await openSessionDrawer(page);
  await expect(failedRow).toBeVisible();
  harness.provider.assertConsumed();
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
      expect.objectContaining({
        delivery: "steer",
        prompt: "change course safely",
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
  expect(JSON.stringify(steeredRequest?.body)).toContain("change course safely");
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
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);

  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("E2E_QUEUE_STOP_TOKEN");
  await page.getByRole("button", { name: "Send" }).click();
  await boundary.accepted;

  await composer.fill("queued follow-up");
  await page.getByRole("button", { name: "Queue Next" }).click();
  const pending = page.getByLabel("Pending messages");
  await expect(pending).toContainText("queue");
  await expect(pending).toContainText("queued follow-up");
  await pending.getByRole("button", { name: "Change to steer" }).click();
  await expect(pending.getByRole("button", { name: "Change to queue", exact: true })).toBeVisible();
  await pending.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByLabel("Pending messages")).toHaveCount(0);

  await page.getByRole("button", { name: "Stop run" }).click();
  await waitForRunIdle(request, harness, sessionId);
  const inbox = await request.get(`${harness.baseUrl}/sessions/${sessionId}/inbox`);
  expect(inbox.ok()).toBe(true);
  expect(await inbox.json()).toEqual([
    expect.objectContaining({
      delivery: "steer",
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

  // The run attaches durable accounting after goal creation. Reload so the
  // versioned controls exercise the current post-attachment record.
  await page.reload();
  await openGoalFromComposerMenu(page, "Edit goal: Active");
  await expect(page.getByRole("textbox", { name: "Goal objective" })).toHaveValue(
    "ship the embedded MVP",
  );
  await page.getByRole("button", { name: "Pause goal" }).click();
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/goal`);
      return ((await response.json()) as { status?: string } | null)?.status;
    })
    .toBe("paused");
  await page.getByRole("button", { name: "Resume goal" }).click();
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/goal`);
      return ((await response.json()) as { status?: string } | null)?.status;
    })
    .toBe("active");
  await page.getByRole("button", { name: "Clear goal", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/goal`);
      return await response.json();
    })
    .toBeNull();
  await page.getByRole("button", { name: "Close goal editor" }).click();
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
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  const composer = page.getByRole("combobox", { name: "Message" });
  await composer.fill("/goal original objective");
  await composer.press("Enter");
  await original.accepted;

  const currentResponse = await request.get(`${harness.baseUrl}/sessions/${sessionId}/goal`);
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
      const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/goal`);
      return ((await response.json()) as { status?: string } | null)?.status;
    })
    .toBe("complete");

  harness.provider.enqueue(
    "replacement-goal",
    { token: "replacement objective" },
    { kind: "text", text: "replacement goal response", stream: true },
    replacement,
  );

  await composer.blur();
  await openGoalFromComposerMenu(page, "Edit goal: Complete");
  await page.getByRole("textbox", { name: "Goal objective" }).fill("replacement objective");
  const goalViewport = page.viewportSize() ?? { width: 1280, height: 800 };
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog", { name: "Set durable goal" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Goal objective" })).toHaveValue(
    "replacement objective",
  );
  await page.setViewportSize(goalViewport);
  await expect(page.getByRole("dialog", { name: "Set durable goal" })).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "Goal objective" })).toHaveValue(
    "replacement objective",
  );
  await page.getByRole("button", { name: "Replace goal" }).click();
  await replacement.accepted;
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/goal`);
      return (await response.json()) as {
        goal_id?: string;
        objective?: string;
      } | null;
    })
    .toMatchObject({ objective: "replacement objective" });
  const replacedResponse = await request.get(`${harness.baseUrl}/sessions/${sessionId}/goal`);
  const replaced = (await replacedResponse.json()) as { goal_id: string };
  expect(replaced.goal_id).not.toBe(current.goal_id);
  await page.getByRole("button", { name: "Stop run" }).click();
  await waitForRunIdle(request, harness, sessionId);
  replacement.release();
  harness.provider.assertConsumed();
});

test("shows live background delegated work, terminal events, cancellation, and generation 2", async ({
  harness,
  page,
  request,
}, testInfo) => {
  const success = new ScriptGate();
  const cancelled = new ScriptGate();
  const continued = new ScriptGate();
  harness.provider.enqueue(
    "background-success",
    { token: "E2E_BACKGROUND_SUCCESS" },
    { kind: "text", text: "background child completed", stream: "request" },
    success,
  );
  harness.provider.enqueue(
    "background-cancel",
    { token: "E2E_BACKGROUND_CANCEL" },
    { kind: "text", text: "should be cancelled", stream: "request" },
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
      // A child's instructions also contain its delegation label. Only the
      // parent exposes subagent, so a child request cannot consume this reply.
      { token, afterStep, requiredTools: ["subagent"] },
      { kind: "text", text: `${id} acknowledged`, stream: "request" },
    );
  }
  harness.provider.enqueue(
    "background-generation-2",
    { token: "E2E_GENERATION_TWO" },
    { kind: "text", text: "second generation completed", stream: "request" },
    continued,
  );
  harness.provider.enqueue(
    "observe-generation-2",
    {
      token: "second generation completed",
      afterStep: "background-generation-2",
      requiredTools: ["subagent"],
    },
    { kind: "text", text: "generation 2 acknowledged", stream: "request" },
  );

  const parentId = await createSession(request, harness, "direct");
  const awaitParentReceipt = async (step: string) => {
    await expect
      .poll(() => harness.provider.requests.some((entry) => entry.matchedStep === step))
      .toBe(true);
    await waitForRunIdle(request, harness, parentId);
  };
  await page.goto(`${harness.baseUrl}/#/session/${parentId}/delegated`);
  // Docked, Subagents stays beside the transcript that receives the completion cards.
  await dockSessionDrawer(page);
  await openSessionPanel(page, "Subagents");
  const launch = async (description: string, prompt: string) => {
    const response = await request.post(`${harness.baseUrl}/sessions/${parentId}/children`, {
      data: { profile: "general", description, prompt, background: true },
    });
    expect(response.ok(), `launch failed: ${response.status()} ${await response.text()}`).toBe(
      true,
    );
    return (await response.json()) as { child_session_id: string };
  };
  const successChild = await launch("Background success", "E2E_BACKGROUND_SUCCESS");
  await success.accepted;
  await launch("Background cancellation", "E2E_BACKGROUND_CANCEL");
  await cancelled.accepted;
  await launch("Background failure", "E2E_BACKGROUND_FAILURE");
  await awaitParentReceipt("observe-failure");

  const subagent = (name: string) =>
    page.getByRole("button", { name, exact: true }).and(page.locator("button[aria-description]"));
  const composer = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Send a message" }),
  });
  const idle = composer.getByRole("button", { name: "Send", exact: true });
  await subagent("Background success").click();
  await expect(composer.locator("span", { hasText: "Running in the background" })).toBeVisible();
  await expect(composer.getByRole("button", { name: "Stop", exact: true })).toBeVisible();
  await subagent("Background cancellation").click();
  await composer.getByRole("button", { name: "Stop" }).click();
  await expect(idle).toBeVisible();
  cancelled.release();
  await subagent("Background failure").click();
  await expect(idle).toBeVisible();
  await awaitParentReceipt("observe-cancel");

  success.release();
  await subagent("Background success").click();
  await expect(idle).toBeVisible();
  await expect(page.getByLabel("Subagent completed")).toContainText("Background success");
  await expect(page.getByLabel("Subagent failed")).toContainText("Background failure");
  await expect(page.getByLabel("Subagent cancelled")).toContainText("Background cancellation");
  // Parent acknowledgement messages may have normal snapshot/fork actions;
  // the three durable completion cards themselves must remain passive.
  for (const label of ["Subagent completed", "Subagent failed", "Subagent cancelled"]) {
    const event = page.getByLabel(label, { exact: true });
    await expect(event).toHaveCount(1);
    for (const name of [
      "Regenerate from original prompt",
      "Revert to this snapshot",
      "Create fork",
    ]) {
      await expect(event.getByRole("button", { name, exact: true })).toHaveCount(0);
    }
  }
  // Settle the parent's completion acknowledgement before issuing one new
  // admission. Only observation is polled; the continuation is never replayed.
  await awaitParentReceipt("observe-success");
  const continuation = await request.post(`${harness.baseUrl}/sessions/${parentId}/children`, {
    data: {
      profile: "general",
      description: "Background success",
      prompt: "E2E_GENERATION_TWO",
      background: true,
      child_session_id: successChild.child_session_id,
    },
  });
  expect(continuation.ok()).toBe(true);
  expect((await continuation.json()).child_session_id).toBe(successChild.child_session_id);
  await continued.accepted;
  await expect(composer.locator("span", { hasText: "Running in the background" })).toBeVisible();
  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${parentId}/children`);
      const children = (await response.json()) as Array<{
        description: string;
        generation: number;
      }>;
      return children.find((child) => child.description === "Background success")?.generation;
    })
    .toBe(2);
  continued.release();
  await expect(idle).toBeVisible();
  // Each generation delivers its own card; they all lead to the one child session.
  const completed = page.getByLabel("Subagent completed");
  await expect(completed).toHaveCount(2);
  await expect(completed.last()).toContainText("Background success");
  await completed.first().getByText("Generation 1 result").click();
  await expect(completed.first().getByText("background child completed")).toBeVisible();
  await completed.last().getByText("Generation 2 result").click();
  await expect(completed.last().getByText("second generation completed")).toBeVisible();
  await subagent("Background failure").click();
  await completed
    .last()
    .getByRole("button", { name: "Open Background success in Subagents" })
    .click();
  await expect(page).toHaveURL(new RegExp(parentId));
  const dock = page.getByRole("complementary").filter({ has: sessionPanelTabs(page) });
  await expect(dock.getByText("second generation completed", { exact: true })).toBeVisible();
  await awaitParentReceipt("observe-generation-2");
  // Repeat the receipt checks with the shared Detailed transcript preference.
  await page.evaluate(() => localStorage.setItem("nac.transcriptDensity", "detailed"));
  await page.reload();
  await expect(page.getByLabel("Subagent completed")).toHaveCount(2);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const historicalResult = page
    .getByLabel("Subagent completed")
    .first()
    .getByText("Generation 1 result");
  await historicalResult.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByLabel("Subagent completed").first().getByText("background child completed"),
  ).toBeVisible();
  const receiptTarget = page
    .getByLabel("Subagent completed")
    .first()
    .getByRole("button", { name: "Open Background success in Subagents" });
  await receiptTarget.scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath("narrow-generation-result.png") });
  await receiptTarget.focus();
  await page.keyboard.press("Enter");
  const mobilePanel = page.getByRole("dialog", { name: "Subagents" });
  await expect(mobilePanel).toBeVisible();
  const mobileResult = mobilePanel.getByText("second generation completed", { exact: true });
  await expect(mobileResult).toBeVisible();
  await expect
    .poll(() =>
      mobileResult.evaluate((element) => {
        let opacity = 1;
        for (let node: typeof element | null = element; node; node = node.parentElement) {
          opacity *= Number.parseFloat(
            node.ownerDocument.defaultView?.getComputedStyle(node).opacity ?? "1",
          );
        }
        return opacity;
      }),
    )
    .toBeGreaterThan(0.95);
  await page.screenshot({ path: testInfo.outputPath("narrow-child-panel.png") });
  await expect(page).toHaveURL(new RegExp(parentId));
  expect(harness.provider.requests.map((entry) => entry.matchedStep)).toEqual([
    "background-success",
    "background-cancel",
    "background-failure",
    "observe-failure",
    "observe-cancel",
    "observe-success",
    "background-generation-2",
    "observe-generation-2",
  ]);
  harness.provider.assertConsumed();
});

test("navigates to a read-only child transcript", async ({ harness, page, request }) => {
  harness.provider.enqueue(
    "child-completion",
    { token: "E2E_CHILD_TOKEN" },
    { kind: "text", text: "child completed" },
  );
  const parentId = await createSession(request, harness, "direct");
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

  await page.goto(`${harness.baseUrl}/#/session/${parentId}/delegated`);
  // Docked, the Subagents panel stays beside the transcript it opens children from.
  await dockSessionDrawer(page);
  await openSessionPanel(page, "Subagents");
  const tabs = sessionPanelTabs(page);
  const parentCrumb = page.getByRole("button", { name: /, parent chat$/ });
  await page
    .getByRole("complementary", { name: "Subagents" })
    .getByRole("button", { name: "Inspect the child lifecycle", exact: true })
    .click();
  await expect(page.getByRole("textbox", { name: "Send a message" })).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/session/${childId}/`));
  await expect(parentCrumb).toBeVisible();
  await expect(page.getByText("Traditional coding agent", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Send a message" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Message" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /goal/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Branch:/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Commit", exact: true })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Insights" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Threads" })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Worksets" })).toHaveCount(0);

  // A phone lists the child's panels in its one Open panel sheet.
  await hideSessionDrawer(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobilePanel = await openPhonePanelSheet(page);
  // A row's name is its panel's, then any count it carries ("Worksets 1").
  const panelRow = (name: string) =>
    mobilePanel.getByRole("button", { name: new RegExp(`^${name}(?: |$)`) });
  await expect(panelRow("Sessions")).toHaveCount(0);
  await expect(panelRow("Insights")).toBeVisible();
  await expect(panelRow("Files")).toBeVisible();
  await expect(panelRow("History")).toBeVisible();
  await expect(panelRow("Threads")).toHaveCount(0);
  await expect(panelRow("Worksets")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Branch:/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(mobilePanel).toBeHidden();
  await page.setViewportSize({ width: 1280, height: 720 });

  await parentCrumb.click();
  await expect(page).toHaveURL(new RegExp(`/session/${parentId}/delegated$`));
  harness.provider.assertConsumed();
});

test("resizes and restores the dock beside the conversation", async ({
  harness,
  page,
  request,
}) => {
  await fs.writeFile(path.join(harness.runRoot, "workspace", "dock-fixture.txt"), "dock fixture\n");
  await page.setViewportSize({ width: 1600, height: 900 });
  const sessionId = await createDirectSession(request, harness);
  const otherId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/insights`);
  await dockSessionDrawer(page);
  const separator = page.getByRole("separator", { name: "Resize session panel" });
  const dock = page.getByRole("complementary").filter({ has: sessionPanelTabs(page) });
  await expect(separator).toBeVisible();
  await separator.focus();
  await page.keyboard.press("Shift+ArrowLeft");
  const chosen = Number(await separator.getAttribute("aria-valuenow"));
  expect(chosen).toBeGreaterThan(560);
  await separator.hover(); // Wait for the width transition before targeting the handle.
  const box = await separator.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 3, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x - 40, box!.y + box!.height / 2);
  await page.mouse.up();
  const resized = Number(await separator.getAttribute("aria-valuenow"));
  expect(resized).toBeGreaterThan(chosen);
  await openSessionPanel(page, "Files");
  const inner = dock.getByRole("separator", { name: "Resize list panel" });
  await expect(inner).toBeVisible();
  const innerBefore = Number(await inner.getAttribute("aria-valuenow"));
  await inner.focus();
  await page.keyboard.press("ArrowLeft");
  expect(Number(await inner.getAttribute("aria-valuenow"))).toBeGreaterThan(innerBefore);
  await expect(separator).toHaveAttribute("aria-valuenow", String(resized));
  await dock.getByRole("button", { name: "Full width", exact: true }).click();
  await expect(dock.getByRole("button", { name: "Exit full width" })).toBeVisible();
  await dock.getByRole("button", { name: "Exit full width" }).click();
  await expect(separator).toHaveAttribute("aria-valuenow", String(resized));
  await hideSessionDrawer(page);
  await openSessionDrawer(page);
  await expect(separator).toHaveAttribute("aria-valuenow", String(resized));
  await page.goto(`${harness.baseUrl}/#/session/${otherId}/insights`);
  await dockSessionDrawer(page);
  await expect(separator).toHaveAttribute("aria-valuenow", String(resized));
  await page.reload();
  await dockSessionDrawer(page);
  await expect(separator).toHaveAttribute("aria-valuenow", String(resized));
  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.getByRole("dialog", { name: "Insights" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Hide panel" })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("dialog", { name: "Insights" })
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
});
