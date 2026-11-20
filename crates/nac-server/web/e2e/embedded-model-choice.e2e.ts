// New-session behavior and model choice through the production-embedded app:
// Home's composer, the per-session model dialog, unified-catalog switching and
// saved provider accounts. Split from embedded.e2e.ts along that ownership seam.
import type { Page } from "@playwright/test";

import { createDirectSession, createProject, expect, test, waitForRunIdle } from "./harness";
import {
  behaviorChoice,
  chooseBehavior,
  homeComposer,
  openAdvancedModelOptions,
  openModelList,
  openSessionDrawer,
  openSessionPanel,
  sessionPanelTabs,
  startSessionFromHome,
} from "./focus-embedded-helpers";
import { ScriptGate } from "./scripted-provider";

/** Match the page's browser profile, which can differ from the test host. */
async function newChatChord(page: Page): Promise<string> {
  const isMac = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  return isMac ? "Meta+Shift+O" : "Control+Shift+O";
}

test("asks for immutable behavior on every first and new chat", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness);
  // Home's send creates the session and delivers its prompt as the first run;
  // the prompt also names the session.
  const orchestratorTitle = "Plan the managed deployment rollout";
  const directTitle = "Implement connection status feedback";
  const hybridTitle = "Coordinate release readiness review";
  for (const title of [orchestratorTitle, directTitle, hybridTitle]) {
    harness.provider.enqueue(
      `first-run-${title}`,
      { token: title },
      { kind: "text", text: `${title} acknowledged`, stream: "request" },
    );
  }
  // An explicit title outlives the auto-title, which follows the latest prompt.
  const present = async (sessionId: string, title: string) => {
    const response = await request.put(`${harness.baseUrl}/sessions/${sessionId}/presentation`, {
      data: { title, pinned: false, expected_version: 0 },
    });
    expect(response.ok()).toBe(true);
  };
  const onHome = new RegExp(`/#/\\?project=${encodeURIComponent(projectId)}$`);
  const behaviorChip = page.getByRole("button", { name: /^Behavior: / });
  const tabs = sessionPanelTabs(page);

  // An empty project offers the one new-session flow: Home's composer, pointed
  // at it, asking for the behavior with the orchestrator preselected.
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  await expect(page).toHaveURL(onHome);
  await expect(homeComposer(page)).toBeFocused();
  await expect(behaviorChip).toHaveAccessibleName("Behavior: Orchestrator");
  await behaviorChip.click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(3);
  for (const label of ["Agent", "Agent + Orchestrator", "Orchestrator"] as const) {
    await expect(behaviorChoice(page, label)).toHaveAttribute(
      "aria-checked",
      label === "Orchestrator" ? "true" : "false",
    );
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);

  // Re-entering an empty project offers the same first session again; leaving
  // the first offer must not strand the project route behind a loader.
  await page.goto(`${harness.baseUrl}/#/`);
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  await expect(page).toHaveURL(onHome);
  await expect(homeComposer(page)).toBeFocused();
  await expect(behaviorChip).toHaveAccessibleName("Behavior: Orchestrator");
  const orchestratorSessionId = await startSessionFromHome(page, orchestratorTitle);
  await waitForRunIdle(request, harness, orchestratorSessionId);
  await present(orchestratorSessionId, orchestratorTitle);
  await openSessionDrawer(page);
  await expect(tabs.getByRole("tab", { name: "Insights" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(tabs.getByRole("tab", { name: "Worksets" })).toBeVisible();
  await page.reload();
  await openSessionDrawer(page);
  await expect(tabs.getByRole("tab", { name: "Insights" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Worksets" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Threads" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.keyboard.press(await newChatChord(page));
  await expect(page).toHaveURL(onHome);
  await expect(behaviorChip).toHaveAccessibleName("Behavior: Orchestrator");
  await chooseBehavior(page, "Agent");
  const directSessionId = await startSessionFromHome(page, directTitle);
  expect(directSessionId).not.toBe(orchestratorSessionId);
  await waitForRunIdle(request, harness, directSessionId);
  await present(directSessionId, directTitle);
  await openSessionDrawer(page);
  await expect(tabs.getByRole("tab", { name: "Subagents" })).toBeVisible();
  await page.reload();
  await openSessionDrawer(page);
  await expect(tabs.getByRole("tab", { name: "Subagents" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Threads" })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Worksets" })).toHaveCount(0);
  await page.keyboard.press("Escape");

  await page.keyboard.press(await newChatChord(page));
  await expect(page).toHaveURL(onHome);
  await expect(behaviorChip).toHaveAccessibleName("Behavior: Orchestrator");
  await chooseBehavior(page, "Agent + Orchestrator");
  const hybridSessionId = await startSessionFromHome(page, hybridTitle);
  expect([orchestratorSessionId, directSessionId]).not.toContain(hybridSessionId);
  await waitForRunIdle(request, harness, hybridSessionId);
  await present(hybridSessionId, hybridTitle);
  await openSessionPanel(page, "Subagents");
  await expect(page).toHaveURL(new RegExp(`/session/${hybridSessionId}/delegated$`));
  await expect(page.getByText("No subagents yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "New Orchestrator" })).toHaveCount(0);

  const runningGate = new ScriptGate();
  harness.provider.enqueue(
    "all97-running-session",
    { token: "ALL97_RUNNING_SESSION" },
    { kind: "text", text: "release review complete", stream: "request" },
    runningGate,
  );
  const runningRequest = request.post(`${harness.baseUrl}/sessions/${directSessionId}/runs`, {
    data: { prompt: "ALL97_RUNNING_SESSION" },
  });
  await runningGate.accepted;

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.reload();
  await openSessionPanel(page, "Subagents");
  await expect(page.getByText("No subagents yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Spawn" })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Sessions" })).toHaveCount(0);
  await expect(tabs.getByRole("tab", { name: "Subagents" })).toBeVisible();
  await expect(tabs.getByRole("tab", { name: "Files" })).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByText(hybridTitle, { exact: true }).first()).toBeVisible();
  try {
    for (const [title, behavior, id, tab] of [
      [orchestratorTitle, "Orchestrator", orchestratorSessionId, "Worksets"],
      [directTitle, "Agent", directSessionId, "Subagents"],
    ] as const) {
      const row = page
        .locator('[data-sidebar="true"]')
        .getByRole("button", { name: `${title}, ${behavior}`, exact: true });
      await expect(row).toBeVisible();
      await row.click();
      await expect(page).toHaveURL(new RegExp(`/session/${id}/insights$`));
      await openSessionDrawer(page);
      await expect(tabs.getByRole("tab", { name: "Insights" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(tabs.getByRole("tab", { name: tab })).toBeVisible();
      await page.keyboard.press("Escape");
    }
  } finally {
    runningGate.release();
  }
  expect((await runningRequest).status()).toBe(202);
  await waitForRunIdle(request, harness, directSessionId);
  await expect(page.getByText("release review complete", { exact: true }).last()).toBeVisible();
  harness.provider.assertConsumed();
});

test("shows and persists the optional light model for every chat behavior", async ({
  harness,
  page,
  request,
}) => {
  const lightModel = {
    model: "gpt-5.6-sol",
    backend: "openai-responses" as const,
    base_url: harness.provider.baseUrl,
    api_key_env: "NAC_E2E_API_KEY",
    reasoning_effort: "low" as const,
  };
  const projectId = await createProject(request, harness, { lightModel });
  const expectations = [
    { behavior: "Orchestrator", routingCopy: "Worker models", prompt: "ALL_LIGHT_ORCHESTRATOR" },
    { behavior: "Agent", routingCopy: "Optional light model", prompt: "ALL_LIGHT_DIRECT" },
    {
      behavior: "Agent + Orchestrator",
      routingCopy: "Orchestrator models",
      prompt: "ALL_LIGHT_HYBRID",
    },
  ] as const;
  for (const expected of expectations) {
    harness.provider.enqueue(
      `first-run-${expected.prompt}`,
      { token: expected.prompt },
      { kind: "text", text: `${expected.prompt} acknowledged`, stream: "request" },
    );
  }
  const onHome = new RegExp(`/#/\\?project=${encodeURIComponent(projectId)}$`);
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  await expect(page).toHaveURL(onHome);

  for (const [index, expected] of expectations.entries()) {
    if (expected.behavior === "Orchestrator") {
      await expect(page.getByRole("button", { name: /^Behavior: / })).toHaveAccessibleName(
        "Behavior: Orchestrator",
      );
    } else {
      await chooseBehavior(page, expected.behavior);
    }
    // The model chip shows what the session inherits, light model included.
    const dialog = await openAdvancedModelOptions(page);
    await expect(dialog).toContainText("GPT-5.6 Sol");
    await expect(dialog).toContainText(expected.routingCopy);
    await expect(dialog.getByRole("button", { name: "Dual" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    const sessionId = await startSessionFromHome(page, expected.prompt);
    const config = await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`);
    expect(config.ok()).toBe(true);
    expect((await config.json()) as { light_model?: unknown }).toMatchObject({
      light_model: lightModel,
    });
    await waitForRunIdle(request, harness, sessionId);

    if (index < expectations.length - 1) {
      await page.keyboard.press(await newChatChord(page));
      await expect(page).toHaveURL(onHome);
    }
  }
  harness.provider.assertConsumed();
});

/**
 * Home always delivers the prompt as the new session's first run. A session on
 * a real hosted provider must never reach it from the suite, so the browser
 * holds that one admission back; the create request and stored configuration
 * are what these tests prove.
 */
async function holdFirstRunAdmission(page: Page) {
  await page.route(
    (url) => /\/sessions\/[^/]+\/runs$/.test(url.pathname),
    (route) => (route.request().method() === "POST" ? route.abort() : route.fallback()),
  );
}

test("uses the unified catalog for a cross-provider New Chat override", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness);
  await holdFirstRunAdmission(page);
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  const list = await openModelList(page);
  await page.getByRole("textbox", { name: "Search models", exact: true }).fill("deepseek-v4-flash");
  await list
    .getByRole("menuitemradio")
    .filter({ hasText: /DeepSeek V4 Flash/i })
    .click();
  await expect(list).toBeHidden();
  const created = page.waitForRequest(
    (candidate) => candidate.method() === "POST" && candidate.url().endsWith("/sessions"),
  );
  const sessionId = await startSessionFromHome(page, "ALL_CROSS_PROVIDER_OVERRIDE", {
    runAdmission: "aborted",
  });
  expect((await created).postDataJSON()).toMatchObject({
    backend: "deepseek-chat",
    model: "deepseek-v4-flash",
  });
  const config = await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`);
  expect(config.ok()).toBe(true);
  expect(await config.json()).toMatchObject({
    backend: "deepseek-chat",
    model: "deepseek-v4-flash",
    base_url: "https://api.deepseek.com",
  });
});

test("switches the active chat across configured providers from the unified composer picker", async ({
  harness,
  page,
  request,
}) => {
  const sessionId = await createDirectSession(request, harness);
  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  const list = await openModelList(page);
  await page.getByRole("textbox", { name: "Search models", exact: true }).fill("deepseek-v4-flash");

  const mutation = page.waitForRequest(
    (candidate) =>
      candidate.method() === "PATCH" && candidate.url().endsWith(`/sessions/${sessionId}/config`),
  );
  await list
    .getByRole("menuitemradio")
    .filter({ hasText: /DeepSeek V4 Flash/i })
    .click();
  const body = (await mutation).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({
    backend: "deepseek-chat",
    model: "deepseek-v4-flash",
    base_url: "https://api.deepseek.com",
    api_key_env: "DEEPSEEK_API_KEY",
    extra_headers: null,
  });
  expect(JSON.stringify(body)).not.toContain("nac-e2e-deepseek-dummy-only");

  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`);
      const config = (await response.json()) as {
        backend?: string;
        model?: string;
      };
      return `${config.backend}/${config.model}`;
    })
    .toBe("deepseek-chat/deepseek-v4-flash");
});

test("uses an Advanced saved provider account from the unified composer without exposing its key", async ({
  harness,
  page,
  request,
}) => {
  const sessionId = await createDirectSession(request, harness);
  const canary = "advanced-provider-secret-must-stay-server-side";
  const created = await request.post(`${harness.baseUrl}/model-configs`, {
    data: {
      name: "Advanced Fireworks account",
      backend: "fireworks-chat",
      model: "gpt-5.6-sol",
      base_url: harness.provider.baseUrl,
      api_key: canary,
    },
  });
  expect(created.ok()).toBe(true);
  const saved = (await created.json()) as { api_key_env?: string };
  expect(saved.api_key_env).toMatch(/^NAC_CONFIG_/);
  expect(JSON.stringify(saved)).not.toContain(canary);

  const catalog = await request.get(`${harness.baseUrl}/models`);
  const provider = (
    (await catalog.json()) as {
      providers: Array<{
        id: string;
        auth_status: string;
        connection: { base_url: string; api_key_env: string | null } | null;
      }>;
    }
  ).providers.find((entry) => entry.id === "fireworks-chat");
  expect(provider).toMatchObject({
    auth_status: "ready",
    connection: {
      base_url: harness.provider.baseUrl,
      api_key_env: saved.api_key_env,
    },
  });

  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  const list = await openModelList(page);
  await page.getByRole("textbox", { name: "Search models", exact: true }).fill("gpt-5.6-sol");
  const mutation = page.waitForRequest(
    (candidate) =>
      candidate.method() === "PATCH" && candidate.url().endsWith(`/sessions/${sessionId}/config`),
  );
  await list
    .getByText("Fireworks", { exact: true })
    .locator("..")
    .getByRole("menuitemradio", { name: /^GPT-5\.6 Sol|^gpt-5\.6-sol/i })
    .click();
  const body = (await mutation).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({
    backend: "fireworks-chat",
    model: "gpt-5.6-sol",
    base_url: harness.provider.baseUrl,
    api_key_env: saved.api_key_env,
    extra_headers: null,
  });
  expect(JSON.stringify(body)).not.toContain(canary);

  await expect
    .poll(async () => {
      const response = await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`);
      const config = (await response.json()) as {
        backend?: string;
        api_key_env?: string | null;
      };
      return `${config.backend}/${config.api_key_env}`;
    })
    .toBe(`fireworks-chat/${saved.api_key_env}`);
});

test("uses an Advanced saved provider account for the light model without exposing its key", async ({
  harness,
  page,
  request,
}) => {
  const canary = "advanced-light-provider-secret-must-stay-server-side";
  const created = await request.post(`${harness.baseUrl}/model-configs`, {
    data: {
      name: "Advanced Fireworks light account",
      backend: "fireworks-chat",
      model: "gpt-5.6-sol",
      base_url: harness.provider.baseUrl,
      api_key: canary,
    },
  });
  expect(created.ok()).toBe(true);
  const saved = (await created.json()) as { api_key_env?: string };
  expect(saved.api_key_env).toMatch(/^NAC_CONFIG_/);
  expect(JSON.stringify(saved)).not.toContain(canary);

  const projectId = await createProject(request, harness);
  harness.provider.enqueue(
    "advanced-light-first-run",
    { token: "ALL_ADVANCED_LIGHT_FIRST_RUN" },
    { kind: "text", text: "advanced light account session started", stream: "request" },
  );
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  const dialog = await openAdvancedModelOptions(page);
  await dialog.getByRole("button", { name: "Dual" }).click();
  const lightRow = dialog.getByText("Light model*", { exact: true }).locator("..").locator("..");
  await lightRow.getByRole("button").click();
  await page.getByPlaceholder("Search models…").fill("fireworks-chat");
  await page
    .getByRole("group", { name: "Model results", exact: true })
    .getByRole("button", { name: /^gpt-5\.6-sol\b/ })
    .click();

  await dialog.getByRole("button", { name: "Use this model", exact: true }).click();
  await expect(dialog).toBeHidden();

  const mutation = page.waitForRequest(
    (candidate) => candidate.method() === "POST" && candidate.url().endsWith("/sessions"),
  );
  const sessionId = await startSessionFromHome(page, "ALL_ADVANCED_LIGHT_FIRST_RUN");
  const body = (await mutation).postDataJSON() as {
    light_model?: Record<string, unknown> | null;
  };
  expect(body.light_model).toMatchObject({
    backend: "fireworks-chat",
    model: "gpt-5.6-sol",
    base_url: harness.provider.baseUrl,
    api_key_env: saved.api_key_env,
  });
  expect(JSON.stringify(body)).not.toContain(canary);

  const config = await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`);
  expect(config.ok()).toBe(true);
  expect((await config.json()) as { light_model?: unknown }).toMatchObject({
    light_model: {
      backend: "fireworks-chat",
      model: "gpt-5.6-sol",
      base_url: harness.provider.baseUrl,
      api_key_env: saved.api_key_env,
    },
  });
  await waitForRunIdle(request, harness, sessionId);
  harness.provider.assertConsumed();
});

test("converges concurrent required-first-chat tabs and refreshes deleted ownership", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness);
  const onHome = new RegExp(`/#/\\?project=${encodeURIComponent(projectId)}$`);
  const sessionsOf = async () => {
    const sessions = await request.get(
      `${harness.baseUrl}/sessions?project_id=${encodeURIComponent(projectId)}`,
    );
    expect(sessions.ok()).toBe(true);
    return (await sessions.json()) as unknown[];
  };
  const second = await page.context().newPage();
  try {
    // Both tabs land on Home's composer for the empty project; opening a
    // project never creates a session by itself.
    await Promise.all([
      page.goto(`${harness.baseUrl}/#/project/${projectId}`),
      second.goto(`${harness.baseUrl}/#/project/${projectId}`),
    ]);
    await Promise.all([expect(page).toHaveURL(onHome), expect(second).toHaveURL(onHome)]);
    await Promise.all([
      expect(homeComposer(page)).toBeVisible(),
      expect(homeComposer(second)).toBeVisible(),
    ]);
    expect(await sessionsOf()).toHaveLength(0);

    // Hold both real creates at the same admission boundary. Each tab still
    // believes this project has no primary session when it sends first_chat.
    let releaseCreates!: () => void;
    const createsReady = new Promise<void>((resolve) => {
      releaseCreates = resolve;
    });
    const creates: unknown[] = [];
    for (const tab of [page, second]) {
      await tab.route(`${harness.baseUrl}/sessions`, async (route) => {
        if (route.request().method() !== "POST") return route.continue();
        creates.push(route.request().postDataJSON());
        await createsReady;
        await route.continue();
      });
      // A known first-run rejection must retain each distinct prompt without
      // replay. Session admission itself remains the real server transaction.
      await tab.route("**/sessions/*/runs", (route) =>
        route.fulfill({ status: 409, json: { error: "session is busy with a local operation" } }),
      );
    }
    const rejected = [page, second].map((tab) =>
      tab.waitForResponse(
        (response) =>
          /\/sessions\/[^/]+\/runs$/.test(new URL(response.url()).pathname) &&
          response.request().method() === "POST",
      ),
    );
    const starts = [
      startSessionFromHome(page, "FIRST_TAB_PROMPT", { runAdmission: "busy" }),
      startSessionFromHome(second, "SECOND_TAB_PROMPT", { runAdmission: "busy" }),
    ];
    await expect.poll(() => creates.length).toBe(2);
    releaseCreates();
    for (const body of creates)
      expect(body).toMatchObject({ first_chat: true, first_chat_same_behavior: false });
    const [firstSessionId, otherSessionId] = await Promise.all(starts);
    expect(otherSessionId).toBe(firstSessionId);
    expect(await sessionsOf()).toHaveLength(1);
    for (const reply of await Promise.all(rejected)) expect(reply.status()).toBe(409);
    await expect(page.getByRole("combobox", { name: "Message", exact: true })).toHaveValue(
      "FIRST_TAB_PROMPT",
    );
    await expect(second.getByRole("combobox", { name: "Message", exact: true })).toHaveValue(
      "SECOND_TAB_PROMPT",
    );

    const deleted = await request.delete(`${harness.baseUrl}/projects/${projectId}`);
    expect(deleted.ok()).toBe(true);
    await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
    await expect(page).toHaveURL(/\/#\/$/);
    harness.provider.assertConsumed();
  } finally {
    await second.close();
  }
});
