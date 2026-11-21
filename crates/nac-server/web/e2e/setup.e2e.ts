import { chooseFixtureComposerModel } from "./model-fixture";
import { createProject, createSession, expect, test, waitForRunIdle } from "./harness";
import type { CreateSessionRequest, ModelCatalog } from "../src/app/types/api";
import { homeComposer, openModelList, startSessionFromHome } from "./focus-embedded-helpers";

test.use({ orchestration: "0" });

test("offers the launch folder without creating projects until the user chooses it", async ({
  harness,
  page,
  request,
}) => {
  await page.goto(harness.baseUrl);
  await expect(page.getByRole("heading", { name: "Add a project", exact: true })).toBeVisible();
  const launch = page.getByRole("button", {
    name: "Use launch folder",
    exact: true,
  });
  await expect(launch).toBeVisible();
  const projectsUrl = `${harness.baseUrl}/projects`;
  expect((await (await request.get(projectsUrl)).json()).projects).toEqual([]);
  await launch.click();
  await expect(page).toHaveURL(/#\/\?project=[^&]+$/);
  await expect(homeComposer(page)).toBeFocused();
  expect((await (await request.get(projectsUrl)).json()).projects).toHaveLength(1);
  expect(await (await request.get(`${harness.baseUrl}/sessions`)).json()).toEqual([]);
});

test("a rejected Sandbox launch keeps the draft and never starts a Local session", async ({
  harness,
  page,
  request,
}) => {
  const projectId = await createProject(request, harness);
  let probes = 0;
  await page.route("**/sandbox/availability", (route) => {
    probes++;
    return route.fulfill({ json: { status: "ready" } });
  });
  const launches: CreateSessionRequest[] = [];
  await page.route("**/sessions", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    launches.push(route.request().postDataJSON() as CreateSessionRequest);
    return route.fulfill({
      status: 400,
      json: { error: "Fixture Podman launch rejected" },
    });
  });
  await page.goto(`${harness.baseUrl}/#/?project=${projectId}`);
  const draft = homeComposer(page);
  await draft.fill("Run the fixture in a sandbox");
  await chooseFixtureComposerModel(page);
  await expect(page.getByRole("button", { name: "Start session", exact: true })).toBeEnabled();
  expect(probes).toBe(0);
  const workspace = page.getByRole("button", { name: "Additional settings" });
  await workspace.click();
  await page.getByRole("switch", { name: "Sandbox", exact: true }).click();
  await page.getByRole("button", { name: "Sandbox options" }).click();
  await page.getByRole("textbox", { name: "Container image" }).fill("fixture-image");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Start sandbox session" }).click();
  await expect(page.getByRole("alert")).toContainText("Fixture Podman launch rejected");
  await expect(draft).toHaveValue("Run the fixture in a sandbox");
  expect(launches).toHaveLength(1);
  expect(launches[0]).toMatchObject({
    project_id: projectId,
    first_chat: false,
    sandbox: { enabled: true, image: "fixture-image" },
  });
  expect(await (await request.get(`${harness.baseUrl}/sessions`)).json()).toEqual([]);
});

for (const mobile of [false, true]) {
  test(`reviews direct setup, session-only settings and failed saves (${mobile ? "mobile" : "desktop"})`, async ({
    harness,
    page,
    request,
  }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    const projectId = await createProject(request, harness);
    await page.goto(`${harness.baseUrl}/#/project/${projectId}`);
    await expect(page).toHaveURL(new RegExp(`#/\\?project=${projectId}$`));
    await chooseFixtureComposerModel(page);
    const modelChip = page.getByRole("button", { name: /^Model: / });
    await modelChip.click();
    await page.getByRole("radio", { name: "High", exact: true }).press("Space");
    await page.keyboard.press("Escape");
    await expect(modelChip).toHaveAccessibleName(/high reasoning/i);
    await openModelList(page);
    await page.keyboard.press("Escape");
    await expect(modelChip).toBeFocused();

    harness.provider.enqueue(
      "setup-first-run",
      { token: "SETUP_FIRST_RUN" },
      { kind: "text", text: "Setup first run complete.", stream: "request" },
    );
    const sessionId = await startSessionFromHome(page, "SETUP_FIRST_RUN");
    await waitForRunIdle(request, harness, sessionId);
    const configUrl = `${harness.baseUrl}/sessions/${sessionId}/config`;
    const before = await (await request.get(configUrl)).json();
    expect(before).toMatchObject({ reasoning_effort: "high" });
    expect(before).toMatchObject({
      backend: "openai-responses",
      model: "gpt-5.6-sol",
    });
    const projectBefore = await (await request.get(`${harness.baseUrl}/projects`)).json();

    const chooseEffort = async (label: "Low" | "High") => {
      await modelChip.click();
      await page.getByRole("radio", { name: label, exact: true }).press("Space");
    };
    await chooseEffort("Low");
    await expect(page.getByText("Reasoning set to low", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modelChip).toHaveAccessibleName(/low reasoning/i);
    const saved = await (await request.get(configUrl)).json();
    expect(saved).toMatchObject({
      ...before,
      config_version: before.config_version + 1,
      reasoning_effort: "low",
    });
    expect(await (await request.get(`${harness.baseUrl}/projects`)).json()).toEqual(projectBefore);

    let attempts = 0;
    await page.route(configUrl, async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      attempts += 1;
      await route.abort("failed");
    });
    await chooseEffort("High");
    await expect(page.getByText(/configuration save outcome is unknown/i)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modelChip).toBeDisabled();
    expect(attempts).toBe(1);
    expect(await (await request.get(configUrl)).json()).toEqual(saved);
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
      route.fulfill({
        json: { providers: [auth("arcee", true), auth("codex", codexReady)] },
      }),
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
      await route.fulfill({
        json: { state: "complete", auth: auth("codex", true) },
      });
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
        return route.fulfill({
          json: { base_url: "https://api.arcee.ai/api/v1", models: [] },
        });
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
    const sessionUrl = `${harness.baseUrl}/#/session/${sessionId}/files`;
    const accountsUrl = `${harness.baseUrl}/#/settings/accounts`;
    await page.goto(accountsUrl);
    const accounts = page.getByRole("region", {
      name: "Subscriptions",
      exact: true,
    });
    await expect(accounts.getByText("Signed in", { exact: true })).toHaveCount(1);
    const popup = page.waitForEvent("popup");
    await accounts.getByRole("button", { name: "Sign in with ChatGPT", exact: true }).click();
    await (await popup).close();
    await expect(accounts.getByText("Signed in", { exact: true })).toHaveCount(2);

    await page.goto(sessionUrl);
    let models = await openModelList(page);
    await page.getByRole("textbox", { name: "Search models" }).fill("codex-setup-fixture");
    await expect(models.getByRole("menuitemradio", { name: /Codex setup fixture/ })).toBeVisible();
    expect(modelsRequests).toContainEqual({
      backend: "chatgpt-codex-responses",
    });

    await page.goto(accountsUrl);
    await expect(accounts.getByText("Signed in", { exact: true })).toHaveCount(2);
    await accounts.getByRole("button", { name: "Sign out", exact: true }).first().click();
    await expect(accounts.getByText("Signed in", { exact: true })).toHaveCount(1);
    expect(arceeLogouts).toBe(0);

    await page.goto(sessionUrl);
    models = await openModelList(page);
    await page.getByRole("textbox", { name: "Search models" }).fill("codex-setup-fixture");
    await expect(models.getByText("No matching models")).toBeVisible();
    expect(
      await (await request.get(`${harness.baseUrl}/sessions/${sessionId}/config`)).json(),
    ).toMatchObject({ model: "gpt-5.6-sol", backend: "openai-responses" });
  });
}

test("session model changes leave existing children unchanged and future children inherit the parent", async ({
  harness,
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
      data: {
        profile: "general",
        description: token,
        prompt: token,
        background: false,
      },
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
  const update = await request.patch(`${harness.baseUrl}/sessions/${parentId}/config`, {
    data: { model: "gpt-5.6-terra", reasoning_effort: "low" },
  });
  expect(update.ok()).toBe(true);
  const current = await (
    await request.get(`${harness.baseUrl}/sessions/${parentId}/config`)
  ).json();
  expect(current).toMatchObject({
    model: "gpt-5.6-terra",
    reasoning_effort: "low",
  });
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
