import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import type { ModelCatalog } from "../src/app/types/api";

test.use({ orchestration: "0" });

for (const mobile of [false, true]) {
  test(`reviews inherited direct setup, session-only settings and failed saves (${mobile ? "mobile" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const projectId = await createProject(request, harness);
    await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
    const dialog = page.getByRole("dialog", { name: "New Chat" });
    await expect(dialog).toContainText("Inherited from the project default");
    await expect(dialog).toContainText("reasoning high");
    await expect(dialog.getByText("Primary model", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("radiogroup")).toHaveCount(0);
    await expect(dialog.getByText("Optional light model", { exact: true })).toHaveCount(0);
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && response.url() === `${harness.baseUrl}/sessions`,
    );
    await dialog.getByRole("button", { name: "Create chat", exact: true }).focus();
    await page.keyboard.press("Enter");
    const response = await created;
    expect(response.ok()).toBe(true);
    const sessionId = (await response.json()).metadata.session_id;
    await expect(page).toHaveURL(new RegExp(`/session/${sessionId}/files`));
    const configUrl = `${harness.baseUrl}/sessions/${sessionId}/config`;
    const before = await (await request.get(configUrl)).json();
    expect(before).toMatchObject({
      reasoning_effort: "high",
      orchestrator_compaction_threshold: null,
    });
    const projectBefore = await (await request.get(`${harness.baseUrl}/projects`)).json();

    await page.getByRole("button", { name: "Session settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Session settings", exact: true });
    await expect(settings).toContainText(
      "Project defaults and existing children keep their settings",
    );
    await expect(settings.getByText("Primary model", { exact: true })).toBeVisible();
    await settings
      .getByRole("textbox", { name: "Session title", exact: true })
      .fill(`Setup ${mobile ? "mobile" : "desktop"}`);
    await settings.getByText("Advanced execution settings", { exact: true }).click();
    await settings.getByRole("button", { name: "Advanced Configurations", exact: true }).click();
    await settings.getByRole("textbox", { name: "Context limit", exact: true }).fill("222");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings).toHaveCount(0);
    const saved = await (await request.get(configUrl)).json();
    expect(saved).toMatchObject({
      ...before,
      config_version: before.config_version + 1,
      orchestrator_compaction_threshold: 222,
    });
    expect(await (await request.get(`${harness.baseUrl}/projects`)).json()).toEqual(projectBefore);

    await page.getByRole("button", { name: "Session settings", exact: true }).click();
    await settings.getByText("Advanced execution settings", { exact: true }).click();
    await settings.getByRole("button", { name: "Advanced Configurations", exact: true }).click();
    await settings.getByRole("textbox", { name: "Context limit", exact: true }).fill("333");
    let attempts = 0;
    await page.route(configUrl, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      attempts += 1;
      await route.abort("failed");
    });
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings.getByRole("alert")).toContainText("outcome is unknown");
    await settings
      .getByRole("textbox", { name: "Session title", exact: true })
      .fill("Edited after unknown outcome");
    await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect(attempts).toBe(1);
    await page.unroute(configUrl);
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);

    await page.getByRole("button", { name: "Session settings", exact: true }).click();
    await expect(
      settings.getByRole("textbox", { name: "Session title", exact: true }),
    ).toBeVisible();
    const externalSave = await request.patch(configUrl, {
      data: { orchestrator_compaction_threshold: 444 },
    });
    expect(externalSave.ok()).toBe(true);
    await settings
      .getByRole("textbox", { name: "Session title", exact: true })
      .fill("Stale editor must not rename");
    await settings.getByRole("button", { name: "Save", exact: true }).click();
    await expect(settings.getByRole("alert")).toContainText("settings changed");
    await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    const summary = await (await request.get(`${harness.baseUrl}/sessions`)).json();
    expect(
      summary.find(
        (entry: { summary: { session_id: string } }) => entry.summary.session_id === sessionId,
      ).summary.title,
    ).toBe(`Setup ${mobile ? "mobile" : "desktop"}`);
    const footer = await settings.getByRole("button", { name: "Save", exact: true }).boundingBox();
    expect(footer).not.toBeNull();
    expect(footer!.y + footer!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
    await page.keyboard.press("Escape");
  });

  test(`connects Codex alongside Arcee and updates available models without changing project (${mobile ? "mobile" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const projectId = await createProject(request, harness);
    const sessionId = await createSession(request, harness, "direct", projectId);
    const initialCatalog = (await (
      await request.get(`${harness.baseUrl}/models`)
    ).json()) as ModelCatalog;
    let codexReady = false;
    let arceeLogouts = 0;
    const modelsRequests: unknown[] = [];
    const auth = (provider: "arcee" | "codex", signedIn: boolean) => ({
      provider,
      signed_in: signedIn,
      backend: provider === "arcee" ? "arcee-auth" : "chatgpt-codex-responses",
      base_url:
        provider === "arcee"
          ? "https://api.arcee.ai/api/v1"
          : "https://chatgpt.com/backend-api/codex",
      account: `${provider}@example.test`,
      organization: null,
      expires_at_ms: null,
      path: `/server-owned/${provider}.json`,
    });
    // OAuth itself is an external boundary. The production UI observes these deterministic account outcomes.
    await page.route(`${harness.baseUrl}/auth`, (route) =>
      route.fulfill({ json: { providers: [auth("arcee", true), auth("codex", codexReady)] } }),
    );
    await page.route(`${harness.baseUrl}/auth/arcee`, async (route) => {
      arceeLogouts += 1;
      await route.fulfill({ json: auth("arcee", false) });
    });
    await page.route(`${harness.baseUrl}/auth/codex/login`, (route) =>
      route.fulfill({
        json: {
          provider: "codex",
          login_id: "setup-login",
          verification_uri: `${harness.baseUrl}/health`,
          user_code: "SETUP",
          expires_in_secs: 600,
        },
      }),
    );
    await page.route(`${harness.baseUrl}/auth/codex/login/setup-login`, async (route) => {
      codexReady = true;
      await route.fulfill({ json: { state: "complete", auth: auth("codex", true) } });
    });
    await page.route(`${harness.baseUrl}/auth/codex`, async (route) => {
      codexReady = false;
      await route.fulfill({ json: auth("codex", false) });
    });
    await page.route(`${harness.baseUrl}/models`, async (route) => {
      const original = initialCatalog.providers.find(
        (provider) => provider.id === "chatgpt-codex-responses",
      )!;
      const provider = {
        ...original,
        auth_status: codexReady ? "ready" : "no_credential",
        models: [
          {
            ...initialCatalog.providers.flatMap((entry) => entry.models)[0]!,
            id: "codex-setup-fixture",
            display_name: "Codex setup fixture",
            supported_efforts: ["high"],
          },
        ],
      };
      await route.fulfill({
        json: {
          ...initialCatalog,
          providers: initialCatalog.providers.map((entry) =>
            entry.id === provider.id ? provider : entry,
          ),
        },
      });
    });
    await page.route(`${harness.baseUrl}/providers/models`, async (route) => {
      if (route.request().postDataJSON().backend === "arcee-auth")
        return route.fulfill({ json: { base_url: "https://api.arcee.ai/api/v1", models: [] } });
      if (route.request().postDataJSON().backend !== "chatgpt-codex-responses")
        return route.continue();
      modelsRequests.push(route.request().postDataJSON());
      await route.fulfill({
        json: {
          base_url: "https://chatgpt.com/backend-api/codex",
          models: [{ id: "codex-setup-fixture", display_name: "Codex setup fixture" }],
          api_key_env: null,
        },
      });
    });
    await page.goto(`${harness.baseUrl}/#/session/${sessionId}/files`);
    await page.getByRole("button", { name: "Session settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Session settings", exact: true });
    await settings.getByRole("button", { name: "Provider connections", exact: true }).click();
    const accounts = settings.getByRole("region", { name: "Provider connections" });
    await expect(accounts.getByText("Signed in", { exact: true })).toHaveCount(1);
    const popup = page.waitForEvent("popup");
    await accounts.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
    await (await popup).close();
    await expect(accounts.getByText("Signed in", { exact: true })).toHaveCount(2);
    await settings.getByRole("button").filter({ hasText: "GPT-5.6 Sol" }).first().click();
    await page.getByPlaceholder("Search models…").fill("codex-setup-fixture");
    await expect(page.getByText("Codex setup fixture", { exact: true })).toBeVisible();
    await page.getByPlaceholder("Search models…").press("Enter");
    await expect(
      settings.getByRole("button").filter({ hasText: "Codex setup fixture" }).first(),
    ).toBeVisible();
    await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
    expect(modelsRequests).toContainEqual({ backend: "chatgpt-codex-responses" });
    await accounts.getByRole("button", { name: "Sign out", exact: true }).last().click();
    await expect(accounts.getByText("Signed in", { exact: true })).toHaveCount(1);
    await expect(settings.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect(arceeLogouts).toBe(0);
    await expect(page).toHaveURL(new RegExp(`/session/${sessionId}/files`));
    expect(
      await (await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`)).json(),
    ).toMatchObject({ model: "gpt-5.6-sol", backend: "openai-responses" });
    await page.keyboard.press("Escape");
  });
}

test("explicitly updates a saved project default while existing children keep creation snapshots and future children inherit the accepted parent", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness);
  const parentId = await createSession(request, harness, "direct", projectId);
  const child = async (token: string) => {
    harness.provider.enqueue(
      token,
      { token },
      { kind: "text", text: `${token} complete`, stream: true },
    );
    const response = await request.post(`${harness.baseUrl}/sessions/${parentId}/children`, {
      data: { profile: "general", description: token, prompt: token, background: false },
    });
    expect(response.ok()).toBe(true);
    const id = (await response.json()).child_session_id;
    await waitForRunIdle(request, harness, id);
    return id as string;
  };
  const existingChild = await child("SETUP_CHILD_BEFORE");
  const existingBefore = await (
    await request.get(`${harness.baseUrl}/sessions/${existingChild}/config`)
  ).json();
  const presetResponse = await request.post(`${harness.baseUrl}/model-configs`, {
    data: {
      name: "Explicit future default",
      backend: "openai-responses",
      model: "gpt-5.6-terra",
      base_url: harness.provider.baseUrl,
      api_key: "nac-e2e-dummy-only",
      reasoning_effort: "low",
      extra_headers: { "X-Setup": "future" },
      orchestrator_compaction_threshold: 555,
      light_model: null,
    },
  });
  expect(presetResponse.ok()).toBe(true);
  const preset = await presetResponse.json();
  await page.goto(`${harness.baseUrl}/#/session/${parentId}/files`);
  await page.getByRole("button", { name: "Session settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Session settings", exact: true });
  await settings
    .getByRole("button", { name: "Advanced presets and provider setup", exact: true })
    .click();
  await settings.getByRole("button", { name: "Create New", exact: true }).click();
  await page.getByText("Explicit future default", { exact: true }).click();
  await settings
    .getByRole("checkbox", { name: /Use selected preset as the project default/ })
    .check();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  await expect(settings).toHaveCount(0);
  const current = await (
    await request.get(`${harness.baseUrl}/sessions/${parentId}/config`)
  ).json();
  expect(current).toMatchObject({
    model: "gpt-5.6-terra",
    reasoning_effort: "low",
    orchestrator_compaction_threshold: 555,
    api_key_env: preset.api_key_env,
    extra_headers_json: '{"X-Setup":"future"}',
  });
  const projects = await (await request.get(`${harness.baseUrl}/projects`)).json();
  expect(
    projects.projects.find((project: { project_id: string }) => project.project_id === projectId)
      .default_model_config_id,
  ).toBe(preset.config_id);
  // Opening the exact saved tuple auto-selects its preset. The explicit default
  // action must retain that identity without requiring a redundant re-selection.
  await page.getByRole("button", { name: "Session settings", exact: true }).click();
  await settings
    .getByRole("button", { name: "Advanced presets and provider setup", exact: true })
    .click();
  await expect(settings.getByText("Explicit future default", { exact: true })).toBeVisible();
  await settings
    .getByRole("checkbox", { name: /Use selected preset as the project default/ })
    .check();
  const repeatedDefault = page.waitForResponse(
    (response) =>
      response.url() === `${harness.baseUrl}/projects/${projectId}` &&
      response.request().method() === "PATCH",
  );
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  const defaultResponse = await repeatedDefault;
  expect(defaultResponse.ok()).toBe(true);
  expect(defaultResponse.request().postDataJSON()).toMatchObject({
    default_model_config_id: preset.config_id,
  });
  await expect(settings).toHaveCount(0);
  expect(
    await (await request.get(`${harness.baseUrl}/sessions/${parentId}/config`)).json(),
  ).toEqual(current);
  expect(
    await (await request.get(`${harness.baseUrl}/sessions/${existingChild}/config`)).json(),
  ).toEqual(existingBefore);
  const futureChild = await child("SETUP_CHILD_AFTER");
  expect(
    await (await request.get(`${harness.baseUrl}/sessions/${futureChild}/config`)).json(),
  ).toMatchObject({
    model: current.model,
    backend: current.backend,
    reasoning_effort: current.reasoning_effort,
    api_key_env: current.api_key_env,
    orchestrator_compaction_threshold: 555,
    extra_headers_json: current.extra_headers_json,
  });
  const forbidden = await request.patch(`${harness.baseUrl}/sessions/${existingChild}/config`, {
    data: { model: "gpt-5.6-terra" },
  });
  expect(forbidden.status()).toBe(409);
  expect(
    await (await request.get(`${harness.baseUrl}/sessions/${existingChild}/config`)).json(),
  ).toEqual(existingBefore);
  harness.provider.assertConsumed();
});
