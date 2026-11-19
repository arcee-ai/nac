// New-session behavior and model choice through the production-embedded app:
// Home's composer, the per-session model dialog, unified-catalog switching and
// saved provider accounts. Split from embedded.e2e.ts along that ownership seam.
import type { Page } from "@playwright/test";
import { createDirectSession, createProject, expect, test } from "./harness";
import { homeComposer, startSessionFromHome } from "./focus-embedded-helpers";

async function holdFirstRunAdmission(page: Page) {
  await page.route(
    (url) => /\/sessions\/[^/]+\/runs$/.test(url.pathname),
    (route) => (route.request().method() === "POST" ? route.abort() : route.fallback()),
  );
}

async function chooseFixtureModel(page: Page) {
  await page.getByRole("button", { name: "Choose a model" }).click();
  const dialog = page.getByRole("dialog", { name: "Model for this session" });
  await dialog.locator("button[aria-expanded]").first().click();
  await page.getByRole("textbox", { name: "Search models" }).fill("gpt-5.6-sol");
  await page
    .locator('[aria-label="Model results"] button[data-row]')
    .filter({ hasText: /gpt-5\.6/i })
    .locator("..")
    .filter({ hasText: "OpenAI Responses" })
    .locator("button[data-row]")
    .first()
    .click();
  await dialog.getByRole("button", { name: "Use this model" }).click();
}

test("uses the unified catalog for a cross-provider New Chat override", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness);
  await holdFirstRunAdmission(page);
  await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
  await page.getByRole("button", { name: /^(Model: |Choose a model$)/ }).click();
  const dialog = page.getByRole("dialog", { name: "Model for this session", exact: true });
  await expect(dialog.getByText("Primary model", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Provider connections" })).toBeVisible();
  await dialog.locator("button[aria-expanded]").first().click();
  await page.getByPlaceholder("Search models…").fill("deepseek-v4-flash");
  await page.getByText("deepseek-v4-flash", { exact: true }).click();
  await dialog.getByRole("button", { name: "Use this model", exact: true }).click();
  await expect(dialog).toBeHidden();
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
  const modelButton = page.getByRole("button", { name: "Model" });
  await expect(modelButton).toBeVisible();
  await modelButton.click();
  await page.getByPlaceholder("Search models…").fill("deepseek-v4-flash");

  const mutation = page.waitForRequest(
    (candidate) =>
      candidate.method() === "PATCH" && candidate.url().endsWith(`/sessions/${sessionId}/config`),
  );
  await page.getByText("deepseek-v4-flash", { exact: true }).click();
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

test("uses a provider connection from the unified composer without exposing its key", async ({
  harness,
  page,
  request,
}) => {
  const sessionId = await createDirectSession(request, harness);
  const canary = "advanced-provider-secret-must-stay-server-side";
  const created = await request.post(`${harness.baseUrl}/provider-connections`, {
    data: {
      backend: "fireworks-chat",
      base_url: harness.provider.baseUrl,
      api_key: canary,
    },
  });
  expect(created.ok()).toBe(true);
  const saved = await created.json();
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
    connection: { base_url: harness.provider.baseUrl },
  });
  const selector = provider?.connection?.api_key_env;
  expect(selector).toMatch(/^NAC_PROVIDER_/);

  await page.goto(`${harness.baseUrl}/#/session/${sessionId}/delegated`);
  await page.getByRole("button", { name: "Model" }).click();
  await page.getByPlaceholder("Search models…").fill("fireworks-chat");
  const mutation = page.waitForRequest(
    (candidate) =>
      candidate.method() === "PATCH" && candidate.url().endsWith(`/sessions/${sessionId}/config`),
  );
  await page
    .getByRole("group", { name: "Model results", exact: true })
    .getByRole("button", { name: /^gpt-5\.6-sol\b/ })
    .click();
  const body = (await mutation).postDataJSON() as Record<string, unknown>;
  expect(body).toMatchObject({
    backend: "fireworks-chat",
    model: "gpt-5.6-sol",
    base_url: harness.provider.baseUrl,
    api_key_env: selector,
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
    .toBe(`fireworks-chat/${selector}`);
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
    await Promise.all([chooseFixtureModel(page), chooseFixtureModel(second)]);

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
      expect(body).toMatchObject({ first_chat: true, first_chat_same_behavior: true });
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
